# Onboarding cohorts — phase 4

Administration → Users now includes **Onboarding insights**, alongside the registration milestone funnel and per-account history. The global 7/30/90-day selector and Refresh apply to insights. Account-directory search, role and profile filters intentionally do not change this report; its caption makes that scope explicit.

## Cohort and measures

One visit is one retained onboarding attempt whose `started_at` (first server receipt) falls within the selected rolling window. Only events received before the report cutoff are included. This differs from phase 2's per-account timeline, which selects visits by latest receipt activity, and from the existing registration funnel, which selects newly registered accounts. A returning visit outside the window is not added retrospectively to an older visit cohort.

| Measure | Definition |
| --- | --- |
| Users who opened setup | Distinct accounts with selected recorded visits. Retries do not inflate the user count. |
| Users with a confirmed save | Distinct selected accounts with a `saved_at` confirmed by the profile transaction on a selected visit, divided by users who opened setup. Browser `save_succeeded` alone does not qualify. |
| Returning users who saved | Distinct users with a selected `resumed` visit and a confirmed save on that visit. The denominator is distinct users with any selected resumed visit. Resumed means an earlier retained visit existed, not that it failed. |
| Saved within 24 hours | Visits with a confirmed save no later than 24 hours after first receipt, divided only by visits at least 24 hours old at the cutoff. Recent visits are ineligible rather than treated as failures. |
| Unknown save outcome | Selected visits without a confirmed save. This is explicitly not an abandonment or failure count. |
| Web home arrival | Visits with `home_reached`. Native host acknowledgements are counted separately and do not imply a native home render. |
| Voice connected | Visits with `voice_connected`, out of visits with `voice_start_requested`. Counts deduplicate visits, including retries within one visit. |
| Save after failed save | Visits with a server-confirmed save after the first received `save_failed` signal. A later failure after a successful save does not count as recovery. |
| Setup/language changed | Visits with `setup_method_changed`; multiple changes count once per visit. |
| Median time to save | Median server-clock interval from first receipt to confirmed save within the same visit, with the number of observed saves displayed. It is not total time across returning visits. |
| Median first audio | Median first recorded `first_agent_audio.durationMs` per phase-3 voice visit, with sample and coverage counts. The first sample by client sequence is used, not the fastest retry. Null/missing timing is not zero. Device volume or actual hearing cannot be established. |

Recorded friction counts visits, not event totals: microphone denial, microphone/connection failure, blocked playback, transcription timeout, validation failure, save failure, interrupted save confirmation and failed web/native handoff. Categories can overlap. Normal conversational interruptions are not necessarily errors; absence of a signal does not establish success.

The language/setup table assigns each visit the first recorded `onboarding_opened` language and method by client sequence. Missing or unrecognized choices stay **Not recorded**. Switching language or moving to manual entry stays within the visit's original cohort. Save rates here use visits, not users; recent visits and small samples must not be interpreted as causal comparisons.

The interactive daily chart groups visits by UTC first-receipt date. Selecting a date exposes counts and its age-eligible 24-hour rate. Dates before capture are hatched and labelled unavailable, rather than presenting a known zero. Window and capture boundary days may be partial. Recent recorded cohorts can change as a still-open visit produces additional events or delivery catches up.

## Privacy, access and operation

`POST /api/admin` action `onboarding-metrics` uses the existing `read:activity` permission or configured admin subject allowlist. Period input is restricted to 7/30/90. Unauthorized requests never query the database. Failures return a generic unavailable message with retry; missing migration coverage has its own state, not fake zero statistics. Request cancellation and permission denial remove stale UI results.

The SQL aggregates event rows into visits in PostgreSQL and selects only known technical categories and allowlisted metadata properties (language, method, capture version, duration and status). It binds both account and attempt IDs on every event join. Account/visit keys are used transiently to deduplicate metrics and are not returned in the report. No profile answers, names, emails, conversation text, audio or provider IDs are read for these metrics. There are no additional model calls or new event types.

These are retained operational diagnostics, not a research cohort or permanent audit record. Account deletion/export rules apply. [Phase 5](ONBOARDING_EVENTS_PHASE_5.md) adds stronger recovery, configurable inactivity retention (90 days by default) and operational review flags. Missing past events are not backfilled.

Migration `028_onboarding_cohorts.sql` adds an index on first-receipt time and visit keys for cohort selection. It adds no tables or materialized views. The existing server migration runner applies it on deployment. Deploy the backend reader, index and admin UI together. This phase is implemented locally and has not deployed itself.

## Verification

- Tests distinguish users from visits, returning saves, mature versus recent visits, server cutoff, recovery order, unknown choices, null timing, capture gaps and privacy of the returned report.
- The full cohort SQL runs against the PostgreSQL-compatible fixture with reused visit IDs across two accounts, repeated audio samples, initial choices and a future receipt. CASE aggregates are used so fixture and PostgreSQL behavior agree.
- A dedicated PostgreSQL integration check runs only when `ORIGEN_TEST_DATABASE_URL` is explicitly configured. It uses temporary tables in a rolled-back transaction and never uses the production `DATABASE_URL` automatically.
- The synthetic Playwright check exercises the actual Users integration, API retry, rates, latency samples, unknown choices/capture, interactive daily chart, directory filter isolation, reporting period/refresh, empty/unavailable states, desktop/mobile layout and access revocation. It creates no production accounts and makes no paid calls.
