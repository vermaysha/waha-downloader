# 📱 Pairing

## GET `/api/{session}/auth/qr`

Get QR code for pairing WhatsApp API.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `format` | query | yes | `image` \| `raw` |  |

Responses:

**200**

- `image/png`: string (binary)
- `application/json`: [Base64File](schemas.md#base64file) \| [QRCodeValue](schemas.md#qrcodevalue)

## POST `/api/{session}/auth/request-code`

Request authentication code.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [RequestCodeRequest](schemas.md#requestcoderequest)

Responses:

**201**


## GET `/api/{session}/auth/passkey/challenge`

Get the pending passkey (WebAuthn) challenge.

Available while the session is in PASSKEY_REQUIRED status. Pass the challenge to navigator.credentials.get({ publicKey: challenge }) on the https://web.whatsapp.com origin.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [PasskeyChallenge](schemas.md#passkeychallenge)

## POST `/api/{session}/auth/passkey`

Submit a WebAuthn passkey assertion to finish pairing.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [PasskeyAssertionRequest](schemas.md#passkeyassertionrequest)

Responses:

**201**


## GET `/api/{session}/auth/passkey/confirmation`

Get the pending passkey confirmation code.

Available while the session is in PASSKEY_CONFIRMATION_REQUIRED status. Most pairings skip this step - WhatsApp confirms them right after the assertion.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [PasskeyConfirmationResponse](schemas.md#passkeyconfirmationresponse)

## POST `/api/{session}/auth/passkey/confirm`

Confirm passkey pairing (only needed for the manual code case).

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**201**


## GET `/api/screenshot`

Get a screenshot of the current WhatsApp session (**WEBJS/WPP** only)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | query | yes | string |  |

Responses:

**200**

- `image/jpeg`: string (binary)
- `application/json`: [Base64File](schemas.md#base64file)
