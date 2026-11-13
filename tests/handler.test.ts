import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
});
