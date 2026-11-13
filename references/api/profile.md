# 🆔 Profile

## GET `/api/{session}/profile`

Get my profile

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [MyProfile](schemas.md#myprofile)

## PUT `/api/{session}/profile/name`

Set my profile name

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [ProfileNameRequest](schemas.md#profilenamerequest)

Responses:

**200**

- `application/json`: [Result](schemas.md#result)

## PUT `/api/{session}/profile/status`

Set profile status (About)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [ProfileStatusRequest](schemas.md#profilestatusrequest)

Responses:

**200**

- `application/json`: [Result](schemas.md#result)

## PUT `/api/{session}/profile/picture`

Set profile picture

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [ProfilePictureRequest](schemas.md#profilepicturerequest)

Responses:

**200**

- `application/json`: [Result](schemas.md#result)

## DELETE `/api/{session}/profile/picture`

Delete profile picture

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [Result](schemas.md#result)
