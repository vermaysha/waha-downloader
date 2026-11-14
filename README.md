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
| `UPLOAD_TARGET` | No | `s3` | Upload destination: `s3`, `temp`, `gdrive`, `both` (`s3,temp`), `all` (`s3,temp,gdrive`), or comma-separated (e.g. `temp,gdrive`) |
| `UPLOAD_S3` / `UPLOAD_TEMP` / `UPLOAD_GDRIVE` | No | — | Optional boolean toggles (`true`/`false`) when `UPLOAD_TARGET` is unset |
| `TEMP_UPLOAD_URL` | No | `https://temp.sh/upload` | Temporary file upload endpoint used when `UPLOAD_TARGET` includes `temp` |
| `GDRIVE_CLIENT_ID` | When `gdrive` (OAuth) | — | Google OAuth2 client ID |
| `GDRIVE_CLIENT_SECRET` | When `gdrive` (OAuth) | — | Google OAuth2 client secret |
| `GDRIVE_REFRESH_TOKEN` | When `gdrive` (OAuth) | — | Google OAuth2 refresh token |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | When `gdrive` (SA) | — | Service account JSON string or path to `.json` key file |
| `GDRIVE_CLIENT_EMAIL` | When `gdrive` (SA) | — | Service account `client_email` (alternative to JSON) |
| `GDRIVE_PRIVATE_KEY` | When `gdrive` (SA) | — | Service account `private_key` (alternative to JSON) |
| `GDRIVE_FOLDER_ID` | No | — | Optional Google Drive parent folder ID |
| `GDRIVE_PUBLIC` | No | `true` | Share uploaded Drive files as `anyone` reader (`true`/`false`) |
| `R2_ENDPOINT` | When `s3`/`both` | — | Cloudflare R2 S3-compatible endpoint |
| `R2_BUCKET` | When `s3`/`both` | — | Target R2 bucket name |
| `R2_ACCESS_KEY_ID` | When `s3`/`both` | — | R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | When `s3`/`both` | — | R2 secret access key |
| `R2_PUBLIC_BASE_URL` | No | — | Optional public/CDN base URL (skips presigned URLs when set) |
| `R2_PRESIGN_TTL_SECONDS` | No | `3600` | Presigned URL expiration in seconds |
| `DOWNLOAD_CONCURRENCY` | No | `2` | Max concurrent `yt-dlp` processes |
| `DOWNLOAD_TIMEOUT_SECONDS` | No | `300` | `yt-dlp` idle timeout in seconds (resets whenever output is received; default 5 minutes) |
| `MAX_WHATSAPP_MEDIA_BYTES` | No | `52428800` | Max video size (bytes) sent directly via WhatsApp (50 MiB) |
| `TMP_DIR` | No | `tmp` | Temporary working directory for downloads and per-job cookies |
| `COOKIES_DIR` | No | `./cookies` | Directory storing `<requester>/<domain>.txt` cookie profiles |

## WhatsApp Commands

- **`/dl <url1> [url2 ...]`** — Download one or more space- or newline-separated URLs. Reacts with `⏳` when accepted and replies with the video + R2 URL (or R2 URL text if over the size threshold).
- **`/cookies <domain>`** — Save Netscape-format cookies for `<domain>` under your phone number, either by attaching a `.txt` file with `/cookies <domain>` as the caption, or by pasting the cookie lines on subsequent lines.
- **`/cookies list`** — List all domains for which you have saved cookies.
- **`/cookies del <domain>`** — Delete your saved cookies for `<domain>`.
- **`/help`** or **`/h`** — Show the command usage guide.

## Running with systemd (User Service)

1. Create `~/.config/systemd/user/waha-downloader.service` (replace `/path/to/waha-downloader` and verify `bun` / `yt-dlp` / `ffmpeg` paths with `which bun yt-dlp ffmpeg`):

   ```ini
   [Unit]
   Description=WAHA Downloader
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=/path/to/waha-downloader
   EnvironmentFile=/path/to/waha-downloader/.env
   Environment=PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
   ExecStart=%h/.bun/bin/bun run src/index.ts
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```

2. Reload systemd, enable lingering (so the service keeps running after you log out), and start it:

   ```bash
   systemctl --user daemon-reload
   sudo loginctl enable-linger "$USER"
   systemctl --user enable --now waha-downloader.service
   ```

3. Check status and logs:

   ```bash
   systemctl --user status waha-downloader.service
   journalctl --user -u waha-downloader.service -f
   ```

## Development

```bash
bun test
bun run typecheck
```
