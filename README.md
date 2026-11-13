# WAHA Downloader

A lightweight Bun + TypeScript service that listens to WAHA WhatsApp `message.any` events over WebSocket, downloads videos with `yt-dlp`, uploads them to Cloudflare R2 (S3-compatible), and replies to the requester in WhatsApp—supporting per-requester, per-domain Netscape cookies for private videos.

## Features

- **WAHA Session & WebSocket Listener**: Automatically creates/starts the configured WAHA session on boot and subscribes to `message.any` over WebSocket (no HTTP webhook port required), with exponential backoff reconnection.
- **DM, Group, and Note-to-Self Support**: Handles both incoming messages and `fromMe: true` commands while ignoring non-command messages and bot replies.
- **Multi-URL & Concurrency Queue**: Extracts multiple space- or newline-separated URLs from a single `/dl` message and processes them through a bounded concurrency queue (`DOWNLOAD_CONCURRENCY`, default `2`).
- **Cloudflare R2 Archiving & Smart Reply**: Uploads every downloaded video to Cloudflare R2. Replies with the video + R2 URL caption when within `MAX_WHATSAPP_MEDIA_BYTES`, or with the R2 URL text alone when larger.
- **Per-Requester, Per-Domain Cookies**: Stores Netscape cookie files scoped to each sender's normalized phone number and normalized domain, copying them to a per-job temporary file for `yt-dlp` and cleaning up afterward (see [ADR-0001](docs/adr/0001-per-job-cookie-copy.md)).

## Prerequisites

- [Bun](https://bun.sh/) (`>= 1.4`)
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)
- [`ffmpeg`](https://ffmpeg.org/)
- A running [WAHA](https://waha.devlike.pro/) instance
- A Cloudflare R2 bucket (or S3-compatible object storage)

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Copy `.env.example` to `.env` and fill in your WAHA and Cloudflare R2 credentials:

   ```bash
   cp .env.example .env
   ```

3. Run the service:

   ```bash
   bun run src/index.ts
   ```

   If the WAHA session is new, scan the QR code or pair via the WAHA dashboard/API so WhatsApp is logged in.

## Environment Variables

See [.env.example](.env.example) for the full list:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WAHA_BASE_URL` | Yes | — | Base URL of your WAHA server (e.g. `http://localhost:3000`) |
| `WAHA_API_KEY` | No | — | WAHA API key (`X-Api-Key`) |
| `WAHA_SESSION` | No | `default` | WAHA session name |
| `R2_ENDPOINT` | Yes | — | Cloudflare R2 S3-compatible endpoint |
| `R2_BUCKET` | Yes | — | Target R2 bucket name |
| `R2_ACCESS_KEY_ID` | Yes | — | R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | Yes | — | R2 secret access key |
| `R2_PUBLIC_BASE_URL` | No | — | Optional public/CDN base URL (skips presigned URLs when set) |
| `R2_PRESIGN_TTL_SECONDS` | No | `3600` | Presigned URL expiration in seconds |
| `DOWNLOAD_CONCURRENCY` | No | `2` | Max concurrent `yt-dlp` processes |
| `MAX_WHATSAPP_MEDIA_BYTES` | No | `52428800` | Max video size (bytes) sent directly via WhatsApp (50 MiB) |
| `TMP_DIR` | No | `tmp` | Temporary working directory for downloads and per-job cookies |
| `COOKIES_DIR` | No | `./cookies` | Directory storing `<requester>/<domain>.txt` cookie profiles |

## WhatsApp Commands

- **`/dl <url1> [url2 ...]`** — Download one or more space- or newline-separated URLs. Reacts with `⏳` when accepted and replies with the video + R2 URL (or R2 URL text if over the size threshold).
- **`/cookies <domain>`** — Save Netscape-format cookies for `<domain>` under your phone number, either by attaching a `.txt` file with `/cookies <domain>` as the caption, or by pasting the cookie lines on subsequent lines.
- **`/cookies list`** — List all domains for which you have saved cookies.
- **`/cookies del <domain>`** — Delete your saved cookies for `<domain>`.
- **`/help`** or **`/h`** — Show the command usage guide.

## Development

```bash
bun test
bun run typecheck
```
