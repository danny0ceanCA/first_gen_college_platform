# Deploy Origen to Render

Create a Blueprint from this repository using render.yaml, or configure two services manually.

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

## Temporary anonymous live-voice preview

After deploying this version of both the API and web frontend, set the backend environment variable `ALLOW_PREVIEW_VOICE=true` to enable live voice without signing in. It is disabled by default. No new frontend environment variable is needed. The browser origin must already be in `ALLOWED_ORIGINS`, and `OPENAI_API_KEY` must be configured on the backend.

Anonymous access is limited to live voice, its official-source financial/application lookups, technical diagnostics and browser-local summary generation. Family records, persisted history and text chat still require verified Auth0 authentication. An invalid supplied token never falls back to anonymous mode. Preview traffic shares a limit of 120 requests/minute and five voice starts/minute per API instance, alongside the existing two concurrent voice setup requests. Preview uses the service's OpenAI credits.

Once Twilio login is ready, set `ALLOW_PREVIEW_VOICE=false` (or remove it) on the backend. No domain, SSL or database settings change is needed. This switch enables web live voice, including phone browsers; native mobile live voice remains pending.
