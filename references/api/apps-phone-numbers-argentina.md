# 🧩 Apps: Phone Numbers: Argentina

## GET `/api/apps/argentine-phone-numbers/{session}/cache/memory`

List in-memory cache entries

Entries from the in-memory cache tier of the running session, sorted by key. The session must be running.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `limit` | query | no | number |  |
| `offset` | query | no | number |  |

Responses:

**200**


## GET `/api/apps/argentine-phone-numbers/{session}/cache/db`

List persistent cache entries

Entries from the persistent (database) cache tier, sorted by id. Works even when the session is stopped.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `limit` | query | no | number |  |
| `offset` | query | no | number |  |

Responses:

**200**


## GET `/api/apps/argentine-phone-numbers/{session}/cache/stats`

Get cache stats

Stats for both cache tiers. "memory" is null when the session is not running, "db" is null when the persistent cache is disabled.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**


## DELETE `/api/apps/argentine-phone-numbers/{session}/cache/purge`

Purge the resolved-numbers cache

Removes ALL persistent cache entries and clears the in-memory tier (the in-memory tier only when the session is running).

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**
