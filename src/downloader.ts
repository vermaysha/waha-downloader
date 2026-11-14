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
    "--merge-output-format",
    "mp4",
    "-f",
    "bv*+ba/b",
    "-o",
    outputTemplate,
  ];
  if (options?.cookiesFile) {
    args.push("--cookies", options.cookiesFile);
  }
  args.push(url);
  return args;
}

/**
 * Downloads media using `yt-dlp` via `Bun.spawn` into a temporary output directory.
 */
export class YtDlpDownloader implements DownloaderPort {
  constructor(private readonly timeoutMs = 30 * 60 * 1000) {}

  async download(
    url: string,
    outputDir: string,
    options?: DownloadOptions,
  ): Promise<DownloadedMedia> {
    const proc = Bun.spawn(buildYtDlpArgs(url, outputDir, options), {
      stdout: "pipe",
      stderr: "pipe",
      timeout: this.timeoutMs,
    });

    const [exitCode, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
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
