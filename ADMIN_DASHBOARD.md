Admin dashboard setup
=====================

Recommended: manage access through Auth0
--------------------------------------

In the Origen tenant, open Applications → APIs → Origen API → Permissions and add `read:activity` (view operational dashboard). In API Settings enable RBAC and Add Permissions in the Access Token. Create an **Origen Admin** role under User Management → Roles, add that API permission to the role, and assign the role to your user. Sign out and back in to obtain a fresh token. The backend verifies token signature, issuer and API audience before accepting its `permissions` claim. App profile roles or user-editable metadata never grant admin access. Leave `ADMIN_SUBJECTS` empty when relying exclusively on Auth0 roles.

Alternative: server-managed allowlist
------------------------------------

1. Register/sign in to Origen normally. In the **Origen** Auth0 tenant, open User Management → Users → your user, and copy User ID (not Client ID).
2. Add `ADMIN_SUBJECTS` to the Render **backend** environment, set to that exact User ID. Comma-separated IDs allow multiple administrators. Never set this as a VITE frontend variable. Empty grants nobody access.
3. Deploy backend and frontend together. Startup applies all migrations through 019; `DATABASE_URL` is required. Do not edit previously applied migrations.
4. Sign in and open `https://origenedu.ai/#admin`. Access is checked server-side on every request. Ordinary users receive 403. Admin access does not require a separate Auth0 application or change the domain.

Definitions and limits
----------------------

- Registered users: current PostgreSQL app accounts, including incomplete onboarding; not all identities in Auth0 that never opened the app. Deleted accounts disappear.
- Sign-ins: deduplicated successful Auth0 web callback returns. Refreshes and silent token renewal are excluded. Native app sign-ins are not yet instrumented.
- Voice minutes: connected web voice time including pauses/listening, recorded by 15-second heartbeats with server time. Failed starts are excluded, missed heartbeats undercount, each heartbeat is capped at 30 seconds, and each physical call is capped at 10 minutes. This is operational telemetry, not billable-provider usage. Topic reflects the initial guide; changing topics preserves the call and does not count a new sign-in.
- Dashboard usage covers a selected rolling 7, 30 or 90 days; account count is all current accounts. The directory searches all accounts and uses pages of 25. Latest 50 activity records are shown. Refresh explicitly reloads.
- Tracking starts at deployment; no historic login/minute reconstruction. No email, audio, transcripts, summary content or student details appear on the dashboard. First names and internal account IDs are shown only to administrators.
- Activity records remain until account deletion, and are included in that account's data export. Account deletion cascades both activity tables. The existing research flags/consents remain independent; this dashboard does not authorize research or model training.

The current implementation counts browser-reported connection activity. It is useful for product operations but should not be used for billing, financial audits, or research claims without further validation against provider telemetry.

Admin dashboard phases 1-2
--------------------------

The admin workspace has Overview, Users and Activity navigation, a responsive cream/terracotta layout, four headline metrics, daily registration/connected-minute charts, a compact activity feed, and accessible metric definitions. Phase 3 replaces the original newest-200 user list with the directory below.

POST /api/admin with {action:"overview",days:7|30|90} selects a rolling period (default 30). The response includes window, generatedAt, previous, comparisonReady, and daily series. All period-dependent totals and activity rows use the same timestamp bounds. Registered users remains the current all-time app account count. Comparisons use an equally long window. Voice/sign-in comparisons are withheld until tracking covers the entire previous window. Daily charts use UTC and may include partial first/last days; untracked voice days are null rather than zero. Registrations use existing account timestamps. Voice time preserves fractional minutes. No Auth0 permission change is required.

Sources: origen_accounts, origen_login_activity, origen_voice_activity, and migration 017's tracking start. Refresh is explicit. A failed overview refresh retains and labels the last successfully loaded data; revoked access clears it. Topic remains the call's initial topic. Native usage and provider costs are future phases.

Admin dashboard phase 3
-----------------------

Users now has literal case-insensitive first-name/internal-ID search, parent/student/not-provided role filters, saved/incomplete profile filters, stable sorting, and pages of 25 across all app accounts. Registration dates and last sign-ins are all-time; sign-in counts and connected minutes use the selected period. Filters apply to the directory, not the onboarding cohort. A user detail dialog shows recorded registration/onboarding dates, period usage and latest 30 sign-in/call events. Escape closes it, focus returns to the account button, and the layout works on mobile. Historical saved profiles display an unknown completion date instead of an invented timestamp. No email, Auth0 subject, student details, transcripts or summary content is returned.

Migration 018_onboarding_milestones.sql adds nullable server-owned onboarding_started_at and onboarding_completed_at fields and per-account activity indexes. Web and the shared native onboarding screen send {action:"onboarding-start"} to /api/family when opened; the receipt is best effort and must not interrupt registration. Successful complete-onboarding records completion within the same transaction as the profile. Repeated starts/saves retain the first timestamp. No historical timestamps are backfilled. Startup readiness requires migration 018. Deploy backend and frontend together; startup runs the migration automatically.

The onboarding journey is a registration cohort: current accounts created within the selected period AND after migration 018 was applied. Sequential counts are registration -> recorded onboarding open -> recorded profile completion -> connected call started after completion, with positive credited seconds. Onboarding calls are excluded from the final step. Older registrations in the period are counted separately as untracked. This is not an abandonment or time-to-conversion report: missing receipts, administrators bypassing setup, deleted accounts and people returning later affect counts. Current directory status uses persisted name and parent/student role; it is distinct from timestamped funnel completion.

POST /api/admin accepts users with days/page/search/role/status/sort/direction, or user-detail with a UUID and days. Both require the existing server-verified read:activity permission or explicit admin allowlist. Responses are not cacheable. Parameters are bound, sort columns/directions are allowlisted, and requests/pages/search length are bounded. Refresh reloads the directory and an open detail dialog. Access denial clears admin content; failed directory requests offer retry without displaying old rows under new filters.

Verification: node --test server/admin-users.test.mjs server/admin.test.mjs server/admin-overview.test.mjs server/family.test.mjs server/database.test.mjs; npm run build; and synthetic desktop/mobile browser checks in scripts/admin-dashboard-smoke.cjs. Browser checks cover date changes, keyboard charts, navigation, search/filtering/pagination, detail-dialog dismissal, refresh failure/recovery, logout and overflow. Configure ORIGEN_BROWSER_MODULE_ROOT, ORIGEN_BROWSER_CHANNEL and ORIGEN_PREVIEW_URL; save screenshots with ORIGEN_ADMIN_SCREENSHOT_DIR. Real PostgreSQL integration tests require a dedicated DATABASE_TEST_URL, never production.

Admin dashboard phase 4: voice quality
--------------------------------------

The Voice quality tab adds recorded start attempts, the percentage that reached a connection, failures before/after connecting, unknown outcomes, conversation continuity events, source lookup outcomes/timing, topic/language breakdowns, grouped error categories and latest 30 incidents. Filters use the same 7/30/90-day period plus starting topic/language. Counts are attempts or events, not users. Retries can be separate attempts within one logical conversation. A cancelled reply can be an ordinary interruption, not a bug. Audible gaps, volume variation, speaking time, provider costs and answer accuracy are not measured.

Migration 019_voice_quality.sql stores a small allowlisted subset of authenticated browser diagnostic events, linked to the owning account and cascading on account deletion. Each physical attempt has its own UUID; logical session IDs survive reconnects. Sequence uniqueness makes receipt retries idempotent; reconnects no longer collide after the sequence resets. Storage takes the account lifecycle lock, uses server receipt time, caps each attempt at 1,000 events, and discards unsupported event names/fields and arbitrary error-code content. Data export includes these records. Technical metadata remains until account deletion, consistent with activity records. This operational dashboard does not authorize research or model training.

Persisted fields: account ID, session/attempt UUIDs, sequence, allowed event name, server receipt time, starting/current topic or language when provided, enumerated connection state/error category and bounded lookup duration. Audio, transcripts, names, school information, student IDs, raw tool arguments and summary content are not stored here. Existing technical console logs remain separate. Authenticated diagnostic storage is best effort; storage failures return the existing successful diagnostic response and emit voice_quality_store_failed instead of disrupting calls. Diagnostic writes do not add model calls or research queries.

POST /api/admin {action:"voice-quality",days:7|30|90,topic:"all"|"profile"|"planning"|"finance"|"admissions"|"loans",language:"all"|"en"|"es"} requires the existing read:activity permission/allowlist. Queries select attempts with a received session_start inside the period and apply topic/language filters consistently to totals, events, breakdowns and incidents. The average lookup time uses successful browser-observed lookup duration, including cache-hit handling; it is not upstream latency. Missing start/outcome events, offline clients, older clients and admin bypasses limit completeness. No backfill from Render logs is performed. Unknown outcomes are displayed separately, and no connection percentage is shown when the denominator is zero.

Deploy backend and frontend together. Startup applies migration 019, and readiness requires it. The tracking availability date comes from the migration record; useful data appears only once the updated clients report events. ProfileVoice now records timeout and unexpected transport/data-channel termination before cleanup. Changing topics still updates the existing live connection; these instrumentation changes do not recreate audio or replace voice settings.

Verification: full npm test suite (218 passed, 3 dedicated-PostgreSQL tests skipped), npm run build, and synthetic desktop/mobile browser checks including topic/language filters, incident detail expansion, prior directory/navigation behavior, refresh recovery and page overflow. Tests also cover allowed fields, authenticated ownership, event bounds/idempotency query, coherent filter windows and account lifecycle handling. A real PostgreSQL integration check for migration/storage/aggregate queries is available in server/database.test.mjs with a dedicated DATABASE_TEST_URL; it was not run against production.

Admin dashboard phase 6: institutional reporting
------------------------------------------------

The Institutions tab provides an internal operational report with current institution-page/publication/verification totals, a searchable and paginated page directory, and anonymous monthly page-view/link-click counts. Status totals cover all current pages; directory filters and pages apply only to rows. A public snapshot can remain live while a newer draft awaits review, so live-page totals use published IS NOT NULL rather than draft status. Counts are events, not unique people, enrollment, student affiliation or academic outcomes.

Reporting uses only the last completed UTC calendar month. The endpoint rejects custom month/day ranges, preserving the existing institution-metrics reporting boundary. SQL suppresses values below 10, including absent/zero counters, before returning rows. No cross-institution engagement totals, small-cell inference, user/student affiliation joins, representative emails, conversation summaries, audio or transcripts are exposed.

The report's Download internal report button obtains a fresh server-authorized report and exports JSON for the current filtered page (up to 25 rows), with month, scope, suppression minimum, definitions, provenance and readiness results. It is not an external partner release. Changing filters/refreshing/unmounting cancels pending exports; revoked access clears the admin view and prevents the download. No message is sent to an institution and no recipient permission is granted.

POST /api/admin with {action:"institution-report",page:1,search:"",status:"all"} requires the existing read:activity permission or server allowlist. Allowed statuses are all/draft/submitted/changes-requested/published. Search is literal and bound; pagination uses stable updated_at/id ordering. Existing /api/institution-metrics/report membership permissions and counters are unchanged. No new migration is needed for phase 6; prior pending migrations through 019 are still required when deploying all admin changes.

Research remains synthetic-only as previously selected. The view projects only historical withdrawal, complementary-suppression and recipient-revocation control results from research/sandbox/latest.synthetic-report.json. It never exposes the stored released payload or manifest, which may already be expired or revoked. It fails closed if the snapshot is absent, malformed, contains production data, claims approval, includes real participants or claims live readiness. Technical control demonstrations are not institutional study approval or model-training permission. No live study enrollment or outcome release route is added.

Operational evidence is checked against ops/evidence.json with the existing readiness assessor. Missing owners/approval/evidence, duplicate gates, invalid dates and expired evidence remain Needs review. The UI returns gate IDs/current-validity only; raw evidence, owners and document contents remain private. This is a register assessment, not a new Render/provider audit. Research protocol, appropriate consent/recipient agreements, affiliation/enrollment definitions and outcome instruments remain work to agree with an institution before live research.

Sources: origen_institutions, origen_institution_metrics, the synthetic control snapshot and operational evidence register. The dashboard introduces no new collection, consent, research flags or paid model calls. It preserves the independent synthetic governance workflow and user data boundaries.

Verification: server/admin-institutions.test.mjs covers UTC month rollover, rejected periods/filters, literal search binding, SQL suppression, exclusion of personal-data joins and safe synthetic projection. Existing institution metrics/governance tests verify thresholds, membership boundaries, withdrawal and recipient revocation. Synthetic browser checks cover desktop/mobile navigation, filtering, pagination, report download, suppressed values, request failure/retry, revoked access during export and page overflow. Production build and full server suite are run. Dedicated real-PostgreSQL checks are opt-in via DATABASE_TEST_URL and are not run against production.
