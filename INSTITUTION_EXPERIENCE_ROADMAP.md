# Institutional experience and outreach roadmap

Origen should help institutions publish useful information, receive requests from interested people, respond promptly, and understand which outreach efforts lead to meaningful engagement. A page editor alone provides limited recurring value. This roadmap develops the existing institution portal into an outreach workspace while preserving separation from private family conversations and research data.

Status: proposed implementation phases, based on the local source review on October 7, 2026. These phases are separate from the earlier administrative dashboard phases. No production institutional account flow was tested in this review.

## Current experience

The existing portal supports separate institution registration, private representative details, draft editing and preview, independent affiliation review, publication, and a public page. PostgreSQL stores institution membership separately from family accounts. Published content remains available while a new revision is reviewed. These are useful foundations to retain.

The main gaps are:

- Ordinary sign-in defaults to the family application; institution-specific sign-in preserves its destination, but there is no membership-based workspace selection.
- Registration creates an owner membership. Team invitations and team management are absent, and owner/editor permissions are not meaningfully differentiated in the current editing workflow.
- Registration has no request idempotency protection against creating duplicates after a retry. The editor has no autosave or draft recovery, and review changes require manual refresh.
- Spanish controls do not translate institution-authored content. Programs and events are long text fields rather than structured records with audiences, dates, or actions.
- Public pages use hash routes and have limited sharing and discovery features. There is no inquiry inbox, event registration workflow, or campaign management in the institution portal.
- Reporting exposes only page views and outbound clicks for the last completed UTC month, withholding counts below ten. Counts may include repeat activity and bots; they cannot establish unique reach or applications.

Source anchors: `src/Entry.tsx`, `src/main.tsx`, `src/InstitutionPortal.tsx`, `src/InstitutionMetrics.tsx`, `server/institutions.mjs`, `server/institution-metrics.mjs`, and migration `008_institutions.sql`. Existing behavior is documented in `INSTITUTIONS.md`.

## Identity and permissions

Institutions do not need a separate Auth0 account type today. Representatives can use Origen's existing sign-in. Auth0 establishes identity; PostgreSQL membership determines which institution that identity can access. A person can be both a parent and an institutional representative through separate workspaces.

Support a parent institution with departments and programs underneath it. For example, a college can have an Admissions department, a Financial Aid department, and an outreach program, each with its own page, staff, inquiries, and events. Registration must distinguish the parent institution from the unit being represented. A program operated by a different institution must link to its actual parent rather than implying affiliation with the college it serves.

Parent owners may approve creation of units and delegate access to them. Department staff receive access only to their assigned unit unless explicitly granted broader institutional access. Independent affiliation review must confirm both the parent institution and the representative's authority for the unit. A person may request a department affiliation before the parent is registered, but the request must remain pending until that parent and relationship are established. Public visitors see the relationship clearly.

Keep membership scoped to an institution. Do not grant platform administrator access or access to family profiles through a generic institutional role. Matching a work email domain is supporting evidence, not sufficient authorization to represent an institution.

Proposed roles:

| Role | Permitted work |
| --- | --- |
| Owner | Manage team membership and ownership; manage institution content and outreach |
| Editor | Edit content and submit it for independent review |
| Outreach staff | Handle explicitly shared inquiries and event registrations |
| Analyst | View permitted aggregate reporting; no contact lists by default |
| Origen reviewer | Independently verify affiliation and review publication; no self-approval |

Auth0 Organizations is an optional later integration for organization-aware sign-in and invitations. Auth0 supports roles assigned within organizations; invitation availability depends on the plan and login implementation. If adopted, explicitly choose the authority for membership and synchronize revocation rather than maintaining conflicting grants in two systems. See [organization roles](https://auth0.com/docs/manage-users/organizations/configure-organizations/add-member-roles) and [organization invitations](https://auth0.com/docs/manage-users/organizations/configure-organizations/invite-members).

## Phase 1 Access and dependable registration

Implemented locally on October 7, 2026. Migration 020 and the updated frontend must be deployed together in backend-first order. Automated backend and synthetic browser checks cover the implemented flows; real PostgreSQL and production Auth0 validation remain outstanding. See `INSTITUTIONS.md` for operating details. Affiliation requests require manual independent verification and coordination with owners; automated invitation delivery remains a later phase.

Give institutional users a predictable entrance and a secure team workspace.

- Resolve memberships after login. Open the institution workspace for institution-only users; offer a workspace selector for people with personal and institutional access. Preserve invitation and intended-page destinations.
- Keep institutional onboarding separate from student/parent onboarding. Provide visible logout, loading, retry, and access-denied states.
- Introduce the role matrix above with server-side checks on every institution resource. Separate affiliation status from membership permissions.
- Add expiring, single-use team invitations bound to the intended verified identity, removal, owner transfer, and an audit trail. Prevent removal of the last owner without transfer.
- Make registration retries idempotent; offer an existing-institution claim workflow with independent verification instead of silently creating duplicates.
- Let representatives register a parent institution or request a department/program under an existing parent. Include parent-owner approval, independent verification, and unit-scoped membership. A typed parent name alone must not establish the relationship.
- Prefill confirmed representative details and explain pending verification and next steps in plain language.

Completion: an institution-only user reaches the correct workspace after generic sign-in and refresh; another institution's resource IDs remain inaccessible; revoked membership stops access; duplicate requests create one registration; invitation expiry, reuse, and wrong-account redemption are tested.

Department acceptance: unapproved units cannot become public, department staff cannot access sibling departments, and changing the parent relationship requires a fresh authorization and review workflow.

## Phase 2 Guided workspace and publication

Implemented locally on October 7, 2026. Migration 021, scoped navigation, guided partial drafts, serialized autosave and browser recovery, publication comparison/history, in-app notifications, and owner archive/unpublish/restore are implemented. Synthetic browser checks cover 1440px desktop and 390px phone layouts; real PostgreSQL/Auth0 and manual screen-reader validation remain release checks. No production deployment was performed. See `INSTITUTIONS.md`.

Replace the long form with a clear setup journey and a useful home screen.

- Navigation: Overview, Public page, Programs and events, Inquiries, Outreach, Insights, Team and settings. Show upcoming features only when implemented.
- Overview emphasizes next actions: finish a draft, resolve reviewer feedback, answer inquiries, or update an expiring event. Use Origen's cream and terracotta theme with accessible contrast and mobile layouts.
- Add an institution and department selector, with the active workspace clearly named. Parent owners see their authorized units and pending requests; department staff land directly in their assigned workspace. Display parent and unit review states separately.
- Add a short setup checklist, partial draft saving, debounced autosave, saved timestamps, recovery after interruption, and the existing revision conflict protections.
- Show review history, current outstanding feedback, approved-versus-draft differences, and explicit submission confirmation. Add in-app review notifications; email notifications require a configured delivery provider.
- Add archive/unpublish controls with authorization and clear treatment of already shared links.

Completion: staff can resume an incomplete draft, distinguish live content from edits, and complete review corrections on mobile without losing work. Keyboard, screen-reader, failure, and slow-network paths are verified.

## Phase 3 Useful bilingual public pages

Implemented locally on October 7, 2026: structured offerings/events, English/Spanish versions with explicit fallbacks, introductions/logos, public directory and stable frontend routes, approved HTML sharing pages with social metadata, and page/event QR downloads. Migration 022 and backend public-origin configuration precede frontend deployment. Existing text is preserved. Voice retrieval and consented inquiries remain later integrations; production sharing and real PostgreSQL/Auth0 validation remain release checks. See `INSTITUTIONS.md`.

Make pages valuable to first-time students, transfer students, adult learners, and families.

- Store programs, services, admissions pathways, and events as structured content. Events need dates, timezone, location or online link, expiry, and a clear registration action.
- Add English and Spanish content versions with explicit missing-translation fallbacks. AI translation may draft text, but staff review institution-authored claims before publication.
- Add logos, concise introductions, official resource links, update dates, and prominent actions such as Ask a question, Attend an information session, or Visit admissions.
- Add a discoverable directory and stable public URLs with social preview metadata. Preserve old hash links through a compatibility route.
- Allow sharing and QR downloads for approved pages and events. Distinguish institution-provided information from independently validated admissions requirements.
- Give each approved department/program its own public page and share URL, with a link to its parent. Parent pages list approved public units. Each unit can publish its own services, eligibility, contact details, and events without duplicating the parent's entire page.
- Later allow the voice guide to retrieve approved, current public content with source attribution. Never retrieve unpublished drafts or treat paid placement as authoritative guidance.

Completion: a visitor can find a relevant pathway and action in either language; expired events do not appear upcoming; social previews resolve; only approved content reaches public pages and voice retrieval.

## Phase 4 Consented inquiries and follow up

Status (October 7): in-app implementation and synthetic checks are in place locally. The owner chose in-app replies for now because no email provider is configured. Migration 023 adds scoped inquiries, RSVPs, consent, messages and audit history. Outbound email and contact flows for minors remain release gates; no real research collection is enabled. See INSTITUTIONS.md for operational limits.

Give staff a practical way to respond to people who ask for help.

- Add inquiry and RSVP forms that clearly name the recipient institution and exactly what information will be shared.
- Collect only necessary contact details, preferred language, requested topic, and contact preference. Separate answering a request from optional future outreach permission.
- Build an inbox with new, assigned, awaiting response, and resolved states; internal notes; ownership; and response history.
- Route inquiries and RSVPs to the department/program selected by the visitor. Show both the parent and receiving unit before submission. Transfers to another unit require appropriate access and respect the user's permission to share; sibling departments do not automatically receive contacts.
- Begin with in-app handling and a configured transactional email service. Twilio is not required for the first release. Add SMS only after provider setup and a separate contact permission flow.
- Add delivery status, retry protection, unsubscribe/suppression, withdrawal handling, retention rules, and audited exports. Define the age-appropriate contact flow before releasing forms to minors.
- Do not attach private conversation summaries, student profiles, or research records automatically. Any future user-directed sharing requires a separate explicit review step.

Completion: only authorized staff at the selected institution receive an inquiry; duplicate submissions and delivery retries do not create duplicate contact; withdrawn outreach permission prevents subsequent sends; unresolved delivery failures are visible.

## Phase 5 Outreach and measurable value

Status: implemented locally for the in-app channel. Migration 024 adds campaigns, invitation batches, anonymous campaign counters and operational reporting facts/state history. Fixed-month reports protect small groups and label incomplete collection; no numeric campaign or audience drilldowns are enabled. Email/SMS remain off. See INSTITUTIONS.md for limits and rollout checks.

Help institutions understand which published resources and outreach efforts receive responses.

- Create campaigns around approved pages and events, with share links and QR codes suitable for school visits and information sessions.
- Attribute campaigns, inquiries, and events to the responsible department/program. Department reports cover their own work; authorized parent reports provide consolidated totals without counting the same inquiry twice. Preserve suppression protections across parent and unit reports.
- Let staff prepare bilingual messages for contacts who opted in to the relevant outreach. Add preview, recipient confirmation, suppression checks, and delivery limits before enabling sending.
- Report page views, call-to-action clicks, submitted inquiries, RSVPs, unresolved inquiries, and first-response time. Keep the collection definitions and reporting windows visible.
- Attribute an inquiry to a campaign only when a valid campaign identifier accompanies it; label missing attribution as unknown. Do not infer an application or enrollment from an outbound click.
- Preserve low-count protections for aggregate audience reporting and prevent overlapping filters from exposing suppressed cells. Identifiable inquiry queues are a separate, consented operational surface.

Completion: staff can trace a test campaign from share link to inquiry and response. Reports reconcile with test fixtures and label missing data, repeat counts, and collection outages accurately. No fabricated unique-person or enrollment claims.

## Phase 6 Partner pilot and commercial readiness

Validate recurring value with a small invited group before expanding integrations.

- Run a pilot covering institution setup, publication, one event or campaign, inquiry handling, and a reporting review.
- Include a parent institution with at least two departments in the pilot to verify delegation, distinct public pages, correct inquiry routing, and consolidated reporting. Define whether a paid subscription covers the whole institution or selected units before billing is introduced.
- Gather staff feedback on time to publish, time to respond, unresolved requests, and usefulness of inquiries. Establish targets after observing a baseline rather than inventing performance promises.
- Prepare service onboarding, support ownership, retention settings, institution agreements, and a clear description of collected data and access boundaries.
- Evaluate paid tiers around team workflows, campaign management, integrations, and reporting. Keep admissions guidance independent of payment and label any sponsored placement.
- Add CRM exports or integrations only after field mapping, consent scope, recipient controls, and retry behavior are defined. Evaluate institutional SSO when a partner requires it.
- Keep research partnerships on their separate approval path. The existing research sandbox remains synthetic until an approved protocol and required permissions exist; an outreach contract does not authorize research access or model training.

Completion: pilot staff can operate without developer intervention; permissions and mobile journeys pass acceptance tests; reporting definitions and support responsibilities are agreed; no real research release is enabled by this work.

## Data architecture additions

Retain stable institution IDs and the existing publication/review history. Add migrations incrementally rather than replacing current records.

| Area | Proposed records and constraints |
| --- | --- |
| Membership | Institution invitations with token hashes and expiry, scoped roles, membership audit events; per-institution representative affiliation details |
| Departments and programs | Units with stable IDs and a parent institution foreign key, department/program type, approval state, unit-scoped memberships and published pages; link inquiries, events and campaigns to the owning unit. Start with one level under the parent; prevent arbitrary reparenting and define archival behavior before deletion |
| Content | Localized versions, programs, pathways, events and publication references; distinguish draft from approved records |
| Outreach | Campaigns and approved destinations; institution-scoped inquiry records, assignments, response timestamps, RSVP records |
| Permissions to contact | Recipient institution, purpose, channel, notice version, grant and withdrawal timestamps; suppression checked before delivery |
| Delivery | Outbox jobs with idempotency keys, bounded retries, delivery outcome and provider references |
| Reporting | Documented aggregates by permitted time window and campaign; keep contact records separate from public engagement counters |

All private records require institution-scoped authorization, relevant uniqueness constraints, retention handling, and indexes for actual access patterns. Do not introduce materialized views until measured query volume justifies their refresh and maintenance cost.

## Delivery sequence

Implement phases 1 and 2 first to fix access and daily usability. Phase 3 makes published pages useful; phase 4 creates direct outreach value. Phase 5 measures that value, and phase 6 validates a paid institutional offering. Each phase should include migrations where needed, authorization tests, desktop/mobile verification, and deployment checks before its dependent phase is released.
