export type UploadTarget = "s3" | "temp" | "both";

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  presignTtlSeconds: number;
}

export interface AppConfig {
  waha: {
    baseUrl: string;
    apiKey?: string;
    session: string;
  };
  uploadTarget: UploadTarget;
  r2?: R2Config;
  tempUploadUrl: string;
  downloadConcurrency: number;
  maxWhatsappMediaBytes: number;
  tmpDir: string;
  cookiesDir: string;
}

function parseUploadTarget(value: string | undefined): UploadTarget {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "s3";
  }
  if (normalized === "s3" || normalized === "temp" || normalized === "both") {
    return normalized;
  }
  throw new Error(
    `Invalid UPLOAD_TARGET: ${value}. Expected one of: s3, temp, both`,
  );
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  key: string,
): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${key}: ${value}`);
  }
  return parsed;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Loads service configuration from environment variables with validation and defaults.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const wahaBaseUrl = stripTrailingSlash(requireEnv(env, "WAHA_BASE_URL"));
  const wahaApiKey = env.WAHA_API_KEY?.trim() || undefined;
  const wahaSession = env.WAHA_SESSION?.trim() || "default";
  const uploadTarget = parseUploadTarget(env.UPLOAD_TARGET);
  const tempUploadUrl = stripTrailingSlash(
    env.TEMP_UPLOAD_URL?.trim() || "https://temp.sh/upload",
  );

  const r2: R2Config | undefined =
    uploadTarget === "s3" || uploadTarget === "both"
      ? {
          endpoint: stripTrailingSlash(requireEnv(env, "R2_ENDPOINT")),
          bucket: requireEnv(env, "R2_BUCKET"),
          accessKeyId: requireEnv(env, "R2_ACCESS_KEY_ID"),
          secretAccessKey: requireEnv(env, "R2_SECRET_ACCESS_KEY"),
          publicBaseUrl: env.R2_PUBLIC_BASE_URL?.trim()
            ? stripTrailingSlash(env.R2_PUBLIC_BASE_URL.trim())
            : undefined,
          presignTtlSeconds: parsePositiveInt(
            env.R2_PRESIGN_TTL_SECONDS,
            3600,
            "R2_PRESIGN_TTL_SECONDS",
          ),
        }
      : undefined;

  return {
    waha: {
      baseUrl: wahaBaseUrl,
      apiKey: wahaApiKey,
      session: wahaSession,
    },
    uploadTarget,
    r2,
    tempUploadUrl,
    downloadConcurrency: parsePositiveInt(
      env.DOWNLOAD_CONCURRENCY,
      2,
      "DOWNLOAD_CONCURRENCY",
    ),
    maxWhatsappMediaBytes: parsePositiveInt(
      env.MAX_WHATSAPP_MEDIA_BYTES,
      50 * 1024 * 1024,
      "MAX_WHATSAPP_MEDIA_BYTES",
    ),
    tmpDir: env.TMP_DIR?.trim() || "tmp",
    cookiesDir: env.COOKIES_DIR?.trim() || "./cookies",
  };
}
