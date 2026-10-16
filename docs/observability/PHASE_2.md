# Phase 2 — private operation correlation

Implemented locally on top of the uncommitted [phase 1 baseline](PHASE_1.md). This document describes the final implementation, activation steps and verification. No production migration, deployment, commit or push was performed as part of this phase.

Subsequent [phase 3](PHASE_3.md) adds migration 041 and a separate maintenance login. When deploying the combined changes, follow its prerequisites in addition to this phase's activation steps.

## Behavior and privacy boundary

Every API request gets a server request ID, trace ID and span ID. A separate diagnostic AsyncLocalStorage carries this context without replacing account isolation or permission context. Completion and close callbacks retain immutable request snapshots after the async context exits. Retention jobs receive their own diagnostic roots.

When `OBSERVABILITY_OPERATION_LINKS=true`, authenticated operations can join retries and related events through a server-generated operation ID and trace ID. The browser sends `X-Origen-Operation`, an untrusted UUID hint. The server resolves it using the authenticated account, verified student or family scope, and finite operation kind: voice, summary, history, notes or onboarding. Headers never grant access or select another account. The response exposes `X-Request-ID` and, when mapping succeeds, `X-Origen-Operation-ID` through CORS.

The private mapping table contains account/student foreign keys, operation kind, client hint, server operation/trace IDs and timestamps. It contains no conversation text. Row-level security restricts reads to the active owner; analytics and institution reporting receive no read policy. Runtime access permits SELECT, INSERT and DELETE, with no UPDATE. Account and student deletion cascade mappings. Account exports include only that account's mappings when the table exists.

Operational records may contain server request/operation/trace/span IDs. Client hints, account IDs, student IDs, raw errors, SQL, transcripts, summaries and credentials stay outside this output. The phase 1 event vocabulary and bounded sinks remain mandatory. These server IDs are correlation references, not anonymous data or authorization credentials; protect access to logs accordingly.

## Limits and failure behavior

- At most 100 new mappings per account in a rolling hour and 1,000 live mappings per account.
- Mappings expire after exactly 336 hours, including across daylight-saving changes. Owner reads exclude expired rows; startup and hourly retention remove them. A stopped process cannot perform cleanup until it resumes.
- Existing operations accept continued events for 24 hours after creation. Repeated hints do not renew that window.
- Mapping acquisition allows two outstanding lookups per process. A connection acquisition times out after 250 ms, but keeps its slot until the underlying acquisition settles, preventing unbounded pending requests. Each mapping SQL statement has a 250 ms timeout; this is not a 250 ms deadline for the whole transaction.
- Missing, invalid, unavailable, expired or capped mapping falls back to request-only diagnostics and a finite gap reason. Logging failure does not block the underlying note save or summary request. Existing authentication, permission, deletion and storage failures still retain their normal behavior.

Browser hints live only in memory, are bounded and expire after 24 hours. Retry identity includes the private session, operation kind, student/family scope and logical operation. Logout, account changes and applicable deletions clear them. Voice scope restarts use a fresh operation. Onboarding batches and completion use their attempt hint.

## Evidence and user references

Summary events distinguish generation from committed persistence, deferred attribution, existing saved results and failures. A generated summary is never logged as saved before storage commits. History and note events describe their own completed or failed operations.

Voice and summary requests can send a bounded browser `operation_response_received` diagnostic joined through the same hint. This is **client-reported HTTP response receipt**. It does not prove that a response body was consumed, audio played, the UI rendered or a summary persisted. Those conclusions require their corresponding evidence.

Actionable voice, summary, notebook mutation and conversation overview/delete errors offer “Copy error reference” in English or Spanish when a valid server request reference exists. Only that UUID is copied. Reference controls become unavailable when the private browser session ends. Generic failures without a server reference remain usable without inventing an ID.

## Activation runbook

Use the existing restricted runtime role and separate migration credentials. Never configure the HTTP service with migration/owner credentials. Run these commands in the normal reviewed release environment, using its secret injection mechanism; do not paste connection strings into documentation or logs.

1. Keep `OBSERVABILITY_OPERATION_LINKS` unset or `false` while deploying the additive code. Phase 1 filtering remains active. Unknown values are rejected by production configuration validation.
2. Set `MIGRATION_DATABASE_URL` for the migration job and run `npm run db:migrate`. Confirm migration `040_diagnostic_operations.sql` applied successfully. Do not edit an already applied migration.
3. With `MIGRATION_DATABASE_URL` and `DATABASE_RUNTIME_ROLE` configured for the provisioning job, run `npm run db:grant-runtime`. This refreshes the existing restricted role's grants, including the new table.
4. Using the service's restricted `DATABASE_URL`, run `npm run db:check-runtime` and `npm run check:production` with the deployment's complete configuration. Confirm the role cannot bypass RLS or UPDATE the mapping table. Verify the release revision, privacy notices, actual log access and retention configuration for the deployment.
5. Enable `OBSERVABILITY_OPERATION_LINKS=true` and restart/deploy the API. Startup checks require the new table, RLS and expected non-update privileges; a misconfigured enabled service fails startup instead of silently claiming correlation is available.
6. Use synthetic accounts and students to verify retry continuity, different-student separation, request references and safe gap behavior. Check that logs contain only the allowed technical fields. Never use real conversation content as a logging fixture.

Rollback: set the flag to `false` and restart/deploy. Request-only logging continues. Keep the additive table and grants in place; retention still removes expired rows. Do not restore raw logging or drop customer data to troubleshoot. Roll back code only to a version compatible with the deployed schema and existing privacy controls.

No external telemetry collector, log-query agent, execution agent or new staff access capability is enabled here. Later phases must implement their own authorization, audit, retention and execution boundaries.

## Verification

- Full server suite with the disposable PostgreSQL database: 506 passed, zero failed, one skipped (507 tests). The separate privacy/guardian/isolation/operation run passed 33 tests with no skips.
- Production TypeScript/Vite build passed; existing Auth0 directive and bundle-size warnings remain.
- Real PostgreSQL tests exercised RLS, scope separation, NULL family scope, concurrent retry identity, caps, expiry, runtime grants, deletion cascades, permission withdrawal and mapping failure alongside successful note persistence. Existing privacy, guardian and account-isolation suites also ran against the disposable local database.
- Browser smoke checks used a temporary synthetic fixture: English/Spanish copy controls, exact copied server UUID, stable retry hints and disappearance after logout passed. This was component/API-client verification, not a full production Auth0/Realtime session.
- `npm run check:logging` and `git diff --check` passed.
- The preexisting `npm run test:ops` recovery test failure documented in phase 1 remains outside this change. It was reproduced on unchanged HEAD; this phase does not claim to resolve release readiness for recovery workflows.

For repeatable PostgreSQL regression checks, point `DATABASE_TEST_URL` at a disposable local database capable of creating isolated schemas and restricted roles, then run `npm test`. The operation test skips explicitly without this variable. Never point these tests at production.
