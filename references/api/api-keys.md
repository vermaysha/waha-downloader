# 🔑 Api Keys

## POST `/api/keys`

Create a new API key

Request body (required):

- `application/json`: [ApiKeyRequest](schemas.md#apikeyrequest)

Responses:

**201**

- `application/json`: [ApiKeyDTO](schemas.md#apikeydto)

## GET `/api/keys`

Get all API keys

Responses:

**200**

- `application/json`: array of [ApiKeyDTO](schemas.md#apikeydto)

## POST `/api/keys/media`

Create or get a media-download-only API key for a session

Request body (required):

- `application/json`: [ScopedApiKeyRequest](schemas.md#scopedapikeyrequest)

Responses:

**201**

- `application/json`: [ApiKeyDTO](schemas.md#apikeydto)

## POST `/api/keys/control`

Create or get a control-only API key for a session

Request body (required):

- `application/json`: [ScopedApiKeyRequest](schemas.md#scopedapikeyrequest)

Responses:

**201**

- `application/json`: [ApiKeyDTO](schemas.md#apikeydto)

## PUT `/api/keys/{id}`

Update an API key

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string |  |

Request body (required):

- `application/json`: [ApiKeyRequest](schemas.md#apikeyrequest)

Responses:

**200**

- `application/json`: [ApiKeyDTO](schemas.md#apikeydto)

## DELETE `/api/keys/{id}`

Delete an API key

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string |  |

Responses:

**200**
