# Research: `scriptc` vs `bun` for WAHA Listener + `yt-dlp` Downloader

**Date:** 2026-11-13  
**Scope:** Primary-source evaluation of `scriptc` vs `bun` for a TypeScript/JS service that starts a WAHA session, listens for incoming WhatsApp message events, and spawns `yt-dlp` with per-phone-number, per-URL/domain cookies for private video downloads.

---

## 1. Runtime Comparison: `scriptc` vs `bun`

### 1.1 What `scriptc` Is

`scriptc` (`vercel-labs/scriptc`) is an **experimental TypeScript-to-native compiler** developed by Vercel Labs ([github.com/vercel-labs/scriptc](https://github.com/vercel-labs/scriptc), [scriptc.dev](https://scriptc.dev)). Unlike traditional JavaScript/TypeScript runtimes (Node.js, Bun, Deno) that execute code via an interpreter/JIT engine (V8 or JavaScriptCore), `scriptc`:

- Uses the TypeScript compiler's type-checking to choose native representations and lower a **strict subset** of TypeScript, JavaScript, and Node.js APIs directly to machine code via LLVM/clang, or to WASI Preview 1 WebAssembly ([github.com/vercel-labs/scriptc](https://github.com/vercel-labs/scriptc)).
- Targets macOS, Linux (`gnu` and static `musl`), Windows, and WASI Preview 1 ([scriptc.dev](https://scriptc.dev)).
- Provides core CLI commands: `scriptc run <file>`, `scriptc build <file>`, and `scriptc coverage <file>` (which reports how much of a program can be statically compiled) ([github.com/vercel-labs/scriptc](https://github.com/vercel-labs/scriptc)).
- Reports unsupported APIs or dynamic patterns at build time using diagnostic codes (e.g., `SC2020`, `SC3002`) with rewrite hints ([scriptc.dev](https://scriptc.dev)).
- Offers an opt-in `--dynamic` mode that embeds **QuickJS-ng** (~620 KB) as a "dynamic island" to run untyped JavaScript or npm dependencies that cannot be statically lowered, validating values crossing the static/dynamic boundary at runtime ([scriptc.dev](https://scriptc.dev)).

### 1.2 What `bun` Is

`bun` is a full-featured JavaScript/TypeScript runtime built on JavaScriptCore ([bun.com/docs](https://bun.com/docs)). It executes TypeScript natively without a separate build step and ships integrated native APIs alongside Node.js compatibility (`node:fs`, `node:http`, `node:child_process`, etc.):

- **Subprocesses:** `Bun.spawn` / `Bun.spawnSync` and **Bun Shell (`$`)** ([bun.com/docs](https://bun.com/docs)).
- **Networking / Servers:** `Bun.serve` (native HTTP + WebSocket server) and a built-in standards-compliant `new WebSocket(url)` client ([bun.com/docs](https://bun.com/docs)).
- **File I/O:** `Bun.file()` (lazy `Blob`-backed file handle) and `Bun.write()` ([bun.com/docs](https://bun.com/docs)).

### 1.3 Side-by-Side Evaluation for This Use Case

| Capability | `scriptc` (`vercel-labs/scriptc`) | `bun` |
| --- | --- | --- |
| **Maturity & Scope** | Explicitly **experimental**; compiles a strict subset of TS/JS/Node APIs. Un-lowered patterns fail at build time or require `--dynamic` QuickJS fallback ([github.com/vercel-labs/scriptc](https://github.com/vercel-labs/scriptc), [scriptc.dev](https://scriptc.dev)). | Production-ready general-purpose JS/TS runtime with full dynamic JS semantics and npm ecosystem support ([bun.com/docs](https://bun.com/docs)). |
| **Spawning `yt-dlp` (`stdout`/`stderr`, exit codes, progress, timeouts)** | Lowers parts of `node:child_process` (`spawn`, `spawnSync`, `exec`, `execFile`, `fork` with static build-time paths) on native OS targets (absent on WASI Preview 1, `SC3002`) ([github.com/vercel-labs/scriptc](https://github.com/vercel-labs/scriptc), [scriptc.dev](https://scriptc.dev)). No built-in shell DSL; streaming/timeout edge cases must stay within the supported `node:child_process` subset. | `Bun.spawn` natively supports `stdout: "pipe"` / `stderr: "pipe"` as Web `ReadableStream`s (easy line-by-line progress parsing with `yt-dlp --newline`), `exited: Promise<number>`, `timeout` (ms) + `killSignal` (defaults to `"SIGTERM"`), `AbortSignal`, `cwd`, and `env` ([bun.com/docs](https://bun.com/docs)). `Bun.$` provides a cross-platform shell with automatic argument escaping ([bun.com/docs](https://bun.com/docs)). |
| **WAHA Listener: Webhooks (HTTP Server)** | `node:http` (`http.createServer`) and global `fetch` are supported ([github.com/vercel-labs/scriptc](https://github.com/vercel-labs/scriptc), [scriptc.dev](https://scriptc.dev)). | `Bun.serve({ fetch(req) { ... } })` and global `fetch` are built-in ([bun.com/docs](https://bun.com/docs)). |
| **WAHA Listener: WebSockets (Client)** | **Not supported natively.** Global `WebSocket` client usage triggers build-time diagnostic `SC2020`, and `node:http2` `upgradeWebSocket` is not declared ([scriptc.dev](https://scriptc.dev)). | Built-in `new WebSocket("ws://...")` client (matching WAHA's own JS WebSocket example), with optional TLS/proxy config ([bun.com/docs](https://bun.com/docs)). |
| **File System / Config / Cookie Management** | `node:fs` and `node:path` are lowered to native OS calls ([github.com/vercel-labs/scriptc](https://github.com/vercel-labs/scriptc), [scriptc.dev](https://scriptc.dev)), but third-party config/cookie packages may hit subset limits or require `--dynamic`. | `Bun.file()`, `Bun.write()`, `node:fs/promises`, `node:path`, and `os.tmpdir()` all work out of the box ([bun.com/docs](https://bun.com/docs)). |

### 1.4 Runtime Recommendation

**Use `bun`.**
- WAHA's simplest local integration path is its WebSocket event stream (`/ws`), which `bun` supports natively via `new WebSocket(...)`, whereas `scriptc` rejects global `WebSocket` at compile time (`SC2020`).
- Managing `yt-dlp` downloads benefits directly from `Bun.spawn`'s first-class `timeout`, `killSignal`, `ReadableStream` `stdout`/`stderr`, and `exited` promise, plus `Bun.file`/`Bun.write` for copying temporary cookie files per invocation.
- `scriptc` is designed for compiling constrained scripts into tiny standalone binaries and carries experimental compiler-subset friction that adds no value for a local/server-side `yt-dlp` orchestrator (which already shells out to `yt-dlp` and `ffmpeg`).

---

## 2. WAHA Session Startup & Incoming Message Events

All findings below are from the local WAHA primary documentation in `references/`.

### 2.1 Starting and Managing a Session

Source: [`references/sessions.md`](file:///Users/vermaysha/lainnya/waha-downloader/references/sessions.md)

- **Create & auto-start:** `POST /api/sessions` creates a session and starts it immediately unless `"start": false` is passed. Returns `201` (or `422` if the session name is already in use).
- **Start / Stop / Restart:**
  - `POST /api/sessions/{session}/start` (idempotent; starts a `STOPPED` session).
  - `POST /api/sessions/{session}/stop` (idempotent; keeps auth and config).
  - `POST /api/sessions/{session}/restart` (stops if running, then starts; keeps auth).
  - `GET /api/sessions/{session}` returns `status`, `me`, `config`, `engine`. Note that `GET /api/sessions` omits `STOPPED` sessions unless `?all=true` is passed.
- **Session Statuses:** `STOPPED`, `STARTING`, `SCAN_QR_CODE`, `PASSKEY_REQUIRED` (GOWS only), `PASSKEY_CONFIRMATION_REQUIRED`, `WORKING` (authenticated and ready), `FAILED`.
- **Pairing:**
  - QR code: `GET /api/{session}/auth/qr` (binary PNG, base64 JSON with `Accept: application/json`, or `?format=raw`). First QR lasts 60s, then 20s each up to 6 codes before transitioning to `FAILED`.
  - Pairing code: `POST /api/{session}/auth/request-code` with `{"phoneNumber": "..."}` returns `{"code": "ABCD-ABCD"}`.
- **Config updates caveat:** `PUT /api/sessions/{session}` replaces the **full** `SessionConfig` (`metadata`, `webhooks`, `proxy`, `ignore`, `client`, etc.) and **restarts** a running session.

### 2.2 Listening to Incoming Message Events: Webhooks vs WebSockets

Sources: [`references/webhooks-events.md`](file:///Users/vermaysha/lainnya/waha-downloader/references/webhooks-events.md), [`references/docs/how-to/events/index.md`](file:///Users/vermaysha/lainnya/waha-downloader/references/docs/how-to/events/index.md), [`references/inbox-data.md`](file:///Users/vermaysha/lainnya/waha-downloader/references/inbox-data.md), [`references/api-keys.md`](file:///Users/vermaysha/lainnya/waha-downloader/references/api-keys.md)

Both transports deliver the **same JSON event envelope**:
- `id`: lowercase ULID (`evt_...`)
- `timestamp`: milliseconds
- `event`: e.g. `"message"` (incoming messages), `"message.any"` (all message creations including your own), `"session.status"`
- `session`: session name
- `metadata`: custom key-value pairs from `SessionConfig`
- `payload`: event-specific object

#### Option A: WebSockets (Recommended for a single listener script)
- **Endpoint:** `ws://<host>/ws` or `wss://<host>/ws` (note: `/ws` is not in `openapi.json`).
- **Query parameters:**
  - `x-api-key`: API key (session-scoped keys are restricted to their own session).
  - `session`: session name or `*` for all sessions.
  - `events`: repeatable param, e.g. `events=session.status&events=message`, or `events=*` (excludes `engine.event`).
- **Behaviour:** The server sends heartbeats every 60 seconds. No inbound HTTP port, public URL, or reverse-proxy tunnel is needed—the Bun script opens an outbound `new WebSocket(wsUrl)` connection directly to WAHA.

#### Option B: Webhooks
- **Configuration:** Per-session in `config.webhooks` (array of `{ url, events, hmac, retries, customHeaders }`) on `POST /api/sessions` or `PUT /api/sessions/{session}`, or globally via `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS`, `WHATSAPP_HOOK_HMAC_KEY`, etc.
- **Security & Reliability:**
  - If `hmac.key` is set, WAHA sends `X-Webhook-Hmac` and `X-Webhook-Hmac-Algorithm: sha512` computed over the **raw request body**.
  - Return `2xx` quickly and process downloads asynchronously; slow or failing responses trigger in-memory retries (default: 15 attempts, 2s constant delay; retries are not durable across WAHA restarts).
  - Deduplicate on `id` (`evt_...`) because retries can redeliver events, and tolerate out-of-order delivery.

---

## 3. `yt-dlp` Private Video Downloads & Per-Number, Per-URL Cookies

### 3.1 Primary Documentation Findings (`yt-dlp/yt-dlp`)

Sources: [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) (README & Wiki)

1. **Netscape Cookie File Format (`--cookies FILE`)**
   - `yt-dlp` strictly requires `--cookies FILE` to be in **Netscape/Mozilla HTTP Cookie File** format (beginning with `# Netscape HTTP Cookie File` and containing 7 tab-separated columns: `domain`, `include_subdomains` (`TRUE`/`FALSE`), `path`, `secure` (`TRUE`/`FALSE`), `expiration` (Unix timestamp or `0`), `name`, `value`).
   - Passing JSON-formatted cookie exports fails with:  
     `ERROR: 'cookies.txt' does not look like a Netscape format cookies file`.

2. **Critical Caveat: `--cookies FILE` Is Read-Write (Mutated by `yt-dlp`)**
   - `yt-dlp` does not treat `--cookies FILE` as read-only: it loads the file into its internal cookie jar and **writes/dumps updated cookies back into that exact same file** during/after execution (e.g., refreshed session or consent cookies) ([yt-dlp issues #5977 / #33006](https://github.com/yt-dlp/yt-dlp)).
   - Making the file read-only (`chmod -w`) does **not** safely disable writing; it can cause `yt-dlp` to throw an exception/error out.

3. **`--cookies-from-browser` Caveats**
   - Reading live cookies directly from a browser (`--cookies-from-browser chrome|firefox|...`) is convenient for single-user desktop runs, but in automated/headless/server/Docker environments it can fail due to browser database file locks or OS keychain decryption prompts (macOS Keychain, Windows DPAPI, Linux Secret Service). It also does not map cleanly to **multiple WhatsApp phone numbers**.

4. **YouTube Cookie Rotation Caveat**
   - Per the official `yt-dlp` GitHub Wiki ("Exporting YouTube cookies"), YouTube actively rotates cookies in open browser tabs, causing exported cookies to expire rapidly. The wiki recommends logging in inside a fresh Private/Incognito window, navigating to `https://www.youtube.com/robots.txt`, exporting via an extension like *Get cookies.txt LOCALLY*, and **immediately closing** the private window.

### 3.2 Practical Implications for Per-Number, Per-URL/Domain Cookies

1. **Directory & Lookup Layout:**
   - Normalize the WhatsApp sender/phone identifier (e.g., `6281234567890` from `payload.from` / `participant`) and the target URL's domain/hostname (e.g., `youtube.com`, `instagram.com`, `tiktok.com`).
   - Store master Netscape cookie files per `(number, domain)`, for example:
     `cookies/<phone_number>/<domain>.txt` (with a domain alias map such as `youtu.be` → `youtube.com`).

2. **Copy-Before-Invoke Pattern (Essential):**
   - Never pass the master `cookies/<phone_number>/<domain>.txt` path directly to `yt-dlp --cookies`.
   - Before each `Bun.spawn(["yt-dlp", ...])`, copy the matched master cookie file to an isolated per-job temp path (e.g., via `Bun.write(tmpCookiePath, Bun.file(masterCookiePath))`), pass `--cookies ${tmpCookiePath}`, and delete `tmpCookiePath` in a `finally` block.
   - This prevents `yt-dlp` from overwriting/truncating the master file and eliminates race conditions when two downloads for the same phone number + domain run concurrently.

3. **Security & Validation:**
   - Validate uploaded/stored cookie files on ingestion (check for Netscape header / 7 tab-separated fields) so malformed files fail fast with a clear message before invoking `yt-dlp`.
   - Store cookie files with restrictive permissions (`0600`) and keep `cookies/` out of version control (`.gitignore`), as Netscape cookie files contain active session credentials.
