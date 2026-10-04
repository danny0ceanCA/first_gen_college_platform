# Origen vendor readiness phases

Started October 3, 2026. Internal working plan; no UC approval or protection classification claimed.

## Delivery sequence

| Phase | Deliverable | Completion evidence | Current state |
| --- | --- | --- | --- |
| 1: scope and inventory | Pilot service specification, source-backed data inventory, decision register | Every known data store/processor listed; unknown settings explicitly identified | Draft documents prepared; business and live-provider details pending |
| 2: university reporting | Minimal engagement metrics, institution-scoped reporting and authorization, constrained event collection | Tests for cross-institution isolation, unauthorized exports, rejected personal fields, publication boundaries and counting rules | Monthly aggregate counters and member-only dashboard implemented and locally tested; production verification pending; no export endpoint |
| 3: privacy lifecycle | Account export/deletion, linked-account behavior, device-copy handling, enforceable retention, disclosures | Tests proving deletion and import behavior; retention dry run; disclosure matches actual processing | Web data download/closure, receipt enforcement and expired-invite cleanup implemented locally; provider/native/institutional closure and inactivity policy still pending; see ACCOUNT_LIFECYCLE.md |
| 4: production controls | Configuration verification, privileged MFA, least privilege, restore exercise, incident response, patching procedure | Dated configuration evidence, successful restore record, incident exercise and remediation register | Startup validation, API headers and CI implemented; operational runbooks prepared in PRODUCTION_CONTROLS.md; live settings/restore/tabletop unverified |
| 5: assessment packet | Security plan, truthful questionnaire answers, accessibility report, subprocessor inventory, evidence index | Each claim links to code, test, settings evidence or a dated operational record; gaps remain visible | Internal assessment packet, provider inventory and preliminary accessibility review prepared; limited browser checks passed; full ACR/independent assessment/live evidence pending |
| 6: campus review | Department-confirmed classification and scope, accepted assessment route, procurement onboarding | Campus feedback addressed and relevant approval recorded | UC_DAVIS_HANDOFF.md prepared with scope brief, unsent initial outreach, questions and decision log; user has no campus contact; actual review/onboarding pending |

Proceed sequentially where dependencies require it. Do not silently remove existing family features to simplify a university review. Keep family/student processing visible in the service architecture even when university reporting excludes it.

## Working decisions

| Decision | Working proposal | Status |
| --- | --- | --- |
| Pilot reporting | Aggregate page views and approved resource-link clicks; no identified leads | User confirmed October 3, 2026 |
| Visitor identification | No persistent visitor identifier; do not claim unique people | Proposed |
| Reporting detail | Institution-level totals for fixed reporting periods; no demographics or individual histories | Proposed |
| Small counts | Suppress reported metric values below 10; align export and dashboard behavior and prevent overlapping queries from revealing suppressed values | Proposed risk-reduction measure, not a UC rule or anonymization guarantee |
| Event storage | Atomic monthly counters rather than individual event records; no visitor identifiers in application counters | Implemented and locally tested |
| Analytics retention | Current month plus preceding 11 calendar months, automated expiry | Implemented locally; provider backup retention unverified |
| Family-record retention | User-controlled deletion plus an explicit inactivity policy | Unresolved; no silent mass deletion until a policy and notice process are established |
| Provider settings | Regions, log/backup expiry, encryption and AI processing terms | Must verify live settings/agreements |
| UC classification | Buyer/security lead determines the applicable protection/availability levels | External determination required |

## Evidence rules

Use statuses: implemented in source, tested locally, verified in production, proposed, missing, external determination required. Do not substitute one status for another. Provider certification is supporting evidence and does not certify Origen's application or operations.

No credentials, personal records or private transcripts belong in this folder. Capture redacted settings evidence. Preserve existing uncommitted work and add new migrations rather than editing applied migrations.

## Phase 1 outputs

- [Pilot service specification](SERVICE_SCOPE.md)
- [Data inventory](DATA_INVENTORY.md)
- [Original readiness review](../../UC_VENDOR_READINESS.md)

## Required external inputs

- User: reporting preference, business/security contact, intended minimum user age, retention commitments, and current insurance/assessment documents.
- Provider verification: Render service/database region and plan, backup/log retention, access roles; Auth0 connections/MFA/session policy; OpenAI project processing configuration and applicable agreements.
- UC Davis: department sponsor, data classification, questionnaire/evidence route, accessibility expectations, insurance and contract obligations.

Read-only verification and local implementation can proceed within the authorized work. Review a concrete deployment or externally submitted packet before publication where necessary. Do not send outreach or accept contracts on the user's behalf without authorization.
