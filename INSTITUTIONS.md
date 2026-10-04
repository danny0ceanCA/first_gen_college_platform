# Institution registration and publication

## Aggregate engagement reporting

Migration `009_institution_metrics.sql` adds monthly page-view and outbound-link-click counters. Published pages send a bounded event containing only slug, metric and, for clicks, an approved link index. The official website uses index -1. Draft previews do not send events. Collection sends no identity token, cookies or referrer and does not create visitor identifiers or individual event records. Hosting infrastructure may still process request metadata independently.

`POST /api/institution-metrics/event` requires an allowed browser origin, JSON, a small body and an exact field allowlist. It validates the published page and link before incrementing. A shared per-process cap of 600 submissions/minute bounds basic collection traffic without storing IP-based identities. Origin checks and this cap do not authenticate visitors or prevent fabricated events; statistics can include repeat activity and bots and do not measure unique people or applications. Multi-instance deployments have independent caps.

`POST /api/institution-metrics/report` requires a verified account and current membership of the requested institution. Reviewer privileges alone do not grant reporting access. Reports expose only the last completed UTC calendar month and withhold counts below 10, including zero. There are no custom ranges, real-time reports, per-link breakdowns or individual records. The dashboard provides the same report. Minimum-count withholding reduces exposure and does not certify anonymization.

The API purges counters older than the current month plus the previous 11 months at startup and hourly. Backup retention remains a separate production setting. Deploy the backend first; startup applies migration 009 and readiness requires it. Existing public pages continue working if collection fails. Verify production page collection and signed-in reports after deployment. No provider settings or live deployment were changed locally.

Landing navigation and footer link to `/#institutions`. This is a separate registration/dashboard flow from family onboarding. It uses the existing Auth0 identity and API audience, but stores representatives, institutional membership, pages and review records in separate tables. It neither creates a family account nor grants access to someone else's students or conversations.

## Workflow

1. Sign in with the existing Origen Auth0 application. The registration route survives the callback.
2. Register a representative's first name, work email and institution role. These are private operational contact details, not an email-login feature or proof of authorization.
3. Save and preview a draft page: institution name, official HTTPS website, description, programs, admissions guidance, aid resources, events and resource links. A separate optional public contact email is explicitly labeled public.
4. Submit for review. An authorized reviewer independently confirms affiliation through the institution's official contacts/process and records a short non-sensitive note. Nothing verifies itself from a matching email domain.
5. The reviewer reviews the page and approves publication or requests changes. Self-review is prohibited. Public pages render institution-provided text and links, with a notice distinguishing it from independently verified admission guidance.

The work email is not automatically emailed or exposed publicly. There is no SMS/email notification or automated external outreach. Staff need to refresh the review dashboard to see submissions. No staff member is automatically made an administrator.

## Database and API

Migration `008_institutions.sql` creates:

- `origen_institution_representatives`: separate Auth0 identities and private contact/role details.
- `origen_institutions`: stable ID and public slug, revision, draft content, verification state and approved published snapshot.
- `origen_institution_members`: institution-scoped owner/editor membership. Registration creates only its owner's membership; team invitations are not yet implemented.
- `origen_institution_reviews`: reviewer, revision, review action, note and timestamp.

Authenticated `POST /api/institutions` supports load, register, save, submit, queue, verify, publish and request-changes. Save/submit/review includes the current revision; stale writes return 409. Owners edit only their own institutions. Queue and review operations require a server-configured reviewer identity and refuse review of an institution where that reviewer is a member. Changing the institution's name or website requires affiliation verification again.

`GET /api/institutions/published/{slug}` is public and returns only the last approved snapshot and publication metadata, never membership, draft text, private emails or review notes. The browser page is `/#institution/{slug}`. New drafts remain unpublished; editing an existing approved page keeps the previous public version until the new revision is approved. Reviewer changes and draft text are plain React-rendered text; arbitrary HTML, uploads and embedded scripts are not supported. Links must use HTTPS without URL credentials.

Institution pages are not yet fed into the voice model's research results. Publishing a page does not confer official-source authority or provide a student-data dashboard. Draft owners can choose public contact details but cannot bypass publication review.

## Configure and deploy

Deploy the API before the web frontend. Startup applies migration 008 and `/readyz` requires it. Existing Auth0 callbacks and API audience continue to apply; there is no domain or certificate change.

Set `INSTITUTION_REVIEWER_SUBJECTS` **on the backend only** to a comma-separated list of the intended human reviewers' exact Auth0 `user_id`/subject values. Obtain these from Auth0 User Management after the reviewers sign in. This is a privileged allowlist: add only people authorized to approve institution registrations and publications. It defaults to empty, leaving all submissions pending. Do not use public frontend environment variables or a representative-provided role to grant reviewer access.

The existing Auth0 connection still needs to support login (phone sign-in depends on the pending Twilio setup). Collecting a work email in this form does not enable email authentication. No additional paid provider or automated email is configured by this change.

Tests cover private/public separation, owner isolation, prohibited self-approval, verification before publishing, draft/live snapshot separation, re-verification after identity changes and stale edits. PostgreSQL behavior is exercised in pg-mem; the gated real PostgreSQL check requires a dedicated `DATABASE_TEST_URL`. Production registration, callback and reviewer flows need a signed-in two-account test after deployment. The frontend landing and phone layout can be reviewed locally without authenticating.
