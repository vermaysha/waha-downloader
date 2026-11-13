import { describe, expect, test } from "bun:test";
import {
  WahaClient,
  buildWahaWsUrl,
  computeBackoffMs,
} from "../src/waha";

describe("WAHA client and WebSocket helpers", () => {
  test("buildWahaWsUrl converts http/https to ws/wss with session, events, and optional api key", () => {
    expect(
      buildWahaWsUrl({
        baseUrl: "http://localhost:3000",
        session: "default",
        apiKey: "secret",
      }),
    ).toBe(
      "ws://localhost:3000/ws?session=default&events=message.any&x-api-key=secret",
    );

    expect(
      buildWahaWsUrl({
        baseUrl: "https://waha.example.com",
        session: "prod",
      }),
    ).toBe("wss://waha.example.com/ws?session=prod&events=message.any");
  });

  test("computeBackoffMs grows exponentially and caps at maxDelayMs", () => {
    expect(computeBackoffMs(0, 1000, 30000)).toBe(1000);
    expect(computeBackoffMs(1, 1000, 30000)).toBe(2000);
    expect(computeBackoffMs(2, 1000, 30000)).toBe(4000);
    expect(computeBackoffMs(10, 1000, 30000)).toBe(30000);
  });

  test("ensureSessionStarted verifies WORKING, starts STOPPED, and creates missing 404 sessions", async () => {
    const requests: Array<{ method: string; path: string; body?: string }> = [];

    const makeClient = (statusCode: number, sessionStatus?: string) =>
      new WahaClient(
        { baseUrl: "http://waha:3000", session: "bot", apiKey: "k" },
        async (input, init) => {
          const url = new URL(typeof input === "string" ? input : input.toString());
          requests.push({
            method: init?.method ?? "GET",
            path: url.pathname,
            body: typeof init?.body === "string" ? init.body : undefined,
          });
          if ((init?.method ?? "GET") === "GET") {
            if (statusCode === 404) {
              return new Response("Not Found", { status: 404 });
            }
            return Response.json({ name: "bot", status: sessionStatus });
          }
          return new Response("{}", { status: 201 });
        },
      );

    await makeClient(200, "WORKING").ensureSessionStarted();
    expect(requests).toEqual([{ method: "GET", path: "/api/sessions/bot", body: undefined }]);

    requests.length = 0;
    await makeClient(200, "STOPPED").ensureSessionStarted();
    expect(requests).toEqual([
      { method: "GET", path: "/api/sessions/bot", body: undefined },
      { method: "POST", path: "/api/sessions/bot/start", body: undefined },
    ]);

    requests.length = 0;
    await makeClient(404).ensureSessionStarted();
    expect(requests).toEqual([
      { method: "GET", path: "/api/sessions/bot", body: undefined },
      {
        method: "POST",
        path: "/api/sessions",
        body: JSON.stringify({ name: "bot", start: true }),
      },
    ]);
  });

  test("downloadMedia fetches media URL with X-Api-Key when configured and throws on error status", async () => {
    const requests: Array<{ url: string; method: string; apiKey?: string }> = [];

    const client = new WahaClient(
      { baseUrl: "http://waha:3000", session: "bot", apiKey: "secret-key" },
      async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: typeof input === "string" ? input : input.toString(),
          method: init?.method ?? "GET",
          apiKey: headers.get("X-Api-Key") ?? undefined,
        });
        return new Response("# Netscape HTTP Cookie File\n", { status: 200 });
      },
    );

    const content = await client.downloadMedia(
      "http://waha:3000/api/files/cookies.txt",
    );
    expect(content).toBe("# Netscape HTTP Cookie File\n");
    expect(requests).toEqual([
      {
        url: "http://waha:3000/api/files/cookies.txt",
        method: "GET",
        apiKey: "secret-key",
      },
    ]);

    const failingClient = new WahaClient(
      { baseUrl: "http://waha:3000", session: "bot" },
      async () => new Response("Forbidden", { status: 403 }),
    );
    await expect(
      failingClient.downloadMedia("http://waha:3000/api/files/cookies.txt"),
    ).rejects.toThrow("403");
  });

  test("sendSeen posts session, chatId, and optional messageId/participant to /api/sendSeen", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const client = new WahaClient(
      { baseUrl: "http://waha:3000", session: "bot", apiKey: "secret-key" },
      async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(null, { status: 201 });
      },
    );

    await client.sendSeen({
      chatId: "628123@c.us",
      messageId: "msg-1",
    });

    expect(calls).toEqual([
      {
        url: "http://waha:3000/api/sendSeen",
        method: "POST",
        body: {
          session: "bot",
          chatId: "628123@c.us",
          messageId: "msg-1",
        },
      },
    ]);
  });
});
