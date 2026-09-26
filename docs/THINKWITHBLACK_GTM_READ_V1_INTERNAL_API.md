# ThinkWithBlack GTM Read v1 internal API

This is an offline implementation contract for the trusted ThinkWithBlack
service. It is not a claim that the first real Google read or production
database integration has been verified.

## Required settings

The server reads these names only when a GTM route is used:

- `GOOGLE_GTM_CLIENT_ID`
- `GOOGLE_GTM_CLIENT_SECRET`
- `GTM_CREDENTIAL_KEY` (base64url-encoded 32-byte key)
- `THINKWITHBLACK_GTM_SERVICE_TOKEN`

Values are intentionally not documented here. Missing settings return
`GTM_OAUTH_CONFIGURATION` without changing application startup or GSC.

## Trusted internal routes

All are `POST /api/gtm/internal/...`, require
`Authorization: Bearer <THINKWITHBLACK_GTM_SERVICE_TOKEN>`, and accept JSON.
The two connection operations accept `{"userId":"string"}` after the trusted caller token
and current ECCAL member are checked:

- `/connection/begin`: creates a single-use intent and returns
  `connectionUrl`, `expiresAt`, `connectionId`, and `generation`.
- `/connection/status`: returns the current `status`, `connectionId`,
  and `generation`.

The 11 GTM read requests each include:

```json
{
  "userId": "string",
  "connectionId": "string",
  "generation": 0
}
```

Scopes are additive as follows:

- `/accounts/list`: optional `pageToken`
- `/containers/list`: `accountId`, optional `pageToken`
- `/workspaces/list`: `accountId`, `containerId`, optional `pageToken`
- `/workspaces/status`: `accountId`, `containerId`, `workspaceId`
- `/tags/list`: `accountId`, `containerId`, `workspaceId`, optional `pageToken`
- `/tags/get`: previous scope plus `objectId` (tag ID)
- `/triggers/list`: `accountId`, `containerId`, `workspaceId`, optional `pageToken`
- `/triggers/get`: previous scope plus `objectId` (trigger ID)
- `/variables/list`: `accountId`, `containerId`, `workspaceId`, optional `pageToken`
- `/variables/get`: previous scope plus `objectId` (variable ID)
- `/container-version-headers/list`: `accountId`, `containerId`, optional `pageToken`

Unknown fields, missing parent identifiers, malformed IDs, and pagination on
get operations are rejected.

Responses contain the validated Google payload in `data` plus:

```json
{
  "source": "google_tag_manager",
  "fetchedAt": "ISO-8601 timestamp",
  "queryScope": {
    "operation": "string",
    "accountId": "string",
    "containerId": "string",
    "workspaceId": "string",
    "objectId": "string"
  },
  "pagination": {
    "nextPageToken": "string or null",
    "complete": true,
    "automatic": false
  }
}
```

`pagination.complete` is false whenever Google returns a next-page token.
No automatic pagination is performed.

## Browser connection routes

- `GET /api/gtm/browser/claim?gtm_ticket=...` (single-use MCP handoff)
- `GET /api/gtm/browser/status`
- `POST /api/gtm/browser/begin`
- `POST /api/gtm/browser/start`
- `POST /api/gtm/browser/disconnect`
- `GET /api/gtm/oauth/callback`

The claim route checks the signed-in member and stores the handoff in an
encrypted HttpOnly cookie before redirecting to `/settings?gtm_connect=1`;
the raw ticket does not remain in the settings URL. The settings page then
continues the browser flow. Browser mutations require the existing
authenticated member cookie, exact ECCAL origin, and a GTM-specific CSRF proof. Pending and callback context is
encrypted in short-lived HttpOnly cookies. The trusted internal begin response
contains a single-use handoff URL; browser JSON and OAuth callback URLs do not
return the raw ticket. Callback state is single-use and bound to the member,
browser session, connection, generation, and Google identity.

## Public error codes

- `GTM_CALLER_REJECTED`: caller/member authentication failed
- `GTM_CSRF_REJECTED`: origin or CSRF proof failed
- `GTM_INVALID_INPUT`: invalid request fields
- `GTM_RESOURCE_NOT_FOUND`: Google returned scoped 404
- `GTM_CONNECTION_REJECTED`: stale, revoked, or ineligible generation
- `GTM_OAUTH_REAUTHORIZATION_REQUIRED`: authorization must be repeated
- `GTM_OAUTH_CONFIGURATION` / `GTM_UNAVAILABLE`: unavailable configuration/service
- `GTM_OPERATION_TIMEOUT` / `GTM_UPSTREAM_TIMEOUT`: timeout
- `GTM_UPSTREAM_REDIRECT`: upstream redirect rejected
- `GTM_UPSTREAM_INVALID_RESPONSE`: invalid UTF-8, JSON, or response shape
- `GTM_UPSTREAM_RESPONSE_TOO_LARGE`: response exceeded the bound
- `GTM_UPSTREAM_REJECTED`: upstream rejected request
- `GTM_RESOURCE_IDENTITY_MISMATCH`: returned resource is outside requested ancestry

HTTP mapping is 400 for input, 401 for caller, 403 for origin/CSRF, 404 for
scoped resource absence, 409 for stale/reauthorization, 503 for configuration
or unavailable service, 504 for timeout, and 502 for upstream/protocol/schema
failures.

## Read-only limitation and verification status

The only Google API permission is
`https://www.googleapis.com/auth/tagmanager.readonly`. No GTM create, update,
delete, version creation, synchronization, or publish operation is exposed.
Container version operation returns official version headers only.

Real Google OAuth, real GTM API reads, and production PostgreSQL migration or
data access remain unverified. Offline tests use synthetic data, fakes, an
in-memory repository, a recording pool, and a local test HTTP server.