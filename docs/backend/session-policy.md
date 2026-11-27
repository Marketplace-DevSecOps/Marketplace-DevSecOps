# Session and credential policy (backend)

Scope: API-01 to API-04 (Phase 3), implemented in `backend/src/modules/auth/*`,
`backend/src/modules/users/*` and `backend/src/middlewares/{requireAuth,rateLimit,requireAllowedOrigin}.ts`.
Contract: `backend/src/contracts/openapi.yaml`.

## Summary

| Item | Value |
|---|---|
| Access token | HS256 JWT, 600 s, claims `sub`, `sid`, `iss`, `aud`, `iat`, `exp`; session re-checked in the database on every request |
| Refresh token | 32 random bytes (base64url, 43 chars), SHA-256 stored, single use, family lifetime 7 days from login |
| Web transport | access token in the JSON body (kept in memory); refresh token in cookie `mp_refresh` (`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`) |
| Web CSRF | `Origin` in `CORS_ORIGINS` + signed double-submit token (`mp_csrf` cookie echoed in `X-CSRF-Token`) |
| Mobile transport | `/auth/mobile/*`; both tokens in the JSON body, `Cache-Control: no-store`, cookies never read or set |
| Concurrent refresh | same token again within 10 s → `409 CONFLICT`, family kept; after 10 s → reuse, family revoked, `401` |
| Login quota | 5 failures/min per (normalized email, IP), shared Web/mobile; 20 failures/min per IP; `429 RATE_LIMITED` + `Retry-After` |
| Password hashing | Argon2id m=19456 KiB, t=2, p=1 (measured 23 ms median) |

## Password storage

Module: `backend/src/modules/auth/password.ts` (also used by `prisma/seed.ts`).

### Parameters

| Parameter | Value |
|---|---|
| Algorithm | Argon2id, version 0x13 (`argon2` npm package, native binding) |
| `memoryCost` | 19456 KiB (19 MiB) |
| `timeCost` | 2 iterations |
| `parallelism` | 1 |
| Salt / output | 16-byte random salt per hash, 32-byte digest (library defaults), PHC string format |

Justification: the [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
recommends Argon2id and lists equivalent minimum configurations that trade memory
for iterations. We use the first one (m=19 MiB, t=2, p=1):

- Memory-hard enough to make GPU/ASIC guessing expensive, while 19 MiB per
  concurrent login keeps a small API container (a few hundred MiB) safe from
  memory exhaustion under a login burst. Login attempts are also rate limited.
- `parallelism = 1` because the Node.js libuv pool runs one hash per thread;
  more lanes would only take threads from concurrent requests.
- The measured cost (below) is about 25 ms, well under the ~1 s ceiling users
  tolerate, so the parameters can be raised later (see rehash on login).

### Measurement

Command: `npx tsx scripts/measure-argon2.ts` (20 hashes and 20 verifies after a warm-up).

| Date | Machine | Hash median / p95 | Verify median / p95 |
|---|---|---|---|
| 2026-11-27 | Node v24.19.0, Intel Core Ultra 7 258V (8 logical cores), Windows | 23.4 ms / 25.9 ms | 23.1 ms / 25.0 ms |

Re-run the script on the production host before release and record the result here.

### Rehash on login

`needsRehash(hash)` returns true when a stored hash is not Argon2id or was made with
other parameters. After a successful login, the auth service rehashes the password
with the current parameters and updates the row. This is best effort: a failed update
never fails the login.

### Timing equalization

A login for an unknown email still runs one Argon2id verification, against a dummy
hash computed once per process, eagerly when the auth router is created (same parameters,
`createDummyVerifier`), so the first such login costs no extra hash. A
disabled account verifies its real hash, then fails. The three failure cases (unknown
email, wrong password, disabled account) therefore cost the same time and return the
same error.

### Rules

- The plaintext password exists only in the request body. It is never stored, logged
  (log keys containing `password` are redacted) or returned.
- `passwordHash` never leaves the repository layer: no DTO exposes it.
- `verifyPassword` returns false, never throws, on a malformed stored hash.

## Access token

Module: `backend/src/modules/auth/tokens.ts`.

| Item | Value |
|---|---|
| Format | JWT signed with `jose`, header `{ "alg": "HS256", "typ": "JWT" }` |
| Algorithm allowlist | `HS256` only (`algorithms: ['HS256']`); `none`, other HMAC sizes and asymmetric algorithms are refused |
| Claims | `sub` (user id), `sid` (session id), `iss`, `aud`, `iat`, `exp`. Nothing else: the role is read from the database on each request |
| Lifetime | 600 s (`exp - iat`), also enforced with `maxTokenAge`, so a token forged with a far `exp` is still refused; no clock tolerance |
| Verification | signature, `alg`, `iss` = `JWT_ISSUER`, `aud` = `JWT_AUDIENCE`, `exp`, required `sub`/`sid`/`iat`/`exp` as strings. Any failure is the same `InvalidTokenError` (no reason leaks to the client) |
| Key | `JWT_ACCESS_SECRET`, required, at least 32 characters; in production a value containing `change-me` or `test-only` is refused at startup |

HS256 rather than EdDSA: the same process signs and verifies, so a public key would bring
no distribution benefit. Every protected request also checks the `Session` row
(`findActiveSession`): not revoked, not expired, owned by `sub`, user `ACTIVE`. Revoking a
family therefore stops its access tokens immediately, before `exp`.

## Refresh token

Modules: `tokens.ts`, `sessions.repository.ts`, `sessions.service.ts`.

- Opaque value: 32 bytes from `crypto.randomBytes`, base64url (43 characters).
- Stored only as its SHA-256 hex digest in `Session.refreshTokenHash` (unique). A fast hash
  is enough because the token has 256 bits of entropy.
- Lifetime: 7 days from login. Each login starts a family (`familyId`, random UUID). Rotated
  successors inherit the family's `expiresAt`, so a user re-authenticates at least weekly.
- Rotation runs in one `prisma.$transaction`: a conditional
  `UPDATE ... SET usedAt = now WHERE id = ? AND usedAt IS NULL AND revokedAt IS NULL`
  claims the row, the successor is created in the same family, and the old row's
  `replacedById` points to it. The conditional update takes the row lock, so under Read
  Committed two concurrent rotations cannot both succeed.
- Refused without any change: unknown token, expired token, user not `ACTIVE` (401).
- Presenting a revoked token: 401, and the family is revoked again (no-op if already done).

### Concurrent refresh policy

Spec 3.3 asks to avoid both accidental revocation and an uncontrolled replay window when a
client sends the same refresh token twice (two tabs, a retry after a lost response).

Decision: **10 s grace window, `409 CONFLICT`, no revocation** (`REFRESH_REUSE_GRACE_MS`).

| Presented token | Result |
|---|---|
| Unused, valid | 200, rotated (new refresh token) |
| Used at most 10 s ago (concurrent duplicate or quick retry) | `409 CONFLICT`, no token issued, family kept |
| Used more than 10 s ago (reuse) | `401 UNAUTHORIZED`, every session of the family revoked |
| Revoked | `401 UNAUTHORIZED`, family revoked |
| Expired, unknown, user disabled | `401 UNAUTHORIZED`, nothing revoked |

Why this opens no replay window: the loser of a race receives nothing it can use, and the
winner's new token is the only live one. An attacker replaying a stolen, already-rotated
token inside the 10 s window only gets 409; after it, the replay kills the family.
Required client handling: on 409 the Web client retries with the cookie set by the winning
request (the cookie jar is shared between tabs). The mobile client must coalesce refreshes
and, on 409, re-read the token saved in SecureStore and retry with it. **Open (Anas):** the
mobile app does not do this yet. `docs/anas/client-api-mobile.md` lists SecureStore and
coordinated session rotation as not implemented, and `mobile/src/tests/api-services.test.ts`
expects an immediate replay to give `unauthorized` instead of `409`. Spec 3.3 asks for this
handling to be defined and tested with the client team, so the mobile side stays to be agreed
and tested (see `team-sync.md`, "For Anas").

Tests: `backend/tests/integration/sessions.test.ts` (two concurrent rotations of one token
give exactly one success and one 409, family intact; replay after the window revokes the
family; revoked, expired, disabled-user and unknown tokens).

Follow-up (Phase 7): expired `Session` rows are not purged yet.

Sequence for two browser tabs that refresh at the same time with the same cookie:

| Step | Tab A | Tab B | Database |
|---|---|---|---|
| 1 | `POST /auth/refresh` (token T1) | `POST /auth/refresh` (token T1) | T1 unused |
| 2 | claims T1, gets T2 → 200, cookie = T2 | waits on the row lock | T1 `usedAt` = now, T2 created |
| 3 | | T1 already used < 10 s ago → `409` | unchanged, family valid |
| 4 | | retries with the shared cookie (T2) → 200, cookie = T3 | T2 used, T3 created |

An attacker who replays a stolen T1 later than step 3 + 10 s triggers reuse detection:
every row of the family is revoked, so A's and B's access tokens stop working on the next
request, and both tabs return to login.

## Session check on protected requests

Middleware: `backend/src/middlewares/requireAuth.ts` (`createRequireAuth`), one instance
built in `createApiRouter` and shared by every protected route.

1. `Authorization: Bearer <jwt>` (exact scheme, three base64url segments, at most 4096 chars).
2. Strict verification (`tokens.ts`): signature, `alg` = HS256, `iss`, `aud`, `exp`, `maxTokenAge`.
3. `Session` row `sid`: not revoked, not expired, `userId` = `sub`, user `status` = `ACTIVE`.
4. `req.auth = { userId, sessionId, role }`, with the role read from the database (a role
   change applies on the next request, without a new token).

Any failure gives the same `401 UNAUTHORIZED` body (no reason). A rotated (`usedAt` set) but
unrevoked row still accepts its access token until it expires (at most 10 min), so a
request in flight during a refresh does not fail.

## Web transport (cookies)

| Cookie | Value | Attributes | Readable by JS |
|---|---|---|---|
| `mp_refresh` | refresh token | `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800` | no |
| `mp_csrf` | `<nonce>.<hmac>` | `Secure; SameSite=Strict; Path=/; Max-Age=604800` | yes (by design) |

- `__Host-` is not used: the prefix requires `Path=/`, and `mp_refresh` must only reach
  `/api/v1/auth/*`. No `Domain` attribute, so the cookies are host-only.
- `SameSite=Strict` rather than `Lax`: the SPA only sends the cookie with `fetch()` from its
  own site, never on a top-level cross-site navigation, so Strict costs nothing and stops
  every cross-site send. `Secure` is always set (browsers accept it on `http://localhost`).
- On web refresh both cookies are re-sent with `Max-Age` = time left until the family's
  `expiresAt`, so the browser never keeps a cookie longer than its session.
- Logout clears both with the same attributes (`res.clearCookie`, `Expires` in 1970).
- The Web routes read the refresh token from the cookie only (`cookie-parser`, mounted on
  `/auth/refresh` and `/auth/logout` only); a token in the body is ignored (`401`).

### CSRF and Origin

Choice: **signed double-submit cookie + mandatory Origin** (`backend/src/modules/auth/csrf.ts`),
following the [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

- Web login, refresh and logout require an `Origin` header in `CORS_ORIGINS`
  (missing → `403 FORBIDDEN`, foreign → `403 CORS_FORBIDDEN` from the CORS middleware).
  Login requires it too (login CSRF).
- At web login the server sets `mp_csrf = nonce.HMAC-SHA256(key, familyId + "." + nonce)`
  (16-byte nonce). The key is derived from `JWT_ACCESS_SECRET` with HKDF-SHA256
  (info `mp-csrf-v1`), so no extra secret is configured and the two uses stay separated.
- Refresh and logout with a known `mp_refresh` require `X-CSRF-Token` equal to the
  `mp_csrf` cookie (constant-time comparison) **and** an HMAC valid for that session's
  family. A token copied from another login, a forged value or a missing header → `403`,
  and nothing is rotated or revoked.
- The token is bound to the family, not to one refresh token, so it survives rotation.
- `X-CSRF-Token` is in the CORS `allowedHeaders`.

Deployment constraint: the SPA must read `mp_csrf`, so in production the SPA and the API
are served from the same host (reverse proxy `/api` → backend). Cookies are host-scoped,
not port-scoped, so in development `localhost:5173` → `localhost:3000` works.

## Mobile transport

Routes: `POST /auth/mobile/login`, `/auth/mobile/refresh`, `/auth/mobile/logout`. They call
the same auth service as the Web routes.

- Request: refresh/logout take a strict `{ "refreshToken": "..." }` body (1..256 chars,
  base64url alphabet). Unknown fields → `400`.
- Responses (`Cache-Control: no-store`, never `Set-Cookie`):
  - login: `{ accessToken, expiresIn: 600, refreshToken, user }` (`MobileSession`);
  - refresh: `{ accessToken, expiresIn: 600, refreshToken }` (`MobileTokens`);
  - logout: `204`, also for an unknown or already revoked token, and when repeated.
- Cookies are never parsed or set on these routes. A request that carries only the Web
  cookie fails with `400 VALIDATION_ERROR` (missing body field) and the session is untouched.
  Team-sync #13: no special `400` for the mere presence of a `Cookie` header; ignoring it
  already prevents the Web cookie from acting as a credential here.
- No `Origin` requirement (native apps send none) and no CSRF token: there is no ambient
  credential to forge.
- The Web routes never accept the mobile transport: a body token on `/auth/refresh` gets `401`.

Client rules required from Anas's mobile client. **Not agreed yet:** these are open requirements,
proposed by the backend and still to be confirmed and implemented by Anas. The current mobile
code and docs (`docs/anas/rest-mobile.md`, `architecture.md`, `client-api-mobile.md`) do not
implement them; the tracked actions are in `team-sync.md`, "For Anas".

| Rule | Backend behaviour the app must handle |
|---|---|
| Access token in memory, refresh token in expo-secure-store | Login and refresh return both in the body; nothing in cookies |
| Save the new refresh token before resuming requests | The previous token stops working at rotation; replaying it within 10 s is `409`, later `401` + family revoked |
| Coalesce concurrent refreshes | A second refresh with the same token within 10 s gets `409`: re-read SecureStore and retry with the stored token |
| Lost refresh response | The app goes back to login; replaying the old token would be a reuse after 10 s |
| Logout | `204` whatever the token state; the app always clears SecureStore |
| Error codes | Mirror `INVALID_CREDENTIALS` (401, wrong credentials) next to `UNAUTHORIZED` (401, go to login) in `mobile/src/services/errors.ts` |
| Response parsing | Parse responses with non-strict objects so additive fields (e.g. `role`, `createdAt` in `user`) do not break the app |

## Login protection (API-02)

- Generic failure: unknown email, wrong password and disabled account all return
  `401 INVALID_CREDENTIALS` with the same message, after exactly one Argon2id verification
  (dummy hash for an unknown email). Unit-tested; there is no wall-clock timing test
  because it would be flaky.
- Login accepts passwords of 1..128 code points (not the register minimum), so a later
  policy change does not lock out existing accounts.
- Logs: `auth.login.succeeded` (`userId`, `sessionId`, `transport`) and `auth.login.failed`
  (`transport`). Never the email, password, tokens or cookies (redacted by key in any case).

### Rate limits

`backend/src/middlewares/rateLimit.ts`, `express-rate-limit` 8 with its default `MemoryStore`.

| Limiter | Key | Limit | Applies to |
|---|---|---|---|
| per account + IP | `sha256(normalized email)` + `ipKeyGenerator(req.ip)` | 5 failed attempts / 60 s | `/auth/login` and `/auth/mobile/login` (same instance, shared counter) |
| per IP | `ipKeyGenerator(req.ip)` (IPv6 grouped by /56) | 20 failed attempts / 60 s | same two routes |

- Only failures count (`skipSuccessfulRequests`); a successful login gives its slot back.
  Once the quota is reached, even the right password is refused until the window ends.
- Limiters run before validation, so malformed attempts count. The email is normalized
  (trim + lowercase) like the login schema and hashed in the key, so the store holds no address.
- Over the limit: `429 RATE_LIMITED` with `Retry-After` (seconds) and `RateLimit` draft-8
  headers. `Retry-After` is exposed through CORS.
- `req.ip` depends on `TRUST_PROXY`; production refuses catch-all proxy settings (see
  `config.ts`), otherwise a client could pick its IP through `X-Forwarded-For`.
- **Multi-instance deployments need a shared store** (e.g. `rate-limit-redis`): the
  MemoryStore is per process and resets on restart. Register quotas are Phase 7.

## Revocation

- Logout (Web or mobile) and reuse detection revoke **every row of the family**
  (`revokedAt = now`), so every access token of that login fails `requireAuth` immediately.
- Hook for Phase 5: `backend/src/modules/auth/session-events.ts`. After the revoking write
  commits, and only when rows were newly revoked, the sessions service emits
  `{ userId, familyId, sessionIds, reason: 'logout' | 'reuse' }`. One instance per app
  (`AppOptions.sessionEvents`); the realtime module will `onRevoked(...)` and disconnect
  the sockets authenticated with those sessions. A failing listener is logged and never
  breaks the request.

## Threats (STRIDE, auth flows)

| Threat | Example | Control |
|---|---|---|
| Spoofing | Password guessing, credential stuffing | Argon2id, generic `INVALID_CREDENTIALS`, 5/min per account+IP and 20/min per IP |
| Spoofing | Forged or altered access token, `alg: none` | HS256 only, `iss`/`aud`/`exp`/`maxTokenAge` checked, 32+ char secret, placeholders refused in production |
| Tampering | Role injection at register or `PATCH /users/me` | Strict bodies (unknown field → 400), role forced to USER, role read from the DB |
| Repudiation | Disputed logins or revocations | `auth.login.*`, `auth.refresh.succeeded`, `auth.logout`, `auth.csrf.rejected` logs with correlation id and user/session ids |
| Information disclosure | Account enumeration through login | Same body, status and cost for unknown, wrong and disabled (register still answers 409 by design, see residual risks) |
| Information disclosure | Token or password in logs or DB | SHA-256 of refresh tokens only, Argon2id hashes, key-based log redaction, bodies never logged |
| Information disclosure | Cached credentials | `Cache-Control: no-store` on every `/auth/*` and `/users/me` response |
| Denial of service | Login floods, Argon2 CPU/memory | Login quotas, 19 MiB per hash, 64 KiB body limit |
| Elevation of privilege | Stolen refresh token replayed | Single-use rotation, reuse → family revoked, 7-day absolute lifetime |
| Elevation of privilege | CSRF on cookie routes | Origin allowlist, SameSite=Strict, signed double-submit token bound to the family |

## Residual risks

- `POST /auth/register` reveals that an email exists (`409`), as API-01 requires; register
  quotas arrive in Phase 7.
- In-memory rate-limit counters are per instance and reset on restart.
- An XSS in the SPA could read the in-memory access token and the `mp_csrf` cookie (not
  `mp_refresh`); Web output encoding and CSP are Hanane's scope.
- Expired `Session` rows are kept until a purge job exists (Phase 7).
