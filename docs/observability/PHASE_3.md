# Phase 3 — dependency timing and maintenance outcomes

Phase 8 bounds successful detailed-span sampling with `OBSERVABILITY_DETAIL_STARTED_AT` and `OBSERVABILITY_DETAIL_EXPIRES_AT`, at most one hour apart. The old flag alone now leaves detailed sampling disabled; see [RUNBOOKS.md](RUNBOOKS.md).

Implemented locally October 16, 2026, on baseline `4a1685f253971fd3b17123cb37321728b6ad36f6`, preserving the uncommitted phase 1 and phase 2 implementation. No production database, customer conversations, cloud settings or external telemetry processor were accessed. Nothing has been committed, pushed or deployed.

Subsequent [phase 4](PHASE_4.md) adds migration 042 and optional central delivery with separate storage/erasure roles. Follow its additional deployment prerequisites when releasing the combined changes.

## What is measured

`server/observability/dependencies.mjs` provides explicit provider and database adapters. It does not patch global fetch or pg. Approved sites include summary generation/overview/review, topic-note generation, voice negotiation, admissions/finance research, chat, history transactions, note transactions and permission reads.

Provider events separate response-header time from body-reader time. The original request options and abort signals pass through unchanged; permission-aware readers run before a successful body event. Permission withdrawal after headers still rejects the body. HTTP errors, request/body failures, timeouts and cancellation produce safe terminal outcomes. A completed provider body is transport evidence, not proof of a valid answer or committed summary.

Configured model names must match the checked-in registry; other values become `other`. Only numeric input/output/total token fields explicitly returned in JSON usage are accepted. Missing usage is `unknown`, never zero. No response model, URL, arguments, prompts, output text, provider IDs or body objects enter these events. Browser Realtime observations remain client-reported and are not billing evidence.

History and note transactions separately time acquisition, aggregate execution and COMMIT. Their terminal event is emitted once on release, and a failed commit cannot become a completed transaction. Row counts become coarse buckets. Permission checks already inside a transaction use a separate execute-only timer without acquiring another connection or changing transaction/permission scope; acquisition time is unavailable for that timer.

Each attempt is tracked in a bounded process-local registry. A minute sweep marks attempts older than five minutes `unknown`, once, even if a late body subsequently arrives. It also emits a missing-outcome indicator. This cannot reconstruct starts lost with a dead process; durable cross-process stale-start analysis depends on the phase 4 store. Existing transaction records remain authoritative.

## Metrics and sampling

`server/observability/metrics.mjs` counts outcomes before optional detailed-span sampling and sink delivery. Fixed API/database/job histogram bounds are 50, 100, 250, 500, 1,000, 2,500, 5,000, 15,000, 45,000 and 90,000 ms, followed by overflow. Provider bounds start at 1,000 ms. Labels are limited to reviewed family, operation/route and outcome enums. There are no per-user, request, operation-ID, session, upstream-ID or arbitrary-model labels.

Counters/histograms are currently process-local through `metrics.snapshot()` and reset on restart. No public metrics endpoint or agent access was added. Runtime health records expose bounded RSS/heap, event-loop delay, API pool total/idle/waiting and logger depth/drop gauges each minute. The supervisor records hangup backlog and oldest observed pending age. Jobs record outcome, duration, affected-row count, DELETE count, query count and time since last success when known. A job's first failure has no invented previous success.

`OBSERVABILITY_DETAILED_SPANS` defaults off. When enabled, successful detailed spans are selected deterministically at 10% using the server operation ID, or request trace when no operation is mapped. Selection stays stable for mapped retries. Required terminal outcomes are recorded at probability 1; failed detailed terminals are retained within the existing bounded sink. A failed terminal without a sampled start is labeled `terminal-only`, not a complete trace. Sampling probabilities are numeric fractions preserved by the schema. Turning off detailed spans leaves counters, safe outcomes and audit behavior intact.

## Separate maintenance identity and bounded work

Startup now requires `MAINTENANCE_DATABASE_URL` whenever an application database is configured. Its URL must use a different login on the same database/host/port. It creates a separate pool capped at **one connection**, leaving the five HTTP connections independent. There is no fallback to HTTP or migration credentials. An API-only database object is still passed to request handlers.

`grantMaintenanceAccess` grants reviewed table reads/deletes, a small set of UPDATE columns, existing subject/account lock access and the existing RLS account function. Startup rejects ownership, elevated roles, role memberships, unapproved table/column writes, missing expected grants, missing required RLS, or missing migration 041. Existing institution tables without RLS retain their existing security model. This is a trusted internal cleanup credential: some required table reads can access private records under the established maintenance/account policies. It must never be given to a diagnostic agent, runner or staff log viewer.

Each named task acquires a PostgreSQL session advisory lock on that same dedicated connection. Another process reports `skipped-lock`. The runner reuses the leased connection, while repositories retain separate transactions and their transaction-local RLS purpose. Connection errors invalidate the lease; subsequent work stops. The connection is released in `finally`, and PostgreSQL releases its locks when a connection is lost. Shutdown stops timers, cancels queued work, drains the active chain and closes both pools within the existing service shutdown deadline.

Cleanup is sequential, with a separate result for each of 16 named tasks. Failure of one task does not prevent later tasks. Reviewed simple maintenance DELETE/UPDATE statements retain their original predicate/triggers and are bounded to 250 rows per statement. Orphan review deletion is explicitly bounded too. Opt-in summary expiry considers at most 50 accounts with expired content per sweep; unfinished work remains eligible for the next sweep. Cascading child rows and candidate scans are not bounded by the parent-row limit; statement timeout remains the database backstop. This is incremental cleanup, not a guarantee that a large backlog disappears in one hourly run.

Permission termination keeps durable call rows until successful hangup and removal. Migration `041_permission_hangup_progress.sql` adds first pending time and a capped attempt count, with a maintenance-purpose UPDATE policy; maintenance grants allow only those new columns on the call table. No call IDs enter the logs. Batches process at most 100 invalid calls, HTTP hangup retains its five-second timeout, and the full remaining invalid-call count is measured separately. Oldest pending age is omitted when no pending timestamp exists; unattempted work is not assigned a fabricated age. Multiple failed provider calls can delay a batch and other work in the one-connection pool; inspect backlog and pending age rather than treating the two-second timer as a termination SLA.

## Deployment and rollback

Prepare database configuration **before deploying this revision**; missing maintenance configuration deliberately fails startup.

1. Use the existing migration job and separate `MIGRATION_DATABASE_URL` to run `npm run db:migrate`, applying 040 if needed and 041. Never overwrite applied migrations.
2. Provision a fresh restricted LOGIN on that database through the operator process. It must not own objects, inherit other roles or have elevated attributes. Do not create it by reusing the HTTP login or copying the HTTP role's membership.
3. In the provisioning environment only, set `MIGRATION_DATABASE_URL` and `DATABASE_MAINTENANCE_ROLE`; run `npm run db:grant-maintenance`. Run `npm run db:grant-runtime` if phase 2 grants are not already installed. Remove migration credentials from the API environment.
4. Configure the API's restricted `DATABASE_URL` and the distinct `MAINTENANCE_DATABASE_URL`, using the same TLS policy as the current database connection. Check `npm run db:check-runtime` and `npm run db:check-maintenance`. These commands require the target schema to be `public`, as in production.
5. Keep `OBSERVABILITY_DETAILED_SPANS=false` for the first rollout. Phase 2 operation mapping has its own activation flag and readiness requirements. Run `npm run check:production`, then deploy through the normal release workflow. Do not use customer data for a smoke test.
6. Verify synthetic provider timeout/body failure, database commit failure, permission withdrawal, skipped maintenance locks, job failures and successful expiry. Verify actual release identity and absence of private markers at the deployed sinks. Review database connection capacity across all instances: this phase adds one connection per API process, not one per task.
7. Before enabling detailed spans broadly, compare the same staging workload with them off/on and run the planned ten-minute unavailable-sink exercise. Local short-run measurements below do not establish those production budgets.

Rollback detailed instrumentation by setting `OBSERVABILITY_DETAILED_SPANS=false`; safe outcome counts remain. For a code rollback, retain the additive columns and confirm only one compatible cleanup/supervisor implementation runs per process. Earlier code may run legacy cleanup on its HTTP pool, so retain that release's required permissions. Do not disable expiry, permission supervision or required security audit as a logging workaround. Provisioning/startup errors use fixed categories and do not print credentials.

## Verification and limits

- Final full suite against disposable local PostgreSQL: **515 passed, zero failed, one skipped** (516 tests). The existing cohort-query test skipped independently of these new tests.
- Final focused suite after model, privilege and schema checks: **25 passed, zero skipped or failed**. This includes actual two-process PostgreSQL advisory-lock contention, all maintenance task grants, 250-row batching and rejection of excess privileges.
- A further four-test maintenance run passed with no skips, including actual expired-summary removal, durable failed-hangup progress followed by a successful retry, and the actual API entry point against a fresh synthetic database with two restricted logins; all 14 startup cleanup tasks completed.
- Production TypeScript/Vite build passed with existing Auth0 directive and bundle-size warnings. Logging-policy and whitespace checks passed.
- Dependency tests cover 429/5xx, abort/timeout, headers vs body, unknown usage, permission revocation after response, pool failure, commit failure, stalled/missing outcomes, immutable correlation, label cardinality and private-marker exclusion. Job tests cover connection loss, shutdown and skipped-lock evidence.
- `node --expose-gc scripts/benchmark-observability.mjs` ran 1,000 synthetic HTTP requests per mode at 1, 10 and 25 concurrent clients, including mock provider/body and database transaction work. Added local p95 server time was **0.093 / 0.089 / 0.127 ms**, respectively (approximately 72% / 101% / 206% over the tiny submillisecond mock baseline). These are not real provider/database latency figures.
- The short saturated-sink check accepted 256 records, held 98,816 encoded bytes, dropped further writes and grew RSS by approximately 0.16 MiB after warmup/explicit GC. An initial cold allocation run grew RSS by approximately 23.3 MiB; it was not treated as a passing warm-state measurement. The ten-minute staging outage/RSS budget remains a deployment validation condition.
- The existing recovery-test failure recorded in phase 1 remains unresolved and outside this change. No new gateway, external log store, agent capability or runner was introduced.

The disposable PostgreSQL cluster and synthetic temporary files are removed after verification. This phase improves technical evidence; it cannot establish what someone heard, reconstruct lost browser reports or prove user abandonment.
