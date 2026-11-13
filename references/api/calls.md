# 📞 Calls

## POST `/api/{session}/calls/reject`

Reject incoming call

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [RejectCallRequest](schemas.md#rejectcallrequest)

Responses:

**201**
