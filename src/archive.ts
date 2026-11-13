import { createSign } from "node:crypto";
import { basename } from "node:path";
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

export interface TempShArchiveConfig {
  uploadUrl?: string;
  fetchFn?: FetchLike;
}

/**
 * Uploads downloaded media to temp.sh (multipart POST) and returns the temporary URL.
 */
export class TempShArchive implements MediaArchivePort {
  private readonly uploadUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(config: TempShArchiveConfig = {}) {
    this.uploadUrl = config.uploadUrl || "https://temp.sh/upload";
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async upload(filePath: string, _objectKey: string): Promise<string> {
    const formData = new FormData();
    formData.append("file", Bun.file(filePath), basename(filePath));

    const response = await this.fetchFn(this.uploadUrl, {
      method: "POST",
      body: formData,
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
    const links = await Promise.all(
      this.targets.map(async ({ label, archive }) => ({
        label,
        url: await archive.upload(filePath, objectKey),
      })),
    );

    return {
      primaryUrl: links[0]!.url,
      links,
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

  async upload(filePath: string, _objectKey: string): Promise<string> {
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

    const uploadRes = await this.fetchFn(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(file.size),
      },
      body: file,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => "");
      throw new Error(
        `Google Drive upload failed (${uploadRes.status}): ${body || uploadRes.statusText}`,
      );
    }

    const uploaded = (await uploadRes.json()) as {
      id?: string;
      webViewLink?: string;
      webContentLink?: string;
    };
    if (!uploaded.id) {
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

    return (
      uploaded.webViewLink ||
      uploaded.webContentLink ||
      `https://drive.google.com/file/d/${uploaded.id}/view`
    );
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
