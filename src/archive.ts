import { basename } from "node:path";
import { S3Client } from "bun";
import type { AppConfig } from "./config";
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

/**
 * Builds the configured MediaArchivePort based on `config.uploadTarget`.
 */
export function createArchive(config: AppConfig): MediaArchivePort {
  if (config.uploadTarget === "temp") {
    return new TempShArchive({ uploadUrl: config.tempUploadUrl });
  }

  if (!config.r2) {
    throw new Error(
      `R2 configuration is required when UPLOAD_TARGET is "${config.uploadTarget}"`,
    );
  }

  const r2Archive = new R2Archive(config.r2);
  if (config.uploadTarget === "s3") {
    return r2Archive;
  }

  return new CompositeArchive([
    { label: "S3", archive: r2Archive },
    {
      label: "Temp",
      archive: new TempShArchive({ uploadUrl: config.tempUploadUrl }),
    },
  ]);
}
