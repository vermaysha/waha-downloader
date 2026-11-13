# 🖼️ Media

## POST `/api/{session}/media/convert/voice`

Convert voice to WhatsApp format (opus)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [VoiceFileDTO](schemas.md#voicefiledto)

Responses:

**200**

- `audio/ogg; codecs=opus`: string (binary)
- `application/json`: [Base64File](schemas.md#base64file)

**201**


## POST `/api/{session}/media/convert/video`

Convert video to WhatsApp format (mp4)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [VideoFileDTO](schemas.md#videofiledto)

Responses:

**200**

- `video/mp4`: string (binary)
- `application/json`: [Base64File](schemas.md#base64file)

**201**
