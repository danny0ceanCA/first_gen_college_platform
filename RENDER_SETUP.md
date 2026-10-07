# Deploy Origen to Render

## Current production safeguards

Set backend `NODE_ENV=production`. App access and AI endpoints require an authenticated account. `ALLOW_PREVIEW_VOICE` is retired and no longer enables anonymous access; remove it from the backend environment. Run `npm run check:production` before deployment. See [production controls](docs/vendor-readiness/PRODUCTION_CONTROLS.md) for live provider checks and restore/incident procedures.

Current database readiness requires migration `011_subject_locks.sql`; older phase-specific migration references below are historical. Deploy the backend before the web frontend, verify `/readyz`, then verify signed-in data download and closure using synthetic accounts. Install and validate the Auth0 recent-auth Action before rollout: [fresh-auth and concurrency controls](docs/vendor-readiness/RECENT_AUTH_AND_CLOSURE.md). Provider identities, backups and mobile controls require the separate processes documented in [account lifecycle](docs/vendor-readiness/ACCOUNT_LIFECYCLE.md).

Create a Blueprint from this repository using render.yaml, or configure two services manually. The Blueprint prompts for DATABASE_URL: use the existing Render database internal connection URL. It does not create another database. NODE_ENV is set to production; anonymous voice must remain disabled there.

## API web service
Build: `npm ci`. Start: `npm start`. Health check: `/healthz`.
Set OPENAI_API_KEY as a secret. AUTH0_DOMAIN is already provided.
For PostgreSQL phase 1, set backend-only `DATABASE_URL` to your Render database's internal URL. `npm start` applies migrations before accepting traffic. Verify database readiness at `/readyz`; see [DATABASE_PHASES.md](DATABASE_PHASES.md) for the staged integration plan.
Create an API in Auth0 named Origen API with identifier `https://api.origen.edu` (an identifier, not a required live domain), signing algorithm RS256. Set AUTH0_AUDIENCE to that identifier.
Set ALLOWED_ORIGINS to the exact frontend HTTPS origin, e.g. `https://origen-web.onrender.com`. Multiple origins can be comma-separated. Do not use a wildcard.

## Static site
Build: `npm ci && npm run build`. Publish: `dist`.
Set VITE_API_URL to the actual API service HTTPS URL.
Set VITE_AUTH0_AUDIENCE to the same Auth0 API identifier.
Add the static site's HTTPS origin to Auth0 Web application's Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins. Enable its SMS passwordless connection when Twilio is ready.
Add a rewrite `/*` to `/index.html` (included in Blueprint).
Redeploy the static site after changing VITE_ values; these are bundled at build time.

## Verification and limitations
API `/healthz` returns `{ "ok": true }`. Anonymous API POST requests return 401.
Sign in on the static site and test voice and research.
Account and student persistence is implemented in phase 2. Deploy the API before the frontend, then verify `/readyz` and signed-in saves. Phase 3 persists conversation summaries to PostgreSQL and supplies selected-student history automatically to voice sessions. Native sign-in and family persistence require a development build and Auth0 callback setup; see DATABASE_PHASES.md.
Sanitized diagnostics go to Render logs. Audio and transcripts are excluded.
The API applies a per-user 120-request/minute abuse limit per instance, with no conversation lookup-count cap. Add shared quotas before scaling to multiple instances.

## API logging

The Node service writes structured JSON logs to standard output. In Render, open **Origen Edu → Logs** and search for `requestId`, `api_request`, `database_error`, `summary_error`, or `upstream_error`. Every request receives a server-generated `X-Request-ID` response header; the browser Network panel exposes it, including for failed requests. Search that exact ID to connect request completion, internal failure and upstream OpenAI events. Voice events also retain their Diagnostic session ID.

Completion records include the known endpoint, HTTP method/status, duration, severity and safe error code. Upstream records include a separate `upstreamRequestId` for OpenAI support. Authentication failures, blocked origins, rate limits and aborted connections are logged too. Successful health/readiness probes are omitted; failed probes are logged. Logs do not include authorization headers, tokens, account identifiers, request bodies, query strings, profile details, audio, transcripts, SQL queries, raw error messages or stacks. Database SQLSTATE and recognized network/timeout codes provide failure details safely. Logs are not stored in PostgreSQL; retention follows the hosting provider's log retention.

## Registration-only access

Deploy both the frontend and backend. Public visitors can read the landing, About, Privacy and published institution pages. App routes require Auth0 sign-in; Create an account opens Auth0 sign-up. All AI and family-data endpoints require a valid access token, including voice, research, diagnostics and summaries. Remove the obsolete `ALLOW_PREVIEW_VOICE` setting. No domain, SSL or database migration is needed.

## Voice lookup tuning

Admissions lookups now answer the specific question with a smaller response budget and lower reasoning effort, retaining mandatory live searches and official-source validation. Actual latency still depends on OpenAI and the source pages; verify response quality and timing after deploying.

Within one web voice call, an exact repeated lookup (same topic, language, institution and question) can reuse a successful result for up to five minutes. Cache entries never cross sessions, expire, preserve original source-check dates, and exclude failed/uncited results. The cache is limited to twelve entries. Long lookups display elapsed time and a clearer waiting message after twenty seconds.

Diagnostics now retain the safe cancellation reason, speech segment duration and tool count. Search for `response_cancelled`, `speech_segment`, `lookup_cache_hit` and `lookup_success` to evaluate interruptions and lookup latency. No speech text or audio is logged. Microphone/VAD sensitivity is unchanged until those diagnostics establish whether cancellation reflects actual speech or false detection.

## Planning voice module

Institution registration/pages use migration `008_institutions.sql`; readiness now requires 008. See [INSTITUTIONS.md](INSTITUTIONS.md) for the separate dashboard, affiliation review, public page snapshots and backend-only `INSTITUTION_REVIEWER_SUBJECTS` allowlist. Deploy the API first. With no reviewer identities configured, institution drafts can be submitted but cannot be published.

Structured plan storage is implemented by `007_planning_records.sql` and authenticated `/api/plans`; readiness now requires 007. See [PLANNING_DATABASE.md](PLANNING_DATABASE.md) for table relationships, versioned writes and deletion rules. Deploy the API first. Planning voice automatically receives saved active plans for its confirmed target. The plan editor and voice-to-plan review flow are not yet connected; the current UI saves discussion summaries.

Web navigation includes Planning, with a voice specialist that adapts to high school, community college, transfer and college goals. Its `lookup_education_planning` tool uses `/api/admissions-research` with `purpose=planning` and mandatory live official-source searches. UC admissions, UCOP A–G course lists, CSU, CCCCO/CCCApply, ASSIST, campus catalogs and Federal Student Aid are supported sources. An inaccessible interactive course list or agreement must be reported as unverified. This is researched guidance, not a course audit or guaranteed admission/degree certification.

Parent discussions use the same student/family confirmation flow. Planning summaries persist as mode `planning`, record suggested actions versus verified requirements, and automatically join the confirmed target's future voice context. Deploy the API first: startup applies `006_planning_conversations.sql`, which widens the summary mode constraint without changing existing histories. Then deploy the web frontend. No new environment variable is required; the existing Realtime voice and Sol admissions research settings apply. The module is responsive for phone browsers; native live voice remains pending.

## Parent/student account invitations

Parent college-cost and application voice guides ask which student the discussion concerns and require an on-screen confirmation before using that student's history or saving a summary. General family discussions use a separate, collapsed Family conversations history on Family home, private to the signed-in account. Switching targets saves the previous segment and opens a fresh voice session with only the next target's history. Profile-edit/onboarding voice remains attached to the profile being edited. Native live voice is still pending; native Family home can display persisted family summaries.

Deploy the backend before the frontend for this change. Startup applies `005_family_conversations.sql` and readiness requires it. This permits account-private summaries with a NULL student ID; existing student histories keep their original ownership. Test initial confirmation, duplicate names, a student-to-student switch and a general-family discussion before enabling production use.

Deploy the backend before the web frontend. Backend startup applies `004_account_links.sql`; `/readyz` now requires that migration. No new Auth0 application, SMS provider, email capture, or server secret is required. Linking requires genuine authenticated accounts; anonymous voice preview cannot access `/api/account-links`.

In Settings → Linked accounts, select an owned student profile, choose Invite student or Invite parent, and create a link. Share it manually by text/WhatsApp/email or copy it. HTTPS invitation links put a random 256-bit token in the fragment (not a logged query string); only its SHA-256 hash is stored in PostgreSQL. Links expire after seven days, are accepted once, and can be cancelled. Creating another invitation for the same profile/role cancels the earlier one. Roles are self-described relationships, not identity-verified proof of parenthood or ownership of a phone number. Anyone with the invitation link can accept it after authenticating, so the UI asks users to share only with their intended recipient.

Opening a web invitation preserves its route through Auth0 sign-in and requires explicit acceptance. Accepting creates a separate linked profile in the recipient's account; existing profiles are not automatically merged. Both participants can edit name, education stage, interests, GPA, school, activities, goals, institutions and entry term. Shared fields are resolved from the original profile on each family load/save. Use Refresh linked accounts or reopen the app to retrieve changes made by the other person; this is not a live push subscription. Private notes, practical needs, account email and conversation summaries are never copied/shared. Each participant's voice context uses only their own account's history.

Either participant can unlink. The recipient keeps the last shared academic snapshot and their private history, but future edits are independent. The original profile must be unlinked before its owner can delete it. Linked recipients cannot invite additional people to the original profile.

Native Settings uses the phone share sheet and can review a pasted HTTPS invitation. The web page also offers `origen://invite?token=...` to open an installed development/production build. Native invitation state survives Auth0 login. Native sign-in still requires the configured development build; Expo Go's preview cannot accept an invitation. `EXPO_PUBLIC_WEB_URL` defaults to `https://origenedu.ai`; override it when testing against a local web frontend. Automatic HTTPS universal-link app opening is not configured; the web landing page offers explicit app opening instead.

Verify with two separate authenticated accounts after deploying: invite/accept, academic edits in both directions, private notes/history isolation, cancelled/used/expired links, and unlinking from either side. Automated tests exercise database behavior using pg-mem; the real PostgreSQL integration check requires a dedicated `DATABASE_TEST_URL` and is skipped when absent. No invitations are sent automatically.


## Google and email sign-in while SMS is pending

Web and native entry points use Auth0 Universal Login without forcing the SMS connection. The landing page explains Google and email/password registration in English and Spanish. Available methods are controlled by connections enabled for each Auth0 application; changing the frontend alone does not enable a connection.

1. In Authentication > Database, create an Auth0-hosted connection named `Origen-Email-Password`. Use email and password; leave sign-ups enabled. Enable it for Origen Web and Origen Mobile only. Origen now uses the separate `origenedu.us.auth0.com` tenant. Configure this tenant only; leave the CareSpend tenant unchanged. Under each Origen application's Connections, disable unrelated database connections and disable SMS while Twilio is pending.
2. In Authentication > Social, configure Google/Gmail (`google-oauth2`) and enable it for both Origen applications. Request basic email/profile information only, without Gmail inbox scopes. For production use Google's own OAuth credentials, stored in the Auth0 connection rather than the frontend or this repository. Follow https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/google .
3. For the current tenant, the Google OAuth client is a Web application with authorized JavaScript origin `https://origenedu.us.auth0.com` and redirect URI `https://origenedu.us.auth0.com/login/callback`. These are Google's callbacks to Auth0; retain the existing Origen web/native application callback and logout URLs in Auth0. If the tenant uses a custom Auth0 login domain, use that domain instead.
4. Configure Universal Login branding/text for Origen so the screen does not welcome Origen users to CareSpend. Preserve branding used by other applications. Verify email verification and password-reset delivery with an actual email account; configure a production email provider in Auth0 for reliable delivery.
5. Test a new email signup, returning email login, password reset, Google signup/login, first-time parent/student setup, sign-out, and a family invitation after login. Test native authentication in a development build; Expo Go does not include the Auth0 native module.

Passwords are managed by Auth0. Origen continues to store records under the verified Auth0 subject, never under a client-supplied email. Signing in with Google and signing up separately with email can create distinct accounts even when the emails match. Auth0 identity linking is not yet implemented; do not promise automatic merging. When SMS is enabled later, implement explicit ownership-verified identity linking before offering an existing user a new phone sign-in. Family profile sharing is a different feature.


## Additional rollout notes

### Operational guidance history (phase 2)

Migration 015 adds account-scoped session/topic history and model provenance. Collection defaults off. Follow the [phase 2 rollout](docs/data-architecture/PHASE_2.md) before setting backend `GUIDANCE_HISTORY_ENABLED=true`, `GUIDANCE_DATA_OWNER`, and a known build revision. Legacy issuer mapping requires explicit provenance confirmation. No frontend environment variable is required; preview conversations are excluded and metadata expires after 90 days. This does not enable research or model training.

### Separate Origen tenant migration details

The web defaults and Blueprint now use `origenedu.us.auth0.com` and Origen Web client `SvPMuyj1thhZoowDmsvqsQ05qzEntXmd`. Existing Render environment overrides must be changed explicitly: frontend `VITE_AUTH0_DOMAIN`/`VITE_AUTH0_CLIENT_ID`, backend `AUTH0_DOMAIN`. Recreate Origen API in the new tenant with the same API identifier used by the backend `AUTH0_AUDIENCE` and frontend `VITE_AUTH0_AUDIENCE`; the identifier itself does not need to change. Deploy the matching frontend and backend after connection, callback, API, and recent-auth Action setup is complete. The new tenant also needs the existing `auth0/recent-auth-action.cjs` Action installed according to the fresh-auth guide above. Recreate reviewer role/permissions there if institution review is used. Native configuration and the Auth0 config plugin now use the new tenant and Origen Mobile client `8dHHGrPYL8SYWZjnlFWSzthTfsoEv8cU`; rebuild the development/native app because the plugin domain changed. Use the callback/logout URLs in DATABASE_PHASES.md. Existing Auth0 users are not migrated by changing configuration.

### Phase 3 progress history (off by default)

Migration 016 adds private academic observations, plan revisions and optional feedback/reported milestones. See [phase 3 rollout](docs/data-architecture/PHASE_3.md). Backend opt-in: `PROGRESS_HISTORY_ENABLED=true`, `PROGRESS_DATA_OWNER`, and an application revision. Frontend opt-in: `VITE_PROGRESS_HISTORY_ENABLED=true` after API readiness. Retention is 90 days; no research access or verified institutional outcomes are enabled. Validate on a dedicated staging PostgreSQL database before production collection.
