import type { Logger, WahaClientPort, WahaMessageEvent } from "./types";

export interface WahaConnectionConfig {
  baseUrl: string;
  session: string;
  apiKey?: string;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function buildWahaWsUrl(config: WahaConnectionConfig): string {
  const url = new URL(config.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.searchParams.set("session", config.session);
  url.searchParams.append("events", "message.any");
  if (config.apiKey) {
    url.searchParams.set("x-api-key", config.apiKey);
  }
  return url.toString();
}

export function computeBackoffMs(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
): number {
  const delay = baseDelayMs * 2 ** Math.max(0, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * HTTP client for WAHA session management and messaging APIs.
 */
export class WahaClient implements WahaClientPort {
  constructor(
    private readonly config: WahaConnectionConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.config.apiKey) {
      headers["X-Api-Key"] = this.config.apiKey;
    }
    return headers;
  }

  private async assertOk(response: Response, context: string): Promise<void> {
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${context} failed (${response.status}): ${body}`);
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchFn(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: this.authHeaders({
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      }),
    });
  }

  private async requestOk(path: string, init: RequestInit = {}): Promise<void> {
    const response = await this.request(path, init);
    await this.assertOk(response, `WAHA ${init.method ?? "GET"} ${path}`);
  }

  async ensureSessionStarted(): Promise<void> {
    const sessionPath = `/api/sessions/${encodeURIComponent(this.config.session)}`;
    const res = await this.request(sessionPath, { method: "GET" });

    if (res.status === 404) {
      await this.requestOk("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ name: this.config.session, start: true }),
      });
      return;
    }

    await this.assertOk(res, `WAHA GET ${sessionPath}`);

    const data = (await res.json()) as { status?: string };
    if (data.status === "STOPPED" || data.status === "FAILED") {
      await this.requestOk(`${sessionPath}/start`, { method: "POST" });
    }
  }

  async sendReaction(messageId: string, emoji: string): Promise<void> {
    await this.requestOk("/api/reaction", {
      method: "PUT",
      body: JSON.stringify({
        session: this.config.session,
        messageId,
        reaction: emoji,
      }),
    });
  }

  async sendVideo(params: {
    chatId: string;
    videoUrl: string;
    filename: string;
    caption: string;
    replyTo: string;
  }): Promise<void> {
    await this.requestOk("/api/sendVideo", {
      method: "POST",
      body: JSON.stringify({
        session: this.config.session,
        chatId: params.chatId,
        reply_to: params.replyTo,
        caption: params.caption,
        asNote: false,
        convert: false,
        file: {
          mimetype: "video/mp4",
          filename: params.filename,
          url: params.videoUrl,
        },
      }),
    });
  }

  async sendText(params: {
    chatId: string;
    text: string;
    replyTo: string;
  }): Promise<void> {
    await this.requestOk("/api/sendText", {
      method: "POST",
      body: JSON.stringify({
        session: this.config.session,
        chatId: params.chatId,
        reply_to: params.replyTo,
        text: params.text,
      }),
    });
  }

  async downloadMedia(mediaUrl: string): Promise<string> {
    const resolvedUrl = new URL(mediaUrl, this.config.baseUrl).toString();
    const response = await this.fetchFn(resolvedUrl, {
      method: "GET",
      headers: this.authHeaders(),
    });
    await this.assertOk(response, "WAHA media download");
    return response.text();
  }
}

export interface WebSocketListenerOptions {
  config: WahaConnectionConfig;
  onEvent: (event: WahaMessageEvent) => Promise<void>;
  onError?: (error: unknown) => void;
  logger?: Logger;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Connects to WAHA's `/ws` event stream and reconnects with exponential backoff on disconnect.
 */
export function connectWahaWebSocket(options: WebSocketListenerOptions): {
  stop: () => void;
} {
  let stopped = false;
  let attempt = 0;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (stopped) return;
    const delayMs = computeBackoffMs(
      attempt,
      options.baseDelayMs,
      options.maxDelayMs,
    );
    attempt += 1;
    options.logger?.info(
      `[WAHA] WebSocket closed, reconnecting in ${delayMs}ms (attempt ${attempt})`,
    );
    reconnectTimer = setTimeout(connect, delayMs);
  };

  const connect = () => {
    if (stopped) return;
    const wsUrl = buildWahaWsUrl(options.config);
    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      attempt = 0;
      options.logger?.info(
        `[WAHA] WebSocket connected (session=${options.config.session})`,
      );
    });

    ws.addEventListener("message", (msg) => {
      try {
        const raw = typeof msg.data === "string" ? msg.data : String(msg.data);
        const parsed = JSON.parse(raw) as WahaMessageEvent;
        void options.onEvent(parsed).catch((err) => {
          options.onError?.(err);
        });
      } catch (err) {
        options.onError?.(err);
      }
    });

    ws.addEventListener("error", (err) => {
      options.onError?.(err);
    });

    ws.addEventListener("close", () => {
      ws = null;
      scheduleReconnect();
    });
  };

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
    },
  };
}
