# Scaling

Sources: [FAQ](https://waha.devlike.pro/docs/overview/faq/), [WAHA Scaling](https://waha.devlike.pro/blog/waha-scaling/), [Storages](https://waha.devlike.pro/docs/how-to/storages/), [Observability](https://waha.devlike.pro/docs/how-to/observability/), [Engines](https://waha.devlike.pro/docs/how-to/engines/), `openapi.json`.

## Capacity per container (facts)

From the FAQ. WAHA "strongly" recommends at least 2 CPU and 4 GB RAM even for one session.

| Sessions | WEBJS | NOWEB | GOWS |
| --- | --- | --- | --- |
| 1 | 0.3 CPU, 400 MB | 0.1 CPU, 200 MB | 0.1 CPU, 200 MB |
| 10 | 3 CPU, 2.5 GB | 1 CPU, 2 GB | 0.5 CPU, 1 GB |
| 50 | 15 CPU, 20 GB | 2 CPU, 4 GB | 1.5 CPU, 3 GB |
| 100 | Not listed | 4 CPU, 8 GB | 3-5 CPU, 5 GB |
| 500 | Not listed | Not listed | 5-8 CPU, 25 GB |

Upper limits for one server, from the Scaling post (dated 2024-08-14, no GOWS numbers): 50 sessions on WEBJS and 500 on NOWEB. "It's not safe to run more than the above numbers on a single server!"

| Engine | Sessions | CPU | Memory |
| --- | --- | --- | --- |
| WEBJS | 10 | 270% | 2.5 GB |
| WEBJS | 50 | 1500% | 20 GB |
| NOWEB | 50 | 150% | 4 GB |
| NOWEB | 500 | 300% | 30 GB |

These figures vary with message volume, and the docs say so. The two sources disagree: the FAQ has no NOWEB row at 500, and the post has no GOWS row.

## Engine differences (facts)

| | WEBJS, WPP | NOWEB | GOWS |
| --- | --- | --- | --- |
| Connection | Browser (Chromium or Chrome) | Websocket, Node | Websocket, Go |
| Resources | Highest | Low | Lowest in the table |
| Boot delay advice | `WAHA_AUTO_START_DELAY_SECONDS=5` | `0` or `1` | Not stated |

GOWS is described as "a future replacement for NOWEB". There are no WPP capacity numbers.

## Horizontal scaling: sharding (facts)

Scale past one server by running independent WAHA instances, with your app choosing the server. It is the only approach available.

- WAHA is stateful: each live WhatsApp connection sits on one worker, so requests must be sticky. A plain Kubernetes Deployment or ECS service won't work. StatefulSets can.
- Webhooks go straight from each instance to your app.
- Auto-scaling and "WAHA Hub" are **not available** yet.
- One dashboard can connect to all servers.

Suggested schema from WAHA:

- `Worker`: `id`, `url`, `api_key`, `capacity`
- `User` (or tenant, organization): `id`
- `WAHASession`: `id`, `name`, `user_id`, `worker_id`

Placement: pick a worker with `capacity > 0`, highest first, or by country, proxy or customer level. Routing: look up `worker_id`, use that `url` and `api_key`.

## Multiple workers (facts)

- Each worker needs its own database, or a unique `WAHA_WORKER_ID` when sharing one. It is a "MUST" for shared databases.
- `WAHA_WORKER_ID` also decides restore: each worker restores its own sessions after restart.
- `WAHA_WORKER_RESTART_SESSIONS=True` is the default.
- PostgreSQL uses one database per session plus a main one. Over 100 sessions, raise `max_connections` (docs use 3000).
- Two instances running one session cause `StreamReplaced` on GOWS.

## Health and monitoring (facts)

| Endpoint | Auth | Returns |
| --- | --- | --- |
| `GET /ping` | None | `{"message": "pong"}` |
| `GET /health` | API key (admin, per source) | `200` or `503`. `status` is `ok`, `error` or `shutting_down` |
| `GET /api/server/status` | API key | `startTimestamp`, `uptime` |
| `GET /api/server/version` | API key | `version`, `engine`, `tier`, `browser` |
| `GET /metrics` | None by default | Prometheus; off until `WAHA_PROMETHEUS_ENABLED=True` |

- `/health` checks disk space for media and session files (`WHATSAPP_HEALTH_MEDIA_FILES_THRESHOLD_MB`, `WHATSAPP_HEALTH_SESSIONS_FILES_THRESHOLD_MB`, default 100) and MongoDB. It does **not** report session health.
- Useful metrics: `waha_sessions{status,engine}`, `waha_session_status{session,status,engine}`, `waha_session_status_change_timestamp_seconds{session}`, `waha_session_activity_timestamp_seconds{session}`, `waha_events_total{session,event}`, `waha_http_request_duration_seconds`, plus Node process metrics. A `worker` label carries `WAHA_WORKER_ID`.
- `/metrics` is unprotected like `/ping`. Set `WAHA_PROMETHEUS_USERNAME` and `WAHA_PROMETHEUS_PASSWORD` if it is public.
- `WAHA_PROMETHEUS_TRACK_EVENTS` makes the server process those events, including media downloads, even with no consumer.
- `WAHA_LOG_LEVEL=debug` or `trace` is not for production.

## Recommendation for this SaaS (inference)

- Default to GOWS. Start around 100 sessions per worker at 5 CPU and 8 GB, then raise `capacity` from real metrics. Treat the FAQ's 500 as a ceiling, because the docs do not state the message volume behind it.
- Use one `devlikeapro/waha:gows` container per server, with PostgreSQL for sessions and S3 for media so disks stay small. Give each worker a unique `WAHA_WORKER_ID` and set `WAHA_NAMESPACE=all`.
- Copy WAHA's `Worker` and `WAHASession` tables. Enforce `capacity` with a transaction or lock so simultaneous signups cannot overfill a worker.
- Moving a session between workers is not documented, so plan placement carefully. Expect re-pairing as the safe default.
- Poll `/ping` for liveness, plus `GET /api/sessions?all=true` or Prometheus for session state. `/health` alone cannot tell you sessions are working.
- Keep spare capacity so a lost worker's sessions can be rehomed.

## Not settled

- GOWS has no single-server limit stated as such. The FAQ table stops at 500.
- Per-session storage growth is not documented, including for GOWS with full history sync.
- Moving a session between workers, or failover when a worker dies, is not documented. With shared PostgreSQL it may be possible; this is untested.
- Memory numbers do not state message volume or whether store or history sync were on.
