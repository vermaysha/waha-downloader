# 👥 Groups

## POST `/api/{session}/groups`

Create a new group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [CreateGroupRequest](schemas.md#creategrouprequest)

Responses:

**201**


## GET `/api/{session}/groups`

Get all groups.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `sortBy` | query | no | `id` \| `subject` | Sort by field |
| `sortOrder` | query | no | `desc` \| `asc` | Sort order - <b>desc</b>ending (Z => A, New first) or <b>asc</b>ending (A => Z, Old first) |
| `limit` | query | no | number |  |
| `offset` | query | no | number |  |
| `exclude` | query | no | array of `` \| `participants` | Exclude fields |

Responses:

**200**

- `application/json`: object

## GET `/api/{session}/groups/join-info`

Get info about the group before joining.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `code` | query | yes | string | Group code (123) or url (https://chat.whatsapp.com/123) |

Responses:

**200**

- `application/json`: object

## POST `/api/{session}/groups/join`

Join group via code

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [JoinGroupRequest](schemas.md#joingrouprequest)

Responses:

**200**

- `application/json`: [JoinGroupResponse](schemas.md#joingroupresponse)

## GET `/api/{session}/groups/count`

Get the number of groups.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [CountResponse](schemas.md#countresponse)

## POST `/api/{session}/groups/refresh`

Refresh groups from the server.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**


## GET `/api/{session}/groups/{id}`

Get the group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**


## DELETE `/api/{session}/groups/{id}`

Delete the group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**


## POST `/api/{session}/groups/{id}/leave`

Leave the group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**


## GET `/api/{session}/groups/{id}/picture`

Get group picture

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |
| `refresh` | query | no | boolean | Refresh the picture from the server (24h cache by default). Do not refresh if not needed, you can get rate limit error |

Responses:

**200**

- `application/json`: [ChatPictureResponse](schemas.md#chatpictureresponse)

## PUT `/api/{session}/groups/{id}/picture`

Set group picture

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string | Group ID |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [ProfilePictureRequest](schemas.md#profilepicturerequest)

Responses:

**200**

- `application/json`: [Result](schemas.md#result)

## DELETE `/api/{session}/groups/{id}/picture`

Delete group picture

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `id` | path | yes | string | Group ID |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [Result](schemas.md#result)

## PUT `/api/{session}/groups/{id}/description`

Updates the group description.

Returns "true" if the subject was properly updated. This can return "false" if the user does not have the necessary permissions.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [DescriptionRequest](schemas.md#descriptionrequest)

Responses:

**200**


## PUT `/api/{session}/groups/{id}/subject`

Updates the group subject

Returns "true" if the subject was properly updated. This can return "false" if the user does not have the necessary permissions.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [SubjectRequest](schemas.md#subjectrequest)

Responses:

**200**


## PUT `/api/{session}/groups/{id}/settings/security/info-admin-only`

Updates the group "info admin only" settings.

You can allow only admins to edit group info (title, description, photo).

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [SettingsSecurityChangeInfo](schemas.md#settingssecuritychangeinfo)

Responses:

**200**


## GET `/api/{session}/groups/{id}/settings/security/info-admin-only`

Get the group's 'info admin only' settings.

You can allow only admins to edit group info (title, description, photo).

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: [SettingsSecurityChangeInfo](schemas.md#settingssecuritychangeinfo)

## PUT `/api/{session}/groups/{id}/settings/security/messages-admin-only`

Update settings - who can send messages

Updates the group settings to only allow admins to send messages.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [SettingsSecurityChangeInfo](schemas.md#settingssecuritychangeinfo)

Responses:

**200**


## GET `/api/{session}/groups/{id}/settings/security/messages-admin-only`

Get settings - who can send messages

The group settings to only allow admins to send messages.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: [SettingsSecurityChangeInfo](schemas.md#settingssecuritychangeinfo)

## PUT `/api/{session}/groups/{id}/settings/security/member-add-mode`

Update settings - who can add new members

Updates the group settings for who can add new members to the group - all members or admins only.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [SettingsMemberAddMode](schemas.md#settingsmemberaddmode)

Responses:

**200**


## GET `/api/{session}/groups/{id}/settings/security/member-add-mode`

Get settings - who can add new members

The group settings for who can add new members to the group - all members or admins only.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: [SettingsMemberAddMode](schemas.md#settingsmemberaddmode)

## PUT `/api/{session}/groups/{id}/settings/security/member-share-history-mode`

Update settings - members can send message history to new members

Updates the group settings for whether members can share message history with new members, or only admins can.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [SettingsMemberShareHistoryMode](schemas.md#settingsmembersharehistorymode)

Responses:

**200**

- `application/json`: boolean

## GET `/api/{session}/groups/{id}/settings/security/member-share-history-mode`

Get settings - members can send message history to new members

The group settings for whether members can share message history with new members, or only admins can.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: [SettingsMemberShareHistoryMode](schemas.md#settingsmembersharehistorymode)

## PUT `/api/{session}/groups/{id}/settings/security/membership-approval`

Update settings - approve new members

Enables or disables admin approval for users requesting to join the group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [SettingsMembershipApproval](schemas.md#settingsmembershipapproval)

Responses:

**200**

- `application/json`: boolean

## GET `/api/{session}/groups/{id}/settings/security/membership-approval`

Get settings - approve new members

Returns whether admin approval is required for users requesting to join the group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: [SettingsMembershipApproval](schemas.md#settingsmembershipapproval)

## GET `/api/{session}/groups/{id}/participants/join-requests`

Get pending requests to join the group

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: array of [GroupJoinRequest](schemas.md#groupjoinrequest)

## POST `/api/{session}/groups/{id}/participants/join-requests/approve`

Approve pending requests to join the group

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [ParticipantsRequest](schemas.md#participantsrequest)

Responses:

**200**

- `application/json`: array of [GroupJoinRequestResult](schemas.md#groupjoinrequestresult)

## POST `/api/{session}/groups/{id}/participants/join-requests/reject`

Reject pending requests to join the group

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [ParticipantsRequest](schemas.md#participantsrequest)

Responses:

**200**

- `application/json`: array of [GroupJoinRequestResult](schemas.md#groupjoinrequestresult)

## GET `/api/{session}/groups/{id}/invite-code`

Gets the invite code for the group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: string

## POST `/api/{session}/groups/{id}/invite-code/revoke`

Invalidates the current group invite code and generates a new one.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: string

## GET `/api/{session}/groups/{id}/participants`

Get participants

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**


## GET `/api/{session}/groups/{id}/participants/v2`

Get group participants.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: array of [GroupParticipant](schemas.md#groupparticipant)

## GET `/api/{session}/groups/{id}/participants/v2/tags`

Get member tags

Tags the participants set for themselves in the group. Only members with a tag are listed.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: array of [GroupParticipantTag](schemas.md#groupparticipanttag)

## GET `/api/{session}/groups/{id}/participants/v2/tags/my`

Get my member tag in the group

Returns tag: null when you have no tag in the group.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Responses:

**200**

- `application/json`: [GroupParticipantTag](schemas.md#groupparticipanttag)

## PUT `/api/{session}/groups/{id}/participants/v2/tags/my`

Set my member tag in the group

Sets the tag shown next to your name in the group participants list. Members can only tag themselves. Send an empty or null tag to remove it.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [GroupMemberTagRequest](schemas.md#groupmembertagrequest)

Responses:

**200**

- `application/json`: boolean

## GET `/api/{session}/groups/{id}/participants/v2/tags/{participantId}`

Get member tag of one participant

Returns tag: null when the participant has no tag. Use the participant id as reported in messages and participants (@lid in most groups).

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |
| `participantId` | path | yes | string |  |

Responses:

**200**

- `application/json`: [GroupParticipantTag](schemas.md#groupparticipanttag)

## POST `/api/{session}/groups/{id}/participants/add`

Add participants

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [ParticipantsRequest](schemas.md#participantsrequest)

Responses:

**200**


## POST `/api/{session}/groups/{id}/participants/remove`

Remove participants

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [ParticipantsRequest](schemas.md#participantsrequest)

Responses:

**200**


## POST `/api/{session}/groups/{id}/admin/promote`

Promote participants to admin users.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [ParticipantsRequest](schemas.md#participantsrequest)

Responses:

**200**


## POST `/api/{session}/groups/{id}/admin/demote`

Demotes participants to regular users.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `id` | path | yes | string | Group ID |

Request body (required):

- `application/json`: [ParticipantsRequest](schemas.md#participantsrequest)

Responses:

**200**
