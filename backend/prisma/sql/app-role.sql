-- Least-privilege application role (spec section 7).
--
-- Run as the migration role (owner of the schema and tables), AFTER
-- `prisma migrate deploy`, against the target database:
--
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v app_password="$APP_DB_PASSWORD" -f prisma/sql/app-role.sql
--
-- The password comes from the psql variable `app_password`; it is never
-- stored in this file. The script is idempotent: re-run it after each new
-- migration so new tables and sequences are covered.
--
-- marketplace_app may only read and write rows of the application tables:
-- no DDL, no CREATE on the schema, no temporary tables, no superuser,
-- no access to Prisma's _prisma_migrations history.

\set ON_ERROR_STOP on

\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'app_password is required: psql -v app_password=... -f app-role.sql'; END $$;
\endif

-- 1. Role: login only, every elevated attribute explicitly off.
SELECT 'CREATE ROLE marketplace_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_app')
\gexec

ALTER ROLE marketplace_app WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  NOINHERIT PASSWORD :'app_password';

-- 2. Database: connect, but no CREATE (schemas) and no TEMPORARY tables.
--    TEMPORARY is granted to PUBLIC by default, so it is revoked from PUBLIC;
--    the owning migration role keeps it.
GRANT CONNECT ON DATABASE :"DBNAME" TO marketplace_app;
REVOKE CREATE, TEMPORARY ON DATABASE :"DBNAME" FROM PUBLIC, marketplace_app;

-- 3. Schema: USAGE only, no CREATE (already the PostgreSQL 15+ default for
--    PUBLIC, stated explicitly here).
GRANT USAGE ON SCHEMA public TO marketplace_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, marketplace_app;

-- 4. Tables: DML only. Start from a clean slate so a previous broader grant
--    cannot survive a re-run.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM marketplace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO marketplace_app;
REVOKE ALL ON TABLE public."_prisma_migrations" FROM marketplace_app;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM marketplace_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO marketplace_app;

-- 5. Future objects created by the migration role get the same DML grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marketplace_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO marketplace_app;
