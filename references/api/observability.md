# 🔍 Observability

## GET `/ping`

Ping the server

Check if the server is alive and responding to requests.

Responses:

**200**

- `application/json`: [PingResponse](schemas.md#pingresponse)

## GET `/health`

Check the health of the server

Perform all health checks and return the server's health status.

Responses:

**200** The Health Check is successful

- `application/json`: object

**503** The Health Check is not successful

- `application/json`: object

## GET `/api/server/version`

Get the version of the server

Responses:

**200**

- `application/json`: [WAHAEnvironment](schemas.md#wahaenvironment)

## GET `/api/server/environment`

Get the server environment

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `all` | query | no | boolean | Include all environment variables |

Responses:

**200**

- `application/json`: object

## GET `/api/server/status`

Get the server status

Responses:

**200**

- `application/json`: [ServerStatusResponse](schemas.md#serverstatusresponse)

## POST `/api/server/stop`

Stop (and restart) the server

If you're using docker, after calling this endpoint Docker will start a new container, so you can use this endpoint to restart the server

Request body (required):

- `application/json`: [StopRequest](schemas.md#stoprequest)

Responses:

**201**

- `application/json`: [StopResponse](schemas.md#stopresponse)

## GET `/api/server/debug/cpu`

Collect and return a CPU profile for the current nodejs process

Uses the Node.js inspector profiler to capture a .cpuprofile

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `seconds` | query | no | number | How many seconds to sample CPU |

Responses:

**200**


## GET `/api/server/debug/heapsnapshot`

Return a heapsnapshot for the current nodejs process

Return a heapsnapshot of the server's memory

Responses:

**200**


## GET `/api/server/debug/browser/trace/{session}`

Collect and get a trace.json for Chrome DevTools 

Uses https://pptr.dev/api/puppeteer.tracing

Parameters:

| Name | In | Required | Type | Description |
| --- | --- | --- | --- | --- |
| `session` | path | yes | object | Session name |
| `seconds` | query | yes | number | How many seconds to trace |
| `categories` | query | yes | array of string | Categories to trace (all by default) |

Responses:

**200**


## GET `/api/version`

**Deprecated.**

Get the server version 

Use 'GET /api/server/version' instead 

Responses:

**200**

- `application/json`: [WAHAEnvironment](schemas.md#wahaenvironment)
