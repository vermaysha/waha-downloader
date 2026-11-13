import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createCookieStore, createTempCookieCopy } from "./cookies";
import { handleCookiesCommand } from "./cookies-command";
import { createConcurrencyQueue } from "./queue";
import type {
  DownloaderPort,
  Logger,
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
  logger?: Logger;
}

function extractCommandText(event: WahaMessageEvent): string {
  return (
    event.payload.body?.trim() || event.payload.caption?.trim() || ""
  );
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

const HELP_TEXT = [
  "WAHA Downloader Commands:",
  "",
  "• /dl <url1> [url2 ...] — Download video (supports multiple space/newline-separated URLs)",
  "• /cookies <domain> — Save Netscape cookies (attach a .txt file or paste cookie lines below)",
  "• /cookies list — List your saved cookie domains",
  "• /cookies del <domain> — Delete saved cookies for a domain",
  "• /help or /h — Show this help message",
].join("\n");

/**
 * Creates the primary application seam for handling WAHA `message.any` events.
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  const enqueue = createConcurrencyQueue(deps.downloadConcurrency ?? 2);
  const cookieStore = deps.cookiesDir
    ? createCookieStore(deps.cookiesDir)
    : undefined;

  return async function handleWahaEvent(event: WahaMessageEvent): Promise<void> {
    if (event.event !== "message.any") {
      return;
    }

    const { payload } = event;
    if (payload.source === "api") {
      return;
    }

    const text = extractCommandText(event);
    const chatId = payload.fromMe ? payload.to || payload.from : payload.from;

    if (/^\/(?:help|h)(?:\s|$)/.test(text)) {
      deps.logger?.info(
        `[WAHA] Received /help command from ${chatId} (msg=${payload.id})`,
      );
      await deps.waha.sendText({
        chatId,
        text: HELP_TEXT,
        replyTo: payload.id,
      });
      return;
    }

    if (/^\/cookies(?:\s|$)/.test(text)) {
      deps.logger?.info(
        `[WAHA] Received /cookies command from ${chatId} (msg=${payload.id})`,
      );
      await handleCookiesCommand(
        { waha: deps.waha, cookieStore },
        payload,
        chatId,
        text,
      );
      return;
    }

    const urls = parseDlUrls(text);
    if (urls.length === 0) {
      return;
    }

    deps.logger?.info(
      `[WAHA] Received /dl command from ${chatId} (${urls.length} url(s), msg=${payload.id})`,
    );

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
            if (cookieStore) {
              const profilePath = await cookieStore.resolvePathForUrl(
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

            deps.logger?.info(
              `[yt-dlp] Downloading ${url} (cookies=${tempCookiePath ? "yes" : "no"})`,
            );
            const downloaded = await deps.downloader.download(
              url,
              workDir,
              tempCookiePath ? { cookiesFile: tempCookiePath } : undefined,
            );
            const objectKey = buildObjectKey(downloaded.filename);
            deps.logger?.info(
              `[R2] Uploading ${downloaded.filename} (${downloaded.fileSize} bytes) -> ${objectKey}`,
            );
            const archiveUrl = await deps.archive.upload(
              downloaded.filePath,
              objectKey,
            );

            if (downloaded.fileSize <= deps.maxWhatsappMediaBytes) {
              deps.logger?.info(
                `[WAHA] Replying video to ${chatId} (msg=${payload.id})`,
              );
              await deps.waha.sendVideo({
                chatId,
                videoUrl: archiveUrl,
                filename: downloaded.filename,
                caption: archiveUrl,
                replyTo: payload.id,
              });
            } else {
              deps.logger?.info(
                `[WAHA] Video exceeds limit (${downloaded.fileSize} bytes), replying link to ${chatId} (msg=${payload.id})`,
              );
              await deps.waha.sendText({
                chatId,
                text: archiveUrl,
                replyTo: payload.id,
              });
            }
            deps.logger?.info(`[WAHA] Done ${url} -> ${archiveUrl}`);
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : "Unknown error occurred";
            deps.logger?.error(`[WAHA] Failed ${url}: ${reason}`, error);
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
