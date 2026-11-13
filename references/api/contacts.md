# 👤 Contacts

## GET `/api/contacts/all`

Get all contacts

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | query | yes | string |  |
| `sortBy` | query | no | `id` \| `name` | Sort by field |
| `sortOrder` | query | no | `desc` \| `asc` | Sort order - <b>desc</b>ending (Z => A, New first) or <b>asc</b>ending (A => Z, Old first) |
| `limit` | query | no | number |  |
| `offset` | query | no | number |  |

Responses:

**200**


## GET `/api/contacts`

Get contact basic info

The method always return result, even if the phone number is not registered in WhatsApp. For that - use /contacts/check-exists endpoint below.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `contactId` | query | yes | string |  |
| `session` | query | yes | string |  |

Responses:

**200**


## GET `/api/contacts/check-exists`

Check phone number is registered in WhatsApp.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `phone` | query | yes | string | The phone number to check |
| `session` | query | yes | string |  |

Responses:

**200**

- `application/json`: [WANumberExistResult](schemas.md#wanumberexistresult)

## GET `/api/contacts/about`

Gets the Contact's "about" info

Returns null if you do not have permission to read their status.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `contactId` | query | yes | string |  |
| `session` | query | yes | string |  |

Responses:

**200**


## GET `/api/contacts/profile-picture`

Get contact's profile picture URL

If privacy settings do not allow to get the picture, the method will return null.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `contactId` | query | yes | string |  |
| `refresh` | query | no | boolean | Refresh the picture from the server (24h cache by default). Do not refresh if not needed, you can get rate limit error |
| `session` | query | yes | string |  |

Responses:

**200**


## POST `/api/contacts/block`

Block contact

Request body (required):

- `application/json`: [ContactRequest](schemas.md#contactrequest)

Responses:

**201**


## POST `/api/contacts/unblock`

Unblock contact

Request body (required):

- `application/json`: [ContactRequest](schemas.md#contactrequest)

Responses:

**201**


## GET `/api/{session}/contacts/{id}`

Get contact basic info

The method always return result, even if the phone number is not registered in WhatsApp. For that - use /contacts/check-exists endpoint below.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Contact ID |

Responses:

**200**


## PUT `/api/{session}/contacts/{chatId}`

Create or update contact

Create or update contact on the phone address book. May not work if you have installed many WhatsApp apps on the same phone

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `chatId` | path | yes | string | Chat ID |

Request body (required):

- `application/json`: [ContactUpdateBody](schemas.md#contactupdatebody)

Responses:

**200**

- `application/json`: [Result](schemas.md#result)

## GET `/api/{session}/lids`

Get all known lids to phone number mapping

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `limit` | query | no | number |  |
| `offset` | query | no | number |  |

Responses:

**200**

- `application/json`: array of [LidToPhoneNumber](schemas.md#lidtophonenumber)

## GET `/api/{session}/lids/count`

Get the number of known lids

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [CountResponse](schemas.md#countresponse)

## GET `/api/{session}/lids/{lid}`

Get phone number by lid

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `lid` | path | yes | string |  |

Responses:

**200**

- `application/json`: [LidToPhoneNumber](schemas.md#lidtophonenumber)

## GET `/api/{session}/lids/pn/{phoneNumber}`

Get lid by phone number (chat id)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `phoneNumber` | path | yes | string |  |

Responses:

**200**

- `application/json`: [LidToPhoneNumber](schemas.md#lidtophonenumber)
