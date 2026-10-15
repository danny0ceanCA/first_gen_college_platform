# Guardian permission: local implementation and launch checklist

Updated October 15, 2026. **Local, reviewable code only. Not deployed. Email delivery is disabled by default.** No credentials, production configuration, migrations, or live records were changed. No real emails or OpenAI requests were sent by the synthetic tests.

## Registration recommendation and implemented flow

Use the neutral age and education screen before normal sign-in, and repeat/record the answers against the authenticated account before mounting student profiles, onboarding or AI. Neither question has a selected answer. Collect an age band rather than a full birth date. Ninth grade and above describes the educational audience; it does not establish age.

- Under 13: stop account/profile/AI onboarding, including a younger ninth grader. Provide the privacy contact without suggesting different answers.
- Ages 13–17 in the educational audience: keep the account pending until a parent or legal guardian reviews the notice and affirmatively approves through the emailed link.
- Age 18+: allow the student path or adult supporter path after screening.
- Other educational situations, a minor claiming the adult supporter path, denied or withdrawn permission: block personal profile/AI use. Corrections require support review; there is no self-service age override or reactivation after a refusal.
- Existing accounts with no eligibility record are unknown and blocked from personal features. No automatic grandfathering or age inference from school grade.

Auth0 still handles sign-in. A direct Auth0 signup URL may create an authentication identity before Origen screens eligibility; this code does not change the Auth0 tenant. It blocks Origen profile collection and AI afterward. Before launch, review Auth0 signup behavior and decide whether to prevent those preliminary identities at the identity provider as well. A self-reported band cannot prevent someone lying or creating another identity.

The separate Terms acceptance proposal remains separate work. A welcome receipt, microphone permission, family invitation, and guardian approval are distinct records.

## Guardian notice and email

The English/Spanish notice in `server/guardian-email.mjs`, version `guardian-2026-10-15-v1`, identifies Blueprint Holdings LLC and `daniel@origenedu.ai`, explains OpenAI processing, automatic summaries, separate saved records, withdrawal/deletion, and the absence of access to conversations. The guardian page displays that notice and a request reference, with an unchecked declaration and explicit decision buttons. Opening or scanning the link never grants permission.

Permission does **not** create a family link, reveal a profile or conversation, give a community coordinator access, or authorize marketing. Email possession plus an adult's declaration is evidence of an action; it does not conclusively establish identity, age, or legal guardianship and is not a claim of legally sufficient verifiable parental consent. The guardian should recognize the request reference shared separately by the student. Final notice wording and the appropriate verification method remain review items before launch.

The code records a hashed account subject, age band, audience, status/revision, request ID, guardian email, notice version, server timestamps and decision events. It does not collect full birth dates or guardian identity documents. Approval and withdrawal use separate cryptographically random 32-byte tokens. Only SHA-256 hashes are stored in PostgreSQL. Tokens are sent in URL fragments, then POST bodies; the normal guardian page removes the fragment from browser history after capturing it. They are absent from application logs and student API responses. The future email provider and recipient mailbox necessarily receive the links; disable link tracking and do not forward them.

Approval links expire after 48 hours and can be consumed once. A replacement request invalidates both earlier links. Resend is limited to one per minute and three per rolling account window of 24 hours; the public guardian endpoint uses separate process-local budgets for matched capability hashes and invalid requests by connection peer. Invalid traffic cannot exhaust a valid link’s budget on a shared proxy; classifying a syntactically valid unknown token requires an indexed database lookup. Both budget caches are bounded. Public guardian operations have at most two concurrent database lookups/transactions per API process, with excess work rejected instead of queued; infrastructure-level flood protection remains separate. Permission and the separate withdrawal link expire 180 days after the request. Expired approval can be renewed through a new request. Denied or withdrawn permission cannot be reactivated by the student. Provider acceptance is shown as acceptance, not confirmed delivery. A failed or disabled send leaves permission pending. Restarting the API resets its in-memory budgets, not database request limits. Withdrawal remains available across notice-version changes; approval still requires the current notice.

## Enforcement and withdrawal

`server/index.mjs` checks permission before reading personal request bodies. The gate covers profile read/write, Realtime session creation and guide updates, chat/research, transcripts/summaries, deferred history, notebooks, plans, worksheets, family links and personal telemetry. Privacy/export/closure and separately authorized institutional/staff APIs remain available for their own limited purposes; they retain their existing authorization checks. Public institutional pages and optional public inquiry forms are separate flows.

An HTTP request carries the permission revision it started with. Provider calls check that revision before dispatch and after body reads. Subject transactions check again under the same serialization lock used by a guardian decision. Responses are held until a final permission check. Revocation therefore rejects stale writes/results, including work delayed across a new approval. A transaction already holding the subject lock can finish before withdrawal commits; withdrawal waits for that transaction. Information already sent to a provider cannot be recalled by an abort.

Web gates check status every five seconds and fail closed on status/authentication failures. Revocation unmounts personal screens and clears private browser buffers through the existing privacy lifecycle. Native personal screens are gated before family loading and reuse the web guardian flow in the trusted onboarding surface. Account changes discard the prior subject's gate state. Native network failures close the gate after the request deadline; native device execution still needs a release-device smoke test.

Realtime audio travels directly to OpenAI after setup. The API stores a call ID, subject hash, revision and ten-minute deadline, never audio, and checks durable call records every two seconds. Revoked, missing or expired permission triggers the OpenAI hangup endpoint; failures remain queued for retry across restarts. The browser also stops its connection when the gate closes. This is **not an instantaneous cutoff guarantee**: network outages, a stopped supervisor, or provider failure can delay remote termination. Verify hangup behavior with a separately approved controlled provider test before enabling teen voice. The local tests use mocked provider responses only. The application never returns a Realtime answer without a recognized call ID to supervise.

## Retention and deletion

Guardian email is removed immediately on denial/withdrawal and with account closure. Hourly cleanup removes email/token hashes from pending requests after 30 days, denied/withdrawn records after 30 days, and expired approvals after their 180-day term. Decision event rows expire after 365 days or earlier on account closure. The latest eligibility status, age band, notice version and dates remain until account closure to enforce the gate; there is no inactivity purge for that minimal record. Earlier emails are overwritten on resend; event rows retain request linkage without the old email or tokens.

Account export includes the user's eligibility and decision metadata, excluding token hashes. Closure removes the eligibility row, guardian email and decision events even if a profile was never created. Durable Realtime call rows stay only until the provider confirms termination or reports the call absent; retry continues on failure. Existing hashed closure receipts, Auth0 identity deletion, backups and provider logs retain their separately documented treatment. Withdrawal is not deletion. Parents may request deletion at `daniel@origenedu.ai` without linking accounts.

## Exact future Render/email setup

The chosen transport is **Resend's HTTPS email API**, using native `fetch`; there is no SMTP configuration or new mail SDK. Configure the **backend Render web service**, ID `srv-db02or0u01pc738ktekg`, URL `https://origen-edu.onrender.com`. Do not put the key in the static site, `VITE_` variables, the mobile bundle, documentation, or source control.

| Variable defined by the code | Current/default behavior | Future enabled configuration |
|---|---|---|
| `GUARDIAN_EMAIL_TRANSPORT` | `disabled` when absent | `resend`, only after delivery is separately authorized |
| `GUARDIAN_EMAIL_FROM` | `daniel@origenedu.ai` | Same address, verified/authorized by Resend |
| `GUARDIAN_EMAIL_REPLY_TO` | `daniel@origenedu.ai` | Same monitored inbox, or another explicitly chosen monitored address |
| `GUARDIAN_PUBLIC_URL` | Unset is valid while disabled | `https://origenedu.ai/` if this is the final deployed web origin; HTTPS origin plus `/`, no path/query/fragment/credentials |
| `RESEND_API_KEY` | Not needed while disabled | A server-side Resend API key with sending access for the verified domain; never a mailbox password |

Environment variables alone are **not sufficient**. Before real delivery:

1. Create/authorize the Resend account and verify the sending domain `origenedu.ai` with Resend's required DNS records. Preserve existing inbound mail records. Check the sender is permitted, the account can send to real external recipients, and DKIM/SPF/DMARC and tracking settings are reviewed. An email alias alone neither authenticates application mail nor supplies an API credential. No separate `permissions@` alias is required.
2. Confirm `daniel@origenedu.ai` receives replies and privacy requests. Finalize the public privacy notice and guardian notice, supplier terms/retention, and any legal verification requirements. Resend becomes a named processor only when used; no live Resend account or contract was verified here.
3. In a separately authorized release, deploy the backend, web and relevant native changes; apply migration `039_guardian_permission.sql` using the separate migration credential; rerun `npm run db:grant-runtime` with the existing restricted role and verify `npm run db:check-runtime`. Do not run the web service with a migration-owner credential. Readiness now requires migration 039. Confirm the supervisor and hourly cleanup are running.
4. Verify the public web origin serves the new guardian page, backend CORS permits it, and the existing frontend API URL points to this backend. Auth0 signup/age behavior and published documents must match the flow. Disabled delivery is a deliberate fail-closed state that prevents teenagers from proceeding.
5. After explicit approval for real delivery, add the Resend secret and enable `resend`. Send one controlled message to a consenting adult test recipient, check receipt and both links, replay/expiry/withdrawal, privacy logs, and provider hangup with controlled AI data. Provider HTTP acceptance alone is not delivery evidence. Keep a rollback path that disables delivery and personal access rather than bypassing permission.

Official technical references: [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email), [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction), [OpenAI Realtime hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup). These support API mechanics, not claims about this account's actual provider configuration.

## Local review without sending email

Run `node scripts/review-guardian-permission.mjs` from the repository, then open `http://127.0.0.1:5183/guardian-review`. Ports 5183/5184 must be free. The script ignores environment files, uses a synthetic in-memory database and token verifier, binds loopback only, and captures messages in memory. Use only fictional `.invalid` addresses. No external sender or OpenAI transport is called.

Choose the synthetic teen account, select both unanswered questions, request permission, and click **View mock mailbox**. Open the approval link in a new tab, review English/Spanish, check the declaration and approve. Return to the student tab to see its gate open. Use the separate withdrawal link and watch it close. Switch to the other synthetic accounts to test an adult and an under-13 ninth grader. Ctrl+C stops the review; restarting resets all synthetic data. Do not use this tool with real family information or expose its ports publicly.

Automated checks: `node --test server/guardian-permission.test.mjs`; the dedicated PostgreSQL test is `server/guardian-postgres.test.mjs` with `DATABASE_TEST_URL` pointing **only to a disposable local test database**. Browser test: `output/playwright/guardian-permission-check.js` through Playwright CLI against a fresh local review server. The native source must also pass `npm --prefix mobile run typecheck` and `npm --prefix mobile run lint`.

## Verification recorded October 15, 2026

- Full Node suite: 464 tests, 450 passed, zero failed, 14 environment-dependent skips. See `tmp/guardian-suite-final.log`.
- Separate disposable PostgreSQL 18.4 run: 13 checks passed, zero skipped or failed, covering the existing account-isolation suite and the new guardian migration/RLS/concurrency test. The runtime role was neither an owner nor an RLS-bypass role. See `tmp/guardian-postgres-results.log`.
- Playwright: all 11 synthetic browser checks passed, including unselected age questions, pending block, mock mailbox, explicit English/Spanish approval, replay rejection, withdrawal, account switching, adult path, under-13 block and mobile layout. External requests were blocked in the browser walkthrough. Screenshots are in `output/playwright/guardian-*.png`.
- Web production build, native typecheck and native lint passed. The web build still reports the existing Auth0 directive and large-chunk warnings. No native device build or real provider/email delivery was exercised.
- The revised proposal has 13 pages; the PDF was rendered and visually checked, with editable text and Python source alongside it in `output/pdf/`.

Principal changes: migration 039; `server/guardian-permission.mjs`, `guardian-email.mjs`, `permission-context.mjs`, `permission-execution.mjs`; the API gateway, isolation, transaction guard and lifecycle export/deletion integration; web `EligibilityGate`/`GuardianPermission` and entry points; native `MobilePermission` and the shared welcome bridge; dedicated synthetic tests and review script. Existing unrelated binder/PDF-export edits were preserved.
