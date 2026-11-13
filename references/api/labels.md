# 🏷️ Labels

## GET `/api/{session}/labels`

Get all labels

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: array of [Label](schemas.md#label)

## POST `/api/{session}/labels`

Create a new label

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [LabelBody](schemas.md#labelbody)

Responses:

**201**

- `application/json`: [Label](schemas.md#label)

## PUT `/api/{session}/labels/{labelId}`

Update a label

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `labelId` | path | yes | string |  |

Request body (required):

- `application/json`: [LabelBody](schemas.md#labelbody)

Responses:

**200**

- `application/json`: [Label](schemas.md#label)

## DELETE `/api/{session}/labels/{labelId}`

Delete a label

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `labelId` | path | yes | string |  |

Responses:

**200**

- `application/json`: object

## GET `/api/{session}/labels/chats/{chatId}`

Get labels for the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Responses:

**200**

- `application/json`: array of [Label](schemas.md#label)

## PUT `/api/{session}/labels/chats/{chatId}`

Save labels for the chat

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Request body (required):

- `application/json`: [SetLabelsRequest](schemas.md#setlabelsrequest)

Responses:

**200**


## GET `/api/{session}/labels/{labelId}/chats`

Get chats by label

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `labelId` | path | yes | string |  |

Responses:

**200**
