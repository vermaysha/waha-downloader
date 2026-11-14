import { describe, expect, test } from "bun:test";
import { buildYtDlpArgs } from "../src/downloader";

describe("buildYtDlpArgs", () => {
  test("includes --cookies when cookiesFile is provided and omits it otherwise", () => {
    const withoutCookies = buildYtDlpArgs(
      "https://example.com/video",
      "/tmp/job-1",
    );
    expect(withoutCookies).not.toContain("--cookies");
    expect(withoutCookies[withoutCookies.length - 1]).toBe(
      "https://example.com/video",
    );

    const withCookies = buildYtDlpArgs(
      "https://example.com/private",
      "/tmp/job-2",
      { cookiesFile: "/tmp/cookies-123.txt" },
    );
    const cookiesIdx = withCookies.indexOf("--cookies");
    expect(cookiesIdx).toBeGreaterThan(-1);
    expect(withCookies[cookiesIdx + 1]).toBe("/tmp/cookies-123.txt");
    expect(withCookies[withCookies.length - 1]).toBe(
      "https://example.com/private",
    );
  });

  test("uses byte-bounded output template and highest-quality format selector", () => {
    const args = buildYtDlpArgs("https://example.com/video", "/tmp/job-3");
    const outputIdx = args.indexOf("-o");
    expect(outputIdx).toBeGreaterThan(-1);
    expect(args[outputIdx + 1]).toBe(
      "/tmp/job-3/%(title).80B-%(id).40B.%(ext)s",
    );
    const formatIdx = args.indexOf("-f");
    expect(formatIdx).toBeGreaterThan(-1);
    expect(args[formatIdx + 1]).toBe("bv*+ba/b");
  });
});
