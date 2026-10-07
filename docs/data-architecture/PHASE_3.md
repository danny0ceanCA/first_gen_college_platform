# Phase 3: private progress history and optional feedback

Implemented in source October 6, 2026. Not deployed or enabled by this task. Migration 016 is additive; migrations 001–015 remain unchanged.

## What is implemented

- Accepted academic profile changes record the field, previous/current reported value, server timestamp and origin: user-reported, imported or linked-account. This describes an accepted save, not an independently verified academic fact or proof that AI proposed it. Names, colors, needs and private notes are excluded. School and GPA remain reported text; no unsupported normalization is introduced.
- Plan versions store private snapshots and added/removed/status-changed transitions in the same transaction as the accepted save. Step IDs survive replacement of the current step rows. Reordering alone is not completion; reopening records the previous and new status. Adding an already-complete step does not establish when it was completed. Existing plans are not retrospectively reconstructed.
- `guidance-helpfulness` version 1 defines a bilingual optional service-feedback question with helpful/partly/not-yet responses. It is not a validated learning instrument. Declined and explicitly unknown responses have null values, never zero. Unobserved question exposure remains unknown: there is no fabricated “not asked” record for everyone who has not replied.
- Reported milestones cover contacting a counselor, starting/submitting an application and reviewing an aid offer. A supplied occurrence date is separate from the server receipt timestamp. The web form records the receipt time without guessing an occurrence date. Neither the API nor the voice model can mark these records verified.
- Planning has a compact, optional bilingual progress/feedback disclosure for authenticated web and mobile-browser users. Preview and native placeholder voice are not instrumented. No additional model calls are required.
- `/api/progress` accepts authenticated, bounded records with retry IDs. Reusing an ID with changed content fails. Targets must belong to the account. A read returns the latest bounded account-only history (100 observations/transitions/reports, 10 revisions); full retained data is in the account export. Record responses contain only an acknowledgement. Reports are capped at 1,000 per account within retained storage.
- `node server/progress-report.mjs` is an operator-only aggregate report: feedback submissions, unique submitting accounts, answered denominators, language/response breakdowns and reported milestones. Missing exposure is explicitly unknown. Repeated reports are submissions, not unique student achievements. This is not an institution endpoint or approved research export.

## Access and lifecycle

Academic changes from a verified account link update the canonical owner's academic observations with `linked-account` provenance. They do not give either person access to the other's private notes, plans, summaries, feedback or history. No actor email/name is copied into history. Plans and their revisions remain account-private.

Account exports include retained observations, revisions, transitions, reports and measurement definitions (format version 3). Deleting a student removes their observations/reports and plans/revisions; deleting a plan removes its revisions/transitions; account closure cascades all account-owned records. Existing unlink-before-delete restrictions remain. Retention cleanup runs at startup and hourly, removing records older than 90 days, including dependent transitions. Cleanup continues when collection is disabled. Current profiles/plans/summaries retain their existing independent lifecycle.

No raw audio, transcript corpus, research enrollment, training permission, institution access or verified outcome source is added. Ordinary institution reporting remains unchanged. Verified outcomes and normalized academic evidence require actual authorized sources and are deliberately unavailable here.

## Rollout

1. Review the 90-day operational history policy, user notices, storage budget and accountable owner. Apply migration 016 on a dedicated staging database first.
2. Run `npm test` with a dedicated `DATABASE_TEST_URL` to exercise real PostgreSQL migrations/concurrency and cascade controls. Never point it at production: tests create and delete synthetic schemas.
3. Deploy compatible API code with collection off. To enable it, set backend `PROGRESS_HISTORY_ENABLED=true`, `PROGRESS_DATA_OWNER` to the accountable role/person, and `RENDER_GIT_COMMIT` (Render-provided) or `APPLICATION_REVISION`. Production refuses enabled collection without the owner/revision.
4. Build the frontend with `VITE_PROGRESS_HISTORY_ENABLED=true` only after the API is ready. The planning disclosure remains hidden for unsigned previews. This flag does not enable server writes by itself.
5. Check synthetic profile changes, step reopen/reorder/remove, account export/delete and the internal report. Monitor storage; revisions contain private plan text and sources, so treat exports accordingly.

Rollback disables the frontend and backend flags. Retained history stays exportable until its scheduled cleanup. There is no historical backfill and no automatic rollout in this task.

## Validation and limits

Focused tests cover accepted observations, unchanged imports, linked private boundaries, stable revision transitions, stale edits, account isolation, retry conflicts, unknown/declined handling, untrusted verified claims, preview rejection and export/erasure. The existing suite covers bilingual summaries and conversation boundaries. Real PostgreSQL migration/cascade and concurrent-write checks require the dedicated test URL; a passing in-memory test is not evidence those production checks ran.

Feedback reports are self-selected and cannot measure response rates without future explicit exposure tracking. Profile histories record changes observed after enabling collection, not full lifetime baselines. No causal improvement, academic eligibility, institutional partnership or research approval is claimed.
