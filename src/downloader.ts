import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadedMedia, DownloaderPort, DownloadOptions } from "./types";

/**
 * Builds the `yt-dlp` CLI argument list for a Download Request.
 */
export function buildYtDlpArgs(
  url: string,
  outputDir: string,
  options?: DownloadOptions,
): string[] {
  // Use byte-length truncation (.B) so multi-byte UTF-8 titles (e.g. CJK/emoji)
  // plus yt-dlp's .part / format suffixes never exceed the 255-byte NAME_MAX limit.
  const outputTemplate = join(outputDir, "%(title).80B-%(id).40B.%(ext)s");
  const args = [
    "yt-dlp",
    "--no-playlist",
    "--no-cache-dir",
    "--merge-output-format",
    "mp4",
    "-f",
    "bv*+ba/b",
    "--newline",
    "--socket-timeout",
    "30",
    "-o",
    outputTemplate,
  ];
  if (options?.cookiesFile) {
    args.push("--cookies", options.cookiesFile);
  }
  args.push(url);
  return args;
}

const MAX_STDERR_TAIL_BYTES = 16 * 1024;

export type DownloadCommandFactory = (
  url: string,
  outputDir: string,
  options?: DownloadOptions,
) => string[];

/**
 * Downloads media using `yt-dlp` via `Bun.spawn` into a temporary output directory.
 * Uses an inactivity (idle) timeout that resets whenever stdout or stderr emits output.
 */
export class YtDlpDownloader implements DownloaderPort {
  constructor(
    private readonly idleTimeoutMs = 5 * 60 * 1000,
    private readonly commandFactory: DownloadCommandFactory = buildYtDlpArgs,
  ) {}

  async download(
    url: string,
    outputDir: string,
    options?: DownloadOptions,
  ): Promise<DownloadedMedia> {
    const proc = Bun.spawn(this.commandFactory(url, outputDir, options), {
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        killTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // Process may have already exited.
          }
        }, 5_000);
      }, this.idleTimeoutMs);
    };

    const drainStream = async (
      stream: ReadableStream<Uint8Array> | number | undefined,
      collectTail: boolean,
    ): Promise<string> => {
      if (!stream || typeof stream === "number") {
        return "";
      }
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let tail = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            resetIdleTimer();
            if (collectTail) {
              tail += decoder.decode(value, { stream: true });
              if (tail.length > MAX_STDERR_TAIL_BYTES) {
                tail = tail.slice(-MAX_STDERR_TAIL_BYTES);
              }
            }
          }
        }
        if (collectTail) {
          tail += decoder.decode();
        }
      } finally {
        reader.releaseLock();
      }
      return tail;
    };

    resetIdleTimer();
    let exitCode: number;
    let stderrText = "";

    try {
      const [code, , stderrTail] = await Promise.all([
        proc.exited,
        drainStream(proc.stdout, false),
        drainStream(proc.stderr, true),
      ]);
      exitCode = code;
      stderrText = stderrTail;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (killTimer) clearTimeout(killTimer);
    }

    if (timedOut) {
      const idleSeconds = Math.max(1, Math.round(this.idleTimeoutMs / 1000));
      throw new Error(
        `Download macet (tidak ada progres selama ${idleSeconds} detik).`,
      );
    }

    if (exitCode !== 0) {
      if (exitCode === 143) {
        throw new Error(
          "Download dihentikan sebelum selesai (SIGTERM / exit code 143).",
        );
      }
      const detail = stderrText.trim().split("\n").pop() || `exit code ${exitCode}`;
      throw new Error(`yt-dlp failed: ${detail}`);
    }

    const entries = await readdir(outputDir);
    const filename = entries.find((name) => !name.endsWith(".part"));
    if (!filename) {
      throw new Error("yt-dlp completed but produced no output file");
    }

    const filePath = join(outputDir, filename);
    const fileStat = await stat(filePath);
    return {
      filePath,
      fileSize: fileStat.size,
      filename,
    };
  }
}
