# Onboarding event capture — phase 1

Phase 5 supersedes this phase's memory-only delivery limits and fixed retention: see [delivery and operations](ONBOARDING_EVENTS_PHASE_5.md). The original behavior below describes phase 1.

Each visit to the shared onboarding screen gets a fresh UUID attempt, linked on the server to the authenticated account. Attempts after the first recorded attempt have `resumed=true`; a restored browser draft is also recorded separately. Reloads start a new attempt. Switching between voice and manual entry keeps the current attempt. Earlier visits cannot be reconstructed retroactively.

Migration `027_onboarding_events.sql` adds:

- `origen_onboarding_attempts`: account, attempt ID, receipt timestamps, resumed flag, confirmed save timestamp.
- `origen_onboarding_events`: account, attempt, producer, sequence, event name, occurrence and receipt timestamps, allowlisted metadata.

## Captured events

| Event | Meaning |
| --- | --- |
| `onboarding_opened` | Setup screen mounted; language, initial method and restored-draft flag. |
| `setup_method_changed` | Voice/manual/name entry changed, or screen language changed. |
| `fields_updated` | Field presence changed. All values are booleans, including fields subsequently cleared. |
| `voice_button_pressed` | User selected the start/restart control. Opening an existing call is excluded. |
| `voice_start_requested` | Voice transport initialization began. Includes voice session and attempt IDs for correlation. |
| `microphone_allowed`, `microphone_denied`, `microphone_failed` | Outcome of microphone acquisition; only an allowlisted technical code. |
| `voice_connected`, `voice_connection_failed` | Data channel became ready, or the connection failed/timed out. |
| `voice_ended` | Cleanup of a started voice attempt. Reason: explicit user end, logout, time limit, known connection failure, or unknown. |
| `save_requested`, `validation_failed`, `save_failed` | Save attempted through voice or a button, missing required fields, or unsuccessful request. |
| `profile_saved` | Server event written with the successful profile transaction. Protected by a savepoint so a diagnostic failure does not undo profile saving. |
| `save_succeeded` | Browser received a successful save result. This is distinct from server confirmation. |
| `home_reached` | Web home actually rendered after onboarding. Stops this attempt's tracking while the shared voice call may continue. |
| `logout_selected`, `logout_failed` | Explicit logout selected, or logout rejected. |
| `page_hidden`, `page_visible`, `page_leaving` | Browser lifecycle signals. They do not establish abandonment or its cause. |

Field flags: account name and role; student name, education stage, school, interests, GPA, activities, goals, institutions, entry term, practical needs and notes. No answers, email addresses, school names, transcripts, audio, or error messages are accepted in event metadata. Unknown error codes become `other`.

## Operation and limits

Authenticated clients POST batches to `/api/onboarding-events`. The subject comes from the verified access token; client-supplied account ownership and server events are ignored/rejected. A delayed browser request also verifies its token still belongs to the original user. Closure guards serialize storage with account deletion. Both tables cascade on account deletion and appear in the account data export. Attempts inactive for 90 days are purged at startup and hourly, cascading their events. Account onboarding milestone timestamps remain.

Events are buffered in memory and sent after 300 ms, up to 25 per request. Presence flags are debounced and changes to the underlying answer without a presence change do not generate more events. Attempts have at most 2,000 client sequences, a pending buffer of 100 events, and accounts have a maximum of 200 retained attempts. Client events deduplicate by account, attempt, producer and sequence. Server save confirmations deduplicate separately. Batches are capped at 20 KB; timestamps accept at most one day of delay and five minutes of future clock skew.

Browser tracking failures never throw into the onboarding flow. Requests time out after 10 seconds; logout waits at most 500 ms for its diagnostic flush. Page lifecycle sends are best effort: browser termination, network loss or authentication failure can leave missing events. No retry queue persists between visits in this phase. Failed server tracking rolls back only its savepoint and logs a constant technical warning. An unavailable database can still prevent the profile itself from being saved.

The native WebView reuses setup, field, voice and save capture, including the server attempt ID. Native host Exit and actual native home rendering are outside this web tracker; their confirmation requires host instrumentation. `home_reached` currently represents web home only.

## Rollout and next phases

Deploy the backend and frontend together. Backend startup applies additive migrations automatically. Older clients can still save profiles without an attempt ID. This change does not deploy itself or backfill the previously investigated user.

Phase 2 adds the admin timeline. Phase 3 adds first audio, speech, save-confirmation and transition details. Phase 4 measures cohorts. Phase 5 adds stronger delivery recovery, configurable retention and alerting. Absence of events must remain labelled unknown/incomplete.

Verified locally with PostgreSQL-compatible in-memory tests for schema, account isolation, retries and save attribution; a failing SQL client checks savepoint recovery. The production PostgreSQL integration tests require an explicitly configured test database and are skipped without it.

The Playwright check in `output/playwright/onboarding-events-phase1-check.js` uses synthetic Auth0/bridge identities and mocked HTTP responses. It verifies microphone denial, a failed save, a successful retry despite tracking failure, one attempt across voice/manual setup, exclusion of private answers, and actual web home rendering followed by `home_reached`. It makes no paid voice/model requests and does not create production accounts.
