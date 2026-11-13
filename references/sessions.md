# Sessions

Sources: [Sessions](https://waha.devlike.pro/docs/how-to/sessions/), [GOWS engine](https://waha.devlike.pro/docs/engines/gows/), `openapi.json`.

A session is one WhatsApp account (phone number) connected to WAHA.

## Statuses (facts)

| Status | Meaning | What your app does |
| --- | --- | --- |
| `STOPPED` | Not running | Offer start |
| `STARTING` | Starting or reconnecting | Wait |
| `SCAN_QR_CODE` | Needs QR scan or phone login. Re-issued each time the QR changes | Fetch a fresh QR on every such event |
| `PASSKEY_REQUIRED` | WhatsApp wants a WebAuthn passkey. GOWS only. Challenge is in `data` | See Passkey below |
| `PASSKEY_CONFIRMATION_REQUIRED` | User must check a code. `data.code` holds it | Show the code |
| `WORKING` | Authenticated and ready. May carry `data.reachoutTimelock` or `data.messageCapping` | See `sending-limits.md` |
| `FAILED` | Error; usually re-auth needed or device unlinked | Try restart, then logout and start |

`GET /api/sessions` omits stopped sessions unless you pass `?all=true`.

## Endpoints (facts)

| Action | Endpoint | Behaviour |
| --- | --- | --- |
| Create | `POST /api/sessions` | Starts immediately unless `start: false`. `name` is generated if omitted. |
| Get or list | `GET /api/sessions/{session}`, `GET /api/sessions` | Includes `status`, `me`, `config`, `engine`. |
| Update | `PUT /api/sessions/{session}` | Replaces the **full** config. A running session is stopped and started. |
| Start | `POST /api/sessions/{session}/start` | Idempotent. |
| Stop | `POST /api/sessions/{session}/stop` | Idempotent. |
| Restart | `POST /api/sessions/{session}/restart` | Stops if running, then starts. |
| Logout | `POST /api/sessions/{session}/logout` | See below. Optional body `{"apps": {"purge": true}}`. |
| Delete | `DELETE /api/sessions/{session}` | Idempotent. See below. |
| Who am I | `GET /api/sessions/{session}/me` | Account info. |

Deprecated in the spec: `POST /api/sessions/start`, `/stop` and `/logout`. Use the `{session}` paths.

## What each action does to auth state (facts)

| Action | Auth and data | Config | Linked device on the phone |
| --- | --- | --- | --- |
| **Stop** | Kept: "Stop doesn't Log out or Delete anything" | Kept | Kept |
| **Restart** | Kept | Kept | Kept |
| **Logout** | **Removed** (auth info and data) | Kept | Removed if the session was `WORKING` |
| **Delete** | **Removed** | **Removed** | Logged out as part of delete |

A running session that is logged out starts again from scratch, so it needs a new QR scan.

**Source:** delete runs unassign, unpair, stop, logout, then removes apps, config, auth, `me` and the worker assignment (`src/core/services/SessionService.ts`, `src/core/manager.core.ts`). API keys are not in that list. See `api-keys.md`.

## Pairing

**QR code**, `GET /api/{session}/auth/qr` (facts):

- Formats: binary image (default), base64 (`Accept: application/json`), or raw (`?format=raw`) so you render the QR yourself.
- The first QR lasts 60 seconds, then 20 seconds each, up to 6 codes. After that the session goes `FAILED` and must be restarted.

**Pairing code**, `POST /api/{session}/auth/request-code` with `{"phoneNumber": "12132132130"}` (facts):

- Returns `{"code": "ABCD-ABCD"}`, which the user enters in WhatsApp.
- Always keep QR as a fallback; the docs say the code "is not always available".
- Custom device names apply to QR only. Pairing code auth "is likely to fail" if one is set.
- GOWS supports custom device names only through env vars (`WAHA_CLIENT_DEVICE_NAME`, `WAHA_CLIENT_BROWSER_NAME`).

**Passkey**, GOWS only (facts):

- WhatsApp asks some accounts for a passkey at linking. You cannot finish this from a backend: the assertion must be signed on the `https://web.whatsapp.com` origin.
- WAHA's dashboard does this with a browser extension and has a DevTools script fallback. Custom UI uses `/api/{session}/auth/passkey` endpoints. Guide: [How to Handle Passkey](https://waha.devlike.pro/blog/waha-passkey/).

## Session config (facts)

Fields in `SessionConfig`: `metadata`, `webhooks`, `proxy`, `ignore`, `client`, `debug`, `noweb`, `gows`, `webjs`.

- `metadata`: your own key-value pairs. Returned by session endpoints and included in events. WAHA does not use it. The docs suggest storing a user or tenant id here.
- `ignore`: `status`, `groups`, `channels`, `broadcast`. Drops events and, on GOWS and NOWEB, storage for those chat types. Sending is unaffected.
- `proxy`: `server`, `username`, `password`.

## `FAILED` reasons on GOWS (facts)

Since 2026.10.1 GOWS moves permanent connection failures to `FAILED` with `payload.data.reason.event`:

| `reason.event` | Do this |
| --- | --- |
| `LoggedOut` | Logout, start, re-pair |
| `TemporaryBan` | Wait for `Expire` (nanoseconds; `0` is unknown), then restart. Re-pairing does not help |
| `ClientOutdated` | Update WAHA |
| `StreamReplaced` | Two instances run the session. Keep one, then restart |
| `ConnectFailure`, `CATRefreshError` | Restart; for `ConnectFailure`, logout and start if it keeps failing |

Recoverable drops (`503`, `500`, keepalive timeouts) go `STARTING` then `WORKING`.

## Tested behaviour (2026.10.1, GOWS, tier CORE)

Run on 2026-11-02 against `devlikeapro/waha:gows-arm`.

- `GET /api/sessions/{session}` for a missing session answers `404`.
- `POST /api/sessions` answers `201`, and a name in use answers `422`.
- A UUID works as a session name, and CORE ran several sessions at once.
- `POST /api/sessions/{session}/start` answers `201`, and `DELETE` answers `200`, also for a missing session.
- A wrong key answers `401`.
- Sessions survive a container stop and start when the container is kept.
- `session.status` events arrive out of order: `SCAN_QR_CODE` reached the receiver before the older `STARTING`.
- `SCAN_QR_CODE` fired at 0, 60, 80, 100, 120, and 140 seconds, then `FAILED` at 160 seconds, with `data` null.
- `GET /api/{session}/auth/qr` with `Accept: application/json` answers `{"mimetype":"image/png","data":"<base64>"}`. For a session that does not exist it answers `422`.
- `POST /api/{session}/auth/request-code` answers `201` with `{"code":"A2G6-F8B7"}`.
- `POST /api/sessions/{session}/logout` on a running session returns it to `STARTING`, then `SCAN_QR_CODE`. On a stopped session it answers `201` and stays `STOPPED`.
- With `config.proxy` and no scheme, GOWS sends an HTTP `CONNECT web.whatsapp.com:443` with Basic auth. A proxy that refuses it leaves the session `FAILED`.
- `PUT /api/sessions/{session}` with `{"config": ...}` replaces the config. A running session restarts, a stopped one stays `STOPPED`, and a missing one answers `404`.
- `POST /api/sessions/{session}/logout` on a `FAILED` session answers `201` and it stays `FAILED`, until a restart.
- `/start` and `/stop` repeat safely. `/start` and `/logout` on a missing session answer `404`, and `/stop` answers `201`.

## Tested behaviour (2026.10.1, WEBJS, tier CORE)

- `GET /api/screenshot` answers 500 while `STARTING`, works from `SCAN_QR_CODE`, and answers 404 once `STOPPED`. As JSON, its `mimetype` said `image/jpeg` for PNG data.

## Inferences

- Session names must be unique per WAHA server, and on a shared database across workers. Derive them from an internal tenant id.
- Put your tenant id in `metadata` so webhook handlers can double-check ownership.
- Never map a user-facing "disconnect" to stop if they expect the phone unlinked. Stop keeps the device linked; logout removes it.
- Never restart or re-pair on `reachoutTimelock`, `messageCapping` or `TemporaryBan`. Automated "self-healing" must exclude these.
- Changing a webhook URL through `PUT` restarts the session, so avoid per-deploy config writes.
