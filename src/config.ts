import { readFileSync } from "node:fs";

export type UploadTarget = "s3" | "temp" | "gdrive";

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  presignTtlSeconds: number;
}

export type GoogleDriveAuthConfig =
  | {
      type: "oauth";
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    }
  | {
      type: "service_account";
      clientEmail: string;
      privateKey: string;
    };

export interface GoogleDriveConfig {
  auth: GoogleDriveAuthConfig;
  folderId?: string;
  makePublic: boolean;
}

export interface AppConfig {
  waha: {
    baseUrl: string;
    apiKey?: string;
    session: string;
  };
  uploadTargets: UploadTarget[];
  r2?: R2Config;
  gdrive?: GoogleDriveConfig;
  tempUploadUrl: string;
  downloadConcurrency: number;
  downloadTimeoutMs: number;
  maxWhatsappMediaBytes: number;
  tmpDir: string;
  cookiesDir: string;
}

function parseUploadTargets(value: string | undefined): UploadTarget[] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return ["s3"];
  }
  if (normalized === "both") {
    return ["s3", "temp"];
  }
  if (normalized === "all") {
    return ["s3", "temp", "gdrive"];
  }

  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return ["s3"];
  }

  const targets: UploadTarget[] = [];
  for (const part of parts) {
    if (part !== "s3" && part !== "temp" && part !== "gdrive") {
      throw new Error(
        `Invalid UPLOAD_TARGET: ${value}. Expected s3, temp, gdrive, both, all, or comma-separated targets`,
      );
    }
    if (!targets.includes(part)) {
      targets.push(part);
    }
  }
  return targets;
}

function parseBooleanEnv(
  value: string | undefined,
  fallback: boolean,
  key: string,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`Invalid boolean for ${key}: ${value}`);
}

function resolveUploadTargets(
  env: Record<string, string | undefined>,
): UploadTarget[] {
  const rawTarget = env.UPLOAD_TARGET?.trim();
  if (rawTarget) {
    return parseUploadTargets(rawTarget);
  }

  const hasFlag =
    env.UPLOAD_S3 !== undefined ||
    env.UPLOAD_TEMP !== undefined ||
    env.UPLOAD_GDRIVE !== undefined;

  if (!hasFlag) {
    return ["s3"];
  }

  const targets: UploadTarget[] = [];
  if (parseBooleanEnv(env.UPLOAD_S3, false, "UPLOAD_S3")) {
    targets.push("s3");
  }
  if (parseBooleanEnv(env.UPLOAD_TEMP, false, "UPLOAD_TEMP")) {
    targets.push("temp");
  }
  if (parseBooleanEnv(env.UPLOAD_GDRIVE, false, "UPLOAD_GDRIVE")) {
    targets.push("gdrive");
  }

  if (targets.length === 0) {
    throw new Error(
      "At least one upload target must be enabled (UPLOAD_S3, UPLOAD_TEMP, or UPLOAD_GDRIVE)",
    );
  }

  return targets;
}

function loadGoogleDriveConfig(
  env: Record<string, string | undefined>,
): GoogleDriveConfig {
  const folderId = env.GDRIVE_FOLDER_ID?.trim() || undefined;
  const makePublic = parseBooleanEnv(env.GDRIVE_PUBLIC, true, "GDRIVE_PUBLIC");

  const hasOAuth = Boolean(
    env.GDRIVE_REFRESH_TOKEN?.trim() ||
      env.GDRIVE_CLIENT_ID?.trim() ||
      env.GDRIVE_CLIENT_SECRET?.trim(),
  );
  if (hasOAuth) {
    return {
      auth: {
        type: "oauth",
        clientId: requireEnv(env, "GDRIVE_CLIENT_ID"),
        clientSecret: requireEnv(env, "GDRIVE_CLIENT_SECRET"),
        refreshToken: requireEnv(env, "GDRIVE_REFRESH_TOKEN"),
      },
      folderId,
      makePublic,
    };
  }

  const saJson = env.GDRIVE_SERVICE_ACCOUNT_JSON?.trim();
  if (saJson) {
    const rawJson = saJson.startsWith("{")
      ? saJson
      : readFileSync(saJson, "utf8");
    const parsed = JSON.parse(rawJson) as {
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.client_email?.trim() || !parsed.private_key?.trim()) {
      throw new Error(
        "Invalid GDRIVE_SERVICE_ACCOUNT_JSON: missing client_email or private_key",
      );
    }
    return {
      auth: {
        type: "service_account",
        clientEmail: parsed.client_email.trim(),
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      },
      folderId,
      makePublic,
    };
  }

  if (env.GDRIVE_CLIENT_EMAIL?.trim() || env.GDRIVE_PRIVATE_KEY?.trim()) {
    return {
      auth: {
        type: "service_account",
        clientEmail: requireEnv(env, "GDRIVE_CLIENT_EMAIL"),
        privateKey: requireEnv(env, "GDRIVE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      },
      folderId,
      makePublic,
    };
  }

  throw new Error(
    "Missing Google Drive credentials: set GDRIVE_CLIENT_ID/GDRIVE_CLIENT_SECRET/GDRIVE_REFRESH_TOKEN or GDRIVE_CLIENT_EMAIL/GDRIVE_PRIVATE_KEY (or GDRIVE_SERVICE_ACCOUNT_JSON)",
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
  const uploadTargets = resolveUploadTargets(env);
  const tempUploadUrl = stripTrailingSlash(
    env.TEMP_UPLOAD_URL?.trim() || "https://temp.sh/upload",
  );

  const r2: R2Config | undefined = uploadTargets.includes("s3")
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

  const gdrive: GoogleDriveConfig | undefined = uploadTargets.includes("gdrive")
    ? loadGoogleDriveConfig(env)
    : undefined;

  return {
    waha: {
      baseUrl: wahaBaseUrl,
      apiKey: wahaApiKey,
      session: wahaSession,
    },
    uploadTargets,
    r2,
    gdrive,
    tempUploadUrl,
    downloadConcurrency: parsePositiveInt(
      env.DOWNLOAD_CONCURRENCY,
      2,
      "DOWNLOAD_CONCURRENCY",
    ),
    downloadTimeoutMs:
      parsePositiveInt(
        env.DOWNLOAD_TIMEOUT_SECONDS,
        300,
        "DOWNLOAD_TIMEOUT_SECONDS",
      ) * 1000,
    maxWhatsappMediaBytes: parsePositiveInt(
      env.MAX_WHATSAPP_MEDIA_BYTES,
      50 * 1024 * 1024,
      "MAX_WHATSAPP_MEDIA_BYTES",
    ),
    tmpDir: env.TMP_DIR?.trim() || "tmp",
    cookiesDir: env.COOKIES_DIR?.trim() || "./cookies",
  };
}
