# Admin dashboard enhancement — phase 4

Phase 5 clarification: historical failed summary executions combine generation, persistence and post-processing. The UI now calls these **summary processing failures**, with storage-specific failures classified in the review queue when a stage-specific code exists. References to generation failure below describe the original phase 4 terminology, not proof of which stage failed.

Open **Users → an account → Open conversation records** to inspect the technical history of that account's attributed conversations. This extends the phase 2 user drawer; the existing global Voice quality and conversation-review reports remain available.

## Experience

- An on-demand list of five logical sessions per page, newest first, for the selected 7/30/90-day registration-independent reporting period.
- Filters for any guide included, any recorded English/Spanish language, problem signals, linked summary storage, or storage unconfirmed. Counts apply to the entire filtered session cohort, not just the visible page.
- Each record shows its guide sequence, languages recorded, end status and summary-storage evidence. Unacknowledged guide configurations are labeled unconfirmed, including in the collapsed heading.
- Expanding a record shows browser connection/start-attempt evidence; ordered guide segments and acknowledgements; linked summary metadata; server negotiation, generation and source-request outcomes/durations; and a paginated technical event timeline.
- A summary linked to several guide segments counts once. Its guide-step links and recorded language appear together. No saved summary text or transcript is displayed.
- Keyboard event paging returns focus to the event heading. Mobile uses the existing full-width account drawer. Closing the conversation section aborts outstanding reads; refreshing the account also refreshes the section. Access denial removes the account view.

## What the evidence means

| Display | Required evidence | Limits |
| --- | --- | --- |
| Logical session | Account-owned `origen_guidance_sessions` row | Can contain several physical connection attempts, guides or student-scope reconnections; not a call-minute or distinct-user measure |
| Guide prepared | Account/session-owned segment created before cutoff | Does not prove the client applied it or that a topic was discussed |
| Guide acknowledged | Matching `voice.connected` or `guidance.configuration_applied` receipt before cutoff | Browser report; does not prove audible speech |
| Language recorded | Initial session language or matching language-change receipts | Describes selected language; does not detect sentence-by-sentence language drift |
| Connection reported | A matching guidance or voice-quality connection acknowledgement | Does not establish useful answers or that all audio was heard |
| Linked stored summary | Current summary row, explicit account-owned segment links, and a matching server `summary.saved` receipt before cutoff | Confirms retained linked storage, not semantic summary accuracy; links are never inferred from dates or starting topics |
| Generated; storage unconfirmed | Completed summary-generation execution but no matching storage evidence | Generation and persistence are separate outcomes |
| Generation failed; storage unconfirmed | Failed generation execution and no matching storage evidence | Later retries may succeed; not proof of permanent loss or a storage failure |
| Problem signals | Failed server executions, selected voice-quality failures, browser start failures or failed responses | Signals can overlap across streams; not unique or unresolved incidents |
| End not recorded | No end receipt by cutoff | Does not mean the call is still active |
| Closed after inactivity | Server cleanup marked the session `abandoned` | Does not establish that the person abandoned the app |

Ordinary interruptions, guide changes, cache hits and completed responses are not classified as problems. Failed generation attempts remain visible even when a later summary was saved. Language filters include either retained language stream matched by the explicit session ID; the event timeline distinguishes the underlying reports and can contain overlapping observations.

Server operations show only operational labels, initiation time, effective status, duration, guide step and retained source-reference count. No requested questions, source URLs, provider request IDs, token usage, model prompts or student information are returned. A source count is not a count of validated answers or distinct publishers. Cached client lookups may appear in browser diagnostics but have no server execution row. Durations are operation time, not speaking time, connected minutes or billing.

## Scope, retention and paging

This reader reuses migrations 015 and 019 and the existing summary-storage table. It adds no migration, paid model requests, collection flags, Auth0 role, or retention change. Detailed guidance collection remains controlled by `GUIDANCE_HISTORY_ENABLED`; this task does not enable it. When collection is off, a prominent note explains that only retained history can appear. Historical sessions can still be read while collection is disabled. Missing migration evidence produces an unavailable state rather than zero counts.

The cohort contains logical sessions that started in the selected rolling period, after attribution tracking became available, and within the existing 90-day metadata-retention policy. It can exclude a session that began before the period even if events arrived during the period. Permission failures before server session creation, old clients, uninstrumented calls and expired attribution are absent. Use the existing journey/Voice quality reports for separately recorded evidence; those records are not joined to a nearby conversation by timestamp.

Saved summaries have a separate lifecycle and can survive expiration of their session attribution. Deleted or unlinked summaries cannot be assigned to a session by this reader. Link confirmation requires the save receipt as well as current storage; a summary generated before onboarding profile persistence remains unconfirmed until matching storage evidence exists.

The first list response establishes a server cutoff. It is reused across filters, conversation pages and event pages. Cutoffs older than 24 hours or in the future are rejected. Refresh resets the cutoff and returns to page 1. All event ordering uses server receipt time; receipt ties use stable unique references. Late operation completion, guide acknowledgement, language events and save receipts cannot borrow knowledge beyond the cutoff. End/operation outcomes after cutoff remain unknown.

This is live reporting, not an immutable database snapshot. Retention, account/summary deletion and delayed delivery can change available rows. A removed record yields a clear unavailable error. Summary links are limited to 100 per detail with a truncation notice; server operations show the latest 50 with a total count; events use pages of 30. Guide segments have the existing 100-per-session write limit.

## Authorization and privacy

`POST /api/admin` action `user-conversations` requires existing server-verified `read:activity` permission or the configured admin allowlist. Account UUID, optional session UUID, period, filters, pages and cutoff are validated before record reads. All relationships bind account and session ownership. Matching session, segment or summary IDs in another account cannot contribute records. Detail access must also match the selected period and filters. Database errors return a generic unavailable response with no connection details.

Only technical metadata is returned. The reader never selects student names/IDs, summary text, transcripts, audio, user questions, tool arguments, raw event payloads or source URLs. It does not provide institutions with access, enroll users in research, or grant training permission. No production data was accessed during this implementation.

## Verification

`server/admin-user-conversations.test.mjs` covers validation, missing coverage, authorization, safe failures and actual PostgreSQL query behavior. Its disposable-schema integration test runs with an explicitly supplied `DATABASE_TEST_URL` or the in-memory PGlite entry point in `ADMIN_TEST_PGLITE_MODULE`; it never uses the application's `DATABASE_URL`. It tests colliding IDs across accounts, summary deduplication across topics, explicit save receipts, future acknowledgements and operation outcomes, failed versus completed generation, unconfirmed storage, selected-language filters, ordinary interruptions, deleted summaries, retention and stable paging.

`output/playwright/admin-conversations-phase4-check.js` loads the actual account drawer with synthetic responses. It checks lazy loading, guide acknowledgements, summary attribution, language history, both pagers, fixed cutoffs, refresh, rapid filter changes, retry, missing coverage, access revocation, mobile overflow and keyboard focus. Desktop and mobile screenshots are stored alongside the harness.

The full server suite passed 361 tests; four checks requiring a separate PostgreSQL server were skipped. The new SQL scenarios ran successfully in PGlite. Production build and synthetic browser checks passed. Existing Auth0 bundler and large-chunk warnings remain. Deploy frontend and backend together; this phase has only been verified locally.
