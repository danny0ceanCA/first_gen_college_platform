# Private backend logging phase 1

Implemented locally October 16, 2026 against baseline `4a1685f253971fd3b17123cb37321728b6ad36f6`. This phase introduced no migration, cloud service, external log processor or agent access. Subsequent operation correlation and its migration are documented in [phase 2](PHASE_2.md).

## Event boundary

`server/observability/event-catalog.mjs` defines finite event names, per-event permitted fields, enum values, numeric bounds and severity. It has no Node dependencies and can supply browser-safe enum definitions later. `event-schema.mjs` constructs new immutable records from own data properties; it does not serialize arbitrary objects, inherited properties or getters. Unknown events become a fixed rejection category. Every emitted record has schema version 1, server event ID/time, service, environment, release, boot instance ID, producer and evidence provenance. Records are bounded to 4 KiB.

For compatibility, existing names such as `api_request`, `database_error` and `session_start` remain explicit catalog entries. Later phases may add the plan's more detailed stage events. This phase does not claim to observe those stages yet.

Browser observations retain their finite event/code/technical values and are marked `browser` / `client_reported`. Raw session, attempt, response, call and client event IDs are excluded even when UUID-shaped. Server request IDs come from the request wrapper; client data cannot supply request context. Provider request IDs are also omitted from operational output until a dedicated trusted provider-field boundary is implemented. Existing account-scoped quality storage remains governed by its own validation and lifecycle.

`error-codes.mjs` uses a reviewed finite SQLSTATE set and technical error categories. `response-codes.mjs` is a checked-in finite compatibility vocabulary for server responses. New codes must be reviewed and added explicitly; these lists are never built from user/error text at runtime. The diagnostic boundary discards audio, transcripts, summaries, profiles, credentials, arbitrary URLs, raw errors, stacks, SQL, caller severity and arbitrary metadata.

## Integration

The API, privacy-monitor output, startup/shutdown, database-pool errors and onboarding tracking failures use the shared logger. `X-Request-ID`, CORS exposure, safe route names, no-store headers and probe suppression are preserved. `req.setDiagnosticCode(code)` lets new handlers mark safe error categories without body inspection. Existing handlers use a finite-code compatibility adapter.

Startup validation and connection creation are inside a safe error boundary. Unexpected fatal errors still terminate the process, using a fixed crash category with bounded flushing rather than printing the error object. A broken logging stream is contained by its writer and does not trigger the fatal handler.

Release identity comes from `RENDER_GIT_COMMIT`, `APPLICATION_REVISION` or `GITHUB_SHA` and must be a full hexadecimal revision. Unknown/invalid configuration becomes `unknown`; the API startup emits a configuration warning. No environment values are dumped. Render supplies the deployment commit when configured normally; verify it on rollout.

## Delivery and local expiry

Each sink has at most 256 pending records and 1 MiB of encoded data, including the in-flight record. Only one sink call runs at once. A write that stalls past one second is reported as timed out; no overlapping replacement write is started while it remains unresolved. New records are dropped when capacity is exhausted. Queue statistics expose accepted/dropped/failed counts, last safe reason and pending bytes. Gap reports are rate limited; if the sink is unavailable, a report can only be delivered after capacity recovers and another log attempt occurs. This is best-effort observability, not a durable audit ledger.

Flush waits at most two seconds within the existing ten-second shutdown deadline. The local `.camino-logs` writer uses the same event boundary and queue policy. It rotates before exceeding two 2,000,000-byte files, removes files older than 24 hours before writes, and checks expiry each minute while running. When the process is stopped it cannot execute expiry; the next writer/expiry tick removes stale files. File creation age is conservative, so a file can expire before its most recent record reaches 24 hours. No old local records are imported or read as agent context.

The stricter filter is the mandatory logging baseline and has no switch that restores arbitrary strings. Optional collection/export/access flags described for later phases remain unimplemented and disabled by absence.

## CI checks

`npm run check:logging` scans production server JavaScript using the TypeScript parser. It rejects console access/aliases, direct stdout/stderr use outside the reviewed sink and direct serialization of raw error variables. Five explicitly listed operator CLI entry points retain their existing output; that output is not approved as agent telemetry. This scan is a regression tripwire rather than a complete JavaScript data-flow proof. Event construction and sink tests provide the runtime boundary.

The application CI workflow now runs this check. New tests are picked up by the existing `npm test` glob.

## Verification

- Targeted logging/privacy checks: 26 passed, zero skipped or failed after final stream handling changes.
- Full server suite: 472 passed, 14 skipped, zero failures. The final catalog-severity and limit-configuration assertions also passed in the targeted suites. PostgreSQL integration tests require a separately configured synthetic database and were not treated as passed.
- Production build passed with existing bundle-size/Auth0 directive warnings.
- `npm run check:logging` passed.
- `npm run test:ops`: two passed, one failed. The same failure was reproduced from an isolated archive of the unchanged baseline: `replay halts on family obligations rather than silently deleting shared students`, missing expected 409 rejection. Recovery behavior was not changed by this phase.
- Synthetic microbenchmark, 1,000 iterations of event construction plus JSON serialization after warmup: p95 0.0172 ms, maximum 0.5137 ms on this machine. This measures the in-process boundary only, not production API latency or external delivery.

Tests exercise secret markers across every declared string field/event, unknown keys/prototypes/accessors, malformed/oversized diagnostics, fake UUIDs, finite SQLSTATE, release/severity ownership, bounded queues, stalled/rejected/throwing sinks, writable-stream errors, safe startup exit, local rotation/expiry, and preserved API request IDs and responses.

## Rollout and rollback

Commit/review and deploy through the normal release process. No database migration is needed. Check a synthetic request for the expected release and server request ID; check that a browser diagnostic is marked client-reported and lacks client identifiers. Check queue/gap behavior and startup categories without using real conversations as fixtures.

If a new event is noisy, remove that event at its producer while keeping the shared sanitizer. If a sink is unavailable, keep serving user requests and inspect safe gap statistics. Do not restore body/error-object logging to troubleshoot the logger. Preserve the mandatory audit availability behavior in staff access; this logger does not replace that audit.

A separate preexisting recovery-test failure and unexecuted real PostgreSQL tests remain release-readiness limitations. This local implementation does not establish production deployment or provider retention settings.
