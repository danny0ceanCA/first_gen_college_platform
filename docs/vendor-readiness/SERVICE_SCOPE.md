# Draft pilot service specification

Internal specification dated October 3, 2026. The user confirmed aggregate-only university analytics with no identified leads. Other proposed implementation details remain working choices. This document describes intended behavior, not all current capabilities.

Origen Edu helps families explore education pathways. The proposed university pilot provides a public institution page and engagement totals for that page. Institution content is managed by signed-in representatives, independently reviewed for affiliation and publication, and published as an approved snapshot.

Current source implements registration, draft editing, revision checks, institution memberships, independent reviewer approval and public approved snapshots in `server/institutions.mjs`, `server/migrations/008_institutions.sql` and `src/InstitutionPortal.tsx`. Live deployment and staffing of the review process are unverified. Team invitations and engagement reporting are not implemented.

## Proposed metrics and access

- Page-view count: accepted loads of an approved institution page; refreshes may count again. Not unique visitors or verified human impressions.
- Resource-link click count: accepted activations of approved links belonging to that institution. Not admissions applications or confirmed website arrivals.
- Reporting: fixed institution/date periods, aggregate totals only, with documented suppression and counting limitations. No visitor identities, GPA, student school, demographic breakdowns, private conversations, voice, profile notes or plans in reports/exports.
- Authorization: every report/export resolved against verified identity and current institution membership on the server. Public pages expose only approved content. Reviewer access remains a separately governed privilege.
- Abuse: count validation, rate limits and bot handling must be specified; no claims of bot-free statistics until verified. Infrastructure IP processing is documented separately.

## Data boundary

Families independently use Origen's planning and AI functions. Those functions process identifiable student data and remain part of the wider platform risk description. The university reporting API must not query those records. No university student-system integration, identifiable lead delivery or university-supplied applicant records are included in this proposed pilot.

Institution representatives provide private first name, work email and role information. Institutions may deliberately publish a separate contact email. Public institution content is not necessarily free of personal information; representatives must avoid including student records or confidential content in page fields.

Any future leads, advertising profiles, cross-page tracking, demographics, SSO integration or university-supplied records require an updated data inventory, authorization design and assessment scope.

## Review boundaries

UC Davis determines classification and the appropriate reviews. An affiliation-reviewed institution page is not a claim that UC approved Origen as a supplier. Accessibility review, procurement and security approval remain separate.

No availability, recovery, incident-notification or deletion deadline is promised here until it can be supported by operations and the applicable contract.
