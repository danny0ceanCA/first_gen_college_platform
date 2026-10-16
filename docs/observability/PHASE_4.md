# Phase 4 — bounded central telemetry and erasure

Implemented locally October 16, 2026, over baseline `4a1685f253971fd3b17123cb37321728b6ad36f6` and the uncommitted phases 1–3. No production records, cloud settings or provider credentials were inspected. No external processor was activated. Changes are not committed, pushed or deployed.

## Data flow and boundaries

The API sends the same validated record and event ID independently to stdout and an in-memory exporter. Export defaults off. No Render workspace log stream, historical log import, session replay, transcript capture, disk spool or generic object payload was added.

`ops/observability/ingest.mjs` is a separate HTTPS service. It accepts only authenticated POSTs to `/v1/batch`, validates the wire contract again and calls a restricted database writer routine. It does not receive application database or AI provider credentials. Requests use certificate verification; redirects and HTTP downgrade are refused. The service terminates TLS itself and checks the actual encrypted socket, rather than trusting forwarded headers. PostgreSQL connections verify TLS too; the sole plaintext database exception requires an explicit synthetic-test flag, test environment and localhost.

Storage uses **three distinct databases**: the existing application database, a telemetry event/metric database, and an independent erasure ledger database. Services reject application/provider secrets in their environment. The erasure worker receives only a restricted application outbox login, a ledger writer and a telemetry deletion capability. It cannot SELECT application tables. A separate external health process uses health-only application/telemetry logins and a ledger-generation reader.

Ingest authenticates with a service-specific bearer credential of at least 32 characters. The previous credential may overlap for at most 24 hours, with an explicit expiry. Current and previous credentials share one per-process request budget. Tokens and authorization headers never enter stored events or error output. Rotate by configuring ingest with new current/old previous, updating API writers, then removing the old credential after the overlap. Configure a cryptographically random URL-safe token, not a human password.

## Cost and delivery limits

- Exporter: 2,000 records / 4 MiB including in-flight records; at most 1,500 low-priority records, reserving 500 slots for failed/warning/security-related operational events. Eviction removes the oldest queued low-priority record first. Busy batches are not evicted while a transport still owns them.
- Batches: at most 100 combined events/metric frames and 256 KiB. Pump once per second, at most two requests in flight, two-second timeout, at most five attempts and 30 seconds total age. Jittered retries honor Retry-After within that deadline; a longer delay exhausts the delivery budget. Authentication/schema rejection is not retried. A transport that ignores abort remains quarantined in its existing slot; replacement requests cannot accumulate behind it.
- There is no durable API spool. A process can lose records not acknowledged by ingest; shutdown flush remains bounded to two seconds. Delivery is best effort, not an audit ledger.
- Stdout and the exporter each have a 3,000-record/minute/process emergency ceiling. Normal traffic uses at most 2,900 slots; the remainder protects gap/health/canary output. Above-budget repeated failures are grouped by finite event/route/code, with occurrence counts and no user/request references. Group memory is bounded to 80 keys. Existing mandatory security audit transactions do not use this sampled/bounded operational pipeline.
- Ingest: 8 KiB headers, 256 KiB body, two-second body deadline, 100 records/batch and 60 authenticated requests/minute/process. The database additionally caps each writer login at 3,000 submitted records/minute across ingest replicas. Expired/invalid data is rejected before storage. These are initial cost ceilings, not throughput guarantees.

Unmapped request-only records remain in safe stdout. They are intentionally excluded from central export because there is no committed account-erasure reference for them. Mapped request records are exported only after operation and request references commit. Runtime/aggregate records and identifier-free metrics can export independently. Exporter statistics distinguish filtering from loss. Central timelines must therefore retain their `best_effort`/unknown-completeness labels.

## Storage, metrics and query behavior

Telemetry migrations live separately under `ops/observability/migrations/`; ledger migrations under `ledger-migrations/`. The migration runner checks immutable SQL checksums. A checked-in catalog compiler supplies finite field rules to a database-side validator; ingest credentials cannot change that contract or insert arbitrary attributes.

Events have fixed envelope/correlation columns and a validated attributes object. Daily UTC partitions are prepared ahead of time. A separate event-ID dedupe table lasts 15 days, so retries across partition boundaries cannot create copies or renew expiry. Ingest records its own receipt time, rejects event times more than ten minutes old or one minute ahead, and never lets delayed delivery extend the original event deadline. Standard events expire within 336 hours; sampled dependency spans within 168 hours. Queries hide expired rows immediately, independently of cleanup. No insertion into historical expired partitions is available to the writer.

Retention runs every minute with a database advisory lock, including when API export is off. It deletes bounded overdue event/dedupe batches, drops fully expired partitions and prepares the next day. Other cleanup statements retain their own finite data lifecycle; statement timeout and external freshness monitoring remain backstops for large backlogs. This does not guarantee physical deletion the instant a TTL is reached; query-time expiry is the access boundary.

Minute metric frames are idempotent by boot instance, sequence, metric key and interval. API snapshots send deltas aligned to UTC minute boundaries; startup/late/unaligned windows are partial. Raw intervals expire after 24 hours. Hourly identifier-free rollups last 90 days and merge histogram counts and sums, never averages of percentiles. Missing sequence coverage becomes unknown; query results never turn missing intervals into zero activity or evidence of user abandonment. Cleanup rolls a bounded number of raw intervals per pass; expired unrolled data can be lost rather than retained indefinitely.

`store.mjs` provides named recent/operation/request and metric reads, not arbitrary SQL or an investigation API. Queries use fixed SQL, a two-second timeout, at most 200 rows, environment-scoped security-barrier views, query-time expiry and an independent ledger freshness check before and after reading. Raw tables are unavailable to query credentials. These credentials are for a future trusted gateway, never an agent. Scope authorization, signed investigation capabilities and audit-before-access belong to phase 5.

## Transactional erasure and restore barrier

Application migration **042** adds bounded private request-reference mapping and an opaque erasure outbox. Account/student/map/request deletion triggers capture operation, trace and request references before cascades remove them. Only server UUIDs/trace references and lifecycle timestamps enter the outbox: no account ID, student ID, Auth0 subject or conversation content. Trigger writes are in the deletion transaction; rollback produces no erasure request. The HTTP and maintenance roles cannot read/write the outbox or execute its worker routines. Owned request references are included in account exports.

Request-reference storage is capped at 1,000 per account and expires with its operation map. When mapping/reference storage is unavailable or capped, requests continue with request-only logging, which central export filters out. This is a diagnostics coverage limit, not a limit on users' conversations or saved notes.

The erasure worker polls the outbox every second in batches of 200. It first appends references to the independent 30-day ledger, then commits local suppression and begins bounded physical deletion, then acknowledges the application outbox. Acknowledgement proves suppression is committed, not that all physical rows have been removed. Retention continues pending physical deletion in bounded batches, and the health view exposes remaining work. Failures leave the batch retryable. Outbox rows expire after 30 days; ledger rows expire 30 days after first ledger receipt, without renewal on retries. By then event TTLs and the approved backup horizon have elapsed. No lifecycle timer depends on an API collection flag.

Local suppression and ingestion serialize on reference locks, so an event that races erasure is either deleted or rejected. Late arrivals matching erased operation, trace or request references remain suppressed. Ledger generation changes make readers/ingest unavailable until suppression catches up. An unavailable ledger also denies reads/ingest; ordinary application requests keep working with bounded diagnostic loss.

The store records the PostgreSQL server-start epoch after ledger replay. A restart/physical restore invalidates that epoch, hiding data until replay runs again. For **logical restores on an already-running database**, the operator must stop readers/ingest and call `telemetry_block()` before restoring, then replay the independent ledger and run expiry before reopening. Never restore the ledger from the telemetry backup. A privileged database owner can bypass these barriers; owner credentials stay outside every service.

The erasure worker applies incremental ledger pages during normal operation and full replay after an unverified restart/restore. It uses no private application tables. Propagation is asynchronous and may lag during outages; the independent check flags outbox work older than one hour. Do not describe deletion as instantly propagated to central storage or to platform/provider logs.

## Roles and activation commands

Complete [DEPLOYMENT_RECORD.template.md](DEPLOYMENT_RECORD.template.md) before creating deployment configuration. Region, plan/cost, TLS, actual backup horizons, staff access, notices and the independent monitor are still unverified. `render.yaml` was deliberately left unchanged.

1. Keep `OBSERVABILITY_EXPORT=false`. Apply application migrations with the existing migration job: `npm run db:migrate`. Refresh `npm run db:grant-runtime` and `npm run db:grant-maintenance`; these require operator credentials and must not run from the HTTP runtime identity.
2. Create separate telemetry and ledger databases with distinct migration owners. With `TELEMETRY_MIGRATION_DATABASE_URL`, run `node ops/observability/manage.mjs migrate`. With `LEDGER_MIGRATION_DATABASE_URL`, run `node ops/observability/manage.mjs migrate --ledger`. These URLs use verified TLS; do not share them with services.
3. Provision fresh restricted LOGINs without ownership, elevated attributes or memberships. For each, set `TELEMETRY_ROLE`, `TELEMETRY_PURPOSE` and `TELEMETRY_ENVIRONMENT`; run `node ops/observability/manage.mjs grant` against the telemetry owner, or add `--ledger` against the ledger owner.

| Database | Purpose | Granted service capability |
| --- | --- | --- |
| Telemetry | `ingest` | Validated ingest routine; fixed health status |
| Telemetry | `query` | Explicit live event/metric/health views only |
| Telemetry | `health` | Health view only |
| Telemetry | `retention` | Fixed expiry/partition/rollup routine; health status |
| Telemetry | `erasure` | Typed suppression/deletion and restore-barrier routines; health status |
| Independent ledger | `ledgerWriter` | Append-only references, bounded replay pages, generation |
| Independent ledger | `ledgerReader` | Generation only |
| Independent ledger | `ledgerRetention` | Fixed expired-row removal and generation |

4. Provision two additional application LOGINs. With the existing `MIGRATION_DATABASE_URL` and `DATABASE_ERASURE_ROLE`, run `npm run db:grant-telemetry-erasure` for the worker. For the separate monitor login, run `npm run db:grant-telemetry-erasure -- --health-only`. Neither receives application table reads or arbitrary deletion authority.
5. Start `npm run telemetry:retention` with `TELEMETRY_RETENTION_DATABASE_URL` and `LEDGER_RETENTION_DATABASE_URL`. Start `npm run telemetry:erasure` with `APPLICATION_ERASURE_DATABASE_URL`, `TELEMETRY_ERASURE_DATABASE_URL` and `LEDGER_WRITER_DATABASE_URL`. These are the restricted roles above, not owners.
6. Start `npm run telemetry:ingest` with its restricted `TELEMETRY_DATABASE_URL`, `LEDGER_READER_DATABASE_URL`, `TELEMETRY_ENVIRONMENT`, `OBSERVABILITY_INGEST_TOKEN`, `TELEMETRY_TLS_CERT_FILE`, `TELEMETRY_TLS_KEY_FILE` and completed `OBSERVABILITY_DEPLOYMENT_RECORD` reference. Optional rotation uses `OBSERVABILITY_PREVIOUS_TOKEN` / `OBSERVABILITY_PREVIOUS_UNTIL`. Optional private database CA uses `TELEMETRY_SSL_CA`. Services refuse shared `DATABASE_URL`, migration or provider secrets.
7. Configure the independent monitor outside the ingest/retention service: run `npm run telemetry:health` at least every minute with `TELEMETRY_HEALTH_DATABASE_URL`, `LEDGER_READER_DATABASE_URL` and `APPLICATION_ERASURE_HEALTH_DATABASE_URL`. Exit 1 means unavailable, no canary for five minutes, no successful expiry for two hours, or erasure backlog older than one hour. Route that exit/status through the operator's external monitor, not through this same telemetry pipeline. No notification integration was activated locally.
8. Run seven days of synthetic staging and the planned ten-minute outage/RSS exercise. Verify cross-environment denial, role separation, real TLS, rotation, expiry, restore replay, partial sink failure, costs and notices in both languages. Current notices are not a claim that this unactivated external processor is already in use.
9. Only then enable API export with `OBSERVABILITY_EXPORT=true`, `OBSERVABILITY_OPERATION_LINKS=true`, `OBSERVABILITY_LIFECYCLE_READY=true`, `OBSERVABILITY_DEPLOYMENT_RECORD`, verified HTTPS `OBSERVABILITY_INGEST_URL` ending exactly `/v1/batch`, `OBSERVABILITY_INGEST_TOKEN`, and the verified `OBSERVABILITY_BACKUP_HORIZON_DAYS` (0–7). The API checks migration 042 and erasure triggers/privileges at startup. Longer backup horizons require a reviewed retention-policy/migration change before activation. Keep detailed-span sampling on its own phase 3 flag.

Rollback: disable API export and restart it. Keep retention, erasure propagation, ledger expiry and external monitoring running. Do not delete the outbox/ledger or restore raw logging. Unexported queue contents disappear with the process. No new agent, log-query gateway, audit store or runner is enabled in this phase.

## Verification

- Full server suite with disposable PostgreSQL: **515 passed, zero failed, one skipped** (516 tests). Existing cohort-query skip remains explicit. Production build passed with existing Auth0/bundle-size warnings.
- Observability suite: **14 passed, zero failed or skipped**, using separate disposable application/event/ledger databases and restricted logins. It covers SQL-side validation, duplicate/late delivery, partition-boundary dedupe, metrics idempotence, row/partition expiry, independent-ledger restore replay, account/student cascade rollback, late request suppression, health-only roles, TLS rejection/success, credential rotation, saturation, retry limits and partial sink success.
- Actual HTTPS tests reject an untrusted certificate, then deliver through TLS using the synthetic certificate as an explicit trust root. Test keys are temporary and removed. The ingest/database integration also tests handler logic with a marked synthetic socket; it does not claim to validate a deployed proxy or provider certificate.
- 100,000-row synthetic dataset, 20 named operation queries returning 100 rows: local **p95 6.62 ms, maximum 42.34 ms**, including ledger freshness checks; bounded to 200 rows / two seconds. Pagination preserves PostgreSQL microsecond timestamps, including when one batch spans multiple pages. These are local measurements, not Render capacity or pricing estimates.
- CI has a separate PostgreSQL observability job and `npm run test:observability`; integration tests skip explicitly without `TELEMETRY_TEST_DATABASE_URL`. The preexisting recovery failure in `test:ops`, documented in phase 1, is not fixed or hidden by this new job.
- Logging-policy/whitespace checks passed. No real production export, seven-day staging, provider backup/TLS/access verification or external monitor activation has occurred. Those are release gates, not completed tests.

Synthetic cluster, test databases, temporary keys and logs are removed after validation. Source and this runbook remain for review.

Phase 5 adds the separately gated [scoped support gateway](PHASE_5.md). Its case tombstones share the independent erasure ledger; use the updated worker before enabling support intake.
