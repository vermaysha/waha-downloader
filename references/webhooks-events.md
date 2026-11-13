# Webhooks and events

Sources: [Events](https://waha.devlike.pro/docs/how-to/events/), [Configuration](https://waha.devlike.pro/docs/how-to/config/), `openapi.json`, [webhook sender code](https://github.com/devlikeapro/waha/blob/core/src/modules/waha-webhook/WebhookPlugin.sender.ts).

## Session and global webhooks (facts)

**Per session**, in `config.webhooks` on `POST /api/sessions` or `PUT /api/sessions/{session}`. It is an array, so a session can have several:

```json
{
  "name": "tenant-42",
  "config": {
    "metadata": {"tenant.id": "42"},
    "webhooks": [{
      "url": "https://app.example.com/webhooks/waha",
      "events": ["session.status", "message.any", "message.ack"],
      "hmac": {"key": "per-session-secret"},
      "retries": {"policy": "exponential", "delaySeconds": 2, "attempts": 5},
      "customHeaders": [{"name": "X-Worker", "value": "waha1"}]
    }]
  }
}
```

**Global**, for all sessions, through env vars: `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS`, `WHATSAPP_HOOK_HMAC_KEY`, `WHATSAPP_HOOK_RETRIES_POLICY`, `WHATSAPP_HOOK_RETRIES_DELAY_SECONDS`, `WHATSAPP_HOOK_RETRIES_ATTEMPTS`, `WHATSAPP_HOOK_CUSTOM_HEADERS` (`Header:Value;Header2:Value`).

Global webhook config does not appear in `session.config`. The docs advise against `*` in production because of request volume.

## Payload (facts)

```json
{
  "id": "evt_1111111111111111111111111111",
  "timestamp": 1741249702485,
  "event": "message",
  "session": "default",
  "metadata": {"user.id": "123"},
  "me": {"id": "71111111111@c.us", "pushName": "~"},
  "payload": {},
  "environment": {"tier": "CORE", "version": "2023.10.12"},
  "engine": "WEBJS"
}
```

## Headers and HMAC (facts)

- Every request: `X-Webhook-Request-Id`, `X-Webhook-Timestamp` (milliseconds).
- With `hmac.key`: `X-Webhook-Hmac` and `X-Webhook-Hmac-Algorithm: sha512`.
- The MAC is computed over the **raw body**, hex-encoded.

```php
$expected = hash_hmac('sha512', $request->getContent(), $secret);
hash_equals($expected, (string) $request->header('X-Webhook-Hmac'));
```

Verify against the raw body, not re-encoded JSON. The docs give a test vector: body `{"event":"message","session":"default","engine":"WEBJS"}`, key `my-secret-key`, MAC starting `208f8a55dde9e055`.

## Retries

**Facts:** `policy` is one of `constant`, `linear` or `exponential` (20% jitter). Example delays are 2,2,2,2 / 2,4,6,8 / 2,4.1,8.4,16.3.

**Source:** defaults are 15 attempts, 2 seconds, constant delay. Every failed POST is retried (`retryCondition` is always true), so 4xx responses retry too. A larger `Retry-After` is honoured by the constant and exponential policies. Retries live in memory in an HTTP client.

The source does not show durable delivery, so events can be lost if WAHA restarts mid-retry or attempts run out (inference).

## Event names (facts)

| Group | Events | Engine notes |
| --- | --- | --- |
| Session | `session.status`, `engine.event` | All. `state.change` is deprecated |
| Messages | `message`, `message.any`, `message.ack`, `message.reaction`, `message.edited`, `message.revoked` | All four |
| Messages | `message.waiting` | WEBJS only |
| Messages | `message.ack.group` | Documented separately; engine support not stated in the table |
| Chats | `chat.archive` | Per the Events page, WEBJS |
| Groups | `group.v2.join`, `.leave`, `.participants`, `.update`, `.participants.join-request`, `.participants.tag` | See [Groups](https://waha.devlike.pro/docs/how-to/groups/). `group.join` and `group.leave` are deprecated |
| Presence | `presence.update` | WEBJS needs `webjs.tagsEventsOn` for this and `message.ack` (spec) |
| Polls | `poll.vote`, `poll.vote.failed` | See [Polls](https://waha.devlike.pro/docs/how-to/polls/) |
| Labels | `label.upsert`, `label.deleted`, `label.chat.added`, `label.chat.deleted` | See [Labels](https://waha.devlike.pro/docs/how-to/labels/) |
| Calls | `call.received`, `call.accepted`, `call.rejected` | See [Calls](https://waha.devlike.pro/docs/how-to/calls/) |
| Event messages | `event.response`, `event.response.failed` | See [Event Message](https://waha.devlike.pro/docs/how-to/event-message/) |

`message` covers incoming messages. `message.any` fires on all message creations, including your own.

Engine tables for groups, labels, polls and calls are on the [Engines](https://waha.devlike.pro/docs/how-to/engines/#features) page. Check them before depending on those events.

## `session.status` (facts)

```json
{
  "event": "session.status",
  "session": "default",
  "payload": {
    "status": "WORKING",
    "statuses": [{"status": "STARTING", "timestamp": 1700000002000}],
    "data": null
  }
}
```

- `statuses` holds the recent 3.
- `data` is `null` for most statuses. It carries passkey data, `reachoutTimelock`, `messageCapping`, and on GOWS `reason` for `FAILED`.
- `SCAN_QR_CODE` repeats for each new QR.
- WAHA re-issues `WORKING` when timelock or capping change, so `WORKING` does not always mean a transition.
- WhatsApp does not always push these changes. The docs say to treat the event as a hint and poll `/timelock` and `/capping`.

## Updating an external app (inference)

1. Subscribe each session to `session.status` at creation, with a per-session HMAC key and `metadata` holding the tenant id.
2. Verify the HMAC on the raw body, then return `2xx` fast and queue the work. Slow or failing handlers trigger retries.
3. Deduplicate on `id` (`evt_...`). Retries can deliver the same event twice.
4. Order by `timestamp`, and ignore anything older than the stored status.
5. Handle `SCAN_QR_CODE` by pushing to the browser through Reverb. Fetch the QR on demand rather than storing it.
6. Reconcile on a schedule with `GET /api/sessions?all=true` per worker, because webhooks can be lost.
7. Rotate an HMAC key with care: changing it means `PUT`, which restarts the session.

## Not settled

- No delivery timeout, ordering guarantee or dead-letter behaviour is documented.
- Docs do not state whether webhooks are sent in parallel per session, so handlers must tolerate reordering.
