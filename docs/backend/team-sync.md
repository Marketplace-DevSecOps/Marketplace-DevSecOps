# Team sync: Docker/CI (Abdelilah) and mobile contracts (Anas) vs backend

Date: 2026-11-27, backend at `0a7713c` on `develop`. Scope: teammates' work since `bee4394`
(Abdelilah `28804bb`, `fdae987`; Anas `745a9f5`, `6939a03`, `fed7a7f`, `bb74f25`, `7271595`).
Backend contracts referenced: `backend/src/contracts/{openapi.yaml,errors.ts,dto.ts,pagination.ts}`.

Per spec section 11 the backend contract is authoritative. Anas owns the mobile session transport
interface and the messaging protocol (conversation/message schemas, rooms, resync), so his decisions
there are adopted by the backend when they fit the spec. Teammates' files are not edited by the
backend; every change they need is listed in [Recommended changes](#recommended-changes).

## A. Docker Compose and Dockerfile

Files: `docker-compose.yml` (created by Mohamed in `eae1d4c`, extended by Abdelilah in `fdae987`),
`backend/dockerfile` (Abdelilah `28804bb`, fixed by Anas `bb74f25`), `backend/.dockerignore` (Anas `bb74f25`).

There is one compose file, so there is no service-name conflict. Abdelilah added a `backend` service
next to the existing `db-dev` and `db-test`.

| Item | Value | Compatible with the backend? |
|---|---|---|
| Services | `backend`, `db-dev`, `db-test` (project `marketplace`) | Yes. `db-test` is in the test-DB guard host allowlist (`tests/helpers/testDbGuard.ts`). |
| Ports | backend `127.0.0.1:3000`, db-dev `127.0.0.1:${POSTGRES_PORT}`, db-test `127.0.0.1:${POSTGRES_TEST_PORT}` | Yes, loopback only. |
| Interpolation | `${POSTGRES_*}` from the root `.env` or `--env-file backend/.env` | Yes, same variables as `backend/.env.example`. |
| Backend env | `env_file: backend/.env`, then `NODE_ENV=development`, `PORT=3000`, `DATABASE_URL=…@db-dev:5432/…`, `DATABASE_URL_TEST=…@db-test:5432/…` | Yes. The URLs differ, the test name contains `test`, and `CORS_ORIGINS`/`TRUST_PROXY` come from `backend/.env`. |
| Image | `node:24-bookworm-slim`, `npm ci` (dev deps included), `prisma generate`, `tsc` build, `CMD node dist/server.js` | Builds and runs. Prisma 7 config loads because `prisma.config.ts` is copied before `npm ci` (postinstall runs `prisma generate`). |
| `.dockerignore` | excludes `.env*`, `node_modules`, `dist`, `src/generated` | Yes. The client is generated in the Linux image, and no secret enters the build context. |

Problems found:

1. **Migrations are never applied to `db-dev`.** The image starts `node dist/server.js` directly. On a
   fresh volume `GET /api/v1/categories` fails with 500 until someone runs
   `docker compose run --rm backend npm run db:migrate:deploy`. The script exists (`db:migrate:deploy`);
   compose or the docs need to call it.
2. **`docker compose up -d` now also builds and starts the backend.** Before `fdae987` it started only
   the databases. Developers who run the API with `npm run dev` should start only the databases:
   `docker compose --env-file backend/.env up -d --wait db-dev db-test`. Otherwise the container takes
   port 3000.
3. **The dev backend depends on `db-test`.** `depends_on` waits for both databases, so the dev API
   cannot start without the test database. Only the test commands need it.
4. **The image runs as root and ships dev dependencies, npm and the TypeScript sources.** There is no
   multi-stage build, no `USER node` and no `npm ci --omit=dev` runtime stage. This is also why Trivy
   fails (section B).
5. Minor: Abdelilah's rewrite dropped the header comment that documented the compose usage.
   `.gitignore` gained `.git` (has no effect) and `.npmrc` (good).

## B. CI workflow (`.github/workflows/ci.yml`)

The `build-test-security` job copies `backend/.env.example` to `.env` and `backend/.env`, builds the
image, starts `db-dev` and `db-test`, then runs `npm run test:db`, `npm run typecheck` and `npm test`
inside the container with `NODE_ENV=test`, and finally runs Trivy on `marketplace-backend:latest`.

| Backend need | Provided by CI? |
|---|---|
| Real PostgreSQL for DB integration tests | Yes (`db-test` container on the compose network). |
| `DATABASE_URL`, `DATABASE_URL_TEST` | Yes (compose `environment`, hosts `db-dev`/`db-test`). |
| `CORS_ORIGINS`, `TRUST_PROXY`, `BODY_LIMIT`, `LOG_LEVEL` | Yes (from the copied `.env.example`). |
| `NODE_ENV=test` | Yes (`-e NODE_ENV=test`). |
| typecheck | Yes. |
| tests | Yes. `test:db` is redundant because `npm test` already resets the DB in `globalSetup`, but it does no harm. |
| build | Indirectly, through `RUN npm run build` in the Dockerfile. |
| **lint** | **No.** `npm run lint` is never run. |

Actual results on GitHub Actions (`gh run list --branch develop`): every run since `bb74f25` fails.
For run 46040089841 on `0a7713c`, typecheck passes, the migration applies and **19 test files / 148
tests pass**. Only the Trivy step fails. The `mobile` job passes (57 tests) and SonarQube is skipped
because it is not configured. The earlier run on `fed7a7f` failed at "Build Docker images" before
Anas's CI fix.

The Trivy report (artifact `trivy-backend-0a7713c…`) lists HIGH/CRITICAL findings from three sources:

| Finding | Source | Owner of the fix |
|---|---|---|
| 39 Debian OS packages (38 HIGH, 1 CRITICAL) | `node:24-bookworm-slim` base layer | Abdelilah (base image) |
| `brace-expansion` 5.0.9 (2 HIGH), `undici` 6.28.0 (4 HIGH) | `/usr/local/lib/node_modules/npm`, the npm bundled in the base image (checked inside the built image) | Abdelilah (do not ship npm in the runtime stage, or update it) |
| `effect` 3.20.0 (1 HIGH, ReDoS CVE-2026-121707, fixed in 3.22.1) | `backend/package-lock.json`, pinned by `@prisma/config` 7.10.1 (also reported by `npm audit`) | Mohamed (backend), see "For the backend" below |

So the pipeline would pass for the backend tests, but the job stays red until the image is hardened
and `effect` is patched.

## C. Mobile contracts (Anas) vs backend contracts

Sources: `mobile/src/schemas/api.ts`, `mobile/src/services/*.ts`, `docs/anas/rest-mobile.md`,
`docs/anas/messagerie-temps-reel.md`, `docs/anas/client-api-mobile.md`.

### Matching

- Error body `{error:{code,message,correlationId,details?}}`, the 13 codes and their HTTP statuses
  (`mobile/src/services/errors.ts` mirrors `contracts/errors.ts`), `FieldIssue` shape, `X-Request-Id`.
- Pagination: `limit` 1..100 (default 20), `cursor` base64url ≤ 512, `Page<T> = {items, nextCursor}`.
- Price: string `^(0|[1-9]\d{0,6})\.\d{2}$`, 0.01..1000000.00, `currency` `MAD`.
- UUID ids: mobile requires v4. Prisma `uuid()` and the seed ids are v4.
- Dates: ISO 8601 UTC with milliseconds (`toISOString()`).
- `CategoryDto {id,label}`, `PublicSellerDto {id,displayName}`, `ProductDto` (all fields).
- Mobile auth paths `/auth/register`, `/auth/mobile/login|refresh|logout`, body `{refreshToken}` for
  refresh/logout, logout `204`. Success statuses (201 register, 200/201 conversation and message).
- `MessageDto` field names: `id, conversationId, senderId, body, clientMessageId, seq, createdAt`.

### Mismatches

Note that every mobile response schema is a `z.strictObject`. Any extra field breaks parsing, so the
backend cannot add a field without breaking the app.

| # | Topic | Backend (openapi) | Mobile (Anas) | Which side changes |
|---|---|---|---|---|
| 1 | `GET /categories` (implemented) | `{items:[{id,label}]}`, bounded list (≤ 100), no `nextCursor`, query ignored, sorted by label | `Page<CategoryDto>` with `nextCursor` required; sends `limit`/`cursor` | **Anas.** Spec API-14 asks for a bounded list. Today the real API response is rejected as `invalid_response`. |
| 2 | `CurrentUser` (register, `/users/me`, inside sessions) | `{id,email,displayName,role,createdAt}` | strict `{id,email,displayName}`; doc excludes `role` | **Anas** accepts the extra fields (non-strict parse). To confirm in Phase 3. |
| 3 | Mobile login response | `MobileSession {accessToken, expiresIn, refreshToken, user}` | `{user, tokenType:'Bearer', accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt}` | **Phase 3 decision (Mohamed).** Section 11 gives Anas the mobile session transport, and absolute expiries suit SecureStore. Recommendation: adopt Anas's shape for the `/auth/mobile/*` routes in Phase 3. Otherwise Anas switches to `expiresIn`. |
| 4 | Mobile refresh response | `MobileTokens {accessToken, expiresIn, refreshToken}` (no user) | same full session as login (with `user`) | Same Phase 3 decision as #3. |
| 5 | `RefreshTokenRequest.refreshToken` | max 256 | max 4096 | Compatible (backend is stricter). Anas may lower it to 256. |
| 6 | Login password | 1..128 | 12..128 (register policy reused) | **Anas**: login should accept 1..128 so that a future policy change does not lock out existing accounts. |
| 7 | `GET /products` `q` | 1..100 | 1..120 code points | **Anas** → 100. |
| 8 | `Conversation` DTO | `{id, productId, role, counterpart, lastMessageSeq, createdAt, updatedAt}`, no message content | `{id, productId, buyer, seller, lastMessageSeq, lastMessage: Message\|null, createdAt, updatedAt}` | **Phase 5 decision, leaning backend.** Anas owns the conversation schemas (section 11), and participants may see the last message. The spec test "absence de fuite du dernier message" concerns non-participants. To validate with Hanane before Phase 5; until then the backend skeleton stays. |
| 9 | Buyer = seller on `POST /conversations` | `400` | `403 FORBIDDEN` | Phase 5 decision. The mobile app handles both. |
| 10 | Message history resync | `cursor`, `limit` only (strict query, so `afterSeq` would be a 400) | `afterSeq` 0..2147483647, exclusive with `cursor` | **Backend adopts** (Anas's resync protocol). |
| 11 | `clientMessageId` | string 1..64 | UUID v4 | **Backend adopts** UUID (fits `varchar(64)`). |
| 12 | Message body rules | 1..2000 | CRLF/CR → LF, trim, 1..2000 code points, 8 KiB serialized REST body | **Backend adopts**, documented now and enforced in Phase 5. |
| 13 | Cookie header on `/auth/mobile/*` | ignored | proposes `400 BAD_REQUEST` | Phase 3 decision. Ignoring the cookie already meets spec 3.3. |
| 14 | CORS for Expo Web | allowlist `http://localhost:5173` only; exposes `X-Request-Id` only | needs the Expo Web origin; asks to expose `Retry-After` | **Backend**: add `http://localhost:8081` to the dev example now. Expose `Retry-After` with the quotas in Phase 7. |
| 15 | Socket.IO protocol (`conversation:join/leave`, `message:send`, `message:created`, `SocketAck`, handshake `auth.accessToken`, `connect_error` `err.data = ErrorBody`) | not specified yet | proposed in `messagerie-temps-reel.md` | **Backend adopts in Phase 5** (Anas owns the protocol). It uses the backend error catalogue unchanged. |

## Recommended changes

### For Anas (mobile/, docs/anas/)

1. Categories: parse `{items: CategoryDto[]}` (max 100) without `nextCursor`, and stop sending
   `limit`/`cursor` to `/categories` (#1). The mock adapter needs the same change.
2. Parse responses with `z.object` (unknown keys stripped) instead of `z.strictObject`, so additive
   backend fields do not break the app. Keep strict schemas for request inputs.
3. `CurrentUser`: accept `role` and `createdAt` (#2).
4. Login input: password 1..128. Keep 12..128 for register (#6).
5. Products search: `q` max 100 (#7).
6. Optional: `refreshToken` max 256 (#5).
7. Wait for the Phase 3 decision on the mobile session shape (#3, #4) and the Phase 5 decision on
   `Conversation` (#8, #9) before wiring the screens.
8. `docs/anas/client-api-mobile.md` says the backend mounts only `/health`. `/categories` is
   implemented since `3459b8c`.

### For Abdelilah (Dockerfile, docker-compose.yml, CI)

1. Harden the backend image so Trivy passes: multi-stage build (build stage with dev deps → runtime
   stage with `npm ci --omit=dev`, `dist/`, `prisma/`, the generated client), a patched base
   (e.g. `node:24-trixie-slim` or a distroless/alpine Node 24 image, re-scanned), `USER node`, and no
   npm in the runtime stage, or at least an up-to-date one (removes `brace-expansion`/`undici`). Run
   the tests in the build stage (or a dedicated `test` target), because the runtime stage will no
   longer have Vitest.
2. Apply migrations before the dev API starts: a one-shot `migrate` service
   (`npm run db:migrate:deploy`, `depends_on: db-dev healthy`) that `backend` waits for
   (`condition: service_completed_successfully`).
3. Remove `db-test` from the `backend` service's `depends_on`. Keep `DATABASE_URL_TEST` for the CI
   `run` commands.
4. CI: add `npm run lint`, for example
   `docker compose run --rm --no-deps -e NODE_ENV=test backend npm run lint`. It needs the sources and
   dev deps, so run it in the build/test stage once the image is multi-stage. Drop the redundant
   `npm run test:db` step, or keep it as an explicit migration check.
5. Restore a short usage comment in `docker-compose.yml` (databases only vs full stack).

### For the backend (Mohamed), handled in this sync

1. Patch `effect` to ≥ 3.22.1 through an npm `overrides` entry (Trivy and `npm audit` HIGH).
2. OpenAPI: `afterSeq` on `GET /conversations/{id}/messages`, UUID `clientMessageId`, body
   normalization rules (#10–#12).
3. Dev `.env.example`: allow the Expo Web origin `http://localhost:8081` (#14).
4. Deferred: mobile session shape (Phase 3), `Conversation` DTO and buyer = seller status (Phase 5),
   Socket.IO contract (Phase 5), `Retry-After` exposure (Phase 7).
