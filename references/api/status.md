# 🟢 Status

## POST `/api/{session}/status/text`

Send text status

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [TextStatus](schemas.md#textstatus)

Responses:

**201**


## POST `/api/{session}/status/image`

Send image status

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [ImageStatus](schemas.md#imagestatus)

Responses:

**201**


## POST `/api/{session}/status/voice`

Send voice status

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [VoiceStatus](schemas.md#voicestatus)

Responses:

**201**


## POST `/api/{session}/status/video`

Send video status

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [VideoStatus](schemas.md#videostatus)

Responses:

**201**


## POST `/api/{session}/status/delete`

DELETE sent status

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [DeleteStatusRequest](schemas.md#deletestatusrequest)

Responses:

**201**


## GET `/api/{session}/status/new-message-id`

Generate message ID you can use to batch contacts

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [NewMessageIDResponse](schemas.md#newmessageidresponse)
