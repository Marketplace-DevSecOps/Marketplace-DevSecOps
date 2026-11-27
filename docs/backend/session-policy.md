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
