import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YtDlpDownloader, buildYtDlpArgs } from "../src/downloader";

describe("buildYtDlpArgs", () => {
  test("includes --cookies when cookiesFile is provided and omits it otherwise", () => {
    const withoutCookies = buildYtDlpArgs(
      "https://example.com/video",
      "/tmp/job-1",
    );
    expect(withoutCookies).not.toContain("--cookies");
    expect(withoutCookies[withoutCookies.length - 1]).toBe(
      "https://example.com/video",
    );

    const withCookies = buildYtDlpArgs(
      "https://example.com/private",
      "/tmp/job-2",
      { cookiesFile: "/tmp/cookies-123.txt" },
    );
    const cookiesIdx = withCookies.indexOf("--cookies");
    expect(cookiesIdx).toBeGreaterThan(-1);
    expect(withCookies[cookiesIdx + 1]).toBe("/tmp/cookies-123.txt");
    expect(withCookies[withCookies.length - 1]).toBe(
      "https://example.com/private",
    );
  });

  test("uses byte-bounded output template and highest-quality format selector", () => {
    const args = buildYtDlpArgs("https://example.com/video", "/tmp/job-3");
    const outputIdx = args.indexOf("-o");
    expect(outputIdx).toBeGreaterThan(-1);
    expect(args[outputIdx + 1]).toBe(
      "/tmp/job-3/%(title).80B-%(id).40B.%(ext)s",
    );
    const formatIdx = args.indexOf("-f");
    expect(formatIdx).toBeGreaterThan(-1);
    expect(args[formatIdx + 1]).toBe("bv*+ba/b");
    expect(args).toContain("--newline");
    expect(args).toContain("--no-cache-dir");
  });
});

describe("YtDlpDownloader idle timeout", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "waha-dl-downloader-test-"));
    tempRoots.push(dir);
    return dir;
  }

  test("resets idle timer while stdout keeps emitting progress beyond idleTimeoutMs", async () => {
    const outDir = await makeTempDir();
    // Emits 4 lines spaced 50ms apart (~200ms total), while idleTimeoutMs is 120ms.
    const downloader = new YtDlpDownloader(120, (_url, dir) => [
      "bun",
      "-e",
      `const fs = require("node:fs");
       const path = require("node:path");
       let count = 0;
       const t = setInterval(() => {
         count += 1;
         console.log("[download] progress " + count);
         if (count >= 4) {
           clearInterval(t);
           fs.writeFileSync(path.join(${JSON.stringify(dir)}, "clip.mp4"), "ok");
           process.exit(0);
         }
       }, 50);`,
    ]);

    const result = await downloader.download("https://example.com/v", outDir);
    expect(result.filename).toBe("clip.mp4");
    expect(result.fileSize).toBe(2);
  });

  test("kills process and throws when no output is emitted within idleTimeoutMs", async () => {
    const outDir = await makeTempDir();
    const downloader = new YtDlpDownloader(100, () => [
      "bun",
      "-e",
      "setTimeout(() => {}, 5000);",
    ]);

    await expect(
      downloader.download("https://example.com/hang", outDir),
    ).rejects.toThrow(/tidak ada progres/i);
  });
});
