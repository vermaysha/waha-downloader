import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AutoDownloadStore } from "./autodownload";
import { handleAutoDownloadCommand } from "./autodownload-command";
import {
  createCookieStore,
  createTempCookieCopy,
  normalizeRequester,
} from "./cookies";
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
  downloadCacheTtlMs?: number;
  maxWhatsappMediaBytes: number;
  tmpDir: string;
  cookiesDir?: string;
  autoDownloadStore?: AutoDownloadStore;
  logger?: Logger;
}

function extractCommandText(event: WahaMessageEvent): string {
  return (
    event.payload.body?.trim() || event.payload.caption?.trim() || ""
  );
}

export function isValidHttpUrl(token: string): boolean {
  try {
    const parsed = new URL(token);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const urls: string[] = [];

  for (const raw of matches) {
    let cleaned = raw.replace(/[.,!?:;]+$/, "");
    while (
      cleaned.endsWith(")") &&
      (cleaned.match(/\)/g)?.length ?? 0) > (cleaned.match(/\(/g)?.length ?? 0)
    ) {
      cleaned = cleaned.slice(0, -1);
    }
    while (
      cleaned.endsWith("]") &&
      (cleaned.match(/\]/g)?.length ?? 0) > (cleaned.match(/\[/g)?.length ?? 0)
    ) {
      cleaned = cleaned.slice(0, -1);
    }
    if (isValidHttpUrl(cleaned)) {
      urls.push(cleaned);
    }
  }

  return Array.from(new Set(urls));
}

export function parseDlUrls(text: string): string[] {
  const match = text.match(/^\/dl(?:\s+|$)(.*)/s);
  if (!match) {
    return [];
  }
  const rest = match[1]?.trim();
  if (!rest) {
    return [];
  }
  return extractUrlsFromText(rest);
}

function buildObjectKey(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `downloads/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
}

function formatUserError(error: unknown): string {
  const raw =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Terjadi kesalahan yang tidak diketahui";

  if (/exit code 143|SIGTERM|timed out/i.test(raw)) {
    return "Proses download melebihi batas waktu. Coba lagi nanti.";
  }
  if (/Sign in to confirm|login required|use --cookies/i.test(raw)) {
    return "Video memerlukan login/cookies. Simpan cookies dulu dengan /cookies <domain>.";
  }
  if (/Unsupported URL/i.test(raw)) {
    return "Link tidak didukung atau bukan halaman video yang valid.";
  }
  if (/HTTP Error 403/i.test(raw)) {
    return "Akses video ditolak oleh server sumber (403). Coba pakai /cookies <domain>.";
  }
  if (/HTTP Error 404/i.test(raw)) {
    return "Video tidak ditemukan atau sudah dihapus (404).";
  }
  if (/HTTP Error 429/i.test(raw)) {
    return "Terlalu banyak permintaan ke server sumber (429). Coba lagi beberapa saat lagi.";
  }
  if (/Google Drive auth failed/i.test(raw)) {
    return "Gagal autentikasi Google Drive. Periksa kredensial Google Drive di server.";
  }
  if (/temp\.sh upload failed \(413\)/i.test(raw)) {
    return "Gagal upload ke temp.sh karena ukuran file melebihi batas.";
  }
  if (/ENAMETOOLONG|File name too long/i.test(raw)) {
    return "Nama file terlalu panjang untuk disimpan di server.";
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw)) {
    return "Gagal terhubung ke server tujuan (masalah jaringan).";
  }

  return raw.replace(/^yt-dlp failed:\s*ERROR:\s*/i, "");
}

const HELP_TEXT = [
  "WAHA Downloader Commands:",
  "",
  "• /dl <url1> [url2 ...] — Download video (supports multiple space/newline-separated URLs)",
  "• /autodl [on|off|status] — Aktifkan/nonaktifkan auto download link tanpa /dl",
  "• /cookies <domain> — Save Netscape cookies (attach a .txt file or paste cookie lines below)",
  "• /cookies list — List your saved cookie domains",
  "• /cookies del <domain> — Delete saved cookies for a domain",
  "• /help or /h — Show this help message",
].join("\n");

interface CompletedUploadRecord {
  filename: string;
  fileSize: number;
  uploadResult: {
    primaryUrl: string;
    links: Array<{ label: string; url: string }>;
    preferLocalFile?: boolean;
  };
  expiresAtMs: number;
}

const MAX_SEEN_MESSAGE_IDS = 1000;
const MAX_COMPLETED_CACHE_ENTRIES = 500;

/**
 * Creates the primary application seam for handling WAHA `message.any` events.
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  const enqueue = createConcurrencyQueue(deps.downloadConcurrency ?? 2);
  const cookieStore = deps.cookiesDir
    ? createCookieStore(deps.cookiesDir)
    : undefined;
  const cacheTtlMs = deps.downloadCacheTtlMs ?? 60 * 60 * 1000;
  const seenMessageIds = new Set<string>();
  const inFlightDownloads = new Map<string, Promise<CompletedUploadRecord>>();
  const completedDownloads = new Map<string, CompletedUploadRecord>();

  const rememberMessageId = (id: string): boolean => {
    if (!id) return true;
    if (seenMessageIds.has(id)) {
      return false;
    }
    seenMessageIds.add(id);
    if (seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
      const oldest = seenMessageIds.values().next().value;
      if (oldest) seenMessageIds.delete(oldest);
    }
    return true;
  };

  const getCachedDownload = (key: string): CompletedUploadRecord | undefined => {
    const entry = completedDownloads.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAtMs) {
      completedDownloads.delete(key);
      return undefined;
    }
    return entry;
  };

  const setCachedDownload = (key: string, record: CompletedUploadRecord) => {
    if (cacheTtlMs <= 0) return;
    completedDownloads.set(key, record);
    if (completedDownloads.size > MAX_COMPLETED_CACHE_ENTRIES) {
      const oldest = completedDownloads.keys().next().value;
      if (oldest) completedDownloads.delete(oldest);
    }
  };

  return async function handleWahaEvent(event: WahaMessageEvent): Promise<void> {
    if (event.event !== "message.any") {
      return;
    }

    const { payload } = event;
    if (payload.source === "api") {
      return;
    }
    if (!rememberMessageId(payload.id)) {
      return;
    }

    const text = extractCommandText(event);
    const chatId = payload.fromMe ? payload.to || payload.from : payload.from;

    const markSeenBestEffort = async () => {
      if (payload.fromMe || !deps.waha.sendSeen) {
        return;
      }
      try {
        await deps.waha.sendSeen({
          chatId,
          messageId: payload.id,
          participant: payload.participant ?? undefined,
        });
      } catch {
        // Best-effort read receipt; proceed even if sendSeen fails.
      }
    };

    if (/^\/(?:help|h)(?:\s|$)/.test(text)) {
      deps.logger?.info(
        `[WAHA] Received /help command from ${chatId} (msg=${payload.id})`,
      );
      await markSeenBestEffort();
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
      await markSeenBestEffort();
      await handleCookiesCommand(
        { waha: deps.waha, cookieStore },
        payload,
        chatId,
        text,
      );
      return;
    }

    if (/^\/(?:autodl|autodownload)(?:\s|$)/i.test(text)) {
      deps.logger?.info(
        `[WAHA] Received /autodl command from ${chatId} (msg=${payload.id})`,
      );
      await markSeenBestEffort();
      await handleAutoDownloadCommand(
        { waha: deps.waha, autoDownloadStore: deps.autoDownloadStore },
        payload,
        chatId,
        text,
      );
      return;
    }

    let urls = parseDlUrls(text);
    let isAutoDownload = false;

    if (
      urls.length === 0 &&
      !text.trim().startsWith("/") &&
      deps.autoDownloadStore
    ) {
      const isEnabled = await deps.autoDownloadStore.isEnabled(payload);
      if (isEnabled) {
        urls = extractUrlsFromText(text);
        if (urls.length > 0) {
          isAutoDownload = true;
        }
      }
    }

    if (urls.length === 0) {
      return;
    }

    deps.logger?.info(
      `[WAHA] Received ${isAutoDownload ? "auto-download" : "/dl command"} from ${chatId} (${urls.length} url(s), msg=${payload.id})`,
    );

    await markSeenBestEffort();

    try {
      await deps.waha.sendReaction(payload.id, "⏳");
    } catch {
      // Best-effort reaction; proceed with download even if reaction fails.
    }

    await mkdir(deps.tmpDir, { recursive: true });

    await Promise.all(
      urls.map(async (url) => {
        try {
          const profilePath = cookieStore
            ? await cookieStore.resolvePathForUrl(payload, url)
            : undefined;
          const cacheKey = profilePath
            ? `user:${normalizeRequester(payload)}:${url}`
            : `public:${url}`;

          let record = getCachedDownload(cacheKey);
          let localFilePath: string | undefined;
          let cleanupWorkDir: string | undefined;

          if (record) {
            deps.logger?.info(`[Cache] Hit for ${url} (msg=${payload.id})`);
          } else {
            let sharedPromise = inFlightDownloads.get(cacheKey);
            if (sharedPromise) {
              deps.logger?.info(
                `[Dedupe] Coalescing in-flight download for ${url} (msg=${payload.id})`,
              );
              record = await sharedPromise;
            } else {
              sharedPromise = enqueue(async () => {
                const workDir = await mkdtemp(join(deps.tmpDir, "dl-"));
                let tempCookiePath: string | undefined;

                try {
                  if (profilePath) {
                    tempCookiePath = await createTempCookieCopy(
                      profilePath,
                      deps.tmpDir,
                    );
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
                    `[Archive] Uploading ${downloaded.filename} (${downloaded.fileSize} bytes) -> ${objectKey}`,
                  );
                  const uploadResult: CompletedUploadRecord["uploadResult"] =
                    deps.archive.uploadAll
                      ? await deps.archive.uploadAll(
                          downloaded.filePath,
                          objectKey,
                        )
                      : {
                          primaryUrl: await deps.archive.upload(
                            downloaded.filePath,
                            objectKey,
                          ),
                          links: [],
                        };

                  localFilePath = downloaded.filePath;
                  cleanupWorkDir = workDir;

                  const completed: CompletedUploadRecord = {
                    filename: downloaded.filename,
                    fileSize: downloaded.fileSize,
                    uploadResult,
                    expiresAtMs: Date.now() + cacheTtlMs,
                  };
                  setCachedDownload(cacheKey, completed);
                  return completed;
                } catch (err) {
                  await rm(workDir, { recursive: true, force: true });
                  throw err;
                } finally {
                  if (tempCookiePath) {
                    await rm(tempCookiePath, { force: true });
                  }
                }
              });

              inFlightDownloads.set(cacheKey, sharedPromise);
              try {
                record = await sharedPromise;
              } finally {
                inFlightDownloads.delete(cacheKey);
              }
            }
          }

          try {
            const { uploadResult, filename, fileSize } = record;
            const replyText =
              uploadResult.links.length > 1
                ? uploadResult.links
                    .map((link) => `${link.label}: ${link.url}`)
                    .join("\n")
                : uploadResult.links[0]?.url ?? uploadResult.primaryUrl;

            const canUseLocalFile = Boolean(
              uploadResult.preferLocalFile && localFilePath,
            );
            const effectiveMediaBytes = canUseLocalFile
              ? Math.ceil((fileSize * 4) / 3) + 1024
              : fileSize;

            if (
              effectiveMediaBytes <= deps.maxWhatsappMediaBytes &&
              (!uploadResult.preferLocalFile || canUseLocalFile)
            ) {
              deps.logger?.info(
                `[WAHA] Replying video to ${chatId} (msg=${payload.id})`,
              );
              try {
                await deps.waha.sendVideo({
                  chatId,
                  videoUrl: uploadResult.primaryUrl,
                  filename,
                  caption: replyText,
                  replyTo: payload.id,
                  ...(canUseLocalFile && localFilePath
                    ? { filePath: localFilePath }
                    : {}),
                });
              } catch (sendErr) {
                const sendReason =
                  sendErr instanceof Error ? sendErr.message : String(sendErr);
                deps.logger?.error(
                  `[WAHA] sendVideo failed, falling back to link reply for ${url}: ${sendReason}`,
                  sendErr,
                );
                await deps.waha.sendText({
                  chatId,
                  text: replyText,
                  replyTo: payload.id,
                });
              }
            } else {
              deps.logger?.info(
                `[WAHA] Video exceeds limit (${fileSize} bytes), replying link to ${chatId} (msg=${payload.id})`,
              );
              await deps.waha.sendText({
                chatId,
                text: replyText,
                replyTo: payload.id,
              });
            }
            deps.logger?.info(`[WAHA] Done ${url} -> ${uploadResult.primaryUrl}`);
          } finally {
            if (cleanupWorkDir) {
              await rm(cleanupWorkDir, { recursive: true, force: true });
            }
          }
        } catch (error) {
          const rawReason =
            error instanceof Error ? error.message : "Unknown error occurred";
          const reason = formatUserError(error);
          deps.logger?.error(`[WAHA] Failed ${url}: ${rawReason}`, error);
          const prefix =
            urls.length > 1 ? `Download failed (${url})` : "Download failed";
          try {
            await deps.waha.sendText({
              chatId,
              text: `${prefix}: ${reason}`,
              replyTo: payload.id,
            });
          } catch (notifyErr) {
            deps.logger?.error(
              `[WAHA] Failed to send error reply for ${url}`,
              notifyErr,
            );
          }
        }
      }),
    );
  };
}
