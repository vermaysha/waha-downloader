# 📤 Chatting

## POST `/api/sendText`

Send a text message

Request body (required):

- `application/json`: [MessageTextRequest](schemas.md#messagetextrequest)

Responses:

**201**

- `application/json`: [WAMessage](schemas.md#wamessage)

## GET `/api/sendText`

**Deprecated.**

Send a text message

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `phone` | query | yes | string |  |
| `text` | query | yes | string |  |
| `session` | query | yes | string |  |

Responses:

**200**

- `application/json`: object

## POST `/api/sendImage`

Send an image

Either from an URL or base64 data - look at the request schemas for details.

Request body (required):

- `application/json`: [MessageImageRequest](schemas.md#messageimagerequest)

Responses:

**201**

- `application/json`: object

## POST `/api/sendFile`

Send a file

Either from an URL or base64 data - look at the request schemas for details.

Request body (required):

- `application/json`: [MessageFileRequest](schemas.md#messagefilerequest)

Responses:

**201**

- `application/json`: object

## POST `/api/sendVoice`

Send an voice message

Either from an URL or base64 data - look at the request schemas for details.

Request body (required):

- `application/json`: [MessageVoiceRequest](schemas.md#messagevoicerequest)

Responses:

**201**

- `application/json`: object

## POST `/api/sendVideo`

Send a video

Either from an URL or base64 data - look at the request schemas for details.

Request body (required):

- `application/json`: [MessageVideoRequest](schemas.md#messagevideorequest)

Responses:

**201**


## POST `/api/sendSticker`

Send a sticker

The image will not be converted. It must already be in WebP format. PNG and JPEG are not supported.

Request body (required):

- `application/json`: [MessageStickerRequest](schemas.md#messagestickerrequest)

Example `url`:

```json
{
  "session": "default",
  "chatId": "11111111111@c.us",
  "reply_to": null,
  "file": {
    "url": "https://www.gstatic.com/webp/gallery/1.webp"
  }
}
```


Example `base64webp`:

```json
{
  "session": "default",
  "chatId": "11111111111@c.us",
  "reply_to": null,
  "file": {
    "mimetype": "image/webp",
    "data": "your-base64-data-of-webp"
  }
}
```


Responses:

**201**


## POST `/api/send/link-custom-preview`

Send a text message with a CUSTOM link preview.

You can use regular /api/sendText if you wanna send auto-generated link preview.

Request body (required):

- `application/json`: [MessageLinkCustomPreviewRequest](schemas.md#messagelinkcustompreviewrequest)

Responses:

**201**

- `application/json`: object

## POST `/api/sendButtons`

**Deprecated.**

Send buttons message (interactive)

Send Buttons

Request body (required):

- `application/json`: [SendButtonsRequest](schemas.md#sendbuttonsrequest)

Responses:

**201**


## POST `/api/sendList`

Send a list message (interactive)

Send a List message with sections and rows

Request body (required):

- `application/json`: [SendListRequest](schemas.md#sendlistrequest)

Responses:

**201**

- `application/json`: object

## POST `/api/forwardMessage`

Request body (required):

- `application/json`: [MessageForwardRequest](schemas.md#messageforwardrequest)

Responses:

**201**

- `application/json`: [WAMessage](schemas.md#wamessage)

## POST `/api/sendSeen`

Request body (required):

- `application/json`: [SendSeenRequest](schemas.md#sendseenrequest)

Responses:

**201**

- `application/json`: object

## POST `/api/startTyping`

Request body (required):

- `application/json`: [ChatRequest](schemas.md#chatrequest)

Responses:

**201**


## POST `/api/stopTyping`

Request body (required):

- `application/json`: [ChatRequest](schemas.md#chatrequest)

Responses:

**201**


## PUT `/api/reaction`

React to a message with an emoji

Request body (required):

- `application/json`: [MessageReactionRequest](schemas.md#messagereactionrequest)

Responses:

**200**

- `application/json`: object

## PUT `/api/star`

Star or unstar a message

Request body (required):

- `application/json`: [MessageStarRequest](schemas.md#messagestarrequest)

Responses:

**200**


## POST `/api/sendPoll`

Send a poll with options

You can use it as buttons or list replacement

Request body (required):

- `application/json`: [MessagePollRequest](schemas.md#messagepollrequest)

Responses:

**201**


## POST `/api/sendPollVote`

Vote on a poll

Cast vote(s) on an existing poll message

Request body (required):

- `application/json`: [MessagePollVoteRequest](schemas.md#messagepollvoterequest)

Responses:

**201**


## POST `/api/sendLocation`

Request body (required):

- `application/json`: [MessageLocationRequest](schemas.md#messagelocationrequest)

Responses:

**201**

- `application/json`: object

## POST `/api/sendContactVcard`

Request body (required):

- `application/json`: [MessageContactVcardRequest](schemas.md#messagecontactvcardrequest)

Responses:

**201**


## POST `/api/send/buttons/reply`

Reply on a button message

Request body (required):

- `application/json`: [MessageButtonReply](schemas.md#messagebuttonreply)

Responses:

**201**


## GET `/api/messages`

**Deprecated.**

Get messages in a chat

DEPRECATED. Use "GET /api/chats/{id}/messages" instead

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `sortBy` | query | no | `timestamp` \| `messageTimestamp` | Sort by field |
| `sortOrder` | query | no | `desc` \| `asc` | Sort order - <b>desc</b>ending (Z => A, New first) or <b>asc</b>ending (A => Z, Old first) |
| `downloadMedia` | query | no | boolean | Download media for messages |
| `downloadMediaMimetypes` | query | no | array of string | Download only media with these mimetypes (prefix match) |
| `merge` | query | no | boolean | Merge LID (@lid) and phone-number (@c.us) chats referencing the same contact |
| `chatId` | query | yes | string |  |
| `session` | query | yes | string |  |
| `limit` | query | yes | number |  |
| `offset` | query | no | number |  |
| `filter.timestamp.lte` | query | no | number | Filter messages before this timestamp (inclusive) |
| `filter.timestamp.gte` | query | no | number | Filter messages after this timestamp (inclusive) |
| `filter.fromMe` | query | no | boolean | From me filter (by default shows all messages) |
| `filter.ack` | query | no | `ERROR` \| `PENDING` \| `SERVER` \| `DEVICE` \| `READ` \| `PLAYED` | Filter messages by acknowledgment status |

Responses:

**200**

- `application/json`: array of [WAMessage](schemas.md#wamessage)

## GET `/api/checkNumberStatus`

**Deprecated.**

Check number status

DEPRECATED. Use "POST /contacts/check-exists" instead

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `phone` | query | yes | string | The phone number to check |
| `session` | query | yes | string |  |

Responses:

**200**

- `application/json`: [WANumberExistResult](schemas.md#wanumberexistresult)

## POST `/api/reply`

**Deprecated.**

DEPRECATED - you can set "reply_to" field when sending text, image, etc

Request body (required):

- `application/json`: [MessageReplyRequest](schemas.md#messagereplyrequest)

Responses:

**201**

- `application/json`: object

## POST `/api/sendLinkPreview`

**Deprecated.**

Request body (required):

- `application/json`: [MessageLinkPreviewRequest](schemas.md#messagelinkpreviewrequest)

Responses:

**201**


## GET `/api/{session}/new-message-id`

Generate a new message ID

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [NewMessageIDResponse](schemas.md#newmessageidresponse)
