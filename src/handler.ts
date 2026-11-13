import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createTempCookieCopy,
  deleteCookieProfile,
  listCookieProfiles,
  normalizeCookieDomain,
  resolveCookieProfilePath,
  saveCookieProfile,
} from "./cookies";
import type {
  DownloaderPort,
  MediaArchivePort,
  WahaClientPort,
  WahaMessageEvent,
} from "./types";

export interface MessageHandlerDeps {
  waha: WahaClientPort;
  downloader: DownloaderPort;
  archive: MediaArchivePort;
  downloadConcurrency?: number;
  maxWhatsappMediaBytes: number;
  tmpDir: string;
  cookiesDir?: string;
}

function createConcurrencyQueue(limit: number) {
  const maxConcurrent = Math.max(1, limit);
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active -= 1;
      }
    }
  };
}

function extractCommandText(event: WahaMessageEvent): string {
  const raw = event.payload.body ?? event.payload.caption ?? "";
  return raw.trim();
}

function isValidHttpUrl(token: string): boolean {
  try {
    const parsed = new URL(token);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseDlUrls(text: string): string[] {
  const match = text.match(/^\/dl(?:\s+|$)(.*)/s);
  if (!match) {
    return [];
  }
  const rest = match[1]?.trim();
  if (!rest) {
    return [];
  }
  return rest.split(/\s+/).filter(isValidHttpUrl);
}

function buildObjectKey(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `downloads/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
}

async function handleCookiesCommand(
  deps: MessageHandlerDeps,
  payload: WahaMessageEvent["payload"],
  chatId: string,
  text: string,
): Promise<void> {
  if (!deps.cookiesDir) {
    await deps.waha.sendText({
      chatId,
      text: "Cookie storage is not configured.",
      replyTo: payload.id,
    });
    return;
  }

  const [firstLine, ...restLines] = text.split(/\r?\n/);
  const args = (firstLine ?? "").trim().split(/\s+/).slice(1);
  const subcommand = args[0] ?? "";

  if (subcommand === "list" && args.length === 1) {
    const domains = await listCookieProfiles(deps.cookiesDir, payload);
    const replyText =
      domains.length > 0
        ? `Stored Cookie Profiles:\n${domains.map((d) => `- ${d}`).join("\n")}`
        : "No Cookie Profiles stored.";
    await deps.waha.sendText({
      chatId,
      text: replyText,
      replyTo: payload.id,
    });
    return;
  }

  if (subcommand === "del") {
    const targetDomain = args[1] ?? "";
    const result = await deleteCookieProfile(
      deps.cookiesDir,
      payload,
      targetDomain,
    );
    const replyText =
      result.status === "deleted"
        ? `Deleted Cookie Profile for ${result.domain}.`
        : result.status === "not_found"
          ? `No Cookie Profile found for ${result.domain}.`
          : `Invalid domain "${targetDomain}".`;
    await deps.waha.sendText({
      chatId,
      text: replyText,
      replyTo: payload.id,
    });
    return;
  }

  const rawDomain = subcommand;
  if (!rawDomain) {
    await deps.waha.sendText({
      chatId,
      text: "Usage: /cookies <domain>, /cookies list, or /cookies del <domain>.",
      replyTo: payload.id,
    });
    return;
  }

  const normalizedDomain = normalizeCookieDomain(rawDomain);
  if (!normalizedDomain) {
    await deps.waha.sendText({
      chatId,
      text: `Invalid domain "${rawDomain}".`,
      replyTo: payload.id,
    });
    return;
  }

  let cookieContent: string | null = null;
  if (payload.media?.url) {
    const filename = payload.media.filename;
    if (filename && !filename.toLowerCase().endsWith(".txt")) {
      await deps.waha.sendText({
        chatId,
        text: "Cookie attachment must be a .txt Netscape cookie file.",
        replyTo: payload.id,
      });
      return;
    }

    try {
      cookieContent = await deps.waha.downloadMedia(payload.media.url);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown error occurred";
      await deps.waha.sendText({
        chatId,
        text: `Failed to download cookie attachment: ${reason}`,
        replyTo: payload.id,
      });
      return;
    }
  } else {
    const inlineContent = restLines.join("\n").trim();
    if (inlineContent) {
      cookieContent = `${inlineContent}\n`;
    }
  }

  if (!cookieContent) {
    await deps.waha.sendText({
      chatId,
      text: `Please attach a .txt Netscape cookie file or include cookie lines after "/cookies ${normalizedDomain}".`,
      replyTo: payload.id,
    });
    return;
  }

  const savedDomain = await saveCookieProfile(
    deps.cookiesDir,
    payload,
    normalizedDomain,
    cookieContent,
  );
  if (!savedDomain) {
    await deps.waha.sendText({
      chatId,
      text: `Invalid domain "${rawDomain}".`,
      replyTo: payload.id,
    });
    return;
  }

  await deps.waha.sendText({
    chatId,
    text: `Saved Cookie Profile for ${savedDomain}.`,
    replyTo: payload.id,
  });
}

/**
 * Creates the primary application seam for handling WAHA `message.any` events.
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  const enqueue = createConcurrencyQueue(deps.downloadConcurrency ?? 2);

  return async function handleWahaEvent(event: WahaMessageEvent): Promise<void> {
    if (event.event !== "message.any" && event.event !== "message") {
      return;
    }

    const { payload } = event;
    if (payload.source === "api") {
      return;
    }

    const text = extractCommandText(event);
    const chatId = payload.fromMe ? payload.to || payload.from : payload.from;

    if (/^\/cookies(?:\s|$)/.test(text)) {
      await handleCookiesCommand(deps, payload, chatId, text);
      return;
    }

    const urls = parseDlUrls(text);
    if (urls.length === 0) {
      return;
    }

    try {
      await deps.waha.sendReaction(payload.id, "⏳");
    } catch {
      // Best-effort reaction; proceed with download even if reaction fails.
    }

    await mkdir(deps.tmpDir, { recursive: true });

    await Promise.all(
      urls.map((url) =>
        enqueue(async () => {
          const workDir = await mkdtemp(join(deps.tmpDir, "dl-"));
          let tempCookiePath: string | undefined;

          try {
            if (deps.cookiesDir) {
              const profilePath = await resolveCookieProfilePath(
                deps.cookiesDir,
                payload,
                url,
              );
              if (profilePath) {
                tempCookiePath = await createTempCookieCopy(
                  profilePath,
                  deps.tmpDir,
                );
              }
            }

            const downloaded = await deps.downloader.download(
              url,
              workDir,
              tempCookiePath ? { cookiesFile: tempCookiePath } : undefined,
            );
            const objectKey = buildObjectKey(downloaded.filename);
            const archiveUrl = await deps.archive.upload(
              downloaded.filePath,
              objectKey,
            );

            if (downloaded.fileSize <= deps.maxWhatsappMediaBytes) {
              await deps.waha.sendVideo({
                chatId,
                videoUrl: archiveUrl,
                filename: downloaded.filename,
                caption: archiveUrl,
                replyTo: payload.id,
              });
            } else {
              await deps.waha.sendText({
                chatId,
                text: archiveUrl,
                replyTo: payload.id,
              });
            }
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : "Unknown error occurred";
            const prefix =
              urls.length > 1 ? `Download failed (${url})` : "Download failed";
            await deps.waha.sendText({
              chatId,
              text: `${prefix}: ${reason}`,
              replyTo: payload.id,
            });
          } finally {
            await Promise.all([
              rm(workDir, { recursive: true, force: true }),
              tempCookiePath
                ? rm(tempCookiePath, { force: true })
                : Promise.resolve(),
            ]);
          }
        }),
      ),
    );
  };
}
