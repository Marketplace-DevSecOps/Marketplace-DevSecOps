# API conventions: errors, DTOs, pagination, private resources

Spec reference: `docs/responsibilities/Khanfaf_ELKHANFAF.md` section 4 (typed JSON responses, opaque cursors, stable error codes with neutral messages and a correlation id, consistent 404 policy for private resources).

Code: `backend/src/contracts/errors.ts`, `backend/src/contracts/dto.ts`, `backend/src/contracts/pagination.ts`.

## Error responses

Every error has the same body, produced only by the central error handler (`backend/src/middlewares/errors.ts`):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "correlationId": "2b0c6f0e-…",
    "details": [{ "location": "body", "path": "title", "code": "too_small", "message": "Value is too small or too short." }]
  }
}
```

- `code` is stable. Clients branch on it, never on `message`. Codes are never renamed or reused for another meaning.
- `message` is neutral: no ids, submitted values, SQL, stack traces or hints about private data.
- `details` is present only for `VALIDATION_ERROR` and never contains submitted values.
- `correlationId` matches the `X-Request-Id` response header and the server logs.
- Error responses carry `Cache-Control: no-store`.

Code raises errors with `new AppError(code, { message?, details? })`. The HTTP status always comes from the catalogue, so a code cannot be sent with the wrong status. Any other thrown value becomes `500 INTERNAL_ERROR` and is logged server-side.

### Catalogue

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | HTTP-layer rejection not covered by another code. |
| `VALIDATION_ERROR` | 400 | Params, query or body fail the schema (unknown fields, bounds, formats), including an invalid pagination cursor. |
| `MALFORMED_JSON` | 400 | The body is not parseable JSON. |
| `UNAUTHORIZED` | 401 | No valid session: missing, expired, tampered, wrong audience or revoked token. The client goes back to login. |
| `INVALID_CREDENTIALS` | 401 | Failed login: unknown email, wrong password or disabled account, all with the same message. The client shows "wrong credentials". |
| `FORBIDDEN` | 403 | Authenticated but not allowed: role, Origin/CSRF check. Not used to hide existence (see below). |
| `CORS_FORBIDDEN` | 403 | Browser origin outside the CORS allowlist. |
| `NOT_FOUND` | 404 | Unknown route; resource that does not exist, is removed, or is private to another user. |
| `CONFLICT` | 409 | Duplicate (e.g. email), stale `version` on update, `clientMessageId` reused with different content. |
| `PAYLOAD_TOO_LARGE` | 413 | Body above the 64 KiB limit. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Unsupported body encoding or charset. |
| `RATE_LIMITED` | 429 | Quota exceeded; the response includes `Retry-After`. |
| `INTERNAL_ERROR` | 500 | Unexpected failure. |
| `SERVICE_UNAVAILABLE` | 503 | A dependency (database, assistant provider) is down or timed out. |

## Private resources: 404, not 403

When a user asks for a resource that exists but belongs to someone else (another user's conversation, its messages, another seller's product on `PATCH`/`DELETE`, a removed listing), the API answers **`404 NOT_FOUND`**, with exactly the same body as for an id that never existed.

Reason: a 403 would confirm that the id exists, which lets an attacker enumerate ids (OWASP API1:2023, BOLA). With 404 the caller cannot tell "not yours" from "not there".

Rules:

- Lookups filter by owner, participant or visibility **in the query** (`where: { id, sellerId: session.userId }`), instead of loading the row and comparing afterwards. The "not mine" and "does not exist" paths are then the same code path, with the same timing class and the same response.
- `403 FORBIDDEN` is used only when refusing reveals nothing about a specific resource: a role check on a route, a failed Origin/CSRF check.
- An `ADMIN` role gives no implicit access to other users' private resources; the same 404 applies.
- Tests for every route with an id must check that user B receives a 404 identical to the unknown-id case for user A's resource.

## DTOs

A database row never goes directly into a response. Each resource has a mapper in `contracts/dto.ts` (`toProductDto`, `toPublicSellerDto`, `toCategoryDto`, …):

- Fields are copied one by one (allowlist). Rows are never spread (`...row`), so a column added later is not exposed until a mapper lists it.
- Secrets (`passwordHash`, `refreshTokenHash`) and private fields (`email` in a public seller view, `role`, `status`) never appear in a public DTO.
- Prices are sent as a string with exactly two decimals plus an ISO 4217 currency, e.g. `"price": "1250.50", "currency": "MAD"`. Never as a JSON number, to avoid float rounding.
- Dates are ISO 8601 strings in UTC.
- Prisma queries should `select` only the fields the mapper needs; the mapper's input type (`Pick<…>`) documents them.

## Cursor pagination

List routes use cursor pagination with the shared query fields from `contracts/pagination.ts`:

- `limit`: integer 1 to 100, default 20. Out-of-range values are a `400 VALIDATION_ERROR`, not silently clamped.
- `cursor`: optional, opaque to clients, at most 512 characters.
- Response: `{ "items": [...], "nextCursor": "…" | null }`. `null` means the last page.

The cursor is base64url-encoded JSON of the position after the last returned item (for example `{ "createdAt": "…", "id": "…" }`). It is not encrypted and not a permission. The server:

1. rejects anything that is not canonical base64url, not JSON, or does not match the route's position schema with `400 VALIDATION_ERROR` (`details: [{ location: "query", path: "cursor", … }]`), without echoing the cursor;
2. keeps the route's owner/visibility filters in every query, so a forged cursor only moves the position within data the caller may already see.

Handlers fetch `limit + 1` rows; `buildPage` drops the extra row and derives `nextCursor` from the last returned row.
