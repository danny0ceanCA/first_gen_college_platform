# Admin dashboard enhancement — phase 2

Selecting an account now opens a spacious side drawer on desktop and a full-width view on mobile. Closing it restores focus to the directory and preserves directory filters. The header and close control remain visible while the contents scroll.

## What the view contains

- The phase 1 journey stage, account-holder role, student-profile count and verified/unknown admin access.
- Sign-ins, calls and connected minutes for the selected 7/30/90-day period, with account milestones available separately.
- A deterministic, plain-language recap built from recorded facts. No model request, inference about motivation, or new conversation-content access is involved.
- One newest-first timeline covering registration, sign-ins, onboarding visits, confirmed profile saves, browser-reported home arrival, call records, stored summaries and selected problem signals.
- Filters for account/sign-ins, onboarding, conversations, summaries and recorded problems, plus pages of 30 events.
- Detailed onboarding diagnostics loaded only when requested. The existing visit/event reader remains available for speech, playback and handoff investigation.

## Evidence and scope

All timeline queries bind the selected account ID. `POST /api/admin` action `user-history` requires the existing backend admin authorization. Invalid account IDs, periods, categories, page numbers and cutoffs are rejected. Errors do not expose database details. Access denial removes the displayed account view; unmounting aborts outstanding requests.

Timeline order uses server record/receipt timestamps, not browser timestamps. Browser event timestamps are shown in event references and can differ because of device clocks and queued delivery. Saved profiles use server milestones/attempt receipts, not browser success messages. Matching first-save timestamps are deduplicated across the account and attempt records; subsequent saves remain distinct.

The recap covers all retained key events within the period, independent of the timeline filter or page. Its setup-completion headline uses the account's confirmed milestone through the cutoff even when that milestone predates the selected period. Counts describe records, not unique people, unique incidents, or unresolved problems.

A fixed report cutoff is reused while paging and filtering. Refresh starts again at page 1 with a new cutoff. Cutoffs expire after 24 hours. This is a bounded live report, not an immutable audit snapshot: deletion and retention can remove rows while it is open. Call duration is suppressed when its most recent update occurred after the cutoff rather than pretending to know historical duration. Missing end receipts do not establish an active call.

## Summary status

`origen_conversation_summaries.created_at` confirms when a currently stored summary record was first saved, including possible imports. The query reads topic and storage time only; it never reads summary text, sources, student details or transcripts. Deletion removes this evidence from the report.

Failed summary-generation attempts come from `origen_ai_executions` when guidance-history capture was enabled. They are labelled generation failures, not save failures. There is no comprehensive summary-storage failure ledger in the existing data, so absent summaries remain unknown. This phase does not join calls to summaries by proximity or claim that a later save resolved a particular failure. Per-conversation attribution and deeper topic/language diagnostics remain phase 4 work.

## Deployment and verification

No migration, new application dependency, Auth0 role, AI call or production-data change is introduced. The reader reuses existing migrations 001, 015, 017, 018, 019 and 027. Deploy the frontend and backend together. Missing tables cause an explicit unavailable state; migration dates and configured retention are displayed as coverage information, not a promise of complete capture.

`server/admin-user-history.test.mjs` covers authorization, input validation, safe errors and uncertainty. Its SQL integration test runs in an isolated schema with an explicitly supplied `DATABASE_TEST_URL`, or in an in-memory PostgreSQL runtime supplied through `ADMIN_TEST_PGLITE_MODULE`; it never falls back to the application `DATABASE_URL`. It checks account isolation despite matching visit IDs, save deduplication, delayed receipts, summary evidence without private content, independent recaps, stable equal-time pagination and refresh cutoffs.

`output/playwright/admin-user-phase2-check.js` imports the actual components with synthetic API responses. It exercises directory-state preservation, focus containment/restoration, Escape, closing during a slow response, filters, fixed-cutoff paging, refresh, lazy diagnostics, error retry, access revocation and mobile overflow. Screenshots document the desktop drawer and mobile overview/timeline. These are local checks, not production verification.
