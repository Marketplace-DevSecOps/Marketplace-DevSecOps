# Session and credential policy (backend)

Scope: API-01 to API-04 (Phase 3). This document is completed task by task; the
access/refresh token and transport sections are added with the corresponding code.

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
hash computed once (lazily, same parameters) per process (`createDummyVerifier`). A
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
Client handling: on 409 the Web client retries with the cookie set by the winning
request (the cookie jar is shared between tabs); the mobile client already coalesces
refreshes and, on 409, re-reads the token saved in SecureStore.

Tests: `backend/tests/integration/sessions.test.ts` (two concurrent rotations of one token
give exactly one success and one 409, family intact; replay after the window revokes the
family; revoked, expired, disabled-user and unknown tokens).

Follow-up (Phase 7): expired `Session` rows are not purged yet.
