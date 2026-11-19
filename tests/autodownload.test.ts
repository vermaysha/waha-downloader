import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutoDownloadStore } from "../src/autodownload";
import { handleAutoDownloadCommand } from "../src/autodownload-command";
import type { WahaClientPort } from "../src/types";

describe("AutoDownloadStore", () => {
  test("defaults to disabled for any Requester", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-test-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));
      expect(await store.isEnabled("6281234567890@c.us")).toBe(false);
      expect(await store.isEnabled({ from: "62899999999@c.us" })).toBe(false);
      expect(await store.list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("enable, disable, and toggle persist across store reloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-test-"));
    const filePath = join(dir, "autodl.json");
    try {
      const store1 = createAutoDownloadStore(filePath);
      await store1.enable({ from: "628111@c.us" });
      await store1.enable("628222@s.whatsapp.net");

      expect(await store1.isEnabled("628111")).toBe(true);
      expect(await store1.isEnabled("628222")).toBe(true);
      expect(await store1.list()).toEqual(["628111", "628222"]);

      // Reload store from same file
      const store2 = createAutoDownloadStore(filePath);
      expect(await store2.isEnabled({ from: "628111@c.us" })).toBe(true);
      expect(await store2.isEnabled({ from: "628222@c.us" })).toBe(true);

      // Disable one
      await store2.disable({ from: "628111@c.us" });
      expect(await store2.isEnabled("628111")).toBe(false);
      expect(await store2.isEnabled("628222")).toBe(true);

      // Toggle
      const toggledOn = await store2.toggle({ from: "628333@c.us" });
      expect(toggledOn).toBe(true);
      expect(await store2.isEnabled("628333")).toBe(true);

      const toggledOff = await store2.toggle({ from: "628333@c.us" });
      expect(toggledOff).toBe(false);
      expect(await store2.isEnabled("628333")).toBe(false);

      // Verify list on fresh store
      const store3 = createAutoDownloadStore(filePath);
      expect(await store3.list()).toEqual(["628222"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("normalizes group participant and Note to Self", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-test-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));

      // Group participant
      await store.enable({
        from: "1203630@g.us",
        participant: "628999888@c.us",
      });
      expect(
        await store.isEnabled({
          from: "1203630@g.us",
          participant: "628999888@c.us",
        }),
      ).toBe(true);
      expect(await store.isEnabled("628999888")).toBe(true);

      // Note to Self
      await store.enable({
        from: "me@c.us",
      });
      expect(await store.isEnabled("me")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("gracefully rejects invalid requester inputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-test-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));
      expect(await store.isEnabled("../etc/passwd")).toBe(false);
      expect(await store.enable("   ")).toBe(false);
      expect(await store.disable("")).toBe(false);
      expect(await store.toggle("")).toBe(false);
      expect(await store.list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("handleAutoDownloadCommand", () => {
  function makeMockWaha() {
    const replies: Array<{ chatId: string; text: string; replyTo: string }> = [];
    const waha: WahaClientPort = {
      async sendReaction() {},
      async sendVideo() {},
      async sendText(params) {
        replies.push(params);
      },
      async downloadMedia() {
        return "";
      },
    };
    return { waha, replies };
  }

  test("/autodl on activates auto download and replies with confirmation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-cmd-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));
      const { waha, replies } = makeMockWaha();

      await handleAutoDownloadCommand(
        { waha, autoDownloadStore: store },
        { id: "msg-1", from: "628111@c.us", fromMe: false },
        "628111@c.us",
        "/autodl on",
      );

      expect(replies).toHaveLength(1);
      expect(replies[0]?.text).toContain("DIAKTIFKAN");
      expect(replies[0]?.replyTo).toBe("msg-1");
      expect(await store.isEnabled("628111")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/autodl off deactivates auto download and replies with confirmation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-cmd-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));
      await store.enable("628111");
      const { waha, replies } = makeMockWaha();

      await handleAutoDownloadCommand(
        { waha, autoDownloadStore: store },
        { id: "msg-2", from: "628111@c.us", fromMe: false },
        "628111@c.us",
        "/autodl off",
      );

      expect(replies).toHaveLength(1);
      expect(replies[0]?.text).toContain("DINONAKTIFKAN");
      expect(await store.isEnabled("628111")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/autodl status reports current state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-cmd-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));
      const { waha, replies } = makeMockWaha();

      await handleAutoDownloadCommand(
        { waha, autoDownloadStore: store },
        { id: "msg-3", from: "628111@c.us", fromMe: false },
        "628111@c.us",
        "/autodl status",
      );
      expect(replies[0]?.text).toContain("NONAKTIF");

      await store.enable("628111");
      await handleAutoDownloadCommand(
        { waha, autoDownloadStore: store },
        { id: "msg-4", from: "628111@c.us", fromMe: false },
        "628111@c.us",
        "/autodl status",
      );
      expect(replies[1]?.text).toContain("AKTIF");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("/autodl without args toggles state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-cmd-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));
      const { waha, replies } = makeMockWaha();

      // Initially off -> toggles to on
      await handleAutoDownloadCommand(
        { waha, autoDownloadStore: store },
        { id: "msg-5", from: "628111@c.us", fromMe: false },
        "628111@c.us",
        "/autodl",
      );
      expect(replies[0]?.text).toContain("DIAKTIFKAN");
      expect(await store.isEnabled("628111")).toBe(true);

      // Toggles to off
      await handleAutoDownloadCommand(
        { waha, autoDownloadStore: store },
        { id: "msg-6", from: "628111@c.us", fromMe: false },
        "628111@c.us",
        "/autodownload",
      );
      expect(replies[1]?.text).toContain("DINONAKTIFKAN");
      expect(await store.isEnabled("628111")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("handles missing store or invalid requester", async () => {
    const { waha, replies } = makeMockWaha();

    await handleAutoDownloadCommand(
      { waha },
      { id: "msg-7", from: "628111@c.us", fromMe: false },
      "628111@c.us",
      "/autodl on",
    );
    expect(replies[0]?.text).toContain("belum dikonfigurasi");

    const dir = await mkdtemp(join(tmpdir(), "waha-autodl-cmd-"));
    try {
      const store = createAutoDownloadStore(join(dir, "autodl.json"));
      await handleAutoDownloadCommand(
        { waha, autoDownloadStore: store },
        { id: "msg-8", from: "   ", fromMe: false },
        "chat-1",
        "/autodl on",
      );
      expect(replies[1]?.text).toContain("Gagal mengidentifikasi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
