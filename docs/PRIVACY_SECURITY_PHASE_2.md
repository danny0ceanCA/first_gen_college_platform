# Conversation privacy phase 2: account and student isolation

Implemented locally; production role provisioning, migration, deployment, and a production canary are not yet performed. This phase adds defense against an accidentally omitted ownership predicate. It does not establish end-to-end encryption or protection from a compromised backend, database owner, or provider.

## Ownership contract

1. The HTTP gateway verifies the Auth0 token and issuer. Only its `sub` establishes the asynchronous request context; body fields and model tool arguments cannot choose an account or database purpose.
2. Each private repository starts a transaction and calls `guardAccountTransaction`. Its subject must match the request context. Account IDs are resolved from the authenticated subject; existing account/student predicates and composite foreign keys remain in place.
3. A restricted PostgreSQL connection receives transaction-local subject, subject hash, and purpose settings. COMMIT and ROLLBACK clear them. Releasing an unfinished transaction destroys that connection. Missing context sees no private rows.
4. Migration 035 enables row-level security on accounts, students, and every existing `account_id` table. It also protects family links, invitations, closure receipts, and subject locks. `USING` and `WITH CHECK` protect reads and writes. Startup rejects unprotected account tables added later.
5. The API never runs migrations. Startup rejects a superuser, BYPASSRLS, elevated role membership, table/function owner, schema creator, TRUNCATE authority, or migration-table writer. Production configuration rejects a migration credential in the API environment.

Account-owned resources covered: student profiles and annotations; student/family summaries and deletion reservations; topic notes, translations, extraction receipts and source references; plans, steps, sources, note links, creation receipts and revisions; saved sheets and receipts; guidance sessions, segments, tool execution records and attribution; progress observations/feedback; onboarding and activity metadata; account downloads and closure.

`null` student scope means that account's family workspace. Student IDs are local to an account; identical IDs in two accounts do not connect them. Voice context and focused note/action selection still require the exact account/student pair. A linked profile has its own local ID, notes and conversation history.

## Intentional cross-account paths

- **Family sharing:** owner-executed functions expose only the existing academic allowlist (`name`, `stage`, `interest`, `gpa`, `color`, `institutions`, `entry_term`, `school`, `activities`, `goals`). They validate the caller's membership or a live invitation token, pin their SQL search path, and have no PUBLIC execution grant. Private `needs`, `notes`, summaries, plans, notebooks and sheets are excluded. Unlinking snapshots academic fields only. Linked edits continue recording academic change observations for the owner.
- **Administration:** only the existing authenticated admin gate enters reporting context. Separate read-only views expose summary/profile IDs and dates for counts, never summary prose, sources, student names or annotations. Other reporting policies expose the existing operational metadata and bounded technical reviews. Granular staff roles/MFA remain phase 3.
- **Retention:** only the scheduled server job establishes retention context. Policies permit the existing bounded cleanup operations; HTTP requests cannot enter that context. CLI aggregate reports use a separate explicit operator-report entry point.
- **Institutions:** membership/inquiry authorization remains in its existing repositories. Institutional affiliation does not establish account or conversation authority. This phase grants no institutional or research access to private conversations.

PostgreSQL owners bypass RLS, which is why the separate credential and startup checks are mandatory. SECURITY DEFINER functions use a trusted pinned schema, with `pg_temp` last. See [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) and [secure function definitions](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

## Deployment order

Use Origen's dedicated database, not the CareSpend database. Take the usual tested backup before migration. No data is copied into research or external systems by this change.

1. In a separate migration/operator environment, set `MIGRATION_DATABASE_URL` to the existing database owner's connection. Set the existing guidance rollout variables there if guidance identity backfill is enabled. Run `npm run db:migrate`. Migration 035 is additive and keeps existing records.
2. Create a dedicated login such as `origen_api` with `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`. Use the provider's secure user/password flow or psql `\password`; do not put passwords in source, chat, or shell history. Do not grant membership in the migration owner or other privileged roles.
3. In that separate operator environment, set `DATABASE_RUNTIME_ROLE=origen_api`, then run `npm run db:grant-runtime`. This grants SELECT/INSERT/UPDATE/DELETE as needed, excludes TRUNCATE/schema ownership, limits link writes to approved functions, and makes reporting views read-only. It revokes PUBLIC CREATE on the application schema and direct PUBLIC grants on Origen tables. Re-run this provisioning step when later migrations introduce tables/functions. The runtime role must already exist.
4. Set the API service's backend-only `DATABASE_URL` to the dedicated runtime login using Render's internal host/TLS settings. Remove `MIGRATION_DATABASE_URL` from the API environment. Run `npm run db:check-runtime` with the runtime connection.
5. Deploy the API, verify `/readyz`, and run a synthetic two-account canary: save/read profile and summary, voice context, export, linked academic edit/unlink, and admin counts. Normal users should see the same product behavior. No Auth0 role changes are required for this phase.

The release intentionally fails to start with an owner credential or an older schema. Do not change DATABASE_URL to the owner to work around a denial. Keep migrations in a separate job or trusted operator session; adding the owner secret to a Render web service's environment would undermine the separation.

Rollback: retain migration 035 and the restricted role. Restore the last verified application release that establishes transaction context, or disable traffic while correcting a policy/grant. An older build without context cannot safely use the new restricted role. Do not disable RLS or restore an owner credential as a routine rollback.

## Verification

Local result on 2026-10-10: all 430 tests passed with the real PostgreSQL 18 test database enabled (no skips), and `npm run build` passed. After the final privilege-check changes, the 13 isolation/configuration checks passed again. Existing Auth0 bundling and chunk-size warnings remain. No frontend behavior was changed by this phase.

Run the full suite against a dedicated disposable PostgreSQL database (never production): set `DATABASE_TEST_URL` and `ORIGEN_TEST_DATABASE_URL` to that database, then `npm test`. The new test creates a synthetic schema and non-owner LOGIN role, applies all migrations twice, grants the runtime privileges, and removes both afterward. It requires a test operator allowed to create/drop schemas and roles.

`server/account-isolation.test.mjs` exercises:

- Identical IDs in different accounts; guessed foreign student, summary, note, plan and sheet IDs; forged ownership/purpose fields at the HTTP boundary.
- Reads/updates/deletes deliberately missing ownership filters; rejected cross-account inserts and reassignment; denied TRUNCATE/DDL; a disabled RLS table rejected by startup checks.
- Linked-family invitation preview/accept, academic edits, private annotations/history, export and unlink.
- Reused pool connections, COMMIT, ROLLBACK, failed queries, unfinished transactions, concurrent accounts, and quote/backslash-containing subjects.
- Repeatable-read context setup without taking a snapshot before serialization locks.
- Admin routes and reporting projections without conversation/profile prose; voice instructions using only the caller's stored context; foreign note extraction blocked before a model call.
- Guidance/tool execution ownership, scheduled retention, and account closure with cascading deletion under the restricted role.

Tests use synthetic content and mocked authentication; no real conversations, external model requests, production credentials or production schema changes are used. A live Render canary and p50/p95 latency comparison at pilot concurrency are still deployment gates. No performance improvement or production isolation verification is claimed.
