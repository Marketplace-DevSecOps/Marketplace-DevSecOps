# PostgreSQL roles: application vs migration

Spec reference: `docs/responsibilities/Khanfaf_ELKHANFAF.md` section 7 ("Limiter le rôle PostgreSQL applicatif, séparer les droits de migration").

## Roles

| Role | Used by | Privileges |
|---|---|---|
| Migration role (owner of the schema and tables; `marketplace` in local Docker) | `prisma migrate deploy` / `migrate dev`, `prisma/sql/app-role.sql` | Owns the objects, runs DDL. Never used by the running API. |
| `marketplace_app` | The running API (`DATABASE_URL`) | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the application tables, `USAGE, SELECT` on sequences. Nothing else. |

`marketplace_app` is created with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`. It has:

- `CONNECT` on the database, but no `CREATE` and no `TEMPORARY` (revoked from `PUBLIC` too; the owner keeps them);
- `USAGE` on schema `public`, but no `CREATE`;
- no `TRUNCATE`, `REFERENCES` or `TRIGGER` on tables, and it is not an owner, so `ALTER`/`DROP` fail;
- no access at all to `_prisma_migrations`.

In local Docker the migration role is the container superuser. In a shared or production environment it should be a dedicated non-superuser role that owns the schema; the app role script works the same way.

## Creating or updating the app role

Run the script as the migration role, after migrations, on each database (dev, test, production). The password is passed as a psql variable and is never written in the repository:

```sh
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -v app_password="$APP_DB_PASSWORD" -f backend/prisma/sql/app-role.sql
```

Local Docker equivalent (PowerShell, from the repository root):

```powershell
$pw = Read-Host 'marketplace_app password'
Get-Content backend/prisma/sql/app-role.sql -Raw |
  docker exec -i marketplace-db-dev-1 psql -U marketplace -d marketplace_dev -v ON_ERROR_STOP=1 -v app_password=$pw -f -
```

The script is idempotent: it creates the role only if missing, resets the password and attributes, and re-applies the grants from a clean slate. Default privileges grant DML on tables and sequences that the migration role creates later. Re-run the script after every new migration anyway, so the result does not depend on which role ran the migration. Without `app_password` the script stops with an error before changing anything.

## Connection URLs

- `DATABASE_URL`: the running API connects as `marketplace_app`.
- Migrations and seed: run with `DATABASE_URL` overridden to the migration role for that command only, for example `DATABASE_URL="$MIGRATION_DATABASE_URL" npm run db:migrate:deploy`.

A separate `MIGRATION_DATABASE_URL` is not read by `prisma.config.ts` on purpose. `scripts/reset-test-db.ts` (`npm run test:db`) redirects Prisma to the test database by overriding `DATABASE_URL` only. If the config preferred a `MIGRATION_DATABASE_URL` from `.env`, `npm run test:db` would run `migrate reset --force` against the dev database instead. The local `.env` can keep using the owner role in `DATABASE_URL` until the app is switched to `marketplace_app`.

## Verification (dev Docker database, PostgreSQL 16)

Applied on `marketplace_dev` (container `marketplace-db-dev-1`) with a random password, re-applied a second time (idempotent, exit 0), then run once without `app_password` (stopped with `app_password is required`, exit code 3). Checks made as `marketplace_app` over TCP with scram-sha-256 password authentication:

| Check | Result |
|---|---|
| Role attributes | `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolbypassrls`, `rolreplication` all false |
| `SELECT count(*) FROM "Category"` | OK (4 rows) |
| `INSERT`, `UPDATE`, `DELETE` on `"Category"` (in a rolled-back transaction) | OK |
| `CREATE TABLE evil (id int)` | `permission denied for schema public` |
| `CREATE TEMP TABLE` | `permission denied to create temporary tables` |
| `ALTER TABLE "User" ADD COLUMN` | `must be owner of table User` |
| `DROP TABLE "Message"` | `must be owner of table Message` |
| `TRUNCATE "Session"` | `permission denied for table Session` |
| `CREATE SCHEMA evil` | `permission denied for database marketplace_dev` |
| `SELECT` on `_prisma_migrations` | `permission denied for table _prisma_migrations` |
| Login with a wrong password | `password authentication failed` |
