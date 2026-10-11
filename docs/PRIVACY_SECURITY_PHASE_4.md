# Phase 4 — AI, hosting, and provider controls

Implemented locally on October 10, 2026. Production was inspected read-only.
These changes have not been committed, pushed, or deployed. Provider-console
settings that are unavailable through the connected tools remain unverified.
This is not a claim that the production privacy rollout is complete.

## Application controls

### Voice context and tool boundaries

- For signed-in planning, costs, loans, and application sessions, the selected
  profile comes from the authenticated account's student records. Caller-supplied
  profile prose cannot replace it. A forged student ID returns 404 before OpenAI
  receives a request, including during an in-place guide update.
- Saved summaries, plans, and workspace records are server-owned. Caller-supplied
  copies are ignored. Workspace notes/actions retain their account, student,
  version, status, and topic checks. Unconfirmed family scope receives student
  selection labels, not saved student context.
- Onboarding/profile editing can still send an unsaved profile draft. Recent
  spoken continuity is bounded conversation data, not proof of ownership or
  permission to edit a stored record. Tool instructions cannot bypass API/RLS
  account checks. Private tools never gain authority from retrieved web pages.
- Specialty changes still update the existing call; this phase does not replace
  the audio connection or add another model call.

### Separate private context from web research

`server/provider-privacy.mjs` projects research inputs to explicit fields.
Finance/admissions research receives a bounded question and institution only.
Opportunity research receives seven bounded preference fields. A web-enabled
roadmap receives only academic stage, institutions, and intended entry term;
names, GPA, private notes, needs, goals, and history are omitted. Consequently,
researched roadmaps personalize only to that smaller academic context.

Before research, account-owned names and recognized email addresses, phone
numbers, SSNs, long identifiers, JWT/API-key patterns, URLs, common street-address
forms, and labeled grades/financial amounts are removed. Known prompt-control
phrases are rejected before an external request. Live voice reports a blocked
lookup without ending the call or reading the rejected input aloud. There is no
additional AI preprocessing request or token charge for these filters.

**Limits:** this is minimization, not guaranteed anonymization. Free text can
contain unrecognized personal facts, encoded text, ambiguous names, or unfamiliar
address formats. Filters can also remove legitimate public terms. Prompt injection
is not solved by a phrase filter; authorization is enforced separately in code.
Web-enabled models may generate their own search queries from the filtered input;
Origen does not directly inspect each internal search query. Do not describe this
as a zero-disclosure or comprehensive DLP guarantee. Realtime audio itself still
goes to OpenAI, including personal information a user voluntarily speaks.

### Logs and provider state

- Browser diagnostic event names, error codes, language, mode, and status now use
  finite vocabularies. Unknown values become a generic category. Arbitrary
  operation/parameter/reason strings are omitted. Non-UUID session labels are
  hashed on all logging routes. Request-body text, tokens, raw provider messages,
  and SQL error detail are not added to logs. Valid session UUIDs remain useful
  for operational correlation; these are pseudonymous, not anonymous records.
- Direct Responses builders keep `store:false`. No background response storage,
  provider conversation store, vector store, or Realtime tracing is enabled by
  this change. Tests guard the existing request builders against storage drift.
- This does not inspect or disable Render edge logs, Auth0 logs, OpenAI abuse
  monitoring, or project-level data sharing. Provider retention is separate.

## Transport and browser headers

Production database connections explicitly require TLS. The default verifies the
certificate and hostname; URL parameters cannot silently replace those settings.
`NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected by production configuration checks.

| Database setting | Intended use |
| --- | --- |
| `DATABASE_TLS_MODE=verify-full` (default) | Public database endpoint or a trusted private certificate; optionally set `DATABASE_SSL_CA` to the correct CA PEM |
| `DATABASE_TLS_MODE=render-internal` | Only on Render (`RENDER=true`) with a private, single-label `dpg-…` host; encrypted TLS with Render's self-signed certificate, without certificate/hostname verification |

The internal exception is rejected for public hosts. It is a documented private
network tradeoff, not equivalent to verified public TLS. Render documents this
certificate distinction in its [PostgreSQL connection guidance](https://render.com/docs/postgresql-creating-connecting).
Do not copy the API's internal mode into an external operator/migration environment.

The API adds a deny-all document CSP and device-permissions policy plus production
HSTS. Those headers apply to API responses, not to the voice page's microphone.
The static-site Blueprint adds no-referrer, no-sniff, frame protection, HSTS, and a
permissions policy that allows the app's microphone and screen wake lock while
disabling camera, geolocation, payment, and USB.

The static site enforces only `object-src`, `base-uri`, and `frame-ancestors` initially.
The fuller CSP is **report-only** with explicit API/Auth0/Google Fonts origins;
inline styles remain allowed for React/anime.js, and HTTPS images remain allowed
for published institutional images. It adds no reporting endpoint, avoiding
accidental collection of callback URLs or private browser data. Inspect reports
locally in DevTools; do not export callback query strings. No claim that this
staged policy blocks all unwanted scripts or network requests is made.

Render static headers must be applied through its Dashboard or an existing
Blueprint sync; a `public/_headers` file would not establish them. Do not create
duplicate services from this reference Blueprint. See [Render's header documentation](https://render.com/docs/static-site-headers).

## Read-only production evidence

Captured October 10, 2026 in the previously authorized My Workspace. No user
profiles, conversations, credentials, or raw request logs were retrieved.

| Check | Observed | Remaining work |
| --- | --- | --- |
| API deploy | Live commit `9c4523064cd0c6a8361fb11f26834892397ee0cd` | Local privacy phases are not deployed |
| PostgreSQL | Version 18, available, Oregon; latest migration `028_onboarding_cohorts.sql` | Migrate through 036 and provision/check the restricted runtime role before deploying |
| Database transport | Server SSL enabled; inspection connection TLS 1.3 | No other client connections were present in the inspection snapshot; the app's active connection was not verified |
| Database network | External allowlist `0.0.0.0/0` | Replace with approved operator egress addresses, or disable external access after confirming internal app connectivity |
| Recovery | HA disabled; no replicas returned | Verify actual PITR window, exports, encryption/access controls, restore procedure, and backup expiry in Dashboard; HA is not a backup |
| Landing page | HTTPS 200; nosniff; CSP, permissions policy, no-referrer, HSTS and frame header absent | Apply staged static headers and repeat public checks |
| API health | HTTPS 200; no-store, no-referrer, nosniff, DENY present; new CSP/permissions/HSTS absent | Deploy the reviewed API after prerequisites |
| Auth0 discovery | HTTPS 200; issuer/JWKS host matches `origenedu.us.auth0.com`; HSTS present | Verify actual MFA Actions, role permissions, token lifetimes, social connection credentials, administrators, log retention and deletion workflow in the tenant |
| OpenAI project | Source request settings inspected; project console not available | Verify the key's project, scoped key permissions, administrator MFA, data-sharing/training opt-ins, applicable retention controls, and project membership |

The public header snapshot is `output/privacy-phase4-public-checks.json`.
The connected Render metadata does not expose backup-retention or workspace MFA
evidence. A paid plan or a healthy service is not proof of those settings.

OpenAI documents that `store:false` alone does not enable Zero Data Retention;
default abuse-monitoring retention and endpoint exceptions still matter. The
project's approved controls must be checked separately. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data?popup=false).

## Rollout and verification

1. Complete phases 2–3 prerequisites: separate migration/runtime credentials,
   migrations through 036, runtime grants, and Auth0 permission/MFA configuration.
2. Choose the database TLS mode above, verify connectivity from the API runtime,
   and run `npm run check:production` plus `npm run db:check-runtime`. Check
   `pg_stat_ssl` for the actual API connection; retain booleans/version only.
3. Review provider membership, MFA, key scope, backups/PITR, retention, and OpenAI
   opt-ins in each console. Record reviewer, date, setting, and redacted evidence.
   Do not upload secret keys, tokens, conversation content, or full environment
   dumps into this evidence pack. Unknown settings remain unknown until verified.
4. Deploy the API and client; apply the static header rules to the existing site.
   Test email/Google sign-in, MFA, English/Spanish onboarding, microphone permission,
   wake lock, interruptions, topic changes, summary saves, and native WebView flows
   with synthetic accounts. No real-provider/audio smoke test was performed here.
5. Review the report-only CSP on those flows before promoting it to enforcement.
   If a resource is blocked, add its precise required origin; do not use `*` for
   scripts/connections or remove ownership/logging protections as a workaround.
6. Restrict PostgreSQL external access using known operator/CI addresses or disable
   it after a verified internal route. Re-test operator recovery access. No live
   networking change was made because required operator egress is not known.

Research remains synthetic. Service delivery, institution reporting, research,
and model improvement retain separate purposes; this phase adds no training or
research export and does not enable real-content evaluation uploads.

## Local validation

- Full server suite: 445 passed, zero failures/skips, including real PostgreSQL
  isolation/deletion coverage and synthetic provider-payload/tool tests.
- Production TypeScript/Vite build passed. Existing bundle-size and Auth0 module
  directive warnings remain.
- Render Blueprint validated against Render's public JSON schema.
- New tests cover cross-account student guesses on starts and guide updates,
  forged browser context, unresolved scope, English/Spanish filtering, malicious
  tool arguments, telemetry field smuggling, TLS mode confinement, and saved-response
  settings. Existing workspace and API-header tests remain in the suite.
- These are deterministic application-boundary tests, not live model behavior,
  production role grants, a backup restore, or a provider-retention certification.
