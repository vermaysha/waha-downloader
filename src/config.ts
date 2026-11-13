export interface AppConfig {
  waha: {
    baseUrl: string;
    apiKey?: string;
    session: string;
  };
  r2: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl?: string;
    presignTtlSeconds: number;
  };
  downloadConcurrency: number;
  maxWhatsappMediaBytes: number;
  tmpDir: string;
  cookiesDir: string;
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

  const r2Endpoint = stripTrailingSlash(requireEnv(env, "R2_ENDPOINT"));
  const r2Bucket = requireEnv(env, "R2_BUCKET");
  const r2AccessKeyId = requireEnv(env, "R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = requireEnv(env, "R2_SECRET_ACCESS_KEY");
  const r2PublicBaseUrl = env.R2_PUBLIC_BASE_URL?.trim()
    ? stripTrailingSlash(env.R2_PUBLIC_BASE_URL.trim())
    : undefined;

  return {
    waha: {
      baseUrl: wahaBaseUrl,
      apiKey: wahaApiKey,
      session: wahaSession,
    },
    r2: {
      endpoint: r2Endpoint,
      bucket: r2Bucket,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
      publicBaseUrl: r2PublicBaseUrl,
      presignTtlSeconds: parsePositiveInt(
        env.R2_PRESIGN_TTL_SECONDS,
        3600,
        "R2_PRESIGN_TTL_SECONDS",
      ),
    },
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
