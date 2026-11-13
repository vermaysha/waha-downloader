# API keys

Sources: [Security](https://waha.devlike.pro/docs/how-to/security/), [Dashboard](https://waha.devlike.pro/docs/how-to/dashboard/), [Changelog](https://waha.devlike.pro/docs/overview/changelog/), `openapi.json`, [WAHA code](https://github.com/devlikeapro/waha/tree/core/src/core/auth).

## Short answers

- **Is there a per-session API key, or is the key global?** Both. `WAHA_API_KEY` is global to the server. Per-session keys have existed since 2026.1.4.
- **Can a key be restricted to a single session?** Yes. Set `isAdmin: false` and `session: "{name}"`. Since 2026.4.3 you can also limit its actions.
- **What endpoints manage keys?** `/api/keys`, listed below. They are admin-only, apart from the two scoped routes.

## Key types (facts)

| Key | Created by | Reach |
| --- | --- | --- |
| Global | `WAHA_API_KEY` env var | All sessions, whole server |
| Admin | `POST /api/keys`, `isAdmin: true` | All sessions. `actions` cannot be set |
| Session | `POST /api/keys`, `isAdmin: false`, `session` set | One session, limited by `actions` |
| Media | `POST /api/keys/media` | One session, all actions off, for media download |
| Control | `POST /api/keys/control` | One session, `control` only, for QR and screenshot |

Send the key as an `X-Api-Key` header. A wrong or missing key returns `401`. The lowercase query parameter `?x-api-key=` also works, mainly for `<img>` tags and websockets. The docs say never to put an admin or full-session key in a URL.

## Session key scopes (facts)

| Scope | Default | Allows |
| --- | --- | --- |
| `read` | true | Messages, contacts, chats, groups |
| `send` | true | Sending, plus managing groups, labels, channels, contacts, profile |
| `control` | true | Start, stop, restart, logout, authenticate |
| `setting` | true | Update session settings |
| `app` | true | Manage apps |
| `delete` | **false** | Delete the session |

`actions: null` applies these defaults.

## Endpoints (facts)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/keys` | List keys |
| `POST` | `/api/keys` | Create. Body requires `isAdmin`, `session`, `isActive`; `actions` optional |
| `PUT` | `/api/keys/{id}` | Update `isAdmin`, `session`, `isActive`, `actions` |
| `DELETE` | `/api/keys/{id}` | Delete |
| `POST` | `/api/keys/media` | Create or get the media key. Body `{"session": "..."}` |
| `POST` | `/api/keys/control` | Create or get the control key |

The media and control routes are idempotent: repeat calls return the same key. The session must exist, or you get `422`. This ordering matters: create the session first, then its key.

```json
{"isAdmin": false, "session": "tenant-42", "isActive": true,
 "actions": {"read": true, "send": true, "control": false, "setting": false, "app": false, "delete": false}}
```

## Enforcement in the code (source)

Read in `src/core/auth/casl.rules.ts`, `src/core/services/ApiKeyService.ts`, `src/api/`:

- The session scope applies to routes that name the session in the path or body, such as `POST /api/sendText`.
- `GET /api/sessions` works for a session key, and results are filtered to its own session.
- Creating sessions needs an admin key.
- `/api/keys` list, create, update and delete need admin. `/api/keys/media` needs `read` on the session and `/api/keys/control` needs `control`, so a session key can mint these for itself.
- Session keys can read `GET /api/server/version` and `/status`. `GET /api/server/environment`, `POST /api/server/stop` and `GET /health` need admin.
- Websocket: `session=*` with a session key is narrowed to its own session. Any other session closes the socket, and a key without `read` is refused.
- `GET /api/keys` returns key values in plaintext. Keys are stored retrievably in WAHA's main storage. Only `WAHA_API_KEY` supports the `sha512:` form.
- `isActive: false` blocks a key without deleting it.
- Keys live in the main store, so they follow `WAHA_NAMESPACE`. Default namespace is the engine name, so switching engines without `WAHA_NAMESPACE=all` loses sight of them (fact, Engines page).

## Tenant isolation gaps

These matter if tenants ever hold a WAHA key directly.

1. **Keys appear to outlive their session (source).** `IApiKeyRepository.deleteBySession` exists, but no caller was found, and the session delete path does not touch keys. Scope is a name string, so recreating a session with the same name would make the old key valid again. Delete keys yourself before deleting a session, and never reuse session names.
2. **Media routes do not appear to be scoped (source; not run).** `/api/files` passes through API key auth, but no per-session check was found on the local or PostgreSQL file routes. The docs say a media key fetches "the session's media files". A valid key for session A may therefore reach session B's files if it has the URL. Filenames are hard to guess and there is no list API (fact). Test this before relying on it.
3. **Default scopes are broad (inference).** Default session keys have `setting: true`, so a holder could repoint webhooks or the proxy, and `control: true` lets them log out. Tenant keys should set `setting`, `control` and `app` to false unless needed.
4. **Excluded paths run as admin (source).** Routes excluded from key auth have no user, and the ability factory then grants admin rules (`src/core/auth/casl.ability.ts`). Do not add routes to the exclude list beyond `ping` or media.

## Recommendation (inference)

- Keep every WAHA key server-side in Laravel, encrypted, and proxy all tenant actions through your own authorization.
- Use one admin key per worker for provisioning. Use a session key for routine traffic to that session, which limits damage from a bug in tenant routing.
- For QR display in the browser, proxy the image through Laravel. If you must expose a URL, use a control key.
- Proxy media through Laravel rather than sharing `/api/files` URLs.

## Not settled

- Whether a media key is actually refused on another session's files. Test against a running server.
- Whether key caching delays revocation. No cache was seen in the auth path, but it was not tested.
- How keys behave across workers sharing one database and namespace. Keep per-worker records until tested.
