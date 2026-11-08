# Durable research diagnostics — local verification

Branch: `v1.2`. Starting commit: `991d7118adb0545470547c365a3793195dfae08a`. November 7, 2026.

See [design, retention and operating instructions](../DURABLE_RESEARCH_DIAGNOSTICS.md).

## Review basis

Reused the completed full review of the 45 official pages' unique content. Revalidated every manifest checksum before edits: 45 matched, none unavailable. Revisited the saved Responses reference, audit/measurement plan, relevant delegation/session/error/data guidance, and current official API request-debugging guidance. This was not another literal full reread of repeated schemas. The library remains development reference material and is not injected into runtime context.

## Implemented

Durable account-scoped research/job timeline, bounded asynchronous detail collection, provider/client request IDs, model/configuration/budget metadata, classified failures, queue/recovery/reuse/polling observations, and separate delivery/transcript/browser-playback evidence. Research question/report snapshots survive queue expiry behind an explicit owner-authorized export. No timed expiration is attached to the archive; account deletion remains supported.

A diagnostic read endpoint and local JSON report command allow review by call after transient jobs have been removed. Microsecond-preserving cursors prevent repeated/skipped records. Updated migration/runtime/worker readiness and grant instructions are included. Nothing reads this historical archive into the live model.

## Verification

All database tests used a newly initialized localhost PostgreSQL 18 instance containing fictional fixture data, on port 55439. No application or production database credentials were used.

| Check | Result |
| --- | --- |
| Backend research, live measurements and logging/schema checks, with real PostgreSQL fixtures | 145 passed; zero failures/skips |
| Conversation/delivery/adapter/intro/selection/startup/style/presence regressions, including English/Spanish | 411 passed; zero failures/skips |
| Control-socket, live measurement and trace integration run, including English/Spanish and unavailable diagnostic sink | 71 passed; zero failures/skips |
| Final trace/worker/schema check after persistence-failure coverage was added | 23 passed; zero failures/skips; includes all 14 dedicated trace tests |
| Production logging policy | Passed |
| Local CLI export/report JSON smoke check | Passed |
| TypeScript/Vite production build | Passed; existing large-chunk warning remains |

These runs overlap. Their counts must not be added as unique tests.

Important assertions include durable metadata and reports after cleanup and worker reconnection; another account cannot read or insert events for that job; the restricted worker cannot delete traces or read accounts; account deletion purges the archive; provider/client request IDs match the attempt; failed database writes retain call/job correlation; polling failures are distinguishable from provider failures; a stalled sink adds no speech instruction or intro delay; browser reports and transcript classifications remain separate; and pagination returns each event exactly once across a 500-record boundary with submillisecond timestamps.

The migration was exercised only against isolated local schemas. Full paid English/Spanish voice calls were not made. Tests establish application behavior, not production audible quality, latency improvement, or perfect collection during a hard crash/storage outage. Those remain explicit observation limits.

## Deployment boundary

The implementation was initially left uncommitted on `v1.2`, then the user authorized commit/push and production migration/grants. Migration 124 and required new-table grants were applied atomically at `2026-11-08T01:27:04.854013Z` (November 7 in America/Los_Angeles). Both service logins, RLS, restricted worker permissions, and HTTP 200 health/readiness were verified. No main merge, service deployment, new Render service, or environment-variable change was performed. Previously expired logs cannot be reconstructed. Existing transcript/audio retention is not changed.

A pre-existing migration 121 checksum mismatch was detected during preflight and left untouched. Migration 123 matched the repository; only migration 124 was pending and applied. A future full-directory migration run will require separate reconciliation of that historical mismatch.
