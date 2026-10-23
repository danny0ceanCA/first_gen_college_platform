# Phase 3: student connections

Implemented locally October 18, 2026. This phase connects people; it does not publish or read binder content. Production flags, migrations, pilot enrollment and live Auth0/OpenAI checks have not been changed by this implementation.

## Student and coordinator experience

An operator-approved adult student opens **Connect with a coordinator** in the binder, types an exact code, or opens a coordinator's existing QR/link. The link preserves its destination through sign-in and never automatically sends a request. Codes are locators, not permission to access content.

With voice linking separately enabled, Origen has only `lookup_coordinator_code` and `prepare_coordinator_connection`. It reads back the name and organization, then opens the same screen confirmation. There is no model confirmation or acceptance tool. Uncertain/misheard codes use a typed fallback, without fuzzy matching.

The confirmation displays the coordinator, organization, student name and optional intended topics. Pressing **Confirm request** sends only that displayed student name and chosen topic labels. The coordinator sees the request in their own workspace, and must accept or decline it. Requests expire after seven elapsed days. Students can cancel pending requests or disconnect accepted connections. The UI is available in English and Spanish, uses a native modal with keyboard/Escape support, and fits phone widths.

All binder notes, summaries, recordings, family conversations and derived material remain private. No sharing grant or publication is created. Phase 4 will implement a separate student preview and explicit publication; Phase 5 will implement coordinator reads.

## Server and database boundaries

- Migration `052_coordinator_connections.sql` adds pilot enrollment, one active linking context per student account, two-minute challenges and shared lookup budgets. Connection rows gain a consented name snapshot and optional topic enum values.
- `/api/coordinator-connections` authenticates every operation. Actor/account identity never comes from the browser or model. New tables have RLS and no direct application privileges; the runtime can execute only the scoped connection command. Pilot enrollment has no web API.
- Pilot access requires the exact account/profile approved by an operator, a stored student role, an adult eligibility record at the approved revision, and no family ownership/member link. Changing role, eligibility or family links removes pilot approval and revokes connections. Restoring a role or age status does not revive prior approval. Account/profile deletion cascades the new records.
- Screen lookup creates an account-owned context; opening another context invalidates previous cards. Voice turns advance a server sequence, invalidating earlier cards. Scope change, call end and screen cleanup clear the client card and send a close request. Challenge expiry remains the server backstop if a browser disappears or cleanup cannot reach the server. Concurrent tabs intentionally supersede each other's unconfirmed cards.
- Confirmation rechecks current ownership, eligibility, coordinator/organization status, membership, code expiry/revocation, identity names and revisions. A duplicate confirmation returns the existing connection; a partial unique index prevents two live requests for the same pair. A timed-out response is not retried automatically; the UI asks the student to refresh their connection list.
- Coordinator inbox and decisions require the Phase 2 verified email and signed MFA/authentication evidence. Accept/decline requires authentication and MFA within 12 hours. Organization owners cannot accept another coordinator's requests. No binder selector is supported.
- Invalid, expired and revoked codes return the same unavailable response. Codes normalize only case, whitespace and hyphens. A shared database budget allows ten lookups per account per ten-minute window and 100 per socket-network hash per window. The current deployment deliberately does not trust arbitrary forwarded IP headers; a reverse proxy may share the conservative network cap. Verify this in staging before increasing the cap. The main API account budget remains in place.
- Budgets retain hashes rather than raw IP addresses and expire logically after ten minutes; rows older than one day are pruned during lookup. Contexts last at most one hour, challenges two minutes. Opening a context deletes earlier contexts/challenges for that account. No code, transcript or binder text is stored in these tables. General lifecycle retention work remains Phase 7.

## Code handling and retention

Raw codes are shown when generated and exist transiently in the typed/voice request. Only the canonical SHA-256 digest is looked up; challenges reference the existing code row. No code is included in connection lists, coordinator inbox data, notifications or diagnostic logs. URLs use a fragment, so their code is not part of the HTTP request path or referrer. Auth0 carries the return destination as application state, never as an authorization grant.

Voice processing necessarily sends the spoken code to OpenAI transiently. Before local recovery or server summarization, code-shaped text and coordinator-code turns are omitted; the following spoken code response is also omitted. This conservative redaction can omit surrounding coordinator-code wording. The live-memory write validator rejects code-bearing changes, and saved summary validation sanitizes generated/imported summaries again. The assistant is instructed not to copy codes into notes, plans, research or memories. Existing metadata-only logging remains in force.

## Activation steps, in order

1. Complete the real staff identity checks in [Phase 2](PHASE_2.md). Start in staging with fictional adult accounts.
2. Keep `ORIGEN_COORDINATOR_LINKING=false` and `ORIGEN_COORDINATOR_VOICE_LINKING=false`. Run `npm run db:migrate` using `MIGRATION_DATABASE_URL`, then `npm run db:grant-runtime` with the restricted `DATABASE_RUNTIME_ROLE`. Run `npm run db:check-runtime` using the runtime credential. The API startup readiness check refuses enabled linking without its function and grant.
3. Have an authorized operator verify that the exact student account is adult-owned, represents that student, and has no parent-managed or family-linked profile. Set the following process variables privately and run `node scripts/provision-coordinator-student.mjs`:

   | Variable | Value |
   | --- | --- |
   | `MIGRATION_DATABASE_URL` | Existing migration credential, never the web process credential |
   | `COORDINATOR_PILOT_SUBJECT` | Exact verified Auth0 subject of the student |
   | `COORDINATOR_PILOT_STUDENT` | Exact owned student profile ID |
   | `COORDINATOR_PILOT_REVIEWER` | Operator identifier for the approval record |
   | `COORDINATOR_PILOT_ACTION` | `approve` |

   The script independently checks adult/student status and absence of family links. It neither changes age/consent nor makes existing content shareable. To revoke, use the same identity/profile and action `revoke`; existing connections are revoked and old cards cannot be reused. Clear these one-run variables afterward.

4. Enable `ORIGEN_COORDINATOR_ACCOUNTS=true` and `ORIGEN_COORDINATOR_LINKING=true` in staging. Keep `ORIGEN_BINDER_SHARING=false` and `ORIGEN_COORDINATOR_FEEDBACK=false`. Check typed code, QR sign-in return, identity confirmation, cancellation, accept/decline, expiry, staff suspension and profile switching with synthetic accounts.
5. Enable `ORIGEN_COORDINATOR_VOICE_LINKING=true` only after checking the screen flow. Rehearse English and Spanish spoken codes, mishearing, spelling/typed fallback, interruption before confirmation, cancellation, call termination and uncertain network outcomes using the real voice provider. Verify saved summaries and recovery records contain no test code. The local automated suite mocks provider identity/voice transport; it does not substitute for this staging rehearsal.
6. Keep community-organization rollout gated on the remaining implementation phases and Phase 8 readiness. No new external service, model API key, queue or email provider is required for Phase 3.

## Rollback

Disable voice linking first, then general linking if necessary. Existing contexts cannot perform voice actions with the voice flag disabled; no new typed/voice operation is accepted when linking is disabled. This phase has no content grants to preserve. For pilot removal use the operator revoke script. Keep the additive migration and metadata for forward repair; do not roll back tables with a destructive migration.

## Verification

Local verification completed: **651 server tests passed, 0 failures, 0 skips**; production build and logging policy checks passed. Phone (390 px) and desktop (1280 px) checks showed no horizontal overflow. English/Spanish, keyboard submission, topic selection, pending requests, inbox rendering and Escape cancellation were checked with synthetic data. Live Auth0 and spoken OpenAI transport rehearsal remain pending before activation.

The focused suite covers normalization, forbidden model actions, duplicate/stale tool results, adult pilot checks, account/profile isolation, idempotent confirmation, fresh staff identity requirements, request expiry, code rotation, name changes, cancellation, network/account limits, role/pilot revocation, logging redaction and absence of any grant/publication. Existing Phase 1 privacy and Phase 2 provisioning tests are also rerun. Browser checks use fictional accounts and real React components; the reproducible harness is `output/playwright/coordinator-phase3-preview.js`.

Run focused checks with a **disposable synthetic** `DATABASE_TEST_URL`:

```powershell
node --test server/coordinator-connections.test.mjs server/coordinator-access.test.mjs server/binder-sharing-policy.test.mjs server/binder-sharing-postgres.test.mjs
npm run build
npm run check:logging
```

For the full server suite, also set `ORIGEN_TEST_DATABASE_URL` and `TELEMETRY_TEST_DATABASE_URL` to the same disposable instance and run `node --test --test-concurrency=4 server/*.test.mjs`. Do not run the test fixture against production.
