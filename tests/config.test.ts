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
      r2: {
        endpoint: "https://acct.r2.cloudflarestorage.com",
        bucket: "media-archive",
        accessKeyId: "r2-key",
        secretAccessKey: "r2-secret",
        publicBaseUrl: "https://cdn.example.com",
        presignTtlSeconds: 7200,
      },
      downloadConcurrency: 3,
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
    expect(config.r2.publicBaseUrl).toBeUndefined();
    expect(config.r2.presignTtlSeconds).toBe(3600);
    expect(config.downloadConcurrency).toBe(2);
    expect(config.maxWhatsappMediaBytes).toBe(50 * 1024 * 1024);
    expect(config.tmpDir).toBe("tmp");
    expect(config.cookiesDir).toBe("./cookies");

    expect(() => loadConfig({})).toThrow(/WAHA_BASE_URL/);
  });
});
