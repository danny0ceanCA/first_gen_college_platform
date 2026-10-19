# Coordinator accounts and student binder sharing implementation plan

Date: October 18, 2026. Status: implementation in progress. No coordinator access is enabled by this document.

Implementation progress: [Phase 1](PHASE_1.md), [Phase 2](PHASE_2.md), [Phase 3](PHASE_3.md), [Phase 4](PHASE_4.md), [Phase 5](PHASE_5.md), [Phase 6](PHASE_6.md), and [Phase 7](PHASE_7.md) are implemented locally. [Phase 8](PHASE_8.md) now includes local release verification, a real PostgreSQL/browser workflow rehearsal and bilingual partner operating guides; staging/provider verification and the approved partner pilot remain pending. Provisioning, linking, voice linking, student publication, and coordinator viewing are disabled by default; production activation and live Auth0/OpenAI verification are pending. Coordinator guidance is separately gated and disabled by default. Sharing initially permits only new manual notes with verified student-only provenance; legacy and conversation-derived notes stay private.

Origen will let a student connect with a verified community organization coordinator, publish selected binder material, and receive clearly attributed guidance in the binder. A student can give the coordinator's connection code to Origen by voice. The assistant resolves the code and presents the connection for confirmation; the server controls identity, permissions, and publication.

Deployment preparation update, October 19, 2026: the production database is migrated through 056, restricted application/maintenance grants are updated and verified, and all six coordinator flags are explicitly false in Render. Application code has not been committed, pushed or deployed by this preparation. See [production preparation](PRODUCTION_PREPARATION.md) for the verified result and remaining pilot gates.

This plan supersedes the deferred [coordinator proposal](../COORDINATOR_BINDER_SHARING_PROPOSAL.md). Implement the phases in order. Each phase must meet its acceptance criteria before the next phase exposes its functionality. The complete partner pilot requires all eight phases; earlier phases can be demonstrated with synthetic accounts.

| Phase | Deliverable |
| --- | --- |
| 1 | Privacy rules, protected-source tracking, and database access boundaries |
| 2 | Approved coordinator accounts, organization controls, and invitation codes |
| 3 | Typed, scanned, and spoken-code connection with explicit confirmation |
| 4 | Student preview, snapshot publication, and immediate revocation |
| 5 | Coordinator dashboard and authorized shared binder viewing |
| 6 | Red-ink guidance, student replies, and private follow-through with Origen |
| 7 | Notifications, retention, deletion, offboarding, and access evidence |
| 8 | Complete verification and a controlled community-organization pilot |

## Product rules

1. **Family conversations are never shared with coordinators.** This includes conversations in family scope, conversations originating from a parent or family account, conversations involving family members, and notes, translations, summaries, or other material derived from those conversations. Switching a conversation into a student topic does not make its prior family context shareable.
2. Raw conversations and recordings are never coordinator content, including student-only conversations. Only eligible saved binder entries explicitly published by the student can be shared.
3. The connection code locates a coordinator. It is not a password, access token, or substitute for student permission. A successful connection alone exposes no binder contents.
4. Sharing uses a published snapshot. New conversations, new notes, and edits remain private until the student previews and publishes an update. Topic selection is a maximum scope, not automatic publication of everything in that topic.
5. Coordinator feedback appears in **red ink**, with a visible coordinator label, name, organization, and date. A coordinator cannot overwrite the student's writing. Guidance is a suggestion until the student chooses to adopt it.
6. Grants belong to an individual coordinator within an organization. Organization owners, other staff, and parent organizations do not inherit binder access.
7. Students can withdraw a published item, remove a topic, or stop sharing. Current permission is checked on every server request. No new access is allowed after revocation commits; previously viewed information cannot be recalled from a person's memory or screenshots.
8. Existing guardian permission is not permission to disclose a binder to a coordinator. The initial pilot supports eligible adult student-owned binders. Minor sharing and parent-managed profiles stay disabled until a separate disclosure-permission flow and ownership rules are approved and implemented.

The family exclusion is a source and access policy, not a promise that software can recognize every family detail a person manually retypes. Known family-derived and unknown-source material must be blocked, rather than relying on an AI classifier to redact it safely. Do not offer an override that simply relabels a protected note as student-owned.

## Student and coordinator experience

| Step | Student experience | Coordinator experience |
| --- | --- | --- |
| Invitation | Receive a link, QR code, or spoken code | Share an organization-specific connection code |
| Connection | Enter the code or say it to Origen; confirm the displayed coordinator and organization | Accept or decline a minimal connection request |
| Publication | Choose eligible topics and entries, preview the exact shared view, then publish | See published material only after acceptance and publication |
| Guidance | See a red-ink note in the relevant binder topic; reply or mark reviewed | Add guidance, a resource, or a proposed next step |
| Follow-through | Ask Origen to explain that guidance; privately work on a response | See only replies or updates explicitly submitted for sharing |
| End access | Stop sharing from People with access | Lose access; no automatic reassignment to a coworker |

Voice example: “Origen, my coordinator gave me code R7KMP 4P9XT.” Origen resolves it and says, “This is Maria Lopez at Example Community Center. I have opened the connection card. Confirm if this is your coordinator.” The student confirms on screen. Once accepted, Origen can open the sharing preview. It says “Your request was sent” or “Your notes were shared” only after the relevant server operation succeeds.

## Existing code and integration boundaries

These are repository integration points, not evidence that coordinator sharing already exists.

| Existing area | Reuse or constraint |
| --- | --- |
| `server/institution-access.mjs`, `src/InstitutionTeam.tsx`, migrations 008 and 020 | Organization membership, staff invitations, verified invitation email, and team management already exist. Add coordinator capability without granting existing roles student access. |
| `src/InstitutionSharing.tsx` | Existing QR and link UI is for institutional public pages. Reuse presentation patterns, not its public-page access semantics. |
| Migrations 001, 004, and 015 | Student rows use `(account_id, id)`; family links and conversation segments have distinct ownership. A linked profile is not proof that the signed-in person may publish the student's information. Use verified identity mappings where available; do not match people by name or email. |
| `server/topic-notes.mjs`, `server/binder-jobs.mjs` | Existing notes can derive from summaries. `student_id` alone cannot establish shareability. Extraction, translations, and later edits need protected-source lineage. |
| `server/account-isolation.mjs`, `server/account-guard.mjs` | Preserve account isolation and transaction guards. Never execute coordinator requests as the student or use a maintenance database credential to read private history. |
| `server/permission-context.mjs`, `server/permission-execution.mjs` | Follow existing permission revision and cancellation patterns. Coordinator grants need their own revisions as well as current account eligibility. |
| `src/TopicNotebook.tsx`, `src/PersonalBinder.tsx`, `src/HomeOverview.tsx` | Add sharing controls, People with access, and coordinator feedback without changing private notebook ownership. |
| `src/voiceMemoryTools.mjs`, `server/live-memory-tools.mjs` | Follow current turn binding, idempotency, cancellation, and truthful tool-result patterns for connection tools. Do not reuse memory-save permission as sharing permission. |
| `src/binderExport.mjs`, `src/binderPdf.mjs` | Student PDF export can include received guidance with attribution. Coordinator endpoints must never call the unrestricted personal export path. |
| `docs/data-architecture/ARCHITECTURE.md`, `server/observability/` | Keep access evidence separate from diagnostic telemetry; exclude content and connection codes from routine logs and diagnostic-agent input. |

Keep the existing React, Node, Auth0, and PostgreSQL stack. No new AI provider, vector database, queue service, or external case-management product is required for the pilot.

## Proposed data and authorization contract

Use additive migrations, selecting the next unused migration number when implementation begins. The latest migration at planning time is 049; do not reserve numbers across concurrent work.

| Proposed record | Required information and constraints |
| --- | --- |
| `origen_coordinator_profiles` | Existing institution membership reference, display name, verified identity reference, status, capability revision. Unique per institution and representative. Removing membership disables the profile and grants. |
| `origen_coordinator_codes` | Coordinator profile, hashed random code, created/expiry/revocation times. A code resolves only a safe public coordinator card. No student identity or grant is encoded. |
| `origen_binder_connections` | Exact student account/profile pair, coordinator profile, status, request/accept timestamps, expiry, revision, request idempotency key. Prevent duplicate live connections for the same pair. |
| `origen_binder_share_grants` | Connection, exact grantor identity, allowed topics, permission-text version, permission revision, expiry, revoked time, current publication pointer. No wildcard household or organization grants. |
| `origen_binder_publications` | Immutable version, grant, published time, student confirmation evidence, preview digest, sharing-policy version. Never expose historical publications after replacement or withdrawal. |
| `origen_binder_publication_items` | Copied approved entry text, topic, language, source version, private lineage references and eligibility decision. Coordinator response uses an explicit field allowlist and omits private lineage IDs. |
| `origen_binder_source_lineage` | Source references, protected-source classification, classification version, and derivation edges. Inherit the most restrictive classification across all inputs. Unknown ancestry remains private. |
| `origen_coordinator_feedback` | Student account/profile, grant, topic, optional publication item, author identity and organization snapshot, body, type, version, created/edited/withdrawn times. No private staff-only notes in this feature. |
| `origen_coordinator_feedback_revisions` | Immutable edit history with author and time. Student-visible edits must remain attributable; deleted body retention follows the lifecycle below. |
| `origen_coordinator_replies` | Explicitly submitted student replies tied to feedback and grant. Private voice discussion is never automatically a reply. |
| `origen_binder_share_events` | Restricted audit evidence: actor reference, grant, action, outcome, policy/revision, timestamp and request reference. No note text, transcript, code, or tool argument dumps. |
| `origen_coordinator_notifications` | Recipient, event kind, opaque resource reference, read state and expiry. Delivery resolves current permission again. |

Cross-account publication access needs a separate repository and database policy. Retain the authenticated coordinator as the actor. With row-level security, permit access only to publication rows for an active grant addressed to that coordinator, with current verified organization membership, unexpired permission, and matching revisions. Publication items, feedback, and replies must enforce their parent grant relationship with composite constraints or equivalent checks. Normal student queries remain account-scoped.

Do not widen policies on private summaries, memory, family notes, or plans. Any helper function used by policies must have a fixed search path, narrowly scoped ownership and execution grants, and real PostgreSQL isolation tests. Organization staff and platform administrative roles get no implicit publication-read permission.

Authorization is deny-by-default and must be evaluated on each request, not merely at sign-in or when hiding controls. This follows the [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

### Sharing eligibility

An entry can be published only when the server proves all of the following:

- It belongs to the authenticated student-owned binder and an allowed topic.
- It is a saved, confirmed entry at the exact version the student previewed.
- Every contributing source is eligible student-only material; none is family, parent-originated, mixed, unresolved, suppressed, deleted, or unknown.
- Its generation context did not include private family memory or a mixed summary. Source evidence covers retrieved context and prompt inputs, not just the quoted sentence.
- Its current account eligibility, grant revision, source status, and publication permission still match at commit time.

Do not backfill historical notes as safe because their `student_id` is set. Leave legacy entries private unless existing evidence proves the complete source boundary. Where safe extraction is needed, run it on an isolated student-only input set; do not reuse a model session that has seen family context. A family segment boundary alone does not clear earlier model context.

Student-created manual notes may be candidates after the student identifies them as their own college-planning notes. Entries copied or generated through app workflows from protected sources retain that protection. Explain that family conversations do not belong in shared notes. Arbitrary manually retyped text cannot be reliably classified by origin.

The shared Summary tab is a deterministic digest of the current published items, grouped by topic. Do not send the student's private global summary to the coordinator or to a model generating a shared summary.

### Connection and publication states

Connection states: `requested -> accepted`, `requested -> declined`, or `requested -> expired`. A requested or accepted connection can become `revoked`. Revocation is terminal for that record; reconnecting creates a new request and permission record.

Accepted connections are empty until publication. Grant states are `active`, `revoked`, or `expired`; current eligibility or membership suspension additionally blocks access even if a grant row still says active. Restoring membership never silently restores an old grant.

Preview and publication are separate operations. A preview is bound to the student, recipient, allowed topics, entry IDs and versions, current permission revision, and a short expiry. Changing any of those requires a fresh preview. A confirmation is single-use and idempotent: repeated delivery returns the original result and cannot create duplicate grants, publications, or notes.

## Phase 1 Privacy boundaries and data foundation

**Outcome:** The system can represent sharing without making any private content accessible.

Implementation:

1. Add the proposed schema, foreign keys, unique constraints, indexes, row-level policies, and runtime grants. Keep all new routes disabled by default.
2. Implement `server/binder-sharing-policy.mjs` as the single policy entry point for eligibility, ownership, membership, allowed topic, source lineage, expiry, and permission revisions.
3. Add lineage tracking to note creation, extraction, translation, edits, and copy paths. Protected status is server-owned and cannot be cleared by an HTTP request or AI tool argument.
4. Build an explicit serializer for shared publication fields. Implement source deletion and protection-change invalidation hooks before any sharing can be enabled.
5. Define fixtures containing student-only, parent-originated student-scoped, family-scoped, mixed, unknown legacy, translated, and edited notes.

Acceptance: forbidden fixtures never enter a publication; changing a client-supplied account ID, topic, origin, or classification cannot bypass the policy. Real PostgreSQL tests prove coordinator reads cannot reach private tables. Migration, runtime-role, and rollback checks pass using a disposable database.

Deployment: additive migration and runtime grants only; no historical publication or permissive backfill. Rollback disables routes and preserves new records for forward repair.

## Phase 2 Coordinator provisioning and organization controls

**Outcome:** An approved organization can create individually accountable coordinator accounts.

Implementation:

1. Reuse institution invitations and verified identities. Add a coordinator capability tied to membership, rather than converting every owner, editor, outreach worker, or analyst into a coordinator.
2. Let approved organization owners invite staff and enable/disable coordinator capability. Origen administrators approve pilot organizations. Organization verification is separate from publication of its landing page.
3. Require verified email and server-verifiable MFA assurance for coordinator access. Configure and verify the Auth0 assurance mechanism; a client boolean or profile checkbox is insufficient.
4. Add coordinator workspace routing and a profile card. People with personal and institutional accounts explicitly switch workspace; one role never inherits the other's data access.
5. Issue a random 10-character code from an unambiguous 32-character alphabet, displayed in two groups of five. Store only a hash; display the original on creation and rotate it if lost. Codes expire after 30 days by default and can be revoked earlier. QR/link and text resolve the same record.
6. Removal or suspension of staff disables lookup and all associated grants immediately. Organization suspension has the same effect.

Acceptance: unverified, suspended, removed, and non-coordinator staff cannot use coordinator APIs. An organization owner cannot read a student's binder merely by owning the organization. Rotation invalidates the old code but does not cancel already approved grants. Membership restoration does not reactivate old access.

Deployment: enable provisioning for an explicit organization allowlist. Staff can prepare profiles and codes; no student content is available yet.

## Phase 3 Connection by code and through Origen

**Outcome:** Students can connect through a typed code, QR link, or a spoken code without accidentally sharing content.

Implementation:

1. Add authenticated lookup and request/accept/decline/cancel endpoints. A lookup returns name, organization, role, profile ID, and a short-lived server challenge, never a roster or binder information.
2. Normalize spaces, case, and separators. Do not fuzzy-match an uncertain code to a different coordinator. Read back the resolved identity and provide a typed fallback.
3. Rate-limit lookups and requests per signed-in account and network, using the existing rate-limit infrastructure. Start with 10 lookup attempts per account per 10 minutes and an additional network limit; tune from pilot evidence. Use a generic unavailable response for invalid, expired, or revoked codes.
4. Introduce strict tools such as `lookup_coordinator_code` and `prepare_coordinator_connection`. A tool result opens a confirmation card bound to the current student and voice turn. The production pilot requires the student to press Confirm; speaking the code alone never grants access.
5. Preserve cancellation, duplicate-call handling, and uncertain-result recovery. A later turn, student switch, logout, or expired challenge invalidates the prepared action. A future voice-only confirmation needs equivalent server-bound evidence before release.
6. On student confirmation, create a pending request with the minimal display name and intended topics. Require coordinator acceptance. Pending requests expire after seven days; the connection exposes no entries before Phase 4 publication.
7. Omit spoken codes from retained summaries, memory, diagnostic logs, analytics, and notification text. A voice provider necessarily processes the spoken code transiently; it is an invitation locator, never an authentication secret.

Acceptance: misheard and expired codes fail safely; code enumeration is throttled; a model cannot invent confirmation or choose an actor ID. Duplicate requests create one pending connection. No binder content is returned before acceptance and publication. English and Spanish, keyboard, and mobile flows pass.

Deployment: enable linking for pilot accounts only. In the initial pilot, parent-managed profiles and minors receive a clear unsupported message rather than a consent bypass.

## Phase 4 Student preview and snapshot publication

**Outcome:** Students can choose exactly what a named coordinator sees and withdraw it reliably.

Implementation:

1. Add Share with a coordinator and People with access to the binder. Show eligible saved entries within selected topics. Identify excluded content with a generic privacy explanation; do not show protected content in any coordinator response.
2. Offer selected topics or all eligible topics, followed by entry review. Both paths use the same eligibility filter. Selecting all topics does not expose family content or raw conversations.
3. Generate an exact server preview from permitted item versions. Confirm the recipient, expiration, and current contents. Default grants to 90 days; renewal requires a new student confirmation.
4. Publish the snapshot in a transaction that rechecks and locks relevant grant/source versions. Default new or changed entries to private. Publish updates explicitly, replacing the current publication pointer atomically.
5. Implement item withdrawal, topic removal, revoke-all, source deletion invalidation, and account-permission withdrawal. Recheck grants during reads, writes, queued work, and summary assembly. An altered or deleted source invalidates affected old publication items; it never silently exposes new text.
6. Use `Cache-Control: no-store` for shared content and exclude it from service-worker/offline/local-storage persistence. Active views clear on revocation events, focus refresh, and permission errors; server checks remain authoritative when a browser is disconnected.

Acceptance: a family-derived sentinel never appears in preview, publication, digest, translation, logs, or API errors. Concurrent revoke/publish/read tests show writes authorized before revocation finish in a defined order and no request authorized after revocation can read. Source-version conflicts return a refresh requirement. Reconnecting does not resurrect old publications.

Deployment: permit synthetic student publication first. No production coordinator viewing until both privacy and revocation tests pass. Keep a server kill switch that blocks reads and writes while leaving student stop-sharing controls available.

## Phase 5 Coordinator shared binder workspace

**Outcome:** A coordinator can review authorized published material and understand where a student wants help.

Implementation:

1. Add Shared binders, New updates, and Help requested views. List only active relationships and their permitted display metadata. Pagination, counts, search, and error messages obey the same grant boundary.
2. Reuse the binder's topic layout with a dedicated publication-backed data adapter. Do not load the student's personal notebook API and hide fields in the browser.
3. Show a sharing banner, published time, available topics, and “Only the entries this student has shared are shown.” The Summary tab contains only the permitted publication digest.
4. Track reviewed publication version rather than inferring effort, engagement, or risk from a student's private activity. Help requested is explicitly set by the student.
5. Keep coordinator PDF export, bulk downloads, cross-student AI search, private memory retrieval, and automatic reassignment unavailable in the pilot.

Acceptance: coordinator A cannot access coordinator B's grants, even within the same organization. Tampered item IDs and pagination cursors reveal nothing. No unauthorized names leak through search or counts. Mobile layouts have no horizontal overflow, and empty/revoked/expired states are understandable.

Deployment: release to synthetic coordinators, then a small approved pilot after Phase 8 readiness. A paused view must reauthorize before it reloads content.

## Phase 6 Red ink guidance and student follow-through

**Outcome:** Coordinators can leave useful, unmistakably attributed guidance inside the student's binder.

Implementation:

1. Add feedback types `guidance`, `resource`, and `suggested-step`, with a 2,000-character plain-text limit. Validate links and render text safely. Attach feedback to a shared topic and optionally an eligible published item.
2. Save author and organization attribution on the server. Apply optimistic version checks and idempotency keys. Coordinators can edit or withdraw their own feedback while their grant is active; they cannot mutate student notes or another coordinator's feedback.
3. Display a warm red ink candidate such as `#B42318` on a pale background, a left border, a pen icon, and “Coordinator guidance · Maria Lopez · Example Community Center.” Verify contrast on the actual theme. Use a readable body font and never present the red as an error state.
4. Keep the role label and author visible in grayscale, screen-reader output, and PDF. Color must not be the sole identifier; normal-size text must meet at least 4.5:1 contrast. See [W3C use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) and [minimum contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
5. Give students Mark reviewed, Reply, and Add to my next steps. Reply explicitly submits text to that coordinator. Adding a step creates a separate student-owned action linked to the guidance; it does not change the original advice into a confirmed fact.
6. Talk about this may pass the student's received feedback to Origen with its author clearly identified. Treat feedback as untrusted content, not system instructions. Private discussion of feedback stays private and never becomes an automatic coordinator reply or shared recap.
7. Existing feedback remains readable by the student after sharing ends, with a connection-ended label. Former coordinators lose access and cannot continue editing. Support student hiding/removal and report feedback for abuse; no private staff case-note feature.
8. Student PDF export offers an explicit Include coordinator guidance option and preserves author/date/type. It must not enable coordinator export access.

Acceptance: mobile and desktop red-ink cards are accessible; editing history is clear; malicious markup and prompt instructions do not execute or expand permissions. Retrying a submission creates one note. Revocation during an edit prevents a later unauthorized commit. Private voice discussion never appears in coordinator replies or shared material.

Deployment: enable feedback separately from reading, allowing the feedback switch to be disabled while existing student copies remain visible.

## Phase 7 Notifications and lifecycle operations

**Outcome:** The feature remains manageable when people leave, permissions change, or accounts are deleted.

Implementation:

1. Start with in-app notifications: connection requested/accepted, publication updated, guidance added, reply received, and access ending. Messages contain no note bodies, family information, codes, or sensitive topic details. Every deep link reauthorizes before returning content.
2. Add optional email only after preferences, delivery configuration, retries, and permission checks are implemented. Use generic “You have an update in Origen” copy. A separate notification outbox provides idempotent delivery and suppresses messages invalidated by revocation.
3. Complete operational controls for staff departure, organization suspension, student account closure, source deletion, grant expiry, and abuse reports. No automatic transfer of students to replacement staff; ask students to approve new recipients.
4. Integrate data export, deletion journals, retention jobs, and restore procedures. Restoring a database must not restore revoked access or deleted publication content; reconcile permission/deletion evidence before enabling sharing after recovery.
5. Add minimal typed events to the restricted access audit. Routine diagnostics receive event type, safe reason code, duration, and opaque correlation reference only. Diagnostic agents receive no publication contents, replies, codes, or family data.
6. Add dashboards for failed authorization checks, publication conflicts, delivery failures, expiry processing, and queue age. Do not turn these into private student-content analytics.

Proposed retention defaults for implementation: connection requests expire after seven days; codes after 30 days; grants after 90 days. Delete stale previews after 15 minutes. Superseded and revoked snapshot bodies become unreadable immediately and are purged from the live database within 24 hours; account/source deletion uses the existing deletion workflow immediately. Retain student-visible guidance until the student removes it or the account is deleted. Purge unreadable feedback revisions with the parent record. Keep access evidence without content for 180 days, then delete under the documented retention job. Notifications expire after 30 days. Validate these defaults against existing account retention and organization terms before the pilot; document any adopted change explicitly, including backup expiry.

Acceptance: simulate membership removal, guardian eligibility withdrawal, expired grants, source deletion, missed notification deliveries, account deletion, and backup restore. Old URLs and queued jobs cannot recover access. A revoked coordinator cannot view surviving student copies of feedback. Retention tests verify physical cleanup separately from immediate access denial.

Deployment: exercise lifecycle jobs in staging with synthetic data before pilot enrollment. Reuse the existing API/database and job patterns; email is optional and no new external queue is required.

## Phase 8 Pilot readiness and staged launch

**Outcome:** One community organization can use the complete workflow with supported students and clear operating procedures.

Implementation:

1. Run the full isolation and negative test suite against real disposable PostgreSQL with the restricted runtime role. In-memory tests alone do not establish row-level security behavior.
2. Walk through the complete flow in English and Spanish on desktop and mobile: invite staff, accept invitation, resolve a spoken code, confirm connection, accept request, preview entries, publish, read, leave red guidance, reply, withdraw an item, and revoke access.
3. Validate MFA, Auth0 claims, schema readiness, runtime grants, feature flags, allowed organizations, logging redaction, retention jobs, and incident kill switches in staging.
4. Begin with one verified community organization, two or three coordinators, and five to ten consenting adult students. Offer minors or parent-managed profiles only after the separate permission extension is implemented and validated. Do not use the special test account to bypass production sharing rules.
5. Give the organization a one-page operating guide: whom to invite, how codes work, what is excluded, how guidance appears, when to respond, how to report problems, and how to remove departing staff. Staff must understand that a shared binder is a curated snapshot, not the student's full conversation history.
6. Evaluate whether students understand what they shared and can stop sharing unaided. Measure connection completion, publication completion, guidance delivery, helpfulness, and coordinator response time using minimal metadata. Avoid engagement-risk scoring.
7. Record pilot findings and only then expand the organization allowlist. Add optional automatic updates, coordinator exports, group assignments, or staff handoffs as separately scoped future work.

Release gates: zero unauthorized content in adversarial fixtures; no real-database isolation tests skipped; no known revocation or deletion defects; accessible feedback labels and contrast; successful incident-disable and restore rehearsals. The product owner confirms the partner cohort and operating guide before production enablement.

## API and tool boundaries to implement

Names below are proposed contracts, not currently available endpoints. Follow the existing authenticated API routing conventions in `server/index.mjs` and validate action payloads strictly.

| Endpoint group | Operations | Actor and boundary |
| --- | --- | --- |
| `/api/coordinator-access` | Profile, code issue/rotate/revoke, membership capability | Verified organization owner or coordinator as appropriate; never private binder content |
| `/api/coordinator-connections` | Lookup, prepare, confirm request, accept, decline, cancel | Student controls initiation; recipient controls acceptance; neither step publishes |
| `/api/binder-sharing` | Eligible candidates, preview, publish, withdraw items, narrow scope, renew, revoke | Authenticated eligible student owner; current source and permission checks |
| `/api/coordinator-binders` | Authorized list, current publication, mark reviewed | Exact recipient coordinator; publication-only queries |
| `/api/coordinator-feedback` | Create, edit, withdraw, read, reply, mark reviewed | Separate author and recipient rules; server-stamped attribution |
| `/api/coordinator-notifications` | List, mark read | Recipient only; dereferencing an item repeats authorization |

All mutations require an idempotency key, expected revision where relevant, and server-derived actor identity. Errors expose a safe reason code, never private content or a global account directory. Return explicit `pending`, `accepted`, `published`, `revoked`, `conflict`, or `unavailable` states so Origen cannot confuse a prepared action with a completed one.

Keep model tools limited to lookup and preparing an action in the first release. Final connection/publication confirmation runs through the same authenticated application endpoint as a manual click. The model cannot fabricate a confirmation token, read arbitrary accounts, approve itself, or broaden a grant through instructions embedded in a note.

## Configuration and deployment sequence

These flags are enforced by the server. Keep them disabled until the relevant deployment checks pass. Guidance and in-app lifecycle operations are implemented; email delivery remains optional future work:

- `ORIGEN_COORDINATOR_ACCOUNTS=false`: coordinator provisioning.
- `ORIGEN_COORDINATOR_LINKING=false`: pilot code lookup, confirmation and connection requests; requires coordinator accounts.
- `ORIGEN_BINDER_SHARING=false`: student publication and coordinator-read master switch; requires accounts and linking.
- `ORIGEN_COORDINATOR_BINDER_VIEWING=false`: coordinator shared-binder workspace; additionally requires binder sharing.
- `ORIGEN_COORDINATOR_FEEDBACK=false`: feedback and shared-reply writes.
- `ORIGEN_COORDINATOR_VOICE_LINKING=false`: voice preparation tools.

Use a database-backed pilot organization allowlist. Frontend capability responses are derived from the server flags and actor's current permissions. Disabling sharing blocks new coordinator reads/writes without removing the student's ability to revoke grants or read their own previously received guidance. No new model API key is required. Auth0 MFA configuration must be verified during Phase 2; runtime database grants and migration execution remain separate deployment steps.

For each phase: implement code and migration with flags off, run focused tests, run regression checks, apply migrations and runtime grants in staging, verify current configuration, then enable only the capability that has passed its gate. Deploy backward-compatible code before enabling dependent UI. Do not drop tables to roll back; disable capability and repair forward.

## Verification and implementation records

Create focused tests as each phase is implemented, for example `server/coordinator-access.test.mjs`, `server/coordinator-connections.test.mjs`, `server/binder-sharing-policy.test.mjs`, `server/binder-sharing-postgres.test.mjs`, and `server/coordinator-feedback.test.mjs`. These filenames are planned deliverables, not tests available today.

Required negative scenarios include: another organization; another coordinator in the same organization; another student; parent-owned linked profiles; a guessed code; a stolen invitation URL without the recipient identity; expired or revoked grants; altered preview versions; a family conversation saved under a student topic; mixed-session summaries; translations and copied notes; global summaries; malicious feedback instructions; duplicate tool calls; stale voice results; source deletion; removal during a write; and restore after revocation.

Use synthetic family-content sentinels and assert their absence from every coordinator payload, shared summary, notification, log, and model input used to generate shared content. Tests must check the server payload, not just whether the UI hides a field.

Existing regression commands from the repository root:

```powershell
node --test server/institution-access.test.mjs server/guardian-permission.test.mjs server/account-isolation.test.mjs server/voice-scope.test.mjs server/binder-export.test.mjs
npm run check:logging
npm run build
```

Run the newly added focused tests and the full `npm test` suite for release. Configure the documented disposable test database for PostgreSQL-dependent tests; a skipped database test is not a passing isolation gate. If native mobile code is changed, read `mobile/AGENTS.md` and run its required checks as well.

After each phase, add `docs/coordinator-accounts/PHASE_N.md` recording implementation status, migrations, flags, tests and skips, deployment steps, rollout state, rollback instructions, and outstanding limitations. A phase is complete only when its acceptance criteria pass; document whether it is local, staging, or production. No phase record should imply deployment from a local build alone.

## Recommended first implementation request

“Implement coordinator accounts Phase 1 from this plan. Build the privacy policy, protected-source lineage, schema and access boundaries with all coordinator features disabled. Include tests proving family-derived, mixed, and unknown-source information cannot be published. Preserve existing family and binder behavior.”
