# Faster voice startup and durable binder organization

Implemented locally on October 18, 2026. Production deployment and live provider latency/cost measurements remain separate. This change uses the existing API process and PostgreSQL database; it adds no Redis service, paid database, transcript archive, captions, or chat interface.

## What changes for students

Pressing the microphone button starts authentication and microphone setup concurrently. A previous summary save continues independently, with its save status visible, rather than blocking a new call. The app explains that an earlier discussion is still saving; it may not be available as context for that new call yet.

For a confirmed, authorized informational conversation, context preparation can run while the microphone becomes ready. The server returns a one-use opaque ticket, not private context. When preparation is ready, negotiation can reuse it after verifying its account, request parameters, current database revision, permission, and personalization settings. Unready, expired, or invalid preparation falls back to a fresh context load. The microphone is acquired only after the person presses the voice button; cancellation stops late-arriving audio tracks.

After a narrative summary commits to PostgreSQL, binder organization can continue even if the page closes or the API restarts. The binder displays saved content while new points are pending. A failed job retries with backoff; a completed job or duplicate summary save cannot create another set of points. Exhausted jobs show a failure and permit a bounded explicit retry.

**The durability boundary is the saved narrative summary.** Closing the page before the initial summary save is acknowledged can still lose an unsaved conversation. The client keeps its existing pending-save status and temporary recovery behavior. This implementation does not persist raw turns on the server to change that boundary, and it does not claim a save succeeded before the existing summary write succeeds.

## Configuration and migration

All new variables are backend-only. Both switches default off in the Render Blueprint:

| Variable | Enablement |
| --- | --- |
| `ORIGEN_VOICE_PREPARATION=true` | Enables authorized preparation tickets after migration 048. Without the table, preparation falls back to normal startup. |
| `ORIGEN_BINDER_JOBS=true` | Enables durable binder processing after migration 049, with the existing separate maintenance connection configured and grants verified. |

Use the existing migration-owner process to apply 048 and 049, then reapply runtime and maintenance grants. The HTTP runtime must remain a restricted role. Deploy the compatible backend before the web build and verify readiness before enabling switches. Enabling jobs requires `MAINTENANCE_DATABASE_URL` for the already established maintenance identity; it does not require another database or a new credential in the frontend.

The background worker starts inside `npm start` when enabled and stops with the API. No additional worker command, installation package, or cloud startup process is needed. The existing environment installation/start instructions remain applicable. For future cloud tasks, use the existing checkout and the isolated PostgreSQL test wrapper; do not create a worktree or use the production database for these checks.

The migrations do not backfill older discussions. A binder sync can enqueue up to 100 saved discussions in the requested scope that lack organization receipts. Ordinary new summary writes enqueue their job transactionally, regardless of whether a page remains open. Jobs stored while processing is disabled can be processed on later enablement, subject to permission, age, and attempt limits; review the pending cohort/backlog before enabling paid processing.

## Freshness, isolation, and lifecycle

Preparation entries live only in API memory, expire after 12 seconds, and are limited to one per subject and 32 per process. They store no access token. Consumption requires the same authenticated subject and normalized request; the ticket is consumed once. Database revisions change for profiles, linked-student membership, summaries, notes, plans/steps, memories, and suppression records. Thus a changed or deleted source invalidates a prepared snapshot. Closure and current permission are checked again before negotiation. Preparation never negotiates a provider connection or mints live write capabilities.

Each binder job holds source identifiers, language, permission revision, lease metadata, and attempt times. It holds no transcript, narrative copy, credentials, or provider output. Foreign keys cascade removal of its account, student, or source summary. Dispatch uses the restricted maintenance identity for metadata only; processing returns to the account-scoped application identity under the **original** permission revision. A new approval cannot revive a job accepted under an older permission grant.

Workers claim jobs with row locks and `SKIP LOCKED`. A 90-second lease and random lease token fence obsolete workers. Content insertion checks the current lease, source fingerprint, source suppression, account, and permission within the same transaction. Disabling processing before commit discards the result. Deleting or correcting a source during generation cannot recreate its notes. Erasing notes also cancels pending jobs and writes empty source receipts so a late or legacy extraction cannot repopulate erased content.

Automatic retries stop after five attempts, with 10/20/40/80-second backoffs before later attempts. Expired final leases become visible failures. Explicit retries are limited to two resets per job. Persisted attempt timestamps enforce at most 20 claims per account per rolling hour across API replicas/restarts. Provider work has a 30-second total deadline including response-body reading. These bounds limit retries; they are not a dollar spending limiter. Existing source generation and translation calls still have their normal provider costs.

The dispatcher polls every three seconds, runs one job at a time per API process, and releases its maintenance connection before provider work. It does not hold the permission-supervisor maintenance runner while waiting for a model. Jobs older than seven days are removed on enabled worker sweeps; their saved summaries remain. Shutdown aborts unfinished work and leaves it retryable. Logs/metrics record the approved `binder-processing` job name, outcome, timing, and counts without student text or identifiers.

## Verification and operation

From the repository root, the focused suite is:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs npm run test:voice-infrastructure
```

The real browser journey uses the existing local Vite server, real local scoped API/database/worker code, and synthetic auth, microphone, and providers:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env \
  ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules \
  ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium \
  node scripts/voice-infrastructure-smoke.cjs
```

The tests verify parallel audio/auth startup, immediate/late cancellation, expiry, one-use tickets, current profile/action/source revisions, account isolation, competing workers, restart recovery, exhausted retries, permission withdrawal, note erasure, disable during generation, Spanish language preservation, and processing without an open browser. The browser journeys also hold a summary save open while reconnecting, then close the page, restart after a failed organization attempt, and reopen to exactly one saved point.

In the synthetic database test, cold negotiation used 60 database operations and prepared negotiation used seven. This measures reuse of context work, not real time to first speech. Existing voice/onboarding diagnostics remain the source for connection and first-audio measurements; background success/failure/duration is available under the approved job metric. Live provider latency, actual spend, physical microphones, and Safari still need the release evaluation described in [Phase 6](PERSONALIZATION_PHASE_6.md).

For rollback, disable the two switches across all API instances and retain the additive schema and current compatible backend. New calls use fresh context normally, unfinished jobs remain stored, and binder reads/explicit edits remain usable. Disable background processing in every instance before changing its operation; already-started provider work may still incur a charge even when its result is discarded. Do not drop summaries/jobs or reverse migrations to disable the feature.

Current verification evidence is recorded separately in `evals/voice-infrastructure.offline.v1.json`; the earlier phase reports are preserved as historical evidence.


Validation: the complete server suite passed 608 tests with no skips. The final infrastructure suite passed 12 tests, and six service-startup/configuration checks passed after the final cleanup change. The browser suites passed 43 scenarios: six infrastructure, six adaptive guidance, six live memory, and 25 reliability scenarios. Build and logging checks passed; the existing bundle-size warning remains. Migrations 048–049 were applied and reapplied on the existing isolated local test database. An initial legacy suppression fixture was updated to create its stale note before correction, and a browser fixture now uses a normal pointer click that waits for a stable/enabled action button. No assertion was removed to obtain the passing results.
