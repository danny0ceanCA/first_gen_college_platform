# Admin dashboard enhancement — phase 3

The Engagement tab adds registration cohorts and recorded return use. It answers how many accounts saved a profile, started guidance after setup, and came back for another guidance call. It also reports activity by existing accounts that did not need a new sign-in. This is operational reporting, not a measure of educational outcomes or whether a conversation was helpful.

## Metrics and denominators

All cohort measures count distinct app accounts, not student profiles, visits, or verified unique people. The selected rolling 7/30/90-day window selects the registration cohort. Current account-holder role filters apply throughout. Daily cohorts use UTC; weeks begin Monday and may include partial weeks. Weekly percentages divide summed numerators by summed denominators rather than averaging daily percentages.

| Measure | Numerator | Eligible denominator |
| --- | --- | --- |
| Setup within 7 days | First server-confirmed profile save within 168 hours of registration | Tracked registrations at least 168 hours old |
| Guidance within 7 days | First qualifying guidance call within 168 hours of registration | Tracked registrations at least 168 hours old |
| Return use within 7 days | Another qualifying call on a later UTC date, no later than 168 hours after activation | Activated accounts in the selected registration cohort whose activation is at least 168 hours old |

Activation means the first recorded positive-time call that starts on or after confirmed profile completion and uses a starting guide of planning, finance, admissions, or loans. A call that starts during onboarding and continues into home does not qualify. Sign-ins, page views, summary creation and automated work do not establish activation. Connected time includes listening and pauses. No arbitrary minimum speaking time or inferred satisfaction threshold is added.

Return windows start at activation, even if activation occurred more than seven days after registration. A single call spanning midnight is not a return. Multiple calls on the same UTC date are not a return. A separate call on the following UTC date may qualify even when less than 24 hours have elapsed; this is a later-date return measure, not exact day-1 retention. Use elapsed 168-hour windows even when the database timezone crosses daylight-saving changes.

Early successes from recent accounts are excluded from both numerator and denominator until the relevant full window has elapsed. The cards show counts alongside percentages and how many registrations or activations are waiting. An empty eligible denominator is shown as an em dash, not 0%. Selecting only the last seven days will normally leave no mature registration cohort, although an exact boundary account may qualify.

## Observed milestones and period activity

The progress panel includes recent accounts still waiting for full windows. Confirmed saves, retained web home arrivals and qualifying guidance use are counted independently; missing browser events cannot erase authoritative saves. This is deliberately not a strict funnel.

Home-arrival eligibility starts at the later of migration 027's application time and the configured onboarding-diagnostic retention cutoff. Only registrations covered from the start are in that denominator. Home receipt time must follow both account creation and the server-confirmed profile save. Native handoff acknowledgement is not a web home arrival. Missing or expired home records do not establish failure to arrive.

The separate activity panel covers **all current accounts** matching the role filter, including accounts registered before the selected cohort window. It shows distinct accounts with qualifying calls, distinct qualifying accounts with no recorded sign-in in the period, qualifying call records, and distinct account/UTC-date pairs. Calls belong to the date they started. These measures demonstrate observed guidance use with an existing login; they do not capture all browsing, manual actions, or native sign-ins.

## Coverage, scope and sources

- Sources: `origen_accounts`, `origen_voice_activity`, `origen_login_activity`, retained `origen_onboarding_events`, and `origen_schema_migrations`.
- Registration cohort coverage starts at the later of migrations 017 and 018. Older accounts in the period are explicitly excluded from cohort rates. Their qualifying period activity may still appear in the activity panel.
- Known admins are excluded using the server `ADMIN_SUBJECTS` configuration and the already-authorized caller identity. The browser cannot supply admin-exclusion evidence. Other Auth0 admin assignments are not synchronized and may remain in the report; this limitation is disclosed. Reports from different authorized admins can therefore differ unless the server allowlist covers all reporting admins.
- Role filters use the account's current parent/student role. They are not historical role cohorts or Auth0 permission filters. Institution-only identities without an app account are absent.
- Account deletion removes records from future reports. Retention and delayed event delivery can change counts. This is a live operational report, not an immutable historical snapshot.
- Qualifying call records must have their latest receipt before the report cutoff, preventing later updates from masquerading as knowledge available at that cutoff. Calls that receive an update during the read may be absent until refresh. Source reads share a cutoff, but are not an immutable transaction snapshot.
- Missing baseline migration evidence yields an explicit unavailable state. Query failures yield an error with retry, rather than empty metrics. Baseline dates cannot guarantee uninterrupted capture; missed heartbeats and absent browser diagnostics can undercount use.

## Implementation and verification

`POST /api/admin` action `engagement` requires existing backend admin authorization. The reader validates the reporting period and role before database queries, binds SQL inputs, and returns aggregates only. It does not read or return names, account IDs, Auth0 subjects, student details, summaries, or transcripts. Database failure details are not exposed. Filters and refresh clear prior data; stale responses are ignored and access revocation removes the dashboard content.

No migration, new application dependency, model request or production-data change is introduced. Existing tables from migrations 017, 018 and 027 must be installed. Deploy the frontend and backend together.

`server/admin-engagement.test.mjs` checks authorization, trusted exclusions, invalid inputs, unavailable coverage, safe errors and empty versus zero denominators. Its SQL integration test uses a disposable schema through an explicitly supplied `DATABASE_TEST_URL`, or an in-memory PostgreSQL runtime through `ADMIN_TEST_PGLITE_MODULE`. It never falls back to the application's production `DATABASE_URL`. Fixtures cover repeated calls, account deduplication, same-date calls, midnight crossings, maturity, exact and out-of-window returns, delayed saves, role filters, retention, existing-login activity, future receipts and DST boundaries.

`output/playwright/admin-engagement-phase3-check.js` imports the actual dashboard with synthetic API responses. It exercises the Engagement navigation, weighted day/week grouping, eligibility counts, waiting states, reporting periods, rapid role changes, retry, unavailable tracking, access revocation, phone overflow and keyboard table scrolling. Denial now invalidates any pending overview refresh, preventing an older authorized response from remounting dashboard content. Screenshots document desktop and phone views. These checks are local and do not verify a production deployment.

Local verification completed with 358 passing server tests and four skipped checks requiring a separate PostgreSQL server. The new cohort SQL ran successfully in PGlite. The synthetic browser checks and production build passed. Existing Auth0 bundler and large-chunk warnings remain. The temporary SQL runtime was removed; it is not an application dependency.
