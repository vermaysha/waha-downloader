# WAHA reference

Local reference for agents building a multi-tenant Laravel SaaS that resells WhatsApp sessions through WAHA (WhatsApp HTTP API).

- **WAHA version described:** 2026.10.1 (`info.version` in `openapi.json`; newest changelog entry).
- **Retrieved:** 2026-11-01.
- **Check before relying on this:** WAHA ships monthly. Compare `GET /api/server/version` on your server with the version above, then read the [changelog](https://waha.devlike.pro/docs/overview/changelog/).

## Files

| File | Covers |
| --- | --- |
| `api/` | Complete endpoint reference generated from `openapi.json`: 196 operations with parameters, request bodies, responses and examples, grouped by tag. `api/schemas.md` holds all 218 schemas. Start at `api/README.md`. |
| `docs/` | Verbatim copy of all 176 Markdown files under `content/docs` in `devlikeapro/waha-docs`. Blog posts are not included. |
| `openapi.json` | Full OpenAPI spec for 2026.10.1. Authority for paths, params and schemas. |
| `install.md` | Docker install, required env vars, storage, security, upgrades. |
| `sessions.md` | Lifecycle, statuses, session endpoints, QR and pairing code, what stop, logout and delete do to auth. |
| `api-keys.md` | Global, admin and session keys, scopes, key endpoints, tenant isolation gaps. |
| `webhooks-events.md` | Session and global webhooks, events, HMAC, retries, syncing status to an external app. |
| `inbox-data.md` | Chats, messages and contacts endpoints, engine support, NOWEB store, media, websockets. |
| `sending-limits.md` | Bulk sending, ban risk, restrictions, recommended practice. |
| `scaling.md` | Capacity numbers, sharding, workers, health, engine differences. |

## How to read these files

Each file labels its claims:

- **Fact:** stated in WAHA's docs or `openapi.json`.
- **Source:** read in WAHA's code on the `core` branch on 2026-11-01. This is stronger than docs for behaviour, but it is not pinned to the 2026.10.1 tag and was read, not run.
- **Inference:** our conclusion. Verify it against a running server before depending on it.

## Current-state notes

- **Fact:** since 2026.6.1 WAHA Plus is merged into Core. Unlimited sessions, media, all storages and security are free in `devlikeapro/waha`. There are no paid tiers. Older pages that gate features behind Plus are stale. ([source](https://waha.devlike.pro/docs/how-to/waha-plus/), [release post](https://waha.devlike.pro/blog/waha-2026-6/))
- **Fact:** `devlikeapro/waha-plus` is still published "for a while" so existing setups keep working. ([source](https://waha.devlike.pro/blog/waha-2026-6/))
- **Fact:** the waha repo's `LICENSE` is Apache 2.0. ([source](https://github.com/devlikeapro/waha))

## Sources

- Docs site: https://waha.devlike.pro/docs/
- Docs source, read in Markdown because includes render as feature tables: https://github.com/devlikeapro/waha-docs
- Context7 library: `/devlikeapro/waha-docs`
- Swagger UI: https://waha.devlike.pro/swagger/
- Code: https://github.com/devlikeapro/waha (`core` branch)
