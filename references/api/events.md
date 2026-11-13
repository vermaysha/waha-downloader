# 📅 Events

## POST `/api/{session}/events`

Send an event message

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [EventMessageRequest](schemas.md#eventmessagerequest)

Responses:

**201**

- `application/json`: [WAMessage](schemas.md#wamessage)
