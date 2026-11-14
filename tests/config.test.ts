import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("loads WAHA, R2, concurrency, size-limit, and temp-dir settings from env", () => {
    const config = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000/",
      WAHA_API_KEY: "secret-key",
      WAHA_SESSION: "my-session",
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      R2_BUCKET: "media-archive",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
      R2_PUBLIC_BASE_URL: "https://cdn.example.com/",
      R2_PRESIGN_TTL_SECONDS: "7200",
      DOWNLOAD_CONCURRENCY: "3",
      DOWNLOAD_TIMEOUT_SECONDS: "900",
      DOWNLOAD_CACHE_TTL_SECONDS: "1800",
      MAX_WHATSAPP_MEDIA_BYTES: "16777216",
      TMP_DIR: "/tmp/waha-dl-test",
      COOKIES_DIR: "/var/lib/waha-dl/cookies",
    });

    expect(config).toEqual({
      waha: {
        baseUrl: "http://localhost:3000",
        apiKey: "secret-key",
        session: "my-session",
      },
      uploadTargets: ["s3"],
      r2: {
        endpoint: "https://acct.r2.cloudflarestorage.com",
        bucket: "media-archive",
        accessKeyId: "r2-key",
        secretAccessKey: "r2-secret",
        publicBaseUrl: "https://cdn.example.com",
        presignTtlSeconds: 7200,
      },
      gdrive: undefined,
      tempUploadUrl: "https://temp.sh/upload",
      downloadConcurrency: 3,
      downloadTimeoutMs: 900000,
      downloadCacheTtlMs: 1800000,
      maxWhatsappMediaBytes: 16777216,
      tmpDir: "/tmp/waha-dl-test",
      cookiesDir: "/var/lib/waha-dl/cookies",
    });
  });

  test("applies sensible defaults for optional settings and throws on missing required vars", () => {
    const config = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000",
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      R2_BUCKET: "media-archive",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
    });

    expect(config.waha.session).toBe("default");
    expect(config.waha.apiKey).toBeUndefined();
    expect(config.uploadTargets).toEqual(["s3"]);
    expect(config.tempUploadUrl).toBe("https://temp.sh/upload");
    expect(config.r2?.publicBaseUrl).toBeUndefined();
    expect(config.r2?.presignTtlSeconds).toBe(3600);
    expect(config.gdrive).toBeUndefined();
    expect(config.downloadConcurrency).toBe(2);
    expect(config.downloadTimeoutMs).toBe(300000);
    expect(config.downloadCacheTtlMs).toBe(3540000);
    expect(config.maxWhatsappMediaBytes).toBe(50 * 1024 * 1024);
    expect(config.tmpDir).toBe("tmp");
    expect(config.cookiesDir).toBe("./cookies");

    expect(() => loadConfig({})).toThrow(/WAHA_BASE_URL/);
  });

  test("supports UPLOAD_TARGET=temp, both, gdrive, all, and comma-separated targets", () => {
    const tempOnly = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000",
      UPLOAD_TARGET: "temp",
      TEMP_UPLOAD_URL: "https://temp.sh/upload/",
    });
    expect(tempOnly.uploadTargets).toEqual(["temp"]);
    expect(tempOnly.r2).toBeUndefined();
    expect(tempOnly.gdrive).toBeUndefined();
    expect(tempOnly.tempUploadUrl).toBe("https://temp.sh/upload");

    expect(() =>
      loadConfig({
        WAHA_BASE_URL: "http://localhost:3000",
        UPLOAD_TARGET: "both",
      }),
    ).toThrow(/R2_ENDPOINT/);

    const both = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000",
      UPLOAD_TARGET: "BOTH",
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      R2_BUCKET: "media-archive",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
    });
    expect(both.uploadTargets).toEqual(["s3", "temp"]);
    expect(both.r2?.bucket).toBe("media-archive");

    const gdriveOAuth = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000",
      UPLOAD_TARGET: "gdrive",
      GDRIVE_CLIENT_ID: "cid",
      GDRIVE_CLIENT_SECRET: "csecret",
      GDRIVE_REFRESH_TOKEN: "rtoken",
      GDRIVE_FOLDER_ID: "folder-123",
      GDRIVE_PUBLIC: "false",
    });
    expect(gdriveOAuth.uploadTargets).toEqual(["gdrive"]);
    expect(gdriveOAuth.gdrive).toEqual({
      auth: {
        type: "oauth",
        clientId: "cid",
        clientSecret: "csecret",
        refreshToken: "rtoken",
      },
      folderId: "folder-123",
      makePublic: false,
    });

    const allTargets = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000",
      UPLOAD_TARGET: "all",
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      R2_BUCKET: "media-archive",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
      GDRIVE_CLIENT_EMAIL: "bot@proj.iam.gserviceaccount.com",
      GDRIVE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });
    expect(allTargets.uploadTargets).toEqual(["s3", "temp", "gdrive"]);
    expect(allTargets.gdrive?.makePublic).toBe(true);
    expect(allTargets.gdrive?.auth).toEqual({
      type: "service_account",
      clientEmail: "bot@proj.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });

    const combo = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000",
      UPLOAD_TARGET: "s3, gdrive, s3",
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      R2_BUCKET: "media-archive",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
      GDRIVE_CLIENT_ID: "cid",
      GDRIVE_CLIENT_SECRET: "csecret",
      GDRIVE_REFRESH_TOKEN: "rtoken",
    });
    expect(combo.uploadTargets).toEqual(["s3", "gdrive"]);

    expect(() =>
      loadConfig({
        WAHA_BASE_URL: "http://localhost:3000",
        UPLOAD_TARGET: "gdrive",
      }),
    ).toThrow(/Missing Google Drive credentials/);

    expect(() =>
      loadConfig({
        WAHA_BASE_URL: "http://localhost:3000",
        UPLOAD_TARGET: "invalid",
      }),
    ).toThrow(/Invalid UPLOAD_TARGET/);
  });

  test("supports boolean UPLOAD_S3 / UPLOAD_TEMP / UPLOAD_GDRIVE flags when UPLOAD_TARGET is unset", () => {
    const tempAndGdrive = loadConfig({
      WAHA_BASE_URL: "http://localhost:3000",
      UPLOAD_S3: "false",
      UPLOAD_TEMP: "true",
      UPLOAD_GDRIVE: "true",
      GDRIVE_CLIENT_ID: "cid",
      GDRIVE_CLIENT_SECRET: "csecret",
      GDRIVE_REFRESH_TOKEN: "rtoken",
    });
    expect(tempAndGdrive.uploadTargets).toEqual(["temp", "gdrive"]);
    expect(tempAndGdrive.r2).toBeUndefined();
    expect(tempAndGdrive.gdrive).toBeDefined();

    expect(() =>
      loadConfig({
        WAHA_BASE_URL: "http://localhost:3000",
        UPLOAD_S3: "false",
        UPLOAD_TEMP: "false",
        UPLOAD_GDRIVE: "false",
      }),
    ).toThrow(/At least one upload target must be enabled/);
  });
});
