# Token Scope Policy

This document describes the scope design for internal JWTs used by the Worker. Each scope controls access to a specific set of API capabilities. Scopes are additive; issuing a token with multiple scopes grants all permissions associated with each scope.

## Scope definitions

- `user:profile`
  - Read-only access to a user's own profile information.
  - Intended for dashboards or settings pages that only display data.

- `line:read`
  - Read access to LINE binding status and related information.
  - Required for `GET /api/line/status`.

- `line:write`
  - Write access to LINE-related actions that affect state (bind, unbind, schedule changes, test send).
  - Required for:
    - `PATCH /api/line/schedule`
    - `POST /api/line/bind`
    - `POST /api/line/unbind`
    - `POST /api/line/test`

- `line:manage`
  - Administrative privileges over LINE resources.
  - Implies `line:read` and `line:write` (token may include either only `line:manage` or all three).
  - Suitable for internal tools or SRE operations.

- `admin:rate-limiter`
  - Allows access to `POST /api/admin/rate-limiter/stats` and `POST /api/admin/rate-limiter/reset` when coupled with the `X-Admin-Token` header.
  - Use for automation or scheduled maintenance tasks that must manage the rate limiter.

## Token issuance guidelines

1. **Short-lived tokens**: Include `exp` claim to expire within a reasonable window (e.g., 15 minutes for browser usage, 1 hour for backend service accounts). Include `iat` to mitigate replay.
2. **Scope minimization**: Assign only the scopes necessary for the client. For example:
   - User dashboards: `user:profile line:read`
   - LINE automation services: `line:write`
   - Internal SRE tooling: `line:manage admin:rate-limiter`
3. **Token rotation**: Rotate signing secret `ECCAL_JWT_SECRET` periodically. Tokens issued with previous secrets should be invalidated by expiring them quickly.
4. **Multi-factor operations**: For high-risk scope combinations (e.g., `line:manage` + `admin:rate-limiter`), require secondary approval or logging.

## Example payloads

### Standard user dashboard token
```json
{
  "sub": "user@example.com",
  "email": "user@example.com",
  "scope": "user:profile line:read",
  "iat": 1739510400,
  "exp": 1739511300
}
```

### Automation token for LINE scheduler
```json
{
  "sub": "scheduler-service",
  "email": "scheduler@example.com",
  "scope": ["line:write"],
  "iat": 1739510400,
  "exp": 1739514000
}
```

### Admin token for operations
```json
{
  "sub": "sre@example.com",
  "email": "sre@example.com",
  "scope": "line:manage admin:rate-limiter",
  "iat": 1739510400,
  "exp": 1739512200
}
```

## Scope validation reference

`verifyInternalJWT()` normalizes the `scope` claim to an array and enforces `exp`/`iat` checks. Middleware `requireScope()` ensures at least one required scope is present before allowing access to protected routes.

Keep this document updated as new scopes or APIs are introduced.
