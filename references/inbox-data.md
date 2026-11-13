# Building a chat inbox

Sources: [Chats](https://waha.devlike.pro/docs/how-to/chats/), [Contacts](https://waha.devlike.pro/docs/how-to/contacts/), [Receive messages](https://waha.devlike.pro/docs/how-to/receive-messages/), [Engines](https://waha.devlike.pro/docs/how-to/engines/#features), [NOWEB](https://waha.devlike.pro/docs/engines/noweb/), [GOWS](https://waha.devlike.pro/docs/engines/gows/), [Events](https://waha.devlike.pro/docs/how-to/events/), `openapi.json`.

## Engine support (facts)

| Endpoint | WEBJS | NOWEB | GOWS | WPP |
| --- | --- | --- | --- | --- |
| `GET /api/{session}/chats` | Yes | Store | Yes | Yes |
| `GET /api/{session}/chats/overview` | Yes | Store | Yes | Yes |
| `GET /api/{session}/chats/{chatId}/picture` | Yes | Store | Yes | Yes |
| `GET /api/{session}/chats/{chatId}/messages` | Yes | Store | Yes | Yes |
| `GET .../messages/{messageId}` | Yes | Store | Yes | Yes |
| `POST .../messages/read` | Yes | Store | Yes | Yes |
| `POST .../unread` | Yes | Store | Yes | Yes |
| `POST .../archive`, `/unarchive` | Yes | Store | **No** | Yes |
| `DELETE /api/{session}/chats/{chatId}` | Yes | **No** | **No** | Yes |
| `PUT` edit, `DELETE` a message | Yes | Yes | Yes | Yes |
| Pin or unpin message | Yes | Yes | **No** | **No** |
| `DELETE .../messages` (all) | Yes | **No** | **No** | **No** |
| `GET /api/contacts/all`, `GET /api/contacts` | Yes | Store | Yes | Yes |
| `GET /api/contacts/check-exists` | Yes | Yes | Yes | Yes |
| `GET /api/contacts/profile-picture` | Yes | Yes | Yes | Yes |
| `PUT /api/{session}/contacts/{chatId}` | Yes | Yes | Yes | **No** |
| `GET /api/contacts/about` | Yes | **No** | **No** | Yes |
| Block, unblock contact | Yes | **No** | **No** | Yes |
| `GET /api/{session}/lids*` | Yes | Store | Yes | Yes |

"Store" means the NOWEB store must be enabled.

## NOWEB store (facts)

**Yes, it must be enabled.** By default NOWEB stores no contacts, chats or messages, and the chat and contact endpoints do not work.

```json
{"name": "default", "config": {"noweb": {"store": {"enabled": true, "fullSync": false}}}}
```

- `fullSync: false` gives about 3 months of history. `fullSync: true` gives about 1 year, up to 100K messages per chat.
- Set this at creation. "Do not change the values after you scanned QR"; it can lose history.
- The NOWEB page says the store uses files or MongoDB. The Storages table also lists PostgreSQL for NOWEB. Local files use `store.sqlite3`; don't open it while the session runs.

## GOWS storage (facts)

Storage is on by default. `config.gows.storage` has `messages`, `groups`, `chats`, `labels`, `contacts`, `messageSecrets`. Omit a field or set `null` to keep it on.

- `contacts: false` means no contact API data or names in chats. `messageSecrets: false` breaks poll votes and event responses.
- GOWS syncs the full available history by default, which can bloat the database and use a lot of proxy bandwidth.
- Experimental limits, applied at linking, so they need a container restart and re-pair:

```bash
WAHA_GOWS_DEVICE_REQUIRE_FULL_SYNC=false
WAHA_GOWS_DEVICE_HISTORY_SYNC_FULL_SYNC_DAYS_LIMIT=365
WAHA_GOWS_DEVICE_HISTORY_SYNC_RECENT_SYNC_DAYS_LIMIT=30
WAHA_GOWS_DEVICE_HISTORY_SYNC_INITIAL_SYNC_MAX_MESSAGES_PER_CHAT=100
```

## Core calls (facts)

**Chat list:** `GET /api/{session}/chats/overview?limit=20&offset=0`

- Built for chat UIs. Returns `id`, `name`, `picture`, `lastMessage`, `_chat`, sorted by last message.
- `limit` defaults to 20 in the spec.
- `merge` (default true) merges `@lid` and `@c.us` chats for the same contact.
- `lastMessage` has no media attachment. Fetch the message by id for that.
- Use `POST` for over 400 `ids`.

**Messages:** `GET /api/{session}/chats/{chatId}/messages?limit=20&offset=0`

- Filters: `filter.timestamp.gte`, `filter.timestamp.lte`, `filter.fromMe`, `filter.ack`. Sorting: `sortBy`, `sortOrder`. Also `merge`.
- `downloadMedia` defaults to `true` through `WAHA_API_DOWNLOAD_MEDIA`. Pass `false` for list views.
- `chatId=all` fetches across chats on GOWS and NOWEB.
- Ack values: `ERROR -1`, `PENDING 0`, `SERVER 1`, `DEVICE 2`, `READ 3`, `PLAYED 4`.
- `_data` is raw engine data and differs by engine. Don't build on it.

**Sending:** `POST /api/sendText` and `sendImage`, `sendFile`, `sendVoice`, `sendVideo`, `reply`, `reaction`. Session goes in the body. See [Send messages](https://waha.devlike.pro/docs/how-to/send-messages/).

## Chat ids (facts)

- `123@c.us`: phone number account.
- `123@g.us`: group.
- `123@lid`: hidden user id. Map with `GET /api/{session}/lids/{lid}`.
- `123@newsletter`: channel.
- `123@s.whatsapp.net`: internal NOWEB form. Convert to `@c.us`; do not send to it.

## Media (facts)

- Incoming message events carry `hasMedia` and `media.url`, `media.mimetype`, `media.filename`, `media.error`.
- `hasMedia: true` with `media.url: null` means WAHA did not download it, because of configuration.
- `WAHA_EVENTS_DOWNLOAD_MEDIA`, `_MIMETYPES` control events. `WAHA_API_DOWNLOAD_MEDIA`, `_MIMETYPES` control the API. Query params override per request.
- Download with an API key. Default local files live **180 seconds**, so fetch them promptly or configure persistence.
- `WAHA_BASE_URL` sets the `media.url` host.
- NOWEB and GOWS ask the phone to re-upload expired media (2026.9.1).
- Video reception on WEBJS needs the `chrome` image.
- Docs show `/api/files/{file}` URLs; the code writes `{session}/{id}.{ext}` under local storage. Always use the returned URL.
- `/api/files` and `/ws` are not in `openapi.json`.

## Websockets (facts)

```text
wss://host/ws?x-api-key=KEY&session=default&events=session.status&events=message
```

`session=*` and `events=*` are accepted. `events=*` excludes `engine.event`. The server sends heartbeats every 60 seconds (source). Session keys are limited to their own session (source).

## Recommendation (inference)

**Use GOWS for the inbox, and keep your own copy of messages in Laravel.**

Why GOWS:

- It has the lowest resource cost at scale, and supports 500 sessions in the FAQ table. WEBJS tops out at 50.
- Chats, messages and contacts work without enabling a store, because storage is on by default.
- WAHA calls it the future replacement for NOWEB.
- It is the only engine with passkey pairing and has structured `FAILED` reasons.
- `gows.storage` lets you drop data you do not need.

Trade-offs to accept or design around:

- No archive or unarchive, chat delete, message pin, contact block, or `about`. Keep archive as local state in your app, and don't promise block or pin in the UI. NOWEB offers archive and pin, but it needs the store and still lacks block.
- If you need block or `about`, WEBJS or WPP are the only options, at far higher cost.
- Limit history sync before pairing tenants.
- Recent GOWS fixes include group messages saved without content (2026.9.2). Run a current version.
- Engine responses differ significantly, so test before switching. Don't plan to mix engines per server.

Design:

1. Backfill once from `chats/overview` and `messages` when a session reaches `WORKING`.
2. Stay current from `message.any`, `message.ack`, `message.edited`, `message.revoked` and `message.reaction`.
3. Render from your database. Treat WAHA as a transport, not a data store. Offset paging against WAHA for every tenant view would be slow and load the worker.
4. Copy media to your own storage on arrival and proxy it to tenants.
5. Push updates to browsers through Reverb, not tenant websockets to WAHA.

## Not settled

- GOWS history depth with the default settings, beyond "many years", is not documented.
- Whether history sync emits `message` or `message.any` webhooks is not documented, so backfill through the API and deduplicate.
- Whether the Storages table's blank WPP column means WPP is unsupported or just unlisted.
