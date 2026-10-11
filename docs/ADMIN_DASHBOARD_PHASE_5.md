# Admin dashboard enhancement — phase 5

Open **Administration → Review queue**. This phase turns retained technical failures into an admin workflow, building on the user journeys, engagement report and conversation records from phases 1–4.

## What is implemented

- A paginated queue of open, investigating and resolved items, with problem-type, evidence-type and later-success filters.
- Profile-save request failures, voice connection failures, blocked/unavailable playback, home handoff failures, and summary-operation failures. Summary storage failures receive their own label when the new stage-specific code is present.
- Reported diagnostic delivery gaps in a separate filter. Missing events, missing summaries and ordinary interruptions never create failure items.
- One item per problem type and explicit onboarding visit, voice attempt or summary segment. Repeat failure signals are counted within the item. These are not unique-user counts or incident rates.
- On-demand technical evidence for the affected scope, account journey links, review decisions and paginated resolution history.
- Resolution reasons: later success reviewed, admin verified a fix, or review completed with no further action. Selecting a reason is required. Resolving an item does not rewrite the original evidence.
- A new latest failure changes the evidence fingerprint and reopens a reviewed item. Expiration of older signals does not reopen it. A later success alone never resolves a review.
- Responsive desktop/mobile layout, keyboard focus after pagination and updates, loading/error/empty/migration-unavailable states, and access-revocation cleanup.

## Evidence and recovery definitions

| Item | Recorded source | Later-success evidence |
| --- | --- | --- |
| Profile save request failed | Onboarding client `save_failed` | A server-confirmed profile save for the same account after the latest failure receipt; may be on another visit |
| Voice connection failed during onboarding | Client `voice_connection_failed` | Later-sequence `voice_connected` in the same visit |
| Other voice connection failed | Quality `connection_failure` or failed connection state | Later-sequence connected state in the same account, attempt and session |
| Playback unavailable | Client `audio_playback_blocked` | Later-sequence playback-started/resumed in the same visit; not proof the person heard audio |
| Home handoff failed | Client home-transition/native-handoff failure | Later-sequence home arrival or native acknowledgement in the same visit; native acknowledgement does not verify home rendered |
| Summary processing failed | Failed server summary execution | Current summary storage, account-owned segment linkage and a later server save receipt for the same session and segment |
| Summary storage request failed | Failed summary execution with `summary_storage_failed` | Same storage test; a failed transaction/acknowledgement does not prove permanent data loss |
| Delivery gap reported | Client `tracking_delivery_gap` | No recovery inferred for missing events; delivery resuming cannot reconstruct lost events |

Quality connection reports covered by an explicit onboarding voice-attempt reference and an equally recent or newer failure receipt are omitted from the standalone voice queue. A newer unmatched quality failure remains visible. Unlinked or differently delivered signals can overlap; grouping is not an assertion of unique incidents.

Summary failures previously used one error code for generation, persistence and post-processing. They are now labeled **processing failures** in the user timeline and conversation drawer as well. New failures during the initial storage operation use `summary_storage_failed`; later failures use `summary_postprocessing_failed`. The existing collection gate and error handling remain in place. Failures before an execution is created, disabled capture and some idempotent/deferred save paths have no execution-based failure record. The queue does not invent one.

## Storage, authorization and retention

Migration **029_admin_issue_reviews.sql** adds an append-only review-decision table and query indexes. Decisions store the account ID, opaque issue key, evidence fingerprint, status, categorical reason, server timestamp and reviewer subject hash. No free-text notes, profile answers, audio, transcript, summary text, provider response or raw payload is added.

All four actions (`review-queue`, `review-evidence`, `review-history`, `review-decision`) use POST `/api/admin` and the existing server-granted admin access (`read:activity` or `ADMIN_SUBJECTS`). No new Auth0 role is required. Ordinary users cannot read or write reviews; profile roles do not authorize access. Responses are no-store and errors hide database details.

Writes take a transaction-level advisory lock per account/issue and re-read the latest decision after acquiring it. A submitted revision must still match both evidence and review state. Concurrent/stale writes return 409; a repeated request cannot append an identical decision after a successful commit. Resolving as “later success reviewed” also requires current matching recovery evidence. Account deletion cascades reviews. Account export includes only that account’s issue keys, statuses, reasons and timestamps, excluding reviewer hashes.

The existing hourly retention job removes reviews older than 90 days and decisions whose source evidence no longer qualifies. Onboarding respects its configured 7–90-day inactive-visit retention; guidance follows the existing 90-day session policy; this reader bounds voice quality to 90 days. Removing evidence can remove a review item instead of marking it resolved. This is an operational queue, not a permanent incident archive. Decisions may remain until the next cleanup run after source expiry.

Queue periods select items by their latest failure receipt, independent of registration dates. Counts follow the active filters. The item’s count includes its full retained failure group. Refresh establishes a new cutoff and returns to page 1; filters and paging retain that cutoff for up to 24 hours. Technical evidence uses the same cutoff; review history shows the current retained audit. Late receipts, deletion and retention can change the live report. New evidence arriving after a decision reopens the item when next read.

## Release and verification

Apply the additive migration with the existing migration runner before serving the new backend/UI. Missing migration evidence produces an unavailable state. The normal server migration sequence includes this file automatically. This implementation does not change collection flags or Auth0 settings and adds no AI calls.

Validated locally using synthetic data:

- New reader/write validation and API authorization/error tests.
- Executed PostgreSQL SQL in a disposable PGlite database, including grouping, cross-account and cross-segment isolation, later recovery, future-cutoff exclusion, deduplication, decisions/history, stale writes, new-failure reopening, pagination, retention and deletion cascades. Migration 029 executed in that fixture.
- Injected upstream and storage failures in the real summary handler and verified distinct codes, successful retry, one stored summary and retained save receipts.
- Browser harness `output/playwright/admin-review-phase5-check.js` exercised the real dashboard/components with synthetic API responses: navigation, queue/evidence pagination, account drawer, investigation/resolution/reopen, conflict handling, rapid filters, retries, telemetry-gap separation, unavailable capture and access revocation. Desktop 1440×1080 and mobile 390×844 screenshots were inspected; no horizontal overflow.
- Full suite: 365 passing tests, four existing tests requiring a separate PostgreSQL server skipped. Production build passed with the existing Auth0 directive and bundle-size warnings.

No production data was queried or changed. Migration, code and documentation are local; not committed, pushed or deployed.
