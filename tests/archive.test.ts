import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompositeArchive,
  GoogleDriveArchive,
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
      preferLocalFile: false,
    });

    const gdriveLike: MediaArchivePort = {
      async upload() {
        return "https://drive.google.com/file/d/id-1/view";
      },
      async uploadAll() {
        return {
          primaryUrl:
            "https://drive.usercontent.google.com/download?id=id-1&export=download&confirm=t",
          links: [
            { label: "GDrive", url: "https://drive.google.com/file/d/id-1/view" },
          ],
          preferLocalFile: false,
        };
      },
    };

    const threeTargets = new CompositeArchive([
      { label: "S3", archive: s3 },
      { label: "Temp", archive: temp },
      { label: "GDrive", archive: gdriveLike },
    ]);

    expect(await threeTargets.uploadAll("/tmp/clip.mp4", "downloads/clip.mp4")).toEqual({
      primaryUrl: "https://cdn.example.com/downloads/clip.mp4",
      links: [
        { label: "S3", url: "https://cdn.example.com/downloads/clip.mp4" },
        { label: "Temp", url: "https://temp.sh/xyz/clip.mp4" },
        { label: "GDrive", url: "https://drive.google.com/file/d/id-1/view" },
      ],
      preferLocalFile: false,
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
    expect(
      createArchive(
        loadConfig({
          WAHA_BASE_URL: "http://localhost:3000",
          UPLOAD_TARGET: "gdrive",
          GDRIVE_CLIENT_ID: "cid",
          GDRIVE_CLIENT_SECRET: "csecret",
          GDRIVE_REFRESH_TOKEN: "rtoken",
        }),
      ),
    ).toBeInstanceOf(GoogleDriveArchive);
    expect(
      createArchive(
        loadConfig({
          ...baseEnv,
          UPLOAD_TARGET: "all",
          GDRIVE_CLIENT_ID: "cid",
          GDRIVE_CLIENT_SECRET: "csecret",
          GDRIVE_REFRESH_TOKEN: "rtoken",
        }),
      ),
    ).toBeInstanceOf(CompositeArchive);
  });

  test("GoogleDriveArchive exchanges OAuth refresh token, uploads via resumable session, and sets public permission", async () => {
    const filePath = await makeTempFile("clip.mp4", "drive-video-bytes");
    const requests: Array<{ url: string; method: string; body?: string }> = [];

    const gdrive = new GoogleDriveArchive(
      {
        auth: {
          type: "oauth",
          clientId: "cid",
          clientSecret: "csecret",
          refreshToken: "rtoken",
        },
        folderId: "folder-abc",
        makePublic: true,
      },
      {
        fetchFn: async (input, init) => {
          const url = String(input);
          const method = init?.method ?? "GET";
          const body =
            typeof init?.body === "string" ? init.body : undefined;
          requests.push({ url, method, body });

          if (url === "https://oauth2.googleapis.com/token") {
            return new Response(
              JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }),
              { status: 200 },
            );
          }
          if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
            return new Response(null, {
              status: 200,
              headers: { location: "https://upload.example.com/session/1" },
            });
          }
          if (url === "https://upload.example.com/session/1") {
            return new Response(
              JSON.stringify({
                id: "file-123",
                name: "clip.mp4",
                webViewLink: "https://drive.google.com/file/d/file-123/view",
              }),
              { status: 200 },
            );
          }
          if (
            url ===
            "https://www.googleapis.com/drive/v3/files/file-123/permissions?supportsAllDrives=true"
          ) {
            return new Response(JSON.stringify({ id: "anyoneWithLink" }), {
              status: 200,
            });
          }
          return new Response("unexpected", { status: 500 });
        },
      },
    );

    const url = await gdrive.upload(filePath, "downloads/ignored.mp4");
    expect(url).toBe("https://drive.google.com/file/d/file-123/view");
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://oauth2.googleapis.com/token",
      "POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink",
      "PUT https://upload.example.com/session/1",
      "POST https://www.googleapis.com/drive/v3/files/file-123/permissions?supportsAllDrives=true",
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({
      name: "clip.mp4",
      parents: ["folder-abc"],
    });
    expect(JSON.parse(requests[3]!.body!)).toEqual({
      role: "reader",
      type: "anyone",
    });

    const uploadAllRes = await gdrive.uploadAll(filePath, "downloads/ignored.mp4");
    expect(uploadAllRes).toEqual({
      primaryUrl:
        "https://drive.usercontent.google.com/download?id=file-123&export=download&confirm=t",
      links: [
        { label: "GDrive", url: "https://drive.google.com/file/d/file-123/view" },
      ],
      preferLocalFile: false,
    });
  });

  test("GoogleDriveArchive supports Service Account JWT auth and private uploads (makePublic: false)", async () => {
    const filePath = await makeTempFile("sa.mp4", "sa-bytes");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    let tokenRequestBody = "";
    let permissionCalled = false;

    const gdrive = new GoogleDriveArchive(
      {
        auth: {
          type: "service_account",
          clientEmail: "bot@proj.iam.gserviceaccount.com",
          privateKey,
        },
        makePublic: false,
      },
      {
        fetchFn: async (input, init) => {
          const url = String(input);
          if (url === "https://oauth2.googleapis.com/token") {
            tokenRequestBody = String(init?.body ?? "");
            return new Response(
              JSON.stringify({ access_token: "sa-token", expires_in: 3600 }),
              { status: 200 },
            );
          }
          if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
            return new Response(null, {
              status: 200,
              headers: { location: "https://upload.example.com/sa/1" },
            });
          }
          if (url === "https://upload.example.com/sa/1") {
            return new Response(
              JSON.stringify({
                id: "sa-file-99",
                webContentLink: "https://drive.google.com/uc?id=sa-file-99",
              }),
              { status: 200 },
            );
          }
          if (url.includes("/permissions")) {
            permissionCalled = true;
          }
          return new Response("unexpected", { status: 500 });
        },
      },
    );

    const url = await gdrive.upload(filePath, "downloads/ignored.mp4");
    expect(url).toBe("https://drive.google.com/uc?id=sa-file-99");
    expect(tokenRequestBody).toContain(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer",
    );
    expect(tokenRequestBody).toContain("assertion=");
    expect(permissionCalled).toBe(false);
  });

  test("TempShArchive splits files exceeding splitThresholdBytes and preserves all part links in CompositeArchive", async () => {
    const filePath = await makeTempFile("big.mp4", "0123456789abcdef"); // 16 bytes
    const uploadedNames: string[] = [];

    const tempArchive = new TempShArchive({
      splitThresholdBytes: 10,
      splitFn: async (_src, _targetBytes, splitDir) => {
        const p1 = join(splitDir, "big.part000.mp4");
        const p2 = join(splitDir, "big.part001.mp4");
        await Bun.write(p1, "01234567");
        await Bun.write(p2, "89abcdef");
        return [p1, p2];
      },
      fetchFn: async (_input, init) => {
        const body = await new Response(init?.body).text();
        const match = body.match(/filename="([^"]+)"/);
        const name = match?.[1] ?? "unknown";
        uploadedNames.push(name);
        return new Response(`https://temp.sh/u/${name}\n`, { status: 200 });
      },
    });

    const tempRes = await tempArchive.uploadAll(filePath, "downloads/big.mp4");
    expect(uploadedNames).toEqual(["big.part000.mp4", "big.part001.mp4"]);
    expect(tempRes).toEqual({
      primaryUrl: "https://temp.sh/u/big.part000.mp4",
      links: [
        { label: "Temp (1/2)", url: "https://temp.sh/u/big.part000.mp4" },
        { label: "Temp (2/2)", url: "https://temp.sh/u/big.part001.mp4" },
      ],
    });

    const composite = new CompositeArchive([
      { label: "Temp", archive: tempArchive },
      {
        label: "GDrive",
        archive: {
          async upload() {
            return "https://drive.google.com/file/d/big-1/view";
          },
        },
      },
    ]);

    const compRes = await composite.uploadAll(filePath, "downloads/big.mp4");
    expect(compRes.links).toEqual([
      { label: "Temp (1/2)", url: "https://temp.sh/u/big.part000.mp4" },
      { label: "Temp (2/2)", url: "https://temp.sh/u/big.part001.mp4" },
      { label: "GDrive", url: "https://drive.google.com/file/d/big-1/view" },
    ]);
  });

  test("TempShArchive rejects split when available disk space is insufficient", async () => {
    const filePath = await makeTempFile("big.mp4", "0123456789abcdef");
    let splitCalled = false;

    const tempArchive = new TempShArchive({
      splitThresholdBytes: 10,
      availableBytesFn: async () => 1024, // far below file.size + 64 MiB
      splitFn: async () => {
        splitCalled = true;
        return [];
      },
    });

    await expect(
      tempArchive.uploadAll(filePath, "downloads/big.mp4"),
    ).rejects.toThrow(/Ruang disk tidak cukup/);
    expect(splitCalled).toBe(false);
  });
});
