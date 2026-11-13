# ✅ Presence

## POST `/api/{session}/presence`

Set session presence

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [WAHASessionPresence](schemas.md#wahasessionpresence)

Responses:

**201**


## GET `/api/{session}/presence`

Get all subscribed presence information.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: array of [WAHAChatPresences](schemas.md#wahachatpresences)

## GET `/api/{session}/presence/{chatId}`

Get the presence for the chat id. If it hasn't been subscribed - it also subscribes to it.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**200**

- `application/json`: [WAHAChatPresences](schemas.md#wahachatpresences)

## POST `/api/{session}/presence/{chatId}/subscribe`

Subscribe to presence events for the chat.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**201**
