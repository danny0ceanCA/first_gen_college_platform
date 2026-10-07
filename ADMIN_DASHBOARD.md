Admin dashboard setup
=====================

Recommended: manage access through Auth0
--------------------------------------

In the Origen tenant, open Applications → APIs → Origen API → Permissions and add `read:activity` (view operational dashboard). In API Settings enable RBAC and Add Permissions in the Access Token. Create an **Origen Admin** role under User Management → Roles, add that API permission to the role, and assign the role to your user. Sign out and back in to obtain a fresh token. The backend verifies token signature, issuer and API audience before accepting its `permissions` claim. App profile roles or user-editable metadata never grant admin access. Leave `ADMIN_SUBJECTS` empty when relying exclusively on Auth0 roles.

Alternative: server-managed allowlist
------------------------------------

1. Register/sign in to Origen normally. In the **Origen** Auth0 tenant, open User Management → Users → your user, and copy User ID (not Client ID).
2. Add `ADMIN_SUBJECTS` to the Render **backend** environment, set to that exact User ID. Comma-separated IDs allow multiple administrators. Never set this as a VITE frontend variable. Empty grants nobody access.
3. Deploy backend and frontend together. Startup applies migration 017; `DATABASE_URL` is required. Do not edit previously applied migrations.
4. Sign in and open `https://origenedu.ai/#admin`. Access is checked server-side on every request. Ordinary users receive 403. Admin access does not require a separate Auth0 application or change the domain.

Definitions and limits
----------------------

- Registered users: current PostgreSQL app accounts, including incomplete onboarding; not all identities in Auth0 that never opened the app. Deleted accounts disappear.
- Sign-ins: deduplicated successful Auth0 web callback returns. Refreshes and silent token renewal are excluded. Native app sign-ins are not yet instrumented.
- Voice minutes: connected web voice time including pauses/listening, recorded by 15-second heartbeats with server time. Failed starts are excluded, missed heartbeats undercount, each heartbeat is capped at 30 seconds, and each physical call is capped at 10 minutes. This is operational telemetry, not billable-provider usage. Topic reflects the initial guide; changing topics preserves the call and does not count a new sign-in.
- Dashboard usage cards/users cover 30 days; account count is all current accounts. Newest 200 users and latest 50 activity records are shown. Refresh explicitly reloads.
- Tracking starts at deployment; no historic login/minute reconstruction. No email, audio, transcripts, summary content or student details appear on the dashboard. First names and internal account IDs are shown only to administrators.
- Activity records remain until account deletion, and are included in that account's data export. Account deletion cascades both activity tables. The existing research flags/consents remain independent; this dashboard does not authorize research or model training.

The current implementation counts browser-reported connection activity. It is useful for product operations but should not be used for billing, financial audits, or research claims without further validation against provider telemetry.
