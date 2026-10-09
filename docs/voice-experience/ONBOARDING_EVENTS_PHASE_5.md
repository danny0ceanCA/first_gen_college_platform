# Onboarding delivery and operations — phase 5

For repeatable checks and rollout verification, see [phase 6](ONBOARDING_EVENTS_PHASE_6.md).

Phase 5 adds a recoverable diagnostic outbox, configurable retention and admin review flags. It makes no additional AI calls. Registration, profile saving and voice handoff do not wait for successful diagnostic delivery. These changes are local; production has not been changed by this phase.

## Delivery and recovery

The client stores allowlisted diagnostics under `origen.user.<Auth0 subject>.onboarding-events.<visit UUID>`. Each pending visit retains its original UUID, event sequence and occurrence time across refresh. Metadata is sanitized before storage and again on the server. The outbox contains technical event names, timestamps, allowed status/duration values and field-presence booleans. It contains no tokens, answers, transcript, audio, names or emails. Its account identifier is not anonymous data.

- Limit: 250 pending events across 10 visits per account scope. Open, save, home, logout and reported-gap events receive eviction priority. Each enqueue reloads the scope before trimming. Different visits use separate keys; simultaneous tabs may briefly exceed bounds or replay pending records, but cannot inflate server counts.
- Expiry: 23 hours, leaving margin for the server's 24-hour timestamp acceptance limit. Expired records are pruned on the next queue access. Closed browsers cannot physically remove storage on a timer; records may remain on disk until app access or browser storage clearing.
- Batches: at most 25 events and 18 KB JSON. Acknowledgement removes only those sequences, preserving events appended during a request.
- Retries: exponential backoff from two seconds to 60 seconds, with jitter; `Retry-After` respected up to five minutes. Five automatic retries after the initial failure, then a recovery trigger is needed. Manual flush cannot bypass exhaustion.
- Recovery: authenticated app mount, returning online, becoming visible. Delivery resumes after family-account loading, including when a completed user returns directly to home. It does not invent a new onboarding visit just to send old diagnostics.
- Authentication: 401 or missing token pauses delivery. Subject mismatch or 403/404 clears and blocks that tracker. Rejected payloads (400/413/415) discard only that batch so later events can proceed.
- Logout: pending records remain for a later sign-in by the same account. Other accounts cannot load or send them. Explicit account closure clears the scope and blocks late callbacks from recreating it. Server account deletion still cascades diagnostics.
- Storage unavailable/full: memory fallback. Closing the browser can then lose records. A storage access failure is not labelled corruption.

The backend deduplicates by authenticated account, visit, producer and sequence. An already-stored replay does not refresh `last_received_at` or extend retention. New accepted events can extend inactivity retention. Server-confirmed profile saves remain independent of the outbox.

`tracking_delivery_recovered` reports retry counts. `tracking_delivery_gap` reports bounded counts with reasons `expired`, `capacity`, `invalid` or `request_rejected`. The timeline labels both. These notices are best effort: they can themselves fail, and a refreshed tracker that has not opened onboarding replays older records without opening a visit solely for notices. Dropped events cannot be reconstructed. These signals do not establish complete delivery.

## Configuration and rollout

Optional **backend** environment settings:

| Variable | Default | Allowed values |
| --- | --- | --- |
| `ONBOARDING_RETENTION_DAYS` | `90` | Integer 7–90 |
| `ONBOARDING_ALERT_MIN_VISITS` | `10` | Integer 10–1000 |
| `ONBOARDING_ALERT_RATE_PERCENT` | `25` | Integer 5–100 |

Omit variables to use defaults. Invalid settings fail validation rather than silently changing behavior. Readers and cleanup share settings; admin history and insights display the configured retention.

Cleanup at startup and hourly deletes visits inactive beyond the configured period and cascades their events. This is inactivity retention, not a maximum lifetime for a repeatedly active visit. Shortening retention removes qualifying diagnostics on the next cleanup; it does not delete profiles or conversations. Earlier documentation's fixed 90-day period is now the default. Missing history is not backfilled.

Deploy the shared schema/outbox, lifecycle, backend readers/validator and admin UI together. Existing migrations 027 and 028 suffice; this phase adds no tables or materialized views. Older clients remain valid and lack delivery-version coverage. Review flags require migration 027. Set the backend variables on Render to change defaults; no Render configuration was changed automatically.

## Operational review flags

Administration → Users → Onboarding insights includes **Onboarding review flags** over visits whose first server receipt was in the trailing 24 hours. This window is independent of the reporting selector and directory filters.

| Check | Eligible visits | Affected signal |
| --- | --- | --- |
| Voice connection | Voice start request | Microphone failure or connection failure |
| Profile saving | Save request | Save failure |
| Browser playback | Phase 3 capture with voice start | Blocked playback |
| Home handoff | Web transition start or native handoff request | Web/native handoff failure |
| Reported delivery gaps | Opening marked `deliveryVersion: 1` | Delivery-gap notice |

Each category requires the configured eligible sample, at least **three affected visits**, and the configured issue percentage to show **Review**. Repeated failures within a visit count once. Small samples, absent request signals, unavailable capture and load errors have distinct states. Missing events do not establish abandonment or success. A retry-recovery visit count adds context.

Flags are recalculated when the dashboard loads/refreshes. They are not persisted incidents, scheduled checks, emails or external notifications. A flag can disappear as its cohort leaves the window. Silent clients, complete outages and expired events cannot establish a rate. These are operational prompts, not research findings or demographic comparisons.

`POST /api/admin`, action `onboarding-alerts`, uses existing `read:activity` authorization. It returns aggregate counts/thresholds, not user/visit identifiers or private content. SQL scopes account and visit keys and applies receipt cutoff. Permission denial removes protected UI results; failures give a generic retryable message.

## Verification

`server/onboarding-phase5.test.mjs` covers persistence, scope isolation, metadata stripping, bounded retries/authentication pause, expiry/capacity/corruption, storage fallback, closure/stale acknowledgements, rejected batches, concurrent appends/visits, duplicate receipts, configured cascade retention, SQL alert counts, thresholds and protected errors. PostgreSQL-only integration checks require an explicitly configured `ORIGEN_TEST_DATABASE_URL`; production storage is never used automatically.

`output/playwright/onboarding-events-phase5-check.js` uses actual tracker, transport, lifecycle hook and flag components with synthetic identities and mocked HTTP. It covers refresh replay, original keys, sanitized storage, account switching, token mismatch, closure, review/small samples, retry, missing capture, revocation and responsive layouts. Earlier checks cover actual onboarding, ongoing voice into home, timeline and cohort integration. No production accounts or paid model requests are used.
