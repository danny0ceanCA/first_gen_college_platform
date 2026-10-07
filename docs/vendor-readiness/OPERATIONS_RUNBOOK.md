# Operations evidence and exercises

Scope: Origen operational readiness, October 6, 2026. No customer data should enter repository fixtures, evidence reports, model evaluation cases or the synthetic research sandbox.

## Provider evidence

Record provider/project identifier, configuration date, reviewer, restricted evidence reference, effective region, subprocessors/agreements, purpose/data categories and expiry. Verify live settings, not generic marketing claims.

| Service | Evidence to obtain |
| --- | --- |
| Render | API/database region; backups, PITR availability/window, restoration procedure; logs expiry/access; encryption; administrators/MFA; alert routing; storage/connection headroom |
| Auth0 | Correct dedicated tenant/client/API audience; enabled connections; administrators/MFA; sessions and refresh-token policy; identity attributes; account deletion and log retention; region/contracts |
| OpenAI | Actual project and API access; audio/context processing; retention and abuse-monitoring settings/eligibility; project roles and budget limits; agreements/location; separate permitted model-improvement uses |
| GitHub | Members and least privileges; MFA, protected branch/required checks; Actions permissions and artifact expiry; secret ownership/rotation |

Do not promise residency or zero retention until the actual project evidence supports it. Inventory Twilio when activated; it is not verified active by this exercise.

## Real restore and deletion replay exercise — staging only

1. Name an operator and independent reviewer. Provision a dedicated disposable PostgreSQL target with no public app traffic, approved access and matching PostgreSQL/extensions. Confirm source/target identifiers; never overwrite production.
2. Seed synthetic fixtures covering migrations 001–016: two independent accounts, shared student link/unlink, family and student summaries, planning, guidance metadata, progress reports, institution membership/reviewer exception and preview exclusions. Capture schema/version, row counts and account-scoped exports in restricted evidence.
3. Take a provider backup or approved dump. Then perform closure, unlink, retention expiry, permission withdrawal and access revocation. Preserve a minimal authoritative closure/revocation ledger independently of the restore point, protected and access-audited. Decide its retention/owner before production use. Existing closure receipts in the same database are insufficient after an older restore.
4. Restore into the disposable target and record actual start/end, recovery point, checksums/counts and failures. Reapply migrations before compatible readers. Do not run a public server against it.
5. Reconcile the independent closure/revocation records before traffic: remove closed private records, preserve surviving family members' records, block closed subjects and revoke restored access. Existing lifecycle deletion requires explicit family unlink and institution/reviewer review; do not bypass those safeguards. Any unresolved exception blocks reopening. Apply withdrawal/access revocation to research releases too; study data remains outside operational snapshots.
6. Replay twice; test still-valid tokens cannot recreate closed accounts, another account cannot export their data, and survivors retain their records. Verify all phase 2/3 tables and orphan checks. Run authenticated staging API checks, not only SQL counts.
7. Verify provider identity deletion separately. Record residual backup expiry and how a later restore repeats replay. Destroy the disposable environment under the agreed retention policy. Reviewer records measured RPO/RTO; do not present synthetic in-memory timings as these measurements.

## Administrator access review

Create a restricted roster: person, provider, role, purpose, grant/expiry dates, approver, MFA evidence, last review and emergency access. Include Render, database users, GitHub, Auth0, OpenAI and server reviewer-subject configuration. Institution membership must never grant research access. Confirm departure/revocation, no shared logins, least privilege, no credentials in logs or public evidence, and successful removal of a synthetic access grant. Review before launch and after staffing/security changes; owner chooses a recurring review schedule. No roster or MFA status is inferred from source code.

## Incident tabletop

Assign named primary responder, backup, security/privacy decision owner, communications owner and recovery reviewer. Keep contact details restricted. Exercise a provider outage, wrong-student disclosure, leaked provider key and restored deleted account.

Capture detection, incident ID, UTC timeline, affected revision/providers, scope uncertainty, containment decision, service/feature disablement, restricted evidence, rotation/revocation, recovery verification and follow-up owner. Use safe request IDs/error codes; do not copy transcripts, names, tokens or credentials into ordinary logs. Notify partners/users only through the authorized incident process and verified requirements. No notifications are sent by this kit.

Reopen only after scope/attribution checks, closure/revocation replay, known-safe configuration and reviewer sign-off. Backlog lessons with owners/dates and repeat the failed exercise. Retain evidence under an adopted expiry policy.

## Accessibility evaluation

Public-page browser smoke checks are preliminary. Evaluate registration, onboarding, bilingual form/voice behavior, summaries, target confirmation, text alternatives, error announcements, keyboard/focus, screen readers, reduced motion and zoom/reflow. Include web/mobile widths plus native assistive technology separately. Record product revision, scenario, method, observed failures, remediation and retest. Prepare an ACR only after criterion-by-criterion evaluation; do not mark untested criteria as supported.

## Pilot commitments

Before signature, identify sponsor and reviewers; agree population, deliverables, permitted fields, research permission boundaries, support hours/escalation, retention/withdrawal, access list, incident process, accessibility limitations, fees, provider costs and exit/deletion plan. Agree recovery commitments from measured exercises and affordable staffing. Keep SLA/RPO/RTO and research-performance claims pending until evidence and owners support them. Synthetic evaluation does not establish student outcomes. Research approval, procurement approval and ordinary institution pages are separate authorities.
