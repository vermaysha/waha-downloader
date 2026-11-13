import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createCookieStore, createTempCookieCopy } from "./cookies";
import { handleCookiesCommand } from "./cookies-command";
import { createConcurrencyQueue } from "./queue";
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

    if (/^\/cookies(?:\s|$)/.test(text)) {
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
