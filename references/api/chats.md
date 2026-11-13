# 💬 Chats

## GET `/api/{session}/chats`

Get chats

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `sortBy` | query | no | `conversationTimestamp` \| `id` \| `name` | Sort by field |
| `sortOrder` | query | no | `desc` \| `asc` | Sort order - <b>desc</b>ending (Z => A, New first) or <b>asc</b>ending (A => Z, Old first) |
| `merge` | query | no | boolean | Merge LID (@lid) and phone-number (@c.us) chats referencing the same contact |
| `limit` | query | no | number |  |
| `offset` | query | no | number |  |

Responses:

**200**


## GET `/api/{session}/chats/overview`

Get chats overview. Includes all necessary things to build UI "your chats overview" page - chat id, name, picture, last message. Sorting by last message timestamp

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `merge` | query | no | boolean | Merge LID (@lid) and phone-number (@c.us) chats referencing the same contact |
| `limit` | query | no | number |  |
| `offset` | query | no | number |  |
| `ids` | query | no | array of string | Filter by chat ids |

Responses:

**200**

- `application/json`: array of [ChatSummary](schemas.md#chatsummary)

## POST `/api/{session}/chats/overview`

Get chats overview. Use POST if you have too many "ids" params - GET can limit it

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [OverviewBodyRequest](schemas.md#overviewbodyrequest)

Responses:

**201**

- `application/json`: array of [ChatSummary](schemas.md#chatsummary)

## DELETE `/api/{session}/chats/{chatId}`

Deletes the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**200**


## GET `/api/{session}/chats/{chatId}/picture`

Gets chat picture

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string |  |
| `refresh` | query | no | boolean | Refresh the picture from the server (24h cache by default). Do not refresh if not needed, you can get rate limit error |

Responses:

**200**

- `application/json`: [ChatPictureResponse](schemas.md#chatpictureresponse)

## GET `/api/{session}/chats/{chatId}/messages`

Gets messages in the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `sortBy` | query | no | `timestamp` \| `messageTimestamp` | Sort by field |
| `sortOrder` | query | no | `desc` \| `asc` | Sort order - <b>desc</b>ending (Z => A, New first) or <b>asc</b>ending (A => Z, Old first) |
| `downloadMedia` | query | no | boolean | Download media for messages |
| `downloadMediaMimetypes` | query | no | array of string | Download only media with these mimetypes (prefix match) |
| `merge` | query | no | boolean | Merge LID (@lid) and phone-number (@c.us) chats referencing the same contact |
| `limit` | query | yes | number |  |
| `offset` | query | no | number |  |
| `filter.timestamp.lte` | query | no | number | Filter messages before this timestamp (inclusive) |
| `filter.timestamp.gte` | query | no | number | Filter messages after this timestamp (inclusive) |
| `filter.fromMe` | query | no | boolean | From me filter (by default shows all messages) |
| `filter.ack` | query | no | `ERROR` \| `PENDING` \| `SERVER` \| `DEVICE` \| `READ` \| `PLAYED` | Filter messages by acknowledgment status |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**200**

- `application/json`: array of [WAMessage](schemas.md#wamessage)

## DELETE `/api/{session}/chats/{chatId}/messages`

Clears all messages from the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**200**


## POST `/api/{session}/chats/{chatId}/messages/read`

Read unread messages in the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `messages` | query | no | number | How much messages to read (latest first) |
| `days` | query | no | number | How much days to read (latest first) |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**201**

- `application/json`: [ReadChatMessagesResponse](schemas.md#readchatmessagesresponse)

## GET `/api/{session}/chats/{chatId}/messages/{messageId}`

Gets message by id

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `downloadMedia` | query | no | boolean | Download media for messages |
| `downloadMediaMimetypes` | query | no | array of string | Download only media with these mimetypes (prefix match) |
| `merge` | query | no | boolean | Merge LID (@lid) and phone-number (@c.us) chats referencing the same contact |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |
| `messageId` | path | yes | string |  |

Responses:

**200**

- `application/json`: [WAMessage](schemas.md#wamessage)

## DELETE `/api/{session}/chats/{chatId}/messages/{messageId}`

Deletes a message from the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |
| `messageId` | path | yes | string | Message ID in format <code>{fromMe}_{chat}_{message_id}[_{participant}]</code> |

Responses:

**200**


## PUT `/api/{session}/chats/{chatId}/messages/{messageId}`

Edits a message in the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |
| `messageId` | path | yes | string | Message ID in format <code>{fromMe}_{chat}_{message_id}[_{participant}]</code> |

Request body (required):

- `application/json`: [EditMessageRequest](schemas.md#editmessagerequest)

Responses:

**200**


## POST `/api/{session}/chats/{chatId}/messages/{messageId}/pin`

Pins a message in the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |
| `messageId` | path | yes | string |  |

Request body (required):

- `application/json`: [PinMessageRequest](schemas.md#pinmessagerequest)

Responses:

**201**


## POST `/api/{session}/chats/{chatId}/messages/{messageId}/unpin`

Unpins a message in the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |
| `messageId` | path | yes | string |  |

Responses:

**201**


## POST `/api/{session}/chats/{chatId}/archive`

Archive the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**201**

- `application/json`: object

## POST `/api/{session}/chats/{chatId}/unarchive`

Unarchive the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**201**

- `application/json`: object

## POST `/api/{session}/chats/{chatId}/unread`

Unread the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**201**

- `application/json`: object
