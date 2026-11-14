import { createSign } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { S3Client } from "bun";
import type { AppConfig, GoogleDriveConfig } from "./config";
import type { ArchiveUploadResult, MediaArchivePort } from "./types";

export interface R2ArchiveConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  presignTtlSeconds: number;
}

/**
 * Uploads downloaded media to Cloudflare R2 and returns a public or presigned URL.
 */
export class R2Archive implements MediaArchivePort {
  private readonly client: S3Client;

  constructor(private readonly config: R2ArchiveConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
  }

  async upload(filePath: string, objectKey: string): Promise<string> {
    await this.client.write(objectKey, Bun.file(filePath), {
      type: "video/mp4",
    });

    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl}/${objectKey}`;
    }

    return this.client.presign(objectKey, {
      expiresIn: this.config.presignTtlSeconds,
    });
  }
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const TEMP_SH_SPLIT_THRESHOLD_BYTES = 3_800_000_000; // ~3.8 GB (safe margin under temp.sh 4 GB limit)

export type VideoSplitter = (
  filePath: string,
  targetPartBytes: number,
  workDir: string,
) => Promise<string[]>;

async function splitVideoWithFfmpeg(
  filePath: string,
  targetPartBytes: number,
  workDir: string,
): Promise<string[]> {
  const file = Bun.file(filePath);
  const probe = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [probeCode, probeOut] = await Promise.all([
    probe.exited,
    new Response(probe.stdout).text(),
  ]);
  const durationSec = probeCode === 0 ? Number.parseFloat(probeOut.trim()) : 0;
  const numParts = Math.max(2, Math.ceil(file.size / targetPartBytes));
  const segmentTime =
    Number.isFinite(durationSec) && durationSec > 0
      ? Math.max(10, Math.floor(durationSec / numParts))
      : 600;

  const ext = extname(filePath) || ".mp4";
  const stem = basename(filePath, ext);
  const outPattern = join(workDir, `${stem}.part%03d${ext}`);

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      filePath,
      "-c",
      "copy",
      "-map",
      "0",
      "-f",
      "segment",
      "-segment_time",
      String(segmentTime),
      "-reset_timestamps",
      "1",
      outPattern,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const detail = stderrText.trim().split("\n").pop() || `exit code ${exitCode}`;
    throw new Error(`ffmpeg split failed: ${detail}`);
  }

  const entries = (await readdir(workDir)).sort();
  if (entries.length === 0) {
    throw new Error("ffmpeg split produced no output segments");
  }
  return entries.map((name) => join(workDir, name));
}

export interface TempShArchiveConfig {
  uploadUrl?: string;
  fetchFn?: FetchLike;
  splitThresholdBytes?: number;
  splitFn?: VideoSplitter;
}

/**
 * Uploads downloaded media to temp.sh (streaming multipart POST with backpressure)
 * and splits videos > 4 GB into playable MP4 parts using ffmpeg.
 */
export class TempShArchive implements MediaArchivePort {
  private readonly uploadUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly splitThresholdBytes: number;
  private readonly splitFn: VideoSplitter;

  constructor(config: TempShArchiveConfig = {}) {
    this.uploadUrl = config.uploadUrl || "https://temp.sh/upload";
    this.fetchFn = config.fetchFn ?? fetch;
    this.splitThresholdBytes =
      config.splitThresholdBytes ?? TEMP_SH_SPLIT_THRESHOLD_BYTES;
    this.splitFn = config.splitFn ?? splitVideoWithFfmpeg;
  }

  private async uploadSingleFile(filePath: string): Promise<string> {
    const file = Bun.file(filePath);
    const filename = basename(filePath).replace(/["\r\n]/g, "_");
    const boundary = `----wahaDl${crypto.randomUUID().replace(/-/g, "")}`;
    const encoder = new TextEncoder();
    const header = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
    const totalLength = header.byteLength + file.size + footer.byteLength;

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let headerSent = false;
    let footerSent = false;

    const bodyStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(header);
          return;
        }
        if (!reader) {
          reader = file.stream().getReader();
        }
        const { done, value } = await reader.read();
        if (!done && value) {
          controller.enqueue(value);
          return;
        }
        if (!footerSent) {
          footerSent = true;
          controller.enqueue(footer);
          controller.close();
        }
      },
      async cancel() {
        await reader?.cancel();
      },
    });

    const response = await this.fetchFn(this.uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(totalLength),
      },
      body: bodyStream,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `temp.sh upload failed (${response.status}): ${body || response.statusText}`,
      );
    }

    const url = (await response.text()).trim();
    if (!url) {
      throw new Error("temp.sh upload returned an empty URL");
    }

    return url;
  }

  async upload(filePath: string, objectKey: string): Promise<string> {
    const result = await this.uploadAll(filePath, objectKey);
    return result.primaryUrl;
  }

  async uploadAll(
    filePath: string,
    _objectKey: string,
  ): Promise<ArchiveUploadResult> {
    const file = Bun.file(filePath);
    if (file.size <= this.splitThresholdBytes) {
      const url = await this.uploadSingleFile(filePath);
      return {
        primaryUrl: url,
        links: [{ label: "Temp", url }],
      };
    }

    const splitDir = await mkdtemp(join(tmpdir(), "waha-dl-split-"));
    try {
      const partPaths = await this.splitFn(
        filePath,
        this.splitThresholdBytes,
        splitDir,
      );
      const urls: string[] = [];
      for (const partPath of partPaths) {
        urls.push(await this.uploadSingleFile(partPath));
      }
      return {
        primaryUrl: urls[0]!,
        links: urls.map((url, idx) => ({
          label: urls.length === 1 ? "Temp" : `Temp (${idx + 1}/${urls.length})`,
          url,
        })),
      };
    } finally {
      await rm(splitDir, { recursive: true, force: true });
    }
  }
}

export interface CompositeArchiveTarget {
  label: string;
  archive: MediaArchivePort;
}

/**
 * Uploads downloaded media to multiple archive targets in parallel.
 */
export class CompositeArchive implements MediaArchivePort {
  constructor(private readonly targets: CompositeArchiveTarget[]) {
    if (targets.length === 0) {
      throw new Error("CompositeArchive requires at least one archive target");
    }
  }

  async upload(filePath: string, objectKey: string): Promise<string> {
    const result = await this.uploadAll(filePath, objectKey);
    return result.primaryUrl;
  }

  async uploadAll(
    filePath: string,
    objectKey: string,
  ): Promise<ArchiveUploadResult> {
    // Upload targets sequentially to avoid multiplying memory usage on low-RAM servers
    // when archiving large video files to multiple destinations.
    const results: Array<{
      primaryUrl: string;
      links: Array<{ label: string; url: string }>;
      preferLocalFile: boolean;
    }> = [];

    for (const { label, archive } of this.targets) {
      if (archive.uploadAll) {
        const res = await archive.uploadAll(filePath, objectKey);
        results.push({
          primaryUrl: res.primaryUrl,
          links:
            res.links.length > 1
              ? res.links
              : [{ label, url: res.links[0]?.url ?? res.primaryUrl }],
          preferLocalFile: Boolean(res.preferLocalFile),
        });
      } else {
        const url = await archive.upload(filePath, objectKey);
        results.push({
          primaryUrl: url,
          links: [{ label, url }],
          preferLocalFile: false,
        });
      }
    }

    return {
      primaryUrl: results[0]!.primaryUrl,
      links: results.flatMap((r) => r.links),
      preferLocalFile: results[0]!.preferLocalFile,
    };
  }
}

export interface GoogleDriveArchiveOptions {
  fetchFn?: FetchLike;
}

function createServiceAccountJwt(
  clientEmail: string,
  privateKey: string,
  nowSec: number,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Uploads downloaded media to Google Drive using Drive API v3 resumable uploads.
 */
export class GoogleDriveArchive implements MediaArchivePort {
  private readonly fetchFn: FetchLike;
  private cachedToken?: { token: string; expiresAtMs: number };

  constructor(
    private readonly config: GoogleDriveConfig,
    options: GoogleDriveArchiveOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      Date.now() < this.cachedToken.expiresAtMs - 60_000
    ) {
      return this.cachedToken.token;
    }

    const params =
      this.config.auth.type === "oauth"
        ? new URLSearchParams({
            client_id: this.config.auth.clientId,
            client_secret: this.config.auth.clientSecret,
            refresh_token: this.config.auth.refreshToken,
            grant_type: "refresh_token",
          })
        : new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: createServiceAccountJwt(
              this.config.auth.clientEmail,
              this.config.auth.privateKey,
              Math.floor(Date.now() / 1000),
            ),
          });

    const res = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Google Drive auth failed (${res.status}): ${body || res.statusText}`,
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new Error("Google Drive auth response missing access_token");
    }

    this.cachedToken = {
      token: data.access_token,
      expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  }

  private async uploadFile(
    filePath: string,
  ): Promise<{ id: string; viewUrl: string; directUrl: string }> {
    const accessToken = await this.getAccessToken();
    const file = Bun.file(filePath);
    const filename = basename(filePath);

    const metadata = {
      name: filename,
      ...(this.config.folderId ? { parents: [this.config.folderId] } : {}),
    };

    const initRes = await this.fetchFn(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(file.size),
        },
        body: JSON.stringify(metadata),
      },
    );

    if (!initRes.ok) {
      const body = await initRes.text().catch(() => "");
      throw new Error(
        `Google Drive upload init failed (${initRes.status}): ${body || initRes.statusText}`,
      );
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) {
      throw new Error("Google Drive upload init missing Location header");
    }

    const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB (multiple of 256 KiB required by Drive API)
    let uploaded:
      | { id?: string; webViewLink?: string; webContentLink?: string }
      | undefined;

    if (file.size === 0) {
      const uploadRes = await this.fetchFn(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "0",
        },
        body: new Uint8Array(0),
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "");
        throw new Error(
          `Google Drive upload failed (${uploadRes.status}): ${body || uploadRes.statusText}`,
        );
      }
      uploaded = (await uploadRes.json()) as {
        id?: string;
        webViewLink?: string;
        webContentLink?: string;
      };
    } else {
      let offset = 0;
      while (offset < file.size) {
        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
        const uploadRes = await this.fetchFn(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(end - offset),
            "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
          },
          body: chunk,
        });

        if (uploadRes.status === 308) {
          offset = end;
          continue;
        }

        if (!uploadRes.ok) {
          const body = await uploadRes.text().catch(() => "");
          throw new Error(
            `Google Drive upload failed (${uploadRes.status}): ${body || uploadRes.statusText}`,
          );
        }

        uploaded = (await uploadRes.json()) as {
          id?: string;
          webViewLink?: string;
          webContentLink?: string;
        };
        break;
      }
    }

    if (!uploaded?.id) {
      throw new Error("Google Drive upload response missing file id");
    }

    if (this.config.makePublic) {
      const permRes = await this.fetchFn(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}/permissions?supportsAllDrives=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role: "reader", type: "anyone" }),
        },
      );
      if (!permRes.ok) {
        const body = await permRes.text().catch(() => "");
        throw new Error(
          `Google Drive permission update failed (${permRes.status}): ${body || permRes.statusText}`,
        );
      }
    }

    const viewUrl =
      uploaded.webViewLink ||
      uploaded.webContentLink ||
      `https://drive.google.com/file/d/${uploaded.id}/view`;
    const directUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(uploaded.id)}&export=download&confirm=t`;

    return { id: uploaded.id, viewUrl, directUrl };
  }

  async upload(filePath: string, _objectKey: string): Promise<string> {
    const { viewUrl } = await this.uploadFile(filePath);
    return viewUrl;
  }

  async uploadAll(
    filePath: string,
    _objectKey: string,
  ): Promise<ArchiveUploadResult> {
    const { viewUrl, directUrl } = await this.uploadFile(filePath);
    return {
      primaryUrl: this.config.makePublic ? directUrl : viewUrl,
      links: [{ label: "GDrive", url: viewUrl }],
      // Public Drive files can be fetched by WAHA via directUrl (avoids 50 MiB JSON base64 limit).
      // Private Drive files fall back to local base64 upload.
      preferLocalFile: !this.config.makePublic,
    };
  }
}

/**
 * Builds the configured MediaArchivePort based on `config.uploadTargets`.
 */
export function createArchive(config: AppConfig): MediaArchivePort {
  const entries: CompositeArchiveTarget[] = config.uploadTargets.map(
    (target) => {
      if (target === "temp") {
        return {
          label: "Temp",
          archive: new TempShArchive({ uploadUrl: config.tempUploadUrl }),
        };
      }
      if (target === "s3") {
        if (!config.r2) {
          throw new Error(
            'R2 configuration is required when UPLOAD_TARGET includes "s3"',
          );
        }
        return {
          label: "S3",
          archive: new R2Archive(config.r2),
        };
      }
      if (!config.gdrive) {
        throw new Error(
          'Google Drive configuration is required when UPLOAD_TARGET includes "gdrive"',
        );
      }
      return {
        label: "GDrive",
        archive: new GoogleDriveArchive(config.gdrive),
      };
    },
  );

  if (entries.length === 1) {
    return entries[0]!.archive;
  }
  return new CompositeArchive(entries);
}
