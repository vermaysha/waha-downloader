# Sending limits and ban risk

Sources: [How to Avoid Blocking](https://waha.devlike.pro/docs/overview/how-to-avoid-blocking/), [Sessions](https://waha.devlike.pro/docs/how-to/sessions/), [GOWS](https://waha.devlike.pro/docs/engines/gows/), `openapi.json`.

## What WAHA says (facts)

- WAHA publishes **no API rate limit and no safe message volume**. There is no bulk or broadcast send endpoint in `openapi.json`.
- WAHA does not block API calls during restrictions. WhatsApp enforces them server-side.
- WAHA's stated position: agree with WhatsApp's policy, do not send spam, and "always wait for the other person to contact you first".
- "You should never initiate a conversation" is the headline rule for bots.
- Spam gets you banned whether it goes through a broadcast list, a group or direct messages.

## Heuristics from WAHA's guide (facts, unverified by WAHA as limits)

- Being tagged as spam "a few times (5-10)" gets you banned.
- It behaves like a points system: conversations add points, spam tags and blocks remove them. No formula is given.
- Reports from recipients matter most: "As long as you don't get reports... your account will be mostly fine".
- Wait a random 30 to 60 seconds between messages, and never use fixed times.
- Send in batches with pauses. The example is at most 4 messages per contact that replied within an hour, then stop for an hour.
- Do not send around the clock.
- Vary the text and include the recipient's name.
- Send one short message when starting a conversation.
- Group contacts by area code.
- Have a profile picture, name and status.
- Send seen receipts, or disable them.
- Avoid links flagged as spam and non-HTTPS links.
- Have users start the chat, for example with a `https://wa.me/12132132131?text=Hi` link.

## Reply flow (facts)

1. `POST /api/sendSeen`
2. `POST /api/startTyping`, then wait a random interval based on message length
3. `POST /api/stopTyping`
4. `POST /api/sendText`

## WhatsApp restrictions WAHA exposes (facts)

| | Reachout Timelock | Message Capping |
| --- | --- | --- |
| Meaning | Shadow restriction after too many new contacts | Per-cycle quota on new contacts |
| Send failure | `server returned error 463` | `server returned error 475` once `CAPPED` |
| Session status | Stays `WORKING` | Stays `WORKING` |
| Live state | `GET /api/sessions/{session}/timelock` | `GET /api/sessions/{session}/capping` |
| Last known | `me.reachoutTimelock` | `me.messageCapping` |
| Fields | `isActive`, `timeEnforcementEnds` | `cappingStatus`, `totalQuota`, `usedQuota`, `cycleStart`, `cycleEnd` |
| Ends | At `timeEnforcementEnds`, automatically | At `cycleEnd`, automatically |
| Engines | GOWS, NOWEB, WEBJS | Not stated in the docs |

- `cappingStatus` values: `NONE`, `FIRST_WARNING`, `SECOND_WARNING`, `CAPPED`. Treat as an open set.
- `totalQuota: -1` means no cap. The `1000` in WAHA's examples is sample data, not a limit.
- Both only restrict new contacts. Existing chats generally keep working.
- **Do not restart, log out or re-pair.** It does not lift either restriction.
- Events are hints because WhatsApp does not always push changes. Call the on-demand endpoints for the real value.

Further detail from the [sessions page](https://waha.devlike.pro/docs/how-to/sessions/#reachout-timelock) (facts):

- Timelock engines are GOWS, NOWEB and WEBJS. `enforcementType` is informational (`RESTRICT_ALL_COMPANIONS`, `BIZ_QUALITY`, `WEB_COMPANION_ONLY`, `DEFAULT`). `timeEnforcementEnds` is in unix seconds and may be `null`.
- `me.reachoutTimelock` stays `null` until an enforcement has been seen; `GET /api/sessions/{session}/timelock` returns `isActive: false` when there is none.
- GOWS re-fetches timelock state when WhatsApp rejects a message with `463`.
- Each change re-issues a `WORKING` `session.status` event with the info in `data`. When the lock lifts, the event carries `isActive: false`.
- `FIRST_WARNING` and `SECOND_WARNING` mean slow down outreach to new contacts. The quota only counts 1:1 messages to contacts without an established chat.
- Capping `cycleStart` and `cycleEnd` are unix seconds and may be `null`. `mvStatus` and `oteStatus` are informational.

## Bans on GOWS (facts)

`session.status` `FAILED` with `data.reason.event: "TemporaryBan"`:

| `Code` | Reason |
| --- | --- |
| `101` | Too many messages to people who don't have you in their address book |
| `102` | Too many people blocked you |
| `103` | Too many groups with people who don't have you |
| `104` | Same message to too many people |
| `106` | Too many messages to a broadcast list |

- `Expire` is in nanoseconds; `0` means unknown. The ban hits the account, including the phone.
- Do not re-pair. Wait, then restart.
- Repeated temporary bans may become permanent (`406`). WhatsApp treats `402`, `403` and `406` as banned.

## For a reseller SaaS (inference)

- Build per-session send pacing in Laravel with queues and random delays. WAHA will not protect tenants.
- Gate outreach on the live `capping` and `timelock` values. Pause automatically at `FIRST_WARNING`, and stop at `CAPPED` until `cycleEnd`.
- Treat 463 and 475 as restrictions, not as failures to retry.
- Do not ship a "blast to a list" feature as a default. Reason codes `101`, `104` and `106` describe exactly that.
- Separate each tenant's numbers and proxies, so one tenant's behaviour does not affect another's account or IP.
- Surface ban and restriction states clearly in the tenant UI, and set expectations in your terms that accounts can be banned.

## Not settled

- WAHA gives no safe daily or per-minute numbers. The 30 to 60 second delay is advice, not a guarantee.
- WAHA's docs do not address reselling or whether it is allowed by WhatsApp's terms. Get legal review, and treat account loss as a business risk.
- Whether WEBJS, NOWEB or GOWS differ in ban risk. The docs do not compare them.
- Which engines support Message Capping.
