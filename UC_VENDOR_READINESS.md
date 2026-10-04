# Origen Edu: UC Davis vendor preparation

Reviewed October 3, 2026. This is an internal preparation plan based on repository source and published UC guidance, not a certification, campus approval, or exhaustive security/accessibility audit. Live Render, Auth0, database, provider contracts, and insurance settings have not been verified. Existing uncommitted product changes were included in the review and left untouched.

Update: the current source now includes institution registration, scoped memberships, affiliation review and controlled publication in migration 008 and the institution API/UI. Earlier statements below about missing institution pages describe the previous snapshot. Engagement analytics remain pending. Track the current implementation and phased work in [the phase tracker](docs/vendor-readiness/PHASES.md) and [data inventory](docs/vendor-readiness/DATA_INVENTORY.md).

## Proposed first university offering

A university-managed institution page with aggregate engagement reporting. UC Davis staff receive only metrics about their institution page. Family profiles, GPA, private notes, conversation summaries, voice, and education plans remain outside university reporting. This boundary is a proposed design, not an implemented feature or existing privacy promise.

Start with page views and outbound program/admissions link clicks. Define bot filtering and counting rules. Do not promise unique visitors without defining the identification method and its privacy implications. Do not collect raw IP addresses, full referrer URLs, URL query strings, profile identifiers, or free-text content in application analytics. Infrastructure providers may independently process IPs and logs; document those separately.

Avoid demographic breakdowns, cross-page histories, identifiable leads, and university-system integrations in the first offering. If these become necessary, reassess data use, disclosure, consent, security, and campus requirements before implementation. Aggregate reporting does not make underlying event collection anonymous.

## Source-backed current state

| Area | Evidence | Preparation implication |
| --- | --- | --- |
| Authentication | `server/index.mjs`: Auth0 issuer/audience/RS256 JWT validation and required subject for authenticated API requests | Useful foundation. Live configuration, staff MFA and provisioning still need verification. |
| Account separation | `server/family.mjs`, `server/history.mjs`, `server/account-links.mjs`, migrations | Family records are account-scoped; linked academic fields and private notes/history have separate handling. University tenancy and staff roles are not implemented in these paths. |
| Personal information | `001_family_storage.sql` stores account name/email, student name, stage, GPA, school, interests, goals, needs, notes | Origen already handles identifiable family/student information independently of the proposed university analytics product. Free-text fields can contain sensitive disclosures. |
| Persistent history | Conversation and planning migrations, `server/conversation-summary.mjs` | Summaries and planning records persist. Statements that all chat-related information resets on refresh are no longer a complete description. |
| AI processing | `server/profile-voice.mjs`, `server/conversation-summary.mjs`, `server/ai.mjs` | Profiles/context and voice or transcript content are processed by OpenAI. Responses requests use `store:false`; this does not by itself establish zero provider retention. Verify provider terms and actual configuration. |
| Diagnostic logging | `server/api-logging.mjs` | Application request logs use allowlisted endpoints, request IDs, status/timing and safe errors. These are operational logs, not engagement analytics. Hosting logs require separate review. |
| Preview access | `server/index.mjs`: `ALLOW_PREVIEW_VOICE` allows selected unauthenticated endpoints when enabled | Verify the deployed flag and consciously separate demonstration access from production student use. Origin checks are not user identity. |
| Deletion | Student/history deletion paths; database cascades | Useful partial deletion support. No complete account export/deletion, automated retention schedule, or backup-erasure workflow found in reviewed paths. |
| Device storage | `src/planning.ts`, `src/ConversationHistory.tsx`, database phase documentation | Local copies/import backups need explicit treatment in deletion and retention procedures. |
| University offering | Reviewed frontend, API routes and migrations | No dedicated institution page, institution analytics events/reporting, or university staff authorization model found. These are implementation gaps. |
| Accessibility/privacy evidence | Reviewed source and documentation searches | No completed accessibility conformance report, privacy notice/consent program, or vendor security evidence packet found. This does not prove such documents do not exist outside the repository. |

## Prioritized work

### 1. Set the product/data boundary

- Approve an initial aggregate-only reporting specification and exact metrics.
- Document the intended users, including high-school students; define age/guardian handling and family-sharing permissions with qualified privacy review as needed.
- Produce a data inventory covering application database, Auth0, AI processing, browser/mobile storage, hosting logs, backups, and future analytics.
- Record purposes, recipients, locations, retention periods, deletion mechanisms and responsible owner for each category. Do not claim an item is verified without evidence.
- Update the README to reconcile prototype-era statements with persistent storage and authentication before using it as buyer-facing evidence.

### 2. Build institution pages and access control

- Add an institution record and public page using approved university content and branding permissions.
- Add server-enforced staff memberships scoped to an institution; a frontend role switch is insufficient.
- Separate analytics ingestion and reporting from family profile/history queries. Use an explicit event schema and reject unsupported fields.
- Aggregate by institution, date and allowed event type; set a minimum-count disclosure rule before allowing breakdowns. A threshold reduces disclosure risk but does not certify anonymization.
- Restrict exports to the same aggregate dataset. Define retention and roll-up behavior before collecting events.
- Verify cross-institution isolation, staff membership revocation, event-field rejection and reporting privacy with meaningful tests.

### 3. Establish production privacy/security operations

- Implement complete account export/deletion with explicit behavior for linked family records, Auth0 identity, local copies, plans/history, logs and backup expiry.
- Publish accurate privacy and AI-processing disclosures; record any required user acknowledgments without assuming one consent solves every purpose.
- Verify privileged MFA, least-privilege production access, environment separation, secret rotation, encryption, provider regions and subcontractor terms.
- Document and exercise backup restoration and incident response. Set service availability and recovery commitments based on demonstrated capability.
- Document patching, dependency review, vulnerability reporting and remediation ownership. Obtain an independent assessment acceptable to the campus for the agreed scope.

### 4. Assemble buyer evidence

- One-page service description, pricing and statement of work.
- Architecture/data-flow diagram and subprocessor inventory.
- Written information security plan and supporting assessment evidence; prepare a truthful HECVAT with unavailable controls marked as gaps.
- Accessibility testing of public page and staff dashboard, followed by an Accessibility Conformance Report and remediation plan.
- Insurance evidence matched to the buyer's required coverage.
- Review UC terms and Appendix DS against actual operations before accepting obligations.
- Register in CalUSource; work with a Davis department buyer for PaymentWorks onboarding and campus review.

## Published requirements and applicability

UC Davis's campus VRA standard requires assessment for P3/P4 information or systems, or A4 availability, and recommends assessment for cloud-hosted P2 information. The campus requestor/security lead determines classification and initiates the review. Target assessment completion is four weeks; Davis recommends requesting it at least three months in advance. Unit-specific requirements can be stricter. Source: https://iet.ucdavis.edu/supplier-risk-management

UC Appendix DS applies to suppliers handling Institutional Information or accessing/providing IT Resources. Its security plan calls for a recognized framework and third-party review/certification unless the responsible UC security officer approves an alternative. UC lists several possible evidence forms; SOC 2 is not presented as the only route. Sources: https://security.ucop.edu/resources/contracts.html and https://procurement.ucop.edu/sites/default/files/2023-09/appendix-data-security.pdf

Do not assign Origen a UC protection level solely because it is educational software, or assume all independently collected visitor information is UC Institutional Information. Ask the buyer to confirm the actual data relationship, review scope and evidence expectations.

Davis evaluates software accessibility documentation against WCAG 2.1 AA and treats public-facing web apps as high risk for accessibility procurement review. Source: https://accessibility.ucdavis.edu/digital/procurement

New suppliers register through CalUSource and obtain a departmental invitation to PaymentWorks. Registration is not a guarantee of business or systemwide product approval. Source: https://supplychain.ucdavis.edu/procure-contract/for-suppliers

Insurance requirements depend on the transaction. Source: https://supplychain.ucdavis.edu/procure-contract/for-suppliers/insurance

## Questions to resolve with a prospective Davis buyer

1. Is this a public recruitment/information page service with aggregate reporting, or a service processing university-supplied student/applicant records?
2. Which department owns the page and approves content/branding?
3. What classification, VRA, accessibility and contracting reviews apply to this exact use case?
4. What independent security evidence is acceptable for a supplier at Origen's stage?
5. What insurance, availability, incident-notification and data-retention obligations apply?

## Validation performed

`npm test`: 73 tests, 72 passed, 1 skipped, 0 failed. The skipped real PostgreSQL integration test requires `DATABASE_TEST_URL`. The suite provides useful evidence for existing boundaries but does not demonstrate live deployment controls, accessibility conformance, university reporting isolation, or UC eligibility.

Immediate implementation milestone: institution page + strictly aggregate reporting + server-enforced institution staff access, accompanied by the data inventory. Do not describe Origen as UC-approved until the relevant campus process has actually completed.
