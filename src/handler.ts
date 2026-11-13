import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempCookieCopy, resolveCookieProfilePath } from "./cookies";
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
  maxWhatsappMediaBytes: number;
  tmpDir: string;
  cookiesDir?: string;
}

function extractCommandText(event: WahaMessageEvent): string {
  const raw = event.payload.body ?? event.payload.caption ?? "";
  return raw.trim();
}

function parseDlUrl(text: string): string | null {
  const match = text.match(/^\/dl(?:\s+|$)(.*)/s);
  if (!match) {
    return null;
  }
  const rest = match[1]?.trim();
  if (!rest) {
    return null;
  }
  const firstToken = rest.split(/\s+/)[0];
  return firstToken || null;
}

function buildObjectKey(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `downloads/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
}

/**
 * Creates the primary application seam for handling WAHA `message.any` events.
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  return async function handleWahaEvent(event: WahaMessageEvent): Promise<void> {
    if (event.event !== "message.any" && event.event !== "message") {
      return;
    }

    const { payload } = event;
    if (payload.source === "api") {
      return;
    }

    const text = extractCommandText(event);
    const url = parseDlUrl(text);
    if (!url) {
      return;
    }

    const chatId = payload.fromMe ? payload.to || payload.from : payload.from;

    try {
      await deps.waha.sendReaction(payload.id, "⏳");
    } catch {
      // Best-effort reaction; proceed with download even if reaction fails.
    }

    await mkdir(deps.tmpDir, { recursive: true });
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
          tempCookiePath = await createTempCookieCopy(profilePath, deps.tmpDir);
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
      await deps.waha.sendText({
        chatId,
        text: `Download failed: ${reason}`,
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
  };
}
