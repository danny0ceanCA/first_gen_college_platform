# Origen Edu assessment packet — internal draft

Prepared October 3, 2026. Not ready to submit as a complete assessment: production evidence, ownership/contact information, independent security review and full accessibility evaluation remain outstanding. No UC classification, certification or approval claimed.

## Offering

Origen provides an institution page with approved university content and aggregate monthly page-view/link-click reports. University reports exclude family profiles, student identities, GPA, private conversations and plans. The wider Origen platform processes identifiable student/family data for planning and AI guidance; it is included in this risk description rather than hidden by the analytics boundary. See [service scope](SERVICE_SCOPE.md).

## Evidence index

| Topic | Evidence | Status |
| --- | --- | --- |
| Data inventory and architecture | [Data inventory](DATA_INVENTORY.md), migrations 001–014 and handler source; [phase 1 architecture](../data-architecture/README.md) | Source review; future collection is proposed only; live regions/settings unknown |
| Authentication | `server/index.mjs`: issuer/audience/RS256 verification; production config validation | Locally tested; Auth0 live controls unknown |
| Family access separation | Family, links and history handlers and tests | Locally tested |
| Institution access/publication | Institutions handlers/tests, migration 008 | Locally tested; affiliation-review operations unverified |
| Reporting minimization | Metrics handler/tests, migration 009; fixed completed-month reports and minimum-count withholding | Locally tested; repeat activity/bots possible |
| Account lifecycle | [Account lifecycle](ACCOUNT_LIFECYCLE.md), handler/tests, migration 010 | Partial: web self-service; external/native/institution closure gaps |
| Production safeguards | [Production controls](PRODUCTION_CONTROLS.md), config tests, GitHub checks | Code verified; provider MFA/permissions unverified |
| Logs and retention | Logging/diagnostic tests, hourly metrics/invite cleanup | Application controls tested; hosting logs/backups unknown |
| Continuity/incidents | Restore and incident runbooks in production controls | Draft procedures; no exercise completed |
| Accessibility | [Accessibility review](ACCESSIBILITY_REVIEW.md), smoke script and JSON evidence | Limited browser review; no conformance claim |
| Providers | [Provider inventory](PROVIDERS.md) | Observed integrations; contracts/settings pending |
| Third-party assurance | None supplied | Independent assessment and campus-accepted route pending |
| Insurance/business contacts | None supplied | Business owner to provide |

## Questionnaire response worksheet

Use this to prepare truthful answers when Davis supplies its questionnaire/HECVAT version. This is not a completed HECVAT and does not reproduce its official question set.

| Question area | Draft answer | Evidence needed before submission |
| --- | --- | --- |
| Written security program | This packet and production runbooks are draft security documentation; named owner and formal adoption pending. | Owner/date, maintenance schedule, framework mapping and acceptance |
| Data handled | Identifiable family/student planning data and staff contact information; universities receive aggregate engagement counts. | Confirm actual deployment data and agreed campus scope |
| Authentication/authorization | JWT validation and account/institution-scoped server authorization; reviewer privileges are separately allowlisted. | Live MFA/session settings, role review, signed-in smoke tests |
| Encryption | HTTPS frontend origins required by production startup; application code does not establish storage/backup encryption. | Provider TLS, storage/backup encryption and region evidence |
| Vulnerability management | Tests/build/dependency audit workflow added; local production dependency audit returned zero reported advisories. | Required CI checks, patch ownership, remediation records, independent application assessment |
| Incident response | Draft containment/notification procedure exists; contacts and contractual deadlines not finalized. | Named contacts, tabletop, accepted notification obligations |
| Disaster recovery | Restore procedure drafted; no backup restore verified. | Backup plan and successful isolated exercise |
| Data deletion | Web closure deletes active private database records; linked/institutional records require explicit handling; pseudonymous receipt retained. | Provider identity closure, backup handling, native controls and restore replay |
| Retention | Metrics/invites have automated cleanup; no student inactivity deletion policy established. | Approved purpose-based retention and provider expiry |
| AI/subprocessors | Selected context/audio/transcripts processed by OpenAI; Auth0 and hosting also involved. | Agreements, settings, locations and public notices |
| Accessibility | Public institution routes have limited keyboard/language/layout checks; full WCAG 2.1 AA assessment incomplete. | Screen-reader, contrast, zoom, authenticated-flow and voice evaluation; accurate ACR |
| Certifications | No Origen SOC 2, ISO or similar certification evidenced. | Campus-confirmed acceptable assurance route; third-party review where required |

## Submission blockers

1. Assign business, security, privacy and incident contacts; supply current insurance evidence.
2. Verify live provider controls and complete restore/tabletop exercises.
3. Resolve remaining lifecycle, age/guardian and privacy-notice decisions.
4. Complete accessibility evaluation and issue a truthful ACR using the accepted format.
5. Ask campus security/procurement which independent security evidence and questionnaire apply to the pilot.

The UC guidance allows several forms of security evidence, determined with the campus security office: [Engaging suppliers](https://security.ucop.edu/resources/contracts.html). Davis evaluates accessibility documentation against WCAG 2.1 AA, and a public-facing app receives a high-risk accessibility review: [Software procurement guide](https://accessibility.ucdavis.edu/digital/procurement). This does not determine the security protection level.
