# Admin dashboard phase 6 — reported progress and institution reporting

Implemented locally on 2026-10-10. No production deployment or production-data audit is implied. Research remains a synthetic sandbox with no approved live protocol.

## Administration → Progress

The new tab uses retained `origen_progress_reports` and `origen_feedback_prompts` records. It supports rolling 7, 30 and 90 day server-receipt windows with a consistent read transaction. All reporting accounts are included; the report does not infer student identities or institution membership.

| Measure | Numerator | Denominator / grain |
| --- | --- | --- |
| Reported helpfulness | Helpful responses | Answered Helpful, Partly and Not yet responses to guidance-helpfulness v1 |
| Feedback participation | Answered opportunities | Recorded feedback-panel openings in the period, with responses received before cutoff |
| Accounts sharing progress | Distinct reporting account IDs | Count, not a rate; at least one milestone received during the window |
| Milestone rows | Distinct accounts and submission counts, separately | Each milestone category; one account can appear in several rows or repeat a report |

Zero denominators display an em dash. Declined, unknown, and absent responses remain separate from negative feedback. No goals, grades, raw summaries, transcripts, names, free text, or institution filters are exposed by this report. Milestones are self-reported; report receipt dates are not event completion dates. Usage, feedback and milestones do not establish learning, admissions, enrollment or causal impact.

The optional progress panel in Planning records one opening per mounted student panel, after the person expands it. Closing/reopening the panel or switching its language does not create another opportunity. Navigating away and returning can create another opportunity: these are not unique people. Ownership is authenticated server-side, prompts are capped at 1,000 retained records per account, report retries are idempotent, and one feedback response can be linked to an opportunity. Changing students resets the UI and opportunity scope. English and Spanish disclosures explain the measurement.

Opening measurement is best effort and time bounded. Feedback can still be saved if opening measurement fails. Such submissions, including old clients and historical records, contribute to helpfulness but not participation. The dashboard shows unlinked submissions and schema availability dates; those dates do not establish uninterrupted collection or deployment of the frontend. There is no historical opening backfill and no inferred count of people who were never asked.

The existing progress collection flags remain in force. Disabled server collection is labeled explicitly; retained historical data can still be reported. Feedback is not an academic research instrument or model training authorization.

## Administration → Institutions

The existing monthly report now also shows question requests, RSVP requests, and rounded mean hours to first reply, using `origen_institution_outreach_facts`. The window is always the last completed UTC calendar month. Responses received after month end are excluded; unanswered requests are excluded from the mean and this limitation is displayed. Future outreach messages do not count as first request replies.

Counts below 10, including zero, stay unavailable in server results. First reply time requires at least 10 replied requests in the same cohort. Counts belong to the original receiving institution or department; no parent totals, new affiliation inference, or personal progress joins are introduced. No narrow date, language, or personal cohort filters are provided. The report distinguishes not-collected, partial-month, and availability-not-verified coverage. Existing institution portal membership permissions and reporting are unchanged.

Administrators can explicitly save the currently filtered report page, up to 25 rows, and download it later as JSON. The server regenerates and suppresses the report inside a consistent transaction; it never accepts a client-supplied report payload. Snapshots include the month, scope, definitions, safe readiness projection, creation/expiration dates, and source references. Page status counts describe the time of saving, while engagement/outreach counts describe the completed month. Current institution names/statuses may differ from month-end values.

Snapshots are immutable, internal report pages, not whole-directory exports or research datasets. List pagination is bounded to 20 snapshots; a maximum of 500 are retained. An idempotency key prevents a lost response from creating duplicate saves. Save transactions lock the snapshot table before their first MVCC read, so concurrent saves see preceding commits and enforce the cap. SQL indexes support the reporting receipt windows and institution-scoped facts; monthly counter aggregation is restricted to the selected 25 institutions. No materialized view is required at the present scope.

## Access, lifecycle and rollout

- New actions on authenticated `POST /api/admin`: `progress-report`, `institution-snapshot-save`, `institution-snapshots`, `institution-snapshot`. Existing `institution-report` returns schema version 2 with outreach coverage and definitions.
- Every request, including snapshot downloads, rechecks the existing `read:activity` permission or backend `ADMIN_SUBJECTS` allowlist. Browser results and pending operations are discarded on access denial or changed scope. Stored request hashes are not exposed to the browser.
- Additive migration `030_progress_reporting.sql` creates opportunity storage, its optional report linkage, snapshot storage, and reporting indexes. Migration checksums of earlier migrations remain unchanged.
- Prompts and their linked responses cascade on account/student deletion and expire after at most 90 days. Prompt receipts are included in the existing account export. Internal progress aggregates are recomputed, not copied into institution snapshots.
- Institution snapshots contain only institution operational aggregates and safe metadata, have 90-day retention, and are removed at startup/hourly cleanup. Downloads already saved outside Origen cannot be recalled.
- Deploy backend migration and compatible code before enabling the new frontend. Existing collection configuration: `PROGRESS_HISTORY_ENABLED=true`, `PROGRESS_DATA_OWNER`, and `RENDER_GIT_COMMIT` or `APPLICATION_REVISION`; frontend `VITE_PROGRESS_HISTORY_ENABLED=true`. No environment variables or production flags were changed by this implementation.
- Live research release, individual institution progress feeds, causal academic outcome claims, and model-training uses remain unavailable. They require the separately agreed protocol/permission work.

## Verification

- Full server suite: 372 tests, 368 passed, 4 skipped pending a separate PostgreSQL server. A disposable PGlite PostgreSQL runtime ran the new integration test and existing admin SQL tests.
- Actual migrations applied twice to a clean synthetic database to verify idempotent rollout. Checks cover ownership, duplicate and lost-response retries, explicit declines, missing denominators, old unlinked feedback, opening/report window differences, repeated milestones, account export/deletion, thresholds at 9/10, department isolation, month-end response cutoff, partial collection, immutable snapshots, pagination, expired access and retention.
- Production build and TypeScript passed. Existing Auth0 `use client` and large bundle warnings remain; no new build errors.
- `output/playwright/admin-progress-phase6-check.js` imports the real React components with synthetic Auth0/API responses. It exercises period changes, stale responses, errors/retries, snapshot save/download retries, access revocation, optional feedback capture, Spanish and student switching. Desktop 1440×1080 and mobile 390×844 screenshots were inspected; no page-level horizontal overflow.
- Browser fixtures and SQL measurements are synthetic, not evidence of production uptake, performance at institutional scale, or an approved research population. Multi-connection race behavior still requires the separate PostgreSQL integration environment.
