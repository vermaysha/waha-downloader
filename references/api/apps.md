# 🧩 Apps

## GET `/api/apps`

List all apps for a session

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | query | yes | string | Session name to list apps for |

Responses:

**200**


## POST `/api/apps`

Create a new app

Request body (required):

- `application/json`: [App](schemas.md#app)

Responses:

**201**


## GET `/api/apps/{id}`

Get app by ID

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string |  |

Responses:

**200**


## PUT `/api/apps/{id}`

Update an existing app

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string |  |

Request body (required):

- `application/json`: [App](schemas.md#app)

Responses:

**200**


## DELETE `/api/apps/{id}`

Delete an app

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string |  |

Responses:

**200**


## POST `/api/apps/{id}/purge`

Purge app storage by app ID

Delete the app's stored data (database rows, caches) while keeping the app configured.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string |  |

Responses:

**201**


## POST `/api/apps/{app}/{session}/purge`

Purge app storage by app name and session

Delete the unique app's stored data for the session. The app must be enabled.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `app` | path | yes | `argentine-phone-numbers` \| `brazilian-phone-numbers` \| `chatwoot` \| `calls` \| `mcp` \| `mexican-phone-numbers` \| `phone-numbers` |  |
| `session` | path | yes | string |  |

Responses:

**201**
