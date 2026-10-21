# Coordinator self-registration

Implemented on October 20, 2026. The product owner subsequently authorized production migration, grants, all six coordinator features, and commit/push. See [the activation record](PRODUCTION_ACTIVATION_2026-10-20.md) for deployment evidence and remaining live-provider verification.

## Applicant experience

1. Visit `/#coordinator-register`, linked as **Become a coordinator** on the landing page.
2. Create an individual Auth0 account or sign in with an existing account. The callback returns to registration rather than student onboarding.
3. Verify the sign-in email with Auth0. Submit a name, organization name, HTTPS organization website, and job title. The API obtains the email from Auth0 `/userinfo` using the verified account's bearer token; it ignores any email, subject, approval, or privilege asserted by the form.
4. See **Your application is awaiting review**. Returning to the normal app entry while pending returns to this screen. The applicant can withdraw a pending or declined application and submit corrected details. Retries never silently replace an application under review.
5. Join the verified organization's team using its owner's existing email-bound invitation. Accepting a staff invitation requires the existing verified-email and MFA checks. This step establishes organization membership; submitting an application does not.
6. After independent approval, open the coordinator workspace, complete its MFA check, and create a connection code.

Applications and responses are in-app. No invitation or approval emails are sent automatically. Owners share invitation links themselves. The applicant should return to check status.

An approved application is a historical decision, not permanent authorization. Suspension, member removal, organization status changes, and staff revocation still block the workspace.

## Reviewer process

Use `/#coordinators` with `manage:institutions` and verified email/MFA. The existing institution reviewer allowlist also maps to this permission. Staff reads require authentication/MFA within 12 hours; approval or decline requires both within 5 minutes.

1. Select **Refresh applications** under **Coordinator applications**. The queue is paginated, 50 pending applications per page.
2. Independently verify the person's affiliation using the supplied organization information. Applicant-entered text is a claim, not verification.
3. Register/verify the organization through the existing Institutions workflow and approve its coordinator pilot. An independent reviewer must approve; an organization member cannot approve their own organization.
4. Have the organization's owner invite the applicant to its team. The applicant must accept with the invited verified email. Use an appropriate existing staff role; review of this application does not change that role.
5. Select **Review**, choose the matching verified organization, and enter a message visible to the applicant.
6. **Approve coordinator access** enables the coordinator profile only if that exact authenticated applicant is already a member of the selected active, verified organization. It rejects blocked staff, self-review, review by members of that organization or its parent, missing membership, and already-decided/withdrawn applications.
7. **Decline application** records the decision and explanation without granting anything. The applicant may withdraw and reapply.

Approval creates no connection codes, student connections, binder publications, or sharing grants. Students must still confirm each connection and explicitly publish selected eligible binder items. Family conversations and family-derived content remain excluded.

## Deployment

1. Run `npm run db:migrate` with the migration-owner credential; this applies migrations through `059_coordinator_registration_safety.sql`.
2. Run `npm run db:grant-runtime` using the existing migration credential and restricted runtime role. The application and persistent review-control tables have RLS and no direct runtime grants. Access uses `origen_coordinator_application_command(jsonb)` only.
3. Run the existing coordinator database readiness checks. Provisioning readiness requires migration 059, the application function, and its runtime execute grant.
4. Deploy the code. No new environment variable or external service is required. The owner has authorized all six existing coordinator switches for this release; `render.yaml` reflects that intended configuration.
5. When ready to receive applications, enable `ORIGEN_COORDINATOR_ACCOUNTS=true` and redeploy. This enables registration and existing coordinator provisioning/workspaces. Linking, voice linking, sharing, viewing, and feedback have separate switches and stay disabled until intentionally enabled with their prerequisites.
6. Before inviting real users, verify the deployed Auth0 signup/email verification, callback, existing OTP actions, reviewer permissions, and actual organization invitation flow. Local synthetic tests do not establish that tenant configuration is correct.

While the accounts flag is false, the registration route explains the application process, but the API rejects submissions. Do not tell Keadrian that registration is open until deployment, migration, grants, and activation are complete.

Migration 058 removes manual student pilot enrollment. Students use their own account with existing permission: adult status, or current guardian approval obtained through the email permission flow. Email verification alone is insufficient. Students explicitly confirm the coordinator connection and select each publication. Family-linked/parent-managed profiles and family conversations or derived notes remain excluded. Organization approval and coordinator membership/capability are still required. The old student provisioning script is retired. Permission changes or withdrawal, role changes, and family linking revoke access directly, even without a legacy pilot row; elapsed permission expiry blocks reads immediately. Reapproval does not revive previous grants.

## Data and lifecycle

- One application per authenticated subject. No matching or approval based only on email, names, or organization text.
- Applicant reads return only their application. Reviewer access is server-authorized and audited through the existing staff audit gate; approval also records an institution access event.
- Review and membership changes serialize on the organization; application decisions lock the application. A stale approval cannot restore a disabled coordinator.
- Applicant registration/status/withdrawal serializes with account closure. Closed accounts cannot recreate an application.
- Applications are included in the account export and cascade away when the representative/account is erased. Existing staff membership/reviewer deletion restrictions still apply.
- No application bodies, email addresses, review notes, or invitation codes are added to diagnostic logs.

## Verification

`server/coordinator-applications.test.mjs` uses disposable PostgreSQL with the actual restricted runtime role. It covers forged identity input, cross-account isolation, no automatic privileges, independent review, verified organization/membership gates, blocked staff, duplicate decisions, withdrawal, export/erasure, verified Auth0 email, MFA review gates, and the disabled rollout switch.

`output/playwright/coordinator-registration-preview.js` mounts the actual registration/review components with synthetic Auth0/API responses. It checks English/Spanish at mobile and desktop widths. No real applicant or student data is used.

## Authenticator setup now configured

See [the October 20 MFA setup record](AUTH0_MFA_SETUP_2026-10-20.md). OTP, recovery codes and the two Login Actions are configured in the live Auth0 tenant. Become a coordinator and staff verification include bilingual setup guidance. Hosted synthetic tests verify the Action behavior; a real coordinator must still complete their first phone enrollment.

## Organization registration during coordinator signup

The signup form now offers **Join an existing organization** and **Register my organization**. Existing-team applicants still need an email-bound owner invitation. Authorized representatives can add a short organization description, confirm authorization, and register from the same coordinator page.

The application is saved first. The new-organization path then calls the existing MFA-protected institution `register` and `submit` commands. Registration creates an owner membership and sends the organization for independent review; it does not approve affiliation, enable coordinator access, publish student content, or bypass consent. The organization description is part of its page draft and can become public after approval; representative email stays private.

The application's server-generated ID is the organization registration retry key. The existing institution registration-request table stores the durable link, so logout, a new tab, or a lost response cannot turn a completed registration into a fresh attempt. Recovery checks the authenticated application's ID and organization ownership. Older registrations can be recovered only from a single matching organization already owned by that account; ambiguous matches require the owner to review their existing organizations.

An account-scoped session draft retains unfinished form details across MFA redirects, but is not the source of truth for completion. It must match the current application's ID and identity fields. Withdrawal discards that draft; the server rejects registration attempts for a withdrawn or replaced application. Withdrawing an application does not delete a registered organization.

Refresh status reads both the coordinator application and the organization's current status. Requested corrections and review notes appear on the signup page, with an inline name, website, and description editor to save and resubmit. Recovery still requires MFA, respects the accounts rollout switch, and does not automatically resubmit a reviewer’s request for changes.

Organization recovery itself uses existing tables. The registration safety fixes below require migration 059 and refreshed runtime grants before API deployment. No new environment variables, Auth0 tenant changes, or services are required. Deploy the API support for `signup-status` and application-bound registration before the updated frontend. PostgreSQL regressions in `server/coordinator-organization-signup.test.mjs` cover concurrent retries, stale applications, legacy recovery, lost ownership, ambiguous records, and correction/resubmission. HTTP tests retain MFA and feature-flag checks. Synthetic browser checks cover both choices, MFA return, network failure, logout recovery, withdrawal/reapplication, corrections, and mobile/Spanish layouts.


## Registration safety fixes (migration 059)

- Independent review remains required after withdrawal and reapplication. Organization owners cannot enable pending, declined, or withdrawn applicants. Submission by previously enabled staff disables their coordinator profiles and revokes existing codes/connections/grants until approval. Repeated submission after approval preserves access.
- A restricted review-control row records only that the account entered the application flow. It survives application withdrawal and cascades on account erasure. Migration 059 backfills existing applications and disables active profiles belonging to unapproved applicants. Applications deleted before this migration cannot be reconstructed; previously withdrawn applicants without retained records are indistinguishable from legacy staff who never applied.
- Existing owner provisioning for staff who never applied and approved staff in multiple organizations remains supported. Organization membership, pilot approval, verified affiliation, staff security controls, and MFA remain mandatory.
- Withdrawal requires the exact current application ID. A stale tab receives `application_changed` and cannot delete a newer application. Retrying an already completed withdrawal is safe when no replacement exists.
- Reviewers select from a dedicated, searchable, paginated list of the applicant's eligible organizations. It is independent of the overview's 100-organization limit, requires reviewer authorization/MFA, and excludes the reviewer's own organizations.
- Activation and application decisions serialize through the representative row; organization review acquires its institution lock first. Approval and profile activation commit together. The activation guard must remain installed and the review-control table must remain excluded from raw runtime grants.

Deployment order: migrate through 059, refresh runtime grants, run readiness checks, deploy API, then deploy frontend. Old clients without an application ID cannot withdraw until refreshed. No production rollout is performed by the local tests.

`server/coordinator-registration-safety.test.mjs` covers both complete HTTP signup paths, invitations, independent approval, code creation, stale/missing withdrawal IDs, persisted review requirements, legacy/approved compatibility, concurrent requests, more than 100 organizations, search/pagination, and upgrading a pre-fix database. `server/coordinator-applications.test.mjs` also checks review-control erasure and closed-account rejection.

`output/playwright/coordinator-registration-server.mjs` starts an isolated HTTP server backed by disposable PostgreSQL schemas and restricted runtime grants. `output/playwright/coordinator-registration-e2e.js` drives the actual React registration and reviewer components through signup, browser-draft loss, correction/resubmission, organization search, approval, and first profile/code access. Auth0 identity is synthetic; hosted login, email delivery, and real phone OTP enrollment still require a deployed smoke test. The separate preview scripts cover English/Spanish mobile and desktop layouts, MFA return, and uncertain-response recovery.

## Repeatable registration stress testing

Run `npm run coordinator:stress -- --disposable-database --output <new-directory> --users 300 --concurrency 150 --pool 5 --seed 20261022` with `DATABASE_TEST_URL` pointing to a dedicated disposable loopback PostgreSQL cluster. The runner refuses non-loopback database URLs, uses synthetic identities, creates a random schema and restricted database role, and removes them on completion. It never uses the application's `DATABASE_URL`. The test API's synthetic authentication and fault-injection headers exist only in `server/fixtures/coordinator-registration.mjs`; never mount that fixture in the application.

The runner bounds concurrency, uses the production database acquisition/statement timeouts and a 15-second HTTP deadline, and shuffles each request batch using a repeatable seed. It checks duplicate application/organization prevention; retry after a deliberately dropped response following commit; competing approvals; stale updates; reviewer pagination; cross-account requests; withdrawal/reapplication; invitation replay and membership removal; suspension/code rotation; MFA/email denial; and an identity-provider outage followed by delayed recovery. Every scenario validates persisted state as well as response codes. Expected denials and conflicts are distinct from unexpected failures.

The October 20 local runs completed **34,040 requests across five runs**, with up to **150 simultaneous HTTP requests**, 300 initial applicant accounts per run, and database pools of five and twenty connections. All scenario assertions passed. No unexpected server errors, deadlocks, duplicate registrations, or unauthorized access were observed. The slowest operation was bulk organization verification, reaching about five seconds during the largest burst. No new production-code fix was indicated by these runs.

Results: [summary](../../output/coordinator-registration-stress/2026-10-20/summary.json). Each run's JSON includes scenario counts, status distributions, duration, and latency percentiles. Auth0 verification is synthetic, and traffic bypasses the production hosting/proxy layer; these results validate local concurrency and failure behavior, not live Auth0 rate limits, Render capacity, email delivery, or real device enrollment.
