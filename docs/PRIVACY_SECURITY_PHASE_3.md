# Phase 3 — Staff, institution, and family access

## Administrator sign-in update — 2026-10-10

At the owner's request, administrative reports now accept regular, verified Auth0
sign-in with the required API permissions. The administrator dashboard does not
require an authenticator enrollment or MFA timestamp and does not display the
two-step verification banner. Permission checks, suspension, auditing, database
isolation and exclusion of private conversation text remain enforced. Admin write
actions still require login proof within 12 hours; token issuance is not proof
of a new login. Institutional staff routes retain their existing MFA policy.
The earlier MFA statements below apply to institutional access, not admin reports.

Implemented locally on 2026-10-10. Requires migrations 035/036, runtime grants,
Auth0 configuration, and deployment before these protections operate in production.
No production database, Auth0 tenant, or staff assignment was changed.

## Permission matrix

Only permissions in the verified Origen API access token are authoritative.
Browser roles, form fields, `scope`, and user-editable metadata do not grant access.
All staff data access requires completed MFA and primary authentication within
12 hours. Actions marked **fresh** require both within 12 hours.

| Permission | Allowed admin actions | Content boundary |
| --- | --- | --- |
| `read:activity` | Overview totals/trends, onboarding metrics/alerts, aggregate progress | No account directory or named activity feed; no conversation text |
| `read:users` | Directory/detail, operational history, conversation metadata, onboarding visits, engagement | Account names/IDs and operational status; no summaries, transcripts, notes, plans, or worksheets |
| `read:quality` | Voice/quality signals, review queue/history/evidence | Operational evidence, including affected account names/IDs where applicable; no private conversation text |
| `write:reviews` | Review decisions and conversation-quality review (**fresh**) | Changes review status only; does not edit a user's profile/conversation |
| `read:institutions` | Internal institution reports and saved snapshots | Suppressed institution counts and publication metadata; no family conversations |
| `write:reports` | Save an institution report snapshot (**fresh**) | Internal report only; no permission to release a research dataset |
| `manage:institutions` | Review queue, affiliation review, verification/publication/changes (**fresh** for mutations) | Institutional submission/representative data; independent reviewer checks remain enforced |

The dashboard renders only permitted tabs and disables review/snapshot writing
without the matching permission. A server check remains authoritative even if a
client forges a request or uses an old page. Reporting database context is entered
only after the action permission, MFA, suspension, and audit gates pass.

`ADMIN_SUBJECTS` now grants **only `read:activity`** as a compatibility path. It is
not a superuser bypass and does not exempt MFA. The existing
`INSTITUTION_REVIEWER_SUBJECTS` list is an alternative to `manage:institutions`,
also subject to MFA and suspension. Prefer Auth0 permissions going forward.

## Institution and department boundaries

Auth0 authenticates a person; current database membership determines their workspace.
An Auth0 role by itself never grants membership in a college or department.

| Database role | May do | May not do |
| --- | --- | --- |
| Owner | Own workspace editing; team, invitations, roles, ownership, department approval, lifecycle; own inbox/export; campaigns and reports | Read sibling/parent department inboxes without membership, or family conversations |
| Editor | View/edit/submit their workspace | Manage team, inbox, or ownership |
| Outreach | Own workspace inquiry inbox, approved in-app outreach/campaign workflow | Change membership, export inbox as owner, or inherit other departments' contacts |
| Analyst | Workspace and permitted aggregate reports | Read inquiry contacts, mutate content or manage team |
| Independent reviewer | Review institutional affiliation/publication | Self-approve an institution or its parent; gain institution membership through review |

MFA gates cover private portal operations, inquiry inboxes, campaign operations,
and metrics reports. Fresh MFA covers team/security/lifecycle changes, publication
reviews, inbox export, proposed contact transfer, and campaign sending. Discovery
(`access`, published parent search) and a prospective affiliation request do not
expose private staff records and remain available before step-up. New institutional
registration also requires verification before creating its owner workspace.

Membership is checked from PostgreSQL on each operation, not copied into long-lived
tokens. Existing locks, independent review, verified invitation email, and
visitor-approved transfer controls remain intact. A transfer requires permission
for the named destination; source internal notes do not cross that boundary.
Parent ownership permits department governance and aggregate reporting, not
automatic access to a department's inquiry contents.

## Auth0 rollout (Origen tenant only)

1. In the Origen API, keep RBAC enabled and **Add Permissions in the Access Token**
   enabled. Add the seven permissions above.
2. Suggested roles: Analytics (`read:activity`); Support (`read:activity`,
   `read:users`, `read:quality`); Quality reviewer (`read:quality`, `write:reviews`);
   Institution reporting (`read:institutions`, `write:reports`); Publication
   reviewer (`manage:institutions`). Assign only necessary roles. To retain the
   owner's full current dashboard, explicitly assign all six admin permissions;
   publication review is separate. Institutional members still use database roles.
3. Enable the **Authenticator / OTP** factor and Actions-based MFA customization
   in this tenant. This uses an authenticator app and does not depend on Twilio.
4. Bind `auth0/staff-mfa-action.cjs` as a Post Login Action **before** the updated
   `auth0/recent-auth-action.cjs`. The first enrolls/challenges OTP only when the
   app requests staff verification. The second signs the observed authentication
   and completed MFA timestamps into the API access token. Never substitute
   token issuance time, current time, user metadata, or an enrollment flag.
5. The **Verify my identity** button requests a new login/MFA challenge, returns
   to the workspace, and does not automatically replay a mutation. Reopen and
   review the intended operation. Missing claims fail closed. If enrollment does
   not yield a completed MFA method, verify again to perform the challenge.
6. Use a short API token lifetime (for example 15 minutes) and check refresh-token
   rotation/revocation in the tenant. Auth0 role removal alone cannot invalidate
   an already-issued JWT immediately; use the local suspension control below
   when immediate staff revocation is needed.
7. Before production rollout, verify a real synthetic staff login, OTP enrollment,
   challenge, returned claims, 12-hour expiry, refresh without renewing the
   proof timestamps, and access denial for a normal account. Automated tests mock
   the Auth0 Action API; live tenant enrollment and plan availability are not verified.

Auth0 documents [the challenge/enrollment APIs](https://auth0.com/blog/using-actions-to-customize-your-mfa-factors/)
and [why the completed MFA method must be read by a subsequent Action](https://support.auth0.com/center/s/article/using-actions-mfa-authentication-method-is-missing-on-first-login).
The two-Action order is required; calling `multifactor.enable()` and immediately
claiming completion can misrepresent what the user actually completed.

The proof Action must also work without Enterprise session fields. Auth0 only
provides `event.session.authenticated_at` on Enterprise plans. When it is absent,
`recent-auth-action.cjs` uses the recorded `pwd`, `federated`, or `passkey`
first-factor timestamps from `event.authentication.methods`. It preserves the
original time on SSO/refresh; neither issuance time nor MFA completion alone
renews first-factor freshness. MFA proof still requires the separate completed
`mfa` method. See [Auth0's session-context guidance](https://support.auth0.com/center/s/article/differentiate-user-logins-from-session-reuse-sso-in-post-login-actions).

Regression check: `node --test server/staff-access.test.mjs server/recent-auth.test.mjs`.
After deploying an Action change, obtain a newly issued access token before
checking the registration screen; already-issued tokens retain their old claims.
On October 23, 2026, the synthetic coordinator account's completed OTP enrollment
was recognized after this fix and a resumed sign-in, without another OTP challenge.
The application remained pending review, with organization registration available.

## Immediate staff suspension

Run `node scripts/control-staff-access.mjs` in the separate operator environment,
with `MIGRATION_DATABASE_URL`, `STAFF_CONTROL_SUBJECT` (exact Auth0 subject),
`STAFF_CONTROL_OPERATOR` (operator identifier), and `STAFF_CONTROL_MODE=block`.
The API reads this control on every protected staff operation. An in-flight
operation already authorized may finish; subsequent requests are denied.

Unblock with `STAFF_CONTROL_MODE=unblock`. Existing tokens remain invalid for
staff access; the user needs a newly issued token plus their current permissions
and MFA proof. Suspension never deletes their own family records. The web service
cannot create, change, or delete these control rows. Team removal additionally
revokes outstanding invitations created by the removed member as before.

## Audit records

Migration 036 adds `origen_privileged_access_audit`: UUID, SHA-256 actor/optional
target identifier, area, allowlisted action, outcome, server timestamp. It contains
no transcript, summary, notes, name, email, IP, bearer token, or invitation link.
These hashes are pseudonymous operational identifiers, not anonymous research data.

`authorized`/`denied` records the identity/permission/MFA/suspension gate decision,
**not** successful completion or institution membership approval. Existing domain
review/team/inquiry records capture completed mutations; family link changes and
operator suspensions get atomic `completed` receipts in this table. HTTP status
logs provide the final request outcome without request bodies. A missing audit
store blocks protected operations before private records are read or changed.

The runtime can only INSERT its current actor's receipt. RLS and grants deny audit
SELECT/UPDATE/DELETE/TRUNCATE and deny runtime mutation of suspension controls.
Startup checks reject a runtime role with these extra privileges. Operator review
uses the separate restricted-access operations environment. Apply a 180-day
operational audit retention policy there, for example:

```sql
DELETE FROM origen_privileged_access_audit
WHERE created_at < now() - interval '180 days';
```

No scheduler is installed by this phase. Keep suspension controls until explicitly
cleared; deleting an unblock watermark could revive an older token.

## Family sharing

Web invitation creation and acceptance, and mobile acceptance, now list the exact
shared fields: name, stage, interests, GPA, profile color, institutions, entry term,
school, activities, goals. Both people can edit them. Summaries, conversations,
private notes, needs, plans and worksheets remain separate, enforced by phase 2.
An outdated mobile claim that college plans were shared has been corrected.

Family links remain one-use, seven-day bearer invitations: the person who signs in
and accepts the link becomes the recipient. The sender is explicitly told the link
is not bound to an email and should go only to the intended family member. No email
delivery or automatic institution sharing was added. Institutional staff invitations
continue to require the intended verified email. Sharing an account/password itself
is not made private by family linking.

## Verification

Result: 437 server tests passed, zero failures/skips, including real PostgreSQL.
The production web build and mobile TypeScript/lint checks passed. Synthetic
Playwright checks cover desktop/mobile staff layouts, MFA redirect parameters,
permission-filtered navigation, read-only review controls, and clearing reporting
data after suspension. The browser blocked the local Vite hot-reload WebSocket;
page rendering and the checks passed without it.

- Every mapped admin action denies a token without its explicit permission.
- User metadata, requested roles, forged MFA, future/missing/stale proofs denied.
- Protected institution/inquiry/campaign/metrics HTTP routes require MFA.
- Real PostgreSQL, restricted LOGIN: audit append-only/actor scoping, suspension,
  old-token invalidation after unblock, analyst overview excluding named activity,
  private content inaccessible even to an administrator, and family private-data isolation.
- Existing owner/editor/outreach/analyst, revoked membership, parent/sibling,
  independent review, verified invitation, and visitor transfer tests remain active.
- Web production build and mobile type/lint checks included. Real Auth0 step-up
  and production deployment remain rollout checks, not claimed as tested here.

After migration, rerun `npm run db:grant-runtime` and `npm run db:check-runtime`
with the separate credentials described in phase 2. Do not put the migration
credential in the API service. No new permission ever grants raw conversation access.
