# Install, configuration and upgrades

Sources: [Install](https://waha.devlike.pro/docs/how-to/install/), [Docker guide](https://waha.devlike.pro/blog/waha-on-docker/), [Update guide](https://waha.devlike.pro/blog/waha-update/), [Storages](https://waha.devlike.pro/docs/how-to/storages/), [Security](https://waha.devlike.pro/docs/how-to/security/), [Configuration](https://waha.devlike.pro/docs/how-to/config/), [Engines](https://waha.devlike.pro/docs/how-to/engines/), [Swagger](https://waha.devlike.pro/docs/how-to/swagger/).

## Docker install (facts)

```bash
wget -O docker-compose.yaml https://raw.githubusercontent.com/devlikeapro/waha/refs/heads/core/docker-compose.yaml
touch .env
# Pick the image in docker-compose.yaml first (see trap below)
docker compose run --no-deps -v "$(pwd)":/app/env waha init-waha /app/env   # generates .env credentials
docker compose up -d
```

- A bare `docker run` is for development only, not production.
- The compose template binds to `127.0.0.1:3000`. Put Nginx or another proxy in front. The guide's Nginx config forwards websocket upgrade headers and sets `client_max_body_size 0`.
- HTTPS is "a must-have" in production. Built-in HTTPS (`WAHA_HTTPS_*`) is deprecated; Nginx is recommended.
- **Trap:** the upstream `docker-compose.yaml` still defaults to `image: devlikeapro/waha-plus`. Change it to `devlikeapro/waha`.

## Images (facts)

| Tag | CPU | Browser |
| --- | --- | --- |
| `devlikeapro/waha:latest` | x86 | Chromium |
| `devlikeapro/waha:chrome` | x86 | Chrome (needed to receive video) |
| `devlikeapro/waha:noweb` | x86 | None |
| `devlikeapro/waha:gows` | x86 | None |
| `devlikeapro/waha:arm` | ARM | Chromium |
| `devlikeapro/waha:noweb-arm` | ARM | None |

Tag pattern is `devlikeapro/{image}:{browser}[-cpu][-version]`. All engines are available in WAHA; `WHATSAPP_DEFAULT_ENGINE` picks one, and the default is `WEBJS`.

The table lists no ARM GOWS image.

## Env vars that matter

WAHA generates random secrets on startup if you set none (visible in logs). Set your own. The docs warn that even a "private" server gets found and abused.

| Variable | Purpose |
| --- | --- |
| `WAHA_API_KEY` | Admin API key. Prefer `sha512:{HEX}` so only the hash is stored. See `api-keys.md`. |
| `WAHA_DASHBOARD_USERNAME`, `WAHA_DASHBOARD_PASSWORD` | Dashboard login. `WAHA_DASHBOARD_ENABLED` toggles it. |
| `WHATSAPP_SWAGGER_USERNAME`, `WHATSAPP_SWAGGER_PASSWORD` | Swagger login. Does not protect the API. `WHATSAPP_SWAGGER_ENABLED` toggles it. |
| `WHATSAPP_DEFAULT_ENGINE` | `WEBJS` (default), `NOWEB`, `GOWS`, `WPP`. |
| `WAHA_BASE_URL` | Builds `media.url`. Must be correct or media links point to localhost. |
| `WAHA_PUBLIC_URL` | Public dashboard link, for when `WAHA_BASE_URL` is internal. |
| `WAHA_WORKER_ID` | Unique per worker. Required when workers share a database. |
| `WAHA_NAMESPACE` | Main storage namespace (apps, API keys, shared config). Defaults to the engine name. `all` is recommended for new setups. |
| `WAHA_SESSION_NAMESPACE` | Keep unset. Changing it is not backward compatible. |
| `WAHA_AUTO_START_DELAY_SECONDS` | Delay between session restarts on boot. Docs suggest `5` for WEBJS with many sessions, `0` or `1` for NOWEB. |
| `TZ` | Container timezone, default `UTC`. |

Security trap (fact): `WHATSAPP_API_KEY_EXCLUDE_PATH=api/files/(.*)` turns off auth for media. Note that `WAHA_API_KEY_EXCLUDE_PATH` is the name in the Security page and `WHATSAPP_API_KEY_EXCLUDE_PATH` in Configuration.

## Storage (facts)

| Storage | WEBJS | NOWEB | GOWS | WPP |
| --- | --- | --- | --- | --- |
| Local session and media | Yes | Yes | Yes | Not marked |
| PostgreSQL session and media | Yes | Yes | Yes | Not marked |
| S3 media | Yes | Yes | Yes | Not marked |
| MongoDB session (deprecated) | Yes | Yes | No | Not marked |

- **Sessions, local:** mount `/app/.sessions`. Without session storage, you rescan QR on every launch. Docs call local files "well-tested" for production.
- **Sessions, PostgreSQL:** set `WHATSAPP_SESSIONS_POSTGRESQL_URL`. WAHA creates `waha_{namespace}` plus one database per session (`waha_{session_namespace}_{session}`), so the DB user needs create and drop rights. For over 100 sessions raise `max_connections`; the docs use `3000`.
- **MongoDB:** deprecated. Use PostgreSQL for new installs.
- **Media, local:** files last **180 seconds** by default. To keep them, mount a folder and set `WHATSAPP_FILES_FOLDER=/app/.media` and `WHATSAPP_FILES_LIFETIME=0`.
- **Media, PostgreSQL:** `WAHA_MEDIA_STORAGE=POSTGRESQL` and `WAHA_MEDIA_POSTGRESQL_URL`. Adds a `media` table to each session database.
- **Media, S3:** `WAHA_MEDIA_STORAGE=S3` with `WAHA_S3_REGION`, `WAHA_S3_BUCKET`, `WAHA_S3_ACCESS_KEY_ID`, `WAHA_S3_SECRET_ACCESS_KEY`, `WAHA_S3_ENDPOINT`, `WAHA_S3_FORCE_PATH_STYLE`, `WAHA_S3_PROXY_FILES`. Any S3-compatible service works.

## Upgrade path (facts)

```bash
docker compose pull
docker compose up -d
```

- Sessions survive if data is persisted through a supported storage.
- If you pin a tag, change it to the new `latest-{YEAR}.{MONTH}.{BUILD}` before pulling.
- Moving from Plus: change the image to `devlikeapro/waha` and run `docker compose up -d`.
- Verify with `docker compose ps` and `docker compose logs --since 1h`.
- `ClientOutdated` on GOWS means WhatsApp rejected the client version, so update WAHA.
- NOWEB can follow WhatsApp Web versions without a release: `WAHA_NOWEB_WA_VERSION=auto-web` (since 2026.8.1), resolved once per container start.

## Inferences

- Each deploy restarts sessions on that server, and WhatsApp connections drop briefly. Roll one worker at a time.
- Pin exact tags per worker so a rollback is possible. The docs describe pinning but do not prescribe it, and they do not document downgrade or rollback.
- The docs disagree on minimum hardware. The FAQ says 2 CPU and 4 GB; the Docker guide says 2 CPU and 2 GB. Use 4 GB.
