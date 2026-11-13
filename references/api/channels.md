# 📢 Channels

## GET `/api/{session}/channels`

Get list of know channels

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `role` | query | no | `OWNER` \| `ADMIN` \| `SUBSCRIBER` |  |

Responses:

**200**

- `application/json`: array of [Channel](schemas.md#channel)

## POST `/api/{session}/channels`

Create a new channel.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [CreateChannelRequest](schemas.md#createchannelrequest)

Responses:

**201**

- `application/json`: [Channel](schemas.md#channel)

## DELETE `/api/{session}/channels/{id}`

Delete the channel.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | object | WhatsApp Channel ID |

Responses:

**200**


## GET `/api/{session}/channels/{id}`

Get the channel info

You can use either id (123@newsletter) OR invite code (https://www.whatsapp.com/channel/123)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | object | WhatsApp Channel ID or invite code from invite link https://www.whatsapp.com/channel/11111 |

Responses:

**200**

- `application/json`: [Channel](schemas.md#channel)

## GET `/api/{session}/channels/{id}/messages/preview`

Preview channel messages

You can use either invite code (https://www.whatsapp.com/channel/123) or (123)ORChannel ID (123@newsletter).

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | object | Channel id or invite code |
| `downloadMediaMimetypes` | query | no | array of string | Download only media with these mimetypes (prefix match) |
| `downloadMedia` | query | yes | boolean |  |
| `limit` | query | yes | number |  |

Responses:

**200**

- `application/json`: array of [ChannelMessage](schemas.md#channelmessage)

## POST `/api/{session}/channels/{id}/follow`

Follow the channel.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | object | WhatsApp Channel ID |

Responses:

**201**


## POST `/api/{session}/channels/{id}/unfollow`

Unfollow the channel.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | object | WhatsApp Channel ID |

Responses:

**201**


## POST `/api/{session}/channels/{id}/mute`

Mute the channel.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | object | WhatsApp Channel ID |

Responses:

**201**


## POST `/api/{session}/channels/{id}/unmute`

Unmute the channel.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | object | WhatsApp Channel ID |

Responses:

**201**


## POST `/api/{session}/channels/search/by-view`

Search for channels (by view)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [ChannelSearchByView](schemas.md#channelsearchbyview)

Responses:

**200**

- `application/json`: [ChannelListResult](schemas.md#channellistresult)

## POST `/api/{session}/channels/search/by-text`

Search for channels (by text)

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [ChannelSearchByText](schemas.md#channelsearchbytext)

Responses:

**200**

- `application/json`: [ChannelListResult](schemas.md#channellistresult)

## GET `/api/{session}/channels/search/views`

Get list of views for channel search

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: array of [ChannelView](schemas.md#channelview)

## GET `/api/{session}/channels/search/countries`

Get list of countries for channel search

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: array of [ChannelCountry](schemas.md#channelcountry)

## GET `/api/{session}/channels/search/categories`

Get list of categories for channel search

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: array of [ChannelCategory](schemas.md#channelcategory)
