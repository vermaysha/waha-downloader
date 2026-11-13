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
      async downloadMedia() {
        return "";
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
      async downloadMedia() {
        return "";
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

    // Ignored: non-message.any event (e.g. "message")
    await handle({
      event: "message",
      session: "default",
      payload: {
        id: "m1b",
        from: "6281234567890@c.us",
        fromMe: false,
        body: "/dl https://example.com/ignored-event",
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
      async downloadMedia() {
        return "";
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
      async downloadMedia() {
        return "";
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
      async downloadMedia() {
        return "";
      },
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
      async downloadMedia() {
        return "";
      },
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
      async downloadMedia() {
        return "";
      },
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
      async downloadMedia() {
        return "";
      },
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

  test("multi-URL /dl extracts space- and newline-separated URLs and replies per URL", async () => {
    const rootTmp = await makeTempRoot();
    const reactions: string[] = [];
    const downloadedUrls: string[] = [];
    const sentVideos: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction(messageId, emoji) {
        reactions.push(`${messageId}:${emoji}`);
      },
      async sendVideo(params) {
        sentVideos.push(`${params.chatId}|${params.replyTo}|${params.videoUrl}`);
      },
      async sendText() {},
      async downloadMedia() {
        return "";
      },
    };

    const downloader: DownloaderPort = {
      async download(url, outputDir) {
        downloadedUrls.push(url);
        const idx = downloadedUrls.length;
        const filename = `video-${idx}.mp4`;
        const filePath = join(outputDir, filename);
        await Bun.write(filePath, new Uint8Array(256));
        return { filePath, fileSize: 256, filename };
      },
    };

    const archive: MediaArchivePort = {
      async upload(filePath) {
        const name = filePath.split("/").pop();
        return `https://cdn.example.com/${name}`;
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-multi",
        from: "628333@c.us",
        fromMe: false,
        body: "/dl https://example.com/1 https://example.com/2\nhttps://example.com/3",
        source: "app",
      },
    });

    expect(reactions).toEqual(["msg-multi:⏳"]);
    expect(downloadedUrls.sort()).toEqual([
      "https://example.com/1",
      "https://example.com/2",
      "https://example.com/3",
    ]);
    expect(sentVideos).toHaveLength(3);
    expect(sentVideos.sort()).toEqual([
      "628333@c.us|msg-multi|https://cdn.example.com/video-1.mp4",
      "628333@c.us|msg-multi|https://cdn.example.com/video-2.mp4",
      "628333@c.us|msg-multi|https://cdn.example.com/video-3.mp4",
    ]);
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("bounded concurrency: active downloads never exceed downloadConcurrency across multi-URL and concurrent Download Requests", async () => {
    const rootTmp = await makeTempRoot();
    let activeDownloads = 0;
    let maxActiveDownloads = 0;
    const completedUrls: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo(params) {
        completedUrls.push(params.videoUrl);
      },
      async sendText() {},
      async downloadMedia() {
        return "";
      },
    };

    const downloader: DownloaderPort = {
      async download(url, outputDir) {
        activeDownloads += 1;
        maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
        await new Promise((resolve) => setTimeout(resolve, 25));
        activeDownloads -= 1;

        const name = `${url.split("/").pop()}.mp4`;
        const filePath = join(outputDir, name);
        await Bun.write(filePath, new Uint8Array(64));
        return { filePath, fileSize: 64, filename: name };
      },
    };

    const archive: MediaArchivePort = {
      async upload(filePath) {
        const name = filePath.split("/").pop();
        return `https://cdn.example.com/${name}`;
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      downloadConcurrency: 2,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
    });

    await Promise.all([
      handle({
        event: "message.any",
        session: "default",
        payload: {
          id: "req-1",
          from: "628444@c.us",
          fromMe: false,
          body: "/dl https://example.com/a https://example.com/b https://example.com/c",
          source: "app",
        },
      }),
      handle({
        event: "message.any",
        session: "default",
        payload: {
          id: "req-2",
          from: "628555@c.us",
          fromMe: false,
          body: "/dl https://example.com/d",
          source: "app",
        },
      }),
      handle({
        event: "message.any",
        session: "default",
        payload: {
          id: "req-3",
          from: "628666@c.us",
          fromMe: false,
          body: "/dl https://example.com/e",
          source: "app",
        },
      }),
    ]);

    expect(maxActiveDownloads).toBe(2);
    expect(completedUrls).toHaveLength(5);
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("partial-failure isolation: failure on one URL reports error for that URL without aborting remaining URLs", async () => {
    const rootTmp = await makeTempRoot();
    const sentVideos: string[] = [];
    const textReplies: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo(params) {
        sentVideos.push(`${params.chatId}|${params.replyTo}|${params.videoUrl}`);
      },
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        return "";
      },
    };

    const downloader: DownloaderPort = {
      async download(url, outputDir) {
        if (url === "https://example.com/bad") {
          await Bun.write(join(outputDir, "partial.part"), "partial");
          throw new Error("video unavailable");
        }
        const name = `${url.split("/").pop()}.mp4`;
        const filePath = join(outputDir, name);
        await Bun.write(filePath, new Uint8Array(128));
        return { filePath, fileSize: 128, filename: name };
      },
    };

    const archive: MediaArchivePort = {
      async upload(filePath) {
        const name = filePath.split("/").pop();
        return `https://cdn.example.com/${name}`;
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      downloadConcurrency: 2,
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-partial",
        from: "628777@c.us",
        fromMe: false,
        body: "/dl https://example.com/ok1\nhttps://example.com/bad\nhttps://example.com/ok2",
        source: "app",
      },
    });

    expect(sentVideos.sort()).toEqual([
      "628777@c.us|msg-partial|https://cdn.example.com/ok1.mp4",
      "628777@c.us|msg-partial|https://cdn.example.com/ok2.mp4",
    ]);
    expect(textReplies).toEqual([
      "628777@c.us|msg-partial|Download failed (https://example.com/bad): video unavailable",
    ]);
    expect(await readdir(rootTmp)).toEqual([]);
  });

  test("/cookies <domain> with .txt attachment downloads media from WAHA, saves normalized Cookie Profile, and replies", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const downloadedMediaUrls: string[] = [];
    const textReplies: string[] = [];
    let observedCookiesContent: string | undefined;

    const netscapeCookies =
      "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret123\n";

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia(mediaUrl) {
        downloadedMediaUrls.push(mediaUrl);
        return netscapeCookies;
      },
    };

    const downloader: DownloaderPort = {
      async download(_url, outputDir, options) {
        if (options?.cookiesFile) {
          observedCookiesContent = await Bun.file(options.cookiesFile).text();
        }
        const filePath = join(outputDir, "vid.mp4");
        await Bun.write(filePath, new Uint8Array(64));
        return { filePath, fileSize: 64, filename: "vid.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "https://cdn.example.com/vid.mp4";
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
        id: "msg-cookie-attach",
        from: "628111222@c.us",
        fromMe: false,
        caption: "/cookies www.YouTube.com",
        hasMedia: true,
        media: {
          url: "http://waha:3000/api/files/cookies.txt",
          mimetype: "text/plain",
          filename: "cookies.txt",
        },
        source: "app",
      },
    });

    expect(downloadedMediaUrls).toEqual([
      "http://waha:3000/api/files/cookies.txt",
    ]);
    const savedPath = join(cookiesDir, "628111222", "youtube.com.txt");
    expect(await Bun.file(savedPath).text()).toBe(netscapeCookies);
    expect(textReplies).toEqual([
      "628111222@c.us|msg-cookie-attach|Saved Cookie Profile for youtube.com.",
    ]);

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-dl-after-cookie",
        from: "628111222@c.us",
        fromMe: false,
        body: "/dl https://youtube.com/watch?v=1",
        source: "app",
      },
    });
    expect(observedCookiesContent).toBe(netscapeCookies);
  });

  test("/cookies <domain> with inline Netscape cookie text saves normalized Cookie Profile on disk", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const textReplies: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        throw new Error("should not download media for inline cookies");
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    const inlineCookieLines =
      "# Netscape HTTP Cookie File\n.x.com\tTRUE\t/\tTRUE\t0\tauth_token\tabc";

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-cookie-inline",
        from: "628333444@c.us",
        fromMe: false,
        body: `/cookies WWW.X.COM\n${inlineCookieLines}`,
        source: "app",
      },
    });

    const savedPath = join(cookiesDir, "628333444", "x.com.txt");
    expect(await Bun.file(savedPath).text()).toBe(`${inlineCookieLines}\n`);
    expect(textReplies).toEqual([
      "628333444@c.us|msg-cookie-inline|Saved Cookie Profile for x.com.",
    ]);
  });

  test("/cookies list replies with stored Cookie Profile domains or clear message when none exist", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const textReplies: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        return "";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-list-empty",
        from: "628555666@c.us",
        fromMe: false,
        body: "/cookies list",
        source: "app",
      },
    });

    expect(textReplies[0]).toBe(
      "628555666@c.us|msg-list-empty|No Cookie Profiles stored.",
    );

    const requesterDir = join(cookiesDir, "628555666");
    await mkdir(requesterDir, { recursive: true });
    await Bun.write(join(requesterDir, "youtube.com.txt"), "cookie1");
    await Bun.write(join(requesterDir, "instagram.com.txt"), "cookie2");

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-list-full",
        from: "628555666@c.us",
        fromMe: false,
        body: "/cookies list",
        source: "app",
      },
    });

    expect(textReplies[1]).toContain("instagram.com");
    expect(textReplies[1]).toContain("youtube.com");
  });

  test("/cookies del <domain> deletes stored Cookie Profile on disk and confirms removal", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const textReplies: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        return "";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    const requesterDir = join(cookiesDir, "628999000");
    await mkdir(requesterDir, { recursive: true });
    const profilePath = join(requesterDir, "youtube.com.txt");
    await Bun.write(profilePath, "cookie-data");

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-del-1",
        from: "628999000@c.us",
        fromMe: false,
        body: "/cookies del www.YouTube.com",
        source: "app",
      },
    });

    expect(await Bun.file(profilePath).exists()).toBe(false);
    expect(textReplies[0]).toBe(
      "628999000@c.us|msg-del-1|Deleted Cookie Profile for youtube.com.",
    );

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-del-2",
        from: "628999000@c.us",
        fromMe: false,
        body: "/cookies del nonexistent.com",
        source: "app",
      },
    });

    expect(textReplies[1]).toBe(
      "628999000@c.us|msg-del-2|No Cookie Profile found for nonexistent.com.",
    );
  });

  test("rejects invalid or path-traversal domains and missing/non-txt cookie payloads with clear error messages", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const textReplies: string[] = [];
    let downloadMediaCalled = 0;

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        downloadMediaCalled += 1;
        return "should-not-download";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    const invalidCases = [
      { id: "m1", body: "/cookies ..\nline1" },
      { id: "m2", body: "/cookies ../secret\nline1" },
      { id: "m3", body: "/cookies foo/bar\nline1" },
      { id: "m4", body: "/cookies foo\\bar\nline1" },
      { id: "m5", body: "/cookies del .." },
      { id: "m6", body: "/cookies" },
      { id: "m7", body: "/cookies youtube.com" },
    ];

    for (const c of invalidCases) {
      await handle({
        event: "message.any",
        session: "default",
        payload: {
          id: c.id,
          from: "628000111@c.us",
          fromMe: false,
          body: c.body,
          source: "app",
        },
      });
    }

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "m8",
        from: "628000111@c.us",
        fromMe: false,
        caption: "/cookies ../escape",
        hasMedia: true,
        media: {
          url: "http://waha:3000/api/files/cookies.txt",
          filename: "cookies.txt",
        },
        source: "app",
      },
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "m9",
        from: "628000111@c.us",
        fromMe: false,
        caption: "/cookies youtube.com",
        hasMedia: true,
        media: {
          url: "http://waha:3000/api/files/image.png",
          filename: "image.png",
        },
        source: "app",
      },
    });

    expect(downloadMediaCalled).toBe(0);
    expect(textReplies).toHaveLength(9);
    expect(textReplies[0]).toContain("Invalid domain");
    expect(textReplies[1]).toContain("Invalid domain");
    expect(textReplies[2]).toContain("Invalid domain");
    expect(textReplies[3]).toContain("Invalid domain");
    expect(textReplies[4]).toContain("Invalid domain");
    expect(textReplies[5]).toContain("Usage:");
    expect(textReplies[6]).toContain("attach a .txt");
    expect(textReplies[7]).toContain("Invalid domain");
    expect(textReplies[8]).toContain(".txt");
    expect(await readdir(cookiesDir)).toEqual([]);
  });

  test("/cookies <domain> with empty body string falls back to caption", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const textReplies: string[] = [];
    const netscapeCookies =
      "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tcap123\n";

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        return netscapeCookies;
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-empty-body-caption",
        from: "628111222@c.us",
        fromMe: false,
        body: "",
        caption: "/cookies youtube.com",
        hasMedia: true,
        media: {
          url: "http://waha:3000/api/files/cookies.txt",
          mimetype: "text/plain",
          filename: "cookies.txt",
        },
        source: "app",
      },
    });

    const savedPath = join(cookiesDir, "628111222", "youtube.com.txt");
    expect(await Bun.file(savedPath).text()).toBe(netscapeCookies);
    expect(textReplies).toEqual([
      "628111222@c.us|msg-empty-body-caption|Saved Cookie Profile for youtube.com.",
    ]);
  });

  test("/cookies <domain> with hasMedia true but missing media.url replies with attachment URL unavailable error", async () => {
    const rootTmp = await makeTempRoot();
    const cookiesDir = await makeTempRoot();
    const textReplies: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        throw new Error("should not be called");
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
      cookiesDir,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-missing-media-url",
        from: "628111222@c.us",
        fromMe: false,
        body: "",
        caption: "/cookies youtube.com",
        hasMedia: true,
        media: {
          mimetype: "text/plain",
          filename: "cookies.txt",
        },
        source: "app",
      },
    });

    expect(textReplies).toHaveLength(1);
    expect(textReplies[0]).toContain("628111222@c.us|msg-missing-media-url|");
    expect(textReplies[0].toLowerCase()).toContain("attachment url");
    expect(textReplies[0].toLowerCase()).toContain("unavailable");
  });

  test("/help and /h reply with usage instructions for all supported commands", async () => {
    const rootTmp = await makeTempRoot();
    const textReplies: Array<{ chatId: string; replyTo: string; text: string }> = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(params);
      },
      async downloadMedia() {
        return "";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-help",
        from: "628123@c.us",
        fromMe: false,
        body: "/help",
        source: "app",
      },
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-h",
        from: "628123@c.us",
        fromMe: false,
        body: "/h",
        source: "app",
      },
    });

    expect(textReplies).toHaveLength(2);
    for (const reply of textReplies) {
      expect(reply.chatId).toBe("628123@c.us");
      expect(reply.text).toContain("/dl");
      expect(reply.text).toContain("/cookies");
      expect(reply.text).toContain("/help");
    }
    expect(textReplies[0]?.replyTo).toBe("msg-help");
    expect(textReplies[1]?.replyTo).toBe("msg-h");
  });

  test("sends best-effort seen receipt on incoming commands and skips sendSeen for fromMe messages", async () => {
    const rootTmp = await makeTempRoot();
    const seenCalls: Array<{ chatId: string; messageId?: string; participant?: string }> = [];
    const textReplies: string[] = [];

    const waha: WahaClientPort = {
      async sendSeen(params) {
        seenCalls.push(params);
        if (params.messageId === "msg-seen-fail") {
          throw new Error("seen failed");
        }
      },
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        textReplies.push(`${params.chatId}|${params.replyTo}|${params.text}`);
      },
      async downloadMedia() {
        return "";
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader: {
        async download() {
          throw new Error("unused");
        },
      },
      archive: {
        async upload() {
          throw new Error("unused");
        },
      },
      maxWhatsappMediaBytes: 50 * 1024 * 1024,
      tmpDir: rootTmp,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-seen-fail",
        from: "120363000@g.us",
        participant: "628111@c.us",
        fromMe: false,
        body: "/help",
        source: "app",
      },
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "msg-self",
        from: "628111@c.us",
        to: "628111@c.us",
        fromMe: true,
        body: "/h",
        source: "app",
      },
    });

    expect(seenCalls).toEqual([
      {
        chatId: "120363000@g.us",
        messageId: "msg-seen-fail",
        participant: "628111@c.us",
      },
    ]);
    expect(textReplies).toHaveLength(2);
  });

  test("multi-target archive (uploadAll) sends primary videoUrl with all labeled links in caption or text fallback", async () => {
    const rootTmp = await makeTempRoot();
    const sentVideos: Array<{ videoUrl: string; caption: string }> = [];
    const sentTexts: string[] = [];

    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo(params) {
        sentVideos.push({ videoUrl: params.videoUrl, caption: params.caption });
      },
      async sendText(params) {
        sentTexts.push(params.text);
      },
      async downloadMedia() {
        return "";
      },
    };

    let nextSize = 1024;
    const downloader: DownloaderPort = {
      async download(_url, outputDir) {
        const filePath = join(outputDir, "clip.mp4");
        await Bun.write(filePath, new Uint8Array(10));
        return { filePath, fileSize: nextSize, filename: "clip.mp4" };
      },
    };

    const archive: MediaArchivePort = {
      async upload() {
        return "https://cdn.example.com/clip.mp4";
      },
      async uploadAll() {
        return {
          primaryUrl: "https://cdn.example.com/clip.mp4",
          links: [
            { label: "S3", url: "https://cdn.example.com/clip.mp4" },
            { label: "Temp", url: "https://temp.sh/abc/clip.mp4" },
          ],
        };
      },
    };

    const handle = createMessageHandler({
      waha,
      downloader,
      archive,
      maxWhatsappMediaBytes: 2048,
      tmpDir: rootTmp,
    });

    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "m-small",
        from: "628123@c.us",
        fromMe: false,
        body: "/dl https://example.com/small",
        source: "app",
      },
    });

    nextSize = 4096;
    await handle({
      event: "message.any",
      session: "default",
      payload: {
        id: "m-large",
        from: "628123@c.us",
        fromMe: false,
        body: "/dl https://example.com/large",
        source: "app",
      },
    });

    expect(sentVideos).toEqual([
      {
        videoUrl: "https://cdn.example.com/clip.mp4",
        caption:
          "S3: https://cdn.example.com/clip.mp4\nTemp: https://temp.sh/abc/clip.mp4",
      },
    ]);
    expect(sentTexts).toEqual([
      "S3: https://cdn.example.com/clip.mp4\nTemp: https://temp.sh/abc/clip.mp4",
    ]);
  });
});
