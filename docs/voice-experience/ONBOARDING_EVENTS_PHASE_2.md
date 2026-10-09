# Onboarding history — phase 2

In Administration → Users, select an account name to open account details. The **Onboarding history** section groups captured events by visit and opens the latest attempt. Other visits can be expanded separately. Existing account milestones, sign-ins and call activity remain visible.

## What the timeline means

- Profile saved means `saved_at` was confirmed by the profile transaction on the server. A browser save confirmation is a separate event; it does not establish server tracking success.
- Web home reached means the browser recorded rendering web home. Missing home events do not establish failed navigation; native host home arrival is not instrumented yet.
- Failed saves, microphone denial, connection failures, setup method/language changes and log out selections are displayed as observations. A save failure may be followed by a successful save. Selecting log out does not prove that authentication ended.
- Attempts without a server-confirmed save have an unknown outcome. Page hiding, leaving, call termination and missing events do not establish abandonment or its cause.
- Returning visits keep separate attempt IDs under the same account. The resumed flag means another attempt was retained when the visit was first received; it cannot reconstruct pre-capture visits or expired history.
- Field flags show provided/not provided, never answers. English/Spanish setup is labelled. Conversation text, audio, email addresses and Auth0 subjects are not read by these endpoints.

## Coverage, ordering and bounds

Detailed capture begins when migration `027_onboarding_events.sql` is applied. Accounts created earlier have a visible coverage notice. Before the migration is applied, the UI explicitly reports that detailed tracking is unavailable; it continues to show existing account milestones and activity. Query failures have a retry state rather than silently appearing as empty history.

The dashboard's 7/30/90-day reporting period selects attempts whose last receipt is in or after the start of that period and whose first receipt is before the query time. An expanded attempt shows its full retained history received before the query time, including events preceding the selected period. Phase 1 removes attempts inactive for 90 days, so this is retained diagnostic history, not an indefinite audit archive.

Attempt pages contain five visits, newest first by first receipt and UUID. Event pages contain 50 events, oldest first by device/server occurrence time, receipt time, producer and sequence. Stable tie breakers preserve paging. Browser clocks can differ from server time; references expose receipt timestamps, producer, sequence and recorded voice IDs. Times use the administrator's local time zone. No elapsed-time or abandonment metrics are inferred from these clocks.

Authenticated `/api/admin` actions `onboarding-timeline` and `onboarding-attempt` require the existing server admin permission (`read:activity`) or configured subject allowlist. Account and attempt IDs, periods and pages are validated. Every event query binds both account and attempt IDs; reused UUIDs cannot mix histories. Read metadata is sanitized with the same allowlist as capture. No new role or migration is needed beyond phase 1.

## Verification and rollout

Backend tests cover permission denial, invalid input, coverage gaps, returning attempts, browser versus server saves, account isolation, literal pagination, chronological event pages and metadata stripping. The browser check in `output/playwright/onboarding-events-phase2-check.js` uses synthetic users and mocked APIs to exercise retry, pagination, period changes, historical gaps, permission revocation, Escape dismissal and desktop/mobile layouts. It makes no paid model requests and creates no production records.

Deploy the phase 1 capture backend and phase 2 reader/frontend together. This implementation has not deployed or backfilled historical visits. Phase 3 remains responsible for deeper speech/audio and transition diagnostics.
