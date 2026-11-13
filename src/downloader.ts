import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadedMedia, DownloaderPort } from "./types";

/**
 * Downloads media using `yt-dlp` via `Bun.spawn` into a per-job directory.
 */
export class YtDlpDownloader implements DownloaderPort {
  constructor(private readonly timeoutMs = 5 * 60 * 1000) {}

  async download(url: string, outputDir: string): Promise<DownloadedMedia> {
    const outputTemplate = join(outputDir, "%(title).80s-%(id)s.%(ext)s");
    const proc = Bun.spawn(
      [
        "yt-dlp",
        "--no-playlist",
        "--merge-output-format",
        "mp4",
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "-o",
        outputTemplate,
        url,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        timeout: this.timeoutMs,
      },
    );

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
