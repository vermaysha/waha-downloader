# 🖥️ Sessions

## GET `/api/sessions`

List all sessions

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `expand` | query | no | array of `apps` | Expand additional session details. |
| `all` | query | no | boolean | Return all sessions, including those that are in the STOPPED state. |

Responses:

**200**

- `application/json`: array of [SessionInfo](schemas.md#sessioninfo)

## POST `/api/sessions`

Create a session

Create session a new session (and start it at the same time if required).

Request body (required):

- `application/json`: [SessionCreateRequest](schemas.md#sessioncreaterequest)

Example `basic`:

```json
{
  "name": "default"
}
```


Example `withWebhooks`:

```json
{
  "name": "default",
  "config": {
    "webhooks": [
      {
        "url": "https://example.com/webhooks/waha",
        "events": [
          "message",
          "session.status"
        ],
        "hmac": {
          "key": "super-secret"
        },
        "retries": {
          "delaySeconds": 2,
          "attempts": 5,
          "policy": "linear"
        },
        "customHeaders": [
          {
            "name": "X-Request-ID",
            "value": "123"
          }
        ]
      }
    ]
  }
}
```


Example `withApps`:

```json
{
  "name": "default",
  "apps": [
    {
      "app": "calls",
      "id": "app_unique_id",
      "session": "",
      "config": {
        "dm": {
          "reject": true,
          "message": "📞❌ We don't take calls right now.\n🎤 Please send a voice message or 📝 text — we'll reply ASAP!"
        },
        "group": {
          "reject": true,
          "message": "📞❌ We don't take calls right now.\n🎤 Please send a voice message or 📝 text — we'll reply ASAP!"
        }
      }
    }
  ],
  "start": true
}
```


Example `full`:

```json
{
  "name": "default",
  "start": true,
  "config": {
    "metadata": {
      "user.id": "123"
    },
    "debug": true,
    "webhooks": [
      {
        "url": "https://example.com/webhooks/waha",
        "events": [
          "message",
          "session.status"
        ],
        "hmac": {
          "key": "super-secret"
        }
      }
    ]
  },
  "apps": [
    {
      "app": "calls",
      "enabled": true,
      "config": {
        "dm": {
          "reject": true,
          "message": "📞❌ We don't take calls right now.\n🎤 Please send a voice message or 📝 text — we'll reply ASAP!"
        },
        "group": {
          "reject": true
        }
      }
    }
  ]
}
```


Responses:

**201**

- `application/json`: [SessionDTO](schemas.md#sessiondto)

## GET `/api/sessions/{session}`

Get session information

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `expand` | query | no | array of `apps` | Expand additional session details. |

Responses:

**200**

- `application/json`: [SessionInfo](schemas.md#sessioninfo)

## PUT `/api/sessions/{session}`

Update a session

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body (required):

- `application/json`: [SessionUpdateRequest](schemas.md#sessionupdaterequest)

Example `basic`:

```json
{
  "name": "default"
}
```


Example `withWebhooks`:

```json
{
  "name": "default",
  "config": {
    "webhooks": [
      {
        "url": "https://example.com/webhooks/waha",
        "events": [
          "message",
          "session.status"
        ],
        "hmac": {
          "key": "super-secret"
        },
        "retries": {
          "delaySeconds": 2,
          "attempts": 5,
          "policy": "linear"
        },
        "customHeaders": [
          {
            "name": "X-Request-ID",
            "value": "123"
          }
        ]
      }
    ]
  }
}
```


Example `withApps`:

```json
{
  "name": "default",
  "apps": [
    {
      "app": "calls",
      "id": "app_unique_id",
      "session": "",
      "config": {
        "dm": {
          "reject": true,
          "message": "📞❌ We don't take calls right now.\n🎤 Please send a voice message or 📝 text — we'll reply ASAP!"
        },
        "group": {
          "reject": true,
          "message": "📞❌ We don't take calls right now.\n🎤 Please send a voice message or 📝 text — we'll reply ASAP!"
        }
      }
    }
  ],
  "start": true
}
```


Example `full`:

```json
{
  "name": "default",
  "start": true,
  "config": {
    "metadata": {
      "user.id": "123"
    },
    "debug": true,
    "webhooks": [
      {
        "url": "https://example.com/webhooks/waha",
        "events": [
          "message",
          "session.status"
        ],
        "hmac": {
          "key": "super-secret"
        }
      }
    ]
  },
  "apps": [
    {
      "app": "calls",
      "enabled": true,
      "config": {
        "dm": {
          "reject": true,
          "message": "📞❌ We don't take calls right now.\n🎤 Please send a voice message or 📝 text — we'll reply ASAP!"
        },
        "group": {
          "reject": true
        }
      }
    }
  ]
}
```


Responses:

**200**

- `application/json`: [SessionDTO](schemas.md#sessiondto)

## DELETE `/api/sessions/{session}`

Delete the session

Delete the session with the given name. Stop and logout as well. Idempotent operation.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**


## GET `/api/sessions/{session}/me`

Get information about the authenticated account

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [MeInfo](schemas.md#meinfo)

## GET `/api/sessions/{session}/capping`

Fetch the account new-chat message capping (per-cycle quota)

Fetch a fresh new-chat message capping (quota) state from WhatsApp. The same value is also available under me.messageCapping in the session info, and changes are pushed through the session.status event.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [MessageCappingData](schemas.md#messagecappingdata)

## GET `/api/sessions/{session}/timelock`

Fetch the account reachout timelock state

Fetch a fresh reachout timelock state from WhatsApp - the restriction behind "server returned error 463" when messaging new contacts. The same value is also available under me.reachoutTimelock in the session info, and changes are pushed through the session.status event.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**200**

- `application/json`: [ReachoutTimelockData](schemas.md#reachouttimelockdata)

## POST `/api/sessions/{session}/start`

Start the session

Start the session with the given name. The session must exist. Idempotent operation.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**201**

- `application/json`: [SessionDTO](schemas.md#sessiondto)

## POST `/api/sessions/{session}/stop`

Stop the session

Stop the session with the given name. Idempotent operation.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**201**

- `application/json`: [SessionDTO](schemas.md#sessiondto)

## POST `/api/sessions/{session}/logout`

Logout from the session

Logout the session, restart a session if it was not STOPPED

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Request body:

- `application/json`: [SessionLogoutRequest](schemas.md#sessionlogoutrequest)

Responses:

**201**

- `application/json`: [SessionDTO](schemas.md#sessiondto)

## POST `/api/sessions/{session}/restart`

Restart the session

Restart the session with the given name.

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |

Responses:

**201**

- `application/json`: [SessionDTO](schemas.md#sessiondto)

## POST `/api/sessions/start`

**Deprecated.**

Upsert and Start session

Create session (if not exists) or update a config (if exists) and start it.

Request body (required):

- `application/json`: [SessionStartDeprecatedRequest](schemas.md#sessionstartdeprecatedrequest)

Responses:

**201**

- `application/json`: [SessionDTO](schemas.md#sessiondto)

## POST `/api/sessions/stop`

**Deprecated.**

Stop (and Logout if asked) session

Stop session and Logout by default.

Request body (required):

- `application/json`: [SessionStopDeprecatedRequest](schemas.md#sessionstopdeprecatedrequest)

Responses:

**201**


## POST `/api/sessions/logout`

**Deprecated.**

Logout and Delete session.

Stop, Logout and Delete session.

Request body (required):

- `application/json`: [SessionLogoutDeprecatedRequest](schemas.md#sessionlogoutdeprecatedrequest)

Responses:

**201**
