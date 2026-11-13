import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMessageHandler } from "../src/handler";
import type {
  DownloaderPort,
  MediaArchivePort,
  WahaClientPort,
  WahaMessageEvent,
} from "../src/types";

describe("createMessageHandler", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "waha-dl-handler-test-"));
    tempRoots.push(dir);
    return dir;
  }

  test("happy path: /dl <url> reacts with ⏳, downloads, uploads to Media Archive, replies with video + URL, and cleans up temp files", async () => {
    const rootTmp = await makeTempRoot();
    const calls: string[] = [];
    let observedOutputDir = "";

    const waha: WahaClientPort = {
      async sendReaction(messageId, emoji) {
        calls.push(`react:${messageId}:${emoji}`);
      },
      async sendVideo(params) {
        calls.push(
          `sendVideo:${params.chatId}:${params.replyTo}:${params.videoUrl}:${params.caption}`,
        );
      },
      async sendText(params) {
        calls.push(`sendText:${params.chatId}:${params.replyTo}:${params.text}`);
      },
    };

    const downloader: DownloaderPort = {
      async download(url, outputDir) {
        observedOutputDir = outputDir;
        calls.push(`download:${url}`);
        const filePath = join(outputDir, "clip.mp4");
        await Bun.write(filePath, new Uint8Array(1024));
        return { filePath, fileSize: 1024, filename: "clip.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload(filePath, objectKey) {
        calls.push(`upload:${filePath}:${objectKey}`);
        return "https://cdn.example.com/archive/clip.mp4";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
    });

    const event: WahaMessageEvent = {
      event: "message.any",
      session: "default",
      payload: {
        id: "false_6281234567890@c.us_MSG001",
        from: "6281234567890@c.us",
        fromMe: false,
        body: "/dl https://example.com/watch?v=123",
        source: "app",
      },
    };

    await handle(event);

    expect(calls[0]).toBe("react:false_6281234567890@c.us_MSG001:⏳");
    expect(calls[1]).toBe("download:https://example.com/watch?v=123");
    expect(calls[2]).toStartWith(`upload:${join(observedOutputDir, "clip.mp4")}:`);
    expect(calls[3]).toBe(
      "sendVideo:6281234567890@c.us:false_6281234567890@c.us_MSG001:https://cdn.example.com/archive/clip.mp4:https://cdn.example.com/archive/clip.mp4",
    );

    const remaining = await readdir(rootTmp);
    expect(remaining).toEqual([]);
  });

  test("handles fromMe: true Note to Self and ignores non-command messages and bot replies (source: api)", async () => {
    const rootTmp = await makeTempRoot();
    const calls: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction(messageId, emoji) {
        calls.push(`react:${messageId}:${emoji}`);
      },
      async sendVideo(params) {
        calls.push(`sendVideo:${params.chatId}:${params.replyTo}`);
      },
      async sendText(params) {
        calls.push(`sendText:${params.chatId}:${params.replyTo}:${params.text}`);
      },
    };

    const downloader: DownloaderPort = {
      async download(url, outputDir) {
        calls.push(`download:${url}`);
        const filePath = join(outputDir, "self.mp4");
        await Bun.write(filePath, new Uint8Array(512));
        return { filePath, fileSize: 512, filename: "self.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "https://cdn.example.com/self.mp4";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
    });

    // Ignored: non-command message
    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "m1",
        from: "6281234567890@c.us",
        fromMe: false,
        body: "hello world",
        source: "app",
      },
    });

    // Ignored: bot's own API reply (even if it somehow echoed /dl)
    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "m2",
        from: "6281234567890@c.us",
        fromMe: true,
        body: "/dl https://example.com/loop",
        source: "api",
      },
    });

    // Ignored: /dl without URL
    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "m3",
        from: "6281234567890@c.us",
        fromMe: true,
        body: "/dl   ",
        source: "app",
      },
    });

    expect(calls).toEqual([]);

    // Accepted: fromMe: true Note to Self
    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "true_6281234567890@c.us_SELF1",
        from: "6281234567890@c.us",
        to: "6281234567890@c.us",
        fromMe: true,
        body: "/dl https://example.com/self-video",
        source: "app",
      },
    });

    expect(calls).toEqual([
      "react:true_6281234567890@c.us_SELF1:⏳",
      "download:https://example.com/self-video",
      "sendVideo:6281234567890@c.us:true_6281234567890@c.us_SELF1",
    ]);
  });

  test("large-file fallback: replies with Media Archive URL text when video exceeds threshold", async () => {
    const rootTmp = await makeTempRoot();
    const calls: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {
        calls.push("sendVideo");
      },
      async sendText(params) {
        calls.push(`sendText:${params.chatId}:${params.replyTo}:${params.text}`);
      },
    };

    const downloader: DownloaderPort = {
      async download(_url, outputDir) {
        const filePath = join(outputDir, "large.mp4");
        await Bun.write(filePath, new Uint8Array(10));
        return { filePath, fileSize: 2048, filename: "large.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "https://cdn.example.com/large.mp4";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 1024,
      tmpDir: rootTmp,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-large",
        from: "628111@c.us",
        fromMe: false,
        body: "/dl https://example.com/large",
        source: "app",
      },
    });

    expect(calls).toEqual([
      "sendText:628111@c.us:msg-large:https://cdn.example.com/large.mp4",
    ]);
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("error reply and temp cleanup when download or upload fails, and reaction failure is non-fatal", async () => {
    const rootTmp = await makeTempRoot();
    const textReplies: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {
        throw new Error("reaction unsupported");
      },
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
    };

    const downloader: DownloaderPort = {
      async download(_url, outputDir) {
        await Bun.write(join(outputDir, "partial.part"), "partial");
        throw new Error("yt-dlp exited with code 1");
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "unused";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 1024,
      tmpDir: rootTmp,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-err",
        from: "628222@c.us",
        fromMe: false,
        body: "/dl https://example.com/broken",
        source: "app",
      },
    });

    expect(textReplies).toEqual([
      "628222@c.us|msg-err|Download failed: yt-dlp exited with code 1",
    ]);
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("DM Requester and domain normalization: copies matching Cookie Profile to per-job temp file, isolates writes, and deletes temp copy", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const originalCookies = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n";
    const storedProfileDir = join(cookiesDir, "6281234567890");
    const storedProfilePath = join(storedProfileDir, "youtube.com.txt");
    await mkdir(storedProfileDir, { recursive: true });
    await Bun.write(storedProfilePath, originalCookies);

    let observedCookiesFile: string | undefined;
    let observedCookiesContent = "";

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText() {},
    };

    const downloader: DownloaderPort = {
      async download(_url, outputDir, options) {
        observedCookiesFile = options?.cookiesFile;
        if (observedCookiesFile) {
          observedCookiesContent = await Bun.file(observedCookiesFile).text();
          // Simulate yt-dlp writing updated cookies back to the --cookies file
          await Bun.write(observedCookiesFile, "# mutated by yt-dlp\n");
        }
        const filePath = join(outputDir, "private.mp4");
        await Bun.write(filePath, new Uint8Array(256));
        return { filePath, fileSize: 256, filename: "private.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "https://cdn.example.com/private.mp4";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-cookie-dm",
        from: "6281234567890@c.us",
        fromMe: false,
        body: "/dl https://WWW.YouTube.com/watch?v=priv123",
        source: "app",
      },
    });

    expect(observedCookiesFile).toBeDefined();
    expect(observedCookiesFile).not.toBe(storedProfilePath);
    expect(observedCookiesContent).toBe(originalCookies);
    expect(await Bun.file(observedCookiesFile!).exists()).toBe(false);
    expect(await Bun.file(storedProfilePath).text()).toBe(originalCookies);
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("group chat Requester normalization strips @c.us, @lid, and @s.whatsapp.net from participant", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();

    const profiles = [
      { jid: "6281111111111@c.us", norm: "6281111111111", cookie: "# cookie-cus" },
      { jid: "1999888777666@lid", norm: "1999888777666", cookie: "# cookie-lid" },
      { jid: "6282222222222@s.whatsapp.net", norm: "6282222222222", cookie: "# cookie-swn" },
    ];

    for (const p of profiles) {
      await mkdir(join(cookiesDir, p.norm), { recursive: true });
      await Bun.write(join(cookiesDir, p.norm, "instagram.com.txt"), p.cookie);
    }

    const observedCookies: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText() {},
    };

    const downloader: DownloaderPort = {
      async download(_url, outputDir, options) {
        observedCookies.push(
          options?.cookiesFile ? await Bun.file(options.cookiesFile).text() : "NONE",
        );
        const filePath = join(outputDir, "reel.mp4");
        await Bun.write(filePath, new Uint8Array(128));
        return { filePath, fileSize: 128, filename: "reel.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "https://cdn.example.com/reel.mp4";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    for (const p of profiles) {
      await handle({
        event: "message.any",
        session: "default",
        payload: {
          id: `grp-${p.norm}`,
          from: "120363000111@g.us",
          participant: p.jid,
          fromMe: false,
          body: "/dl https://www.instagram.com/reel/xyz/",
          source: "app",
        },
      });
    }

    expect(observedCookies).toEqual(["# cookie-cus", "# cookie-lid", "# cookie-swn"]);
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("deletes per-job temp cookie copy even when download fails", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const storedProfileDir = join(cookiesDir, "6283333333333");
    const storedProfilePath = join(storedProfileDir, "tiktok.com.txt");
    await mkdir(storedProfileDir, { recursive: true });
    await Bun.write(storedProfilePath, "# tiktok cookie");

    let observedCookiesFile: string | undefined;

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText() {},
    };

    const downloader: DownloaderPort = {
      async download(_url, _outputDir, options) {
        observedCookiesFile = options?.cookiesFile;
        throw new Error("boom");
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "unused";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-fail-cookie",
        from: "6283333333333@c.us",
        fromMe: false,
        body: "/dl https://tiktok.com/@user/video/1",
        source: "app",
      },
    });

    expect(observedCookiesFile).toBeDefined();
    expect(await Bun.file(observedCookiesFile!).exists()).toBe(false);
    expect(await Bun.file(storedProfilePath).text()).toBe("# tiktok cookie");
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("public fallback: runs downloader without cookiesFile when no matching Cookie Profile exists", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    // Create a profile for a different domain to ensure no cross-domain match
    await mkdir(join(cookiesDir, "6284444444444"), { recursive: true });
    await Bun.write(join(cookiesDir, "6284444444444", "vimeo.com.txt"), "# vimeo");

    let observedOptions: unknown = "NOT_CALLED";

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText() {},
    };

    const downloader: DownloaderPort = {
      async download(_url, outputDir, options) {
        observedOptions = options;
        const filePath = join(outputDir, "public.mp4");
        await Bun.write(filePath, new Uint8Array(100));
        return { filePath, fileSize: 100, filename: "public.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "https://cdn.example.com/public.mp4";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-public",
        from: "6284444444444@c.us",
        fromMe: false,
        body: "/dl https://youtube.com/watch?v=public",
        source: "app",
      },
    });

    expect(observedOptions).toBeUndefined();
    expect(await readdir(rootTmp)).toEqual([]);
  });
});
