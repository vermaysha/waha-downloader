import { S3Client } from "bun";
import type { MediaArchivePort } from "./types";

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
