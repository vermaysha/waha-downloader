import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompositeArchive,
  R2Archive,
  TempShArchive,
  createArchive,
} from "../src/archive";
import { loadConfig } from "../src/config";
import type { MediaArchivePort } from "../src/types";

describe("archive adapters", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempFile(name: string, content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "waha-dl-archive-test-"));
    tempRoots.push(dir);
    const filePath = join(dir, name);
    await Bun.write(filePath, content);
    return filePath;
  }

  test("TempShArchive uploads multipart form data and trims returned URL", async () => {
    const filePath = await makeTempFile("sample.mp4", "video-bytes");
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedPayload = "";

    const archive = new TempShArchive({
      uploadUrl: "https://temp.sh/upload",
      fetchFn: async (input, init) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? "";
        capturedPayload = await new Response(init?.body as FormData).text();
        return new Response("https://temp.sh/abcde/sample.mp4\n", {
          status: 200,
        });
      },
    });

    const url = await archive.upload(filePath, "downloads/ignored.mp4");
    expect(capturedUrl).toBe("https://temp.sh/upload");
    expect(capturedMethod).toBe("POST");
    expect(capturedPayload).toContain('filename="sample.mp4"');
    expect(capturedPayload).toContain("video-bytes");
    expect(url).toBe("https://temp.sh/abcde/sample.mp4");
  });

  test("TempShArchive throws on non-OK HTTP response or empty URL", async () => {
    const filePath = await makeTempFile("sample.mp4", "video-bytes");

    const failing = new TempShArchive({
      fetchFn: async () =>
        new Response("payload too large", {
          status: 413,
          statusText: "Payload Too Large",
        }),
    });

    await expect(failing.upload(filePath, "k")).rejects.toThrow(
      /temp\.sh upload failed \(413\): payload too large/,
    );

    const empty = new TempShArchive({
      fetchFn: async () => new Response("   \n", { status: 200 }),
    });

    await expect(empty.upload(filePath, "k")).rejects.toThrow(
      /empty URL/,
    );
  });

  test("CompositeArchive uploads to all targets and returns primary URL + labeled links", async () => {
    const s3: MediaArchivePort = {
      async upload(_filePath, key) {
        return `https://cdn.example.com/${key}`;
      },
    };
    const temp: MediaArchivePort = {
      async upload() {
        return "https://temp.sh/xyz/clip.mp4";
      },
    };

    const composite = new CompositeArchive([
      { label: "S3", archive: s3 },
      { label: "Temp", archive: temp },
    ]);

    expect(await composite.upload("/tmp/clip.mp4", "downloads/clip.mp4")).toBe(
      "https://cdn.example.com/downloads/clip.mp4",
    );

    const all = await composite.uploadAll("/tmp/clip.mp4", "downloads/clip.mp4");
    expect(all).toEqual({
      primaryUrl: "https://cdn.example.com/downloads/clip.mp4",
      links: [
        { label: "S3", url: "https://cdn.example.com/downloads/clip.mp4" },
        { label: "Temp", url: "https://temp.sh/xyz/clip.mp4" },
      ],
    });
  });

  test("createArchive selects R2Archive, TempShArchive, or CompositeArchive from config", () => {
    const baseEnv = {
      WAHA_BASE_URL: "http://localhost:3000",
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      R2_BUCKET: "media-archive",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
    };

    expect(
      createArchive(loadConfig({ ...baseEnv, UPLOAD_TARGET: "s3" })),
    ).toBeInstanceOf(R2Archive);
    expect(
      createArchive(
        loadConfig({ WAHA_BASE_URL: "http://localhost:3000", UPLOAD_TARGET: "temp" }),
      ),
    ).toBeInstanceOf(TempShArchive);
    expect(
      createArchive(loadConfig({ ...baseEnv, UPLOAD_TARGET: "both" })),
    ).toBeInstanceOf(CompositeArchive);
  });
});
