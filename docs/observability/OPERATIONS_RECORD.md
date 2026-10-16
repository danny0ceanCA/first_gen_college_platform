# Diagnostics operations record — October 16, 2026

Status: local implementation plus authorized preparation of the existing production database/API settings, not a production-readiness certificate. Current repository baseline is `4a1685f253971fd3b17123cb37321728b6ad36f6` with uncommitted phases 1–8. No new diagnostic service deployment, processor activation or notification integration occurred. See [the baseline preparation record](BASELINE_PREPARATION.md).

The previously recorded shared-family `test:ops` failure was resolved locally on October 16. The outdated rejection expectation now checks survivor preservation for either account's closure, with independent institutional rejection guards; all six ops tests pass. This changes the local regression evidence, not the pending infrastructure, access or activation gates.

## Infrastructure evidence

| Setting | Evidence and current limit |
| --- | --- |
| Application hosting | Reverified October 16 after the user confirmed My Workspace: API `srv-db02or0u01pc738ktekg`, Oregon; static site `srv-db02o8ou01pc738krjb0`, global/location unspecified. Both automatically deploy commits to main |
| Application PostgreSQL | Reverified October 16: `dpg-db0806hsrm7s73efcupg-a`, PostgreSQL 18, Oregon, 1 GiB disk, HA disabled; available. Migrations 040–043 applied during authorized baseline preparation |
| Current Render metadata | Confirmed target repository and workspace before writes. Existing API/runtime and new cleanup login passed permission checks. API settings saved without deployment; live healthz and readyz returned 200 |
| Plans and monthly infrastructure budget | Current API plan 0.5 CPU / 512 MiB; database plan 0.1 CPU / 256 MiB. Monthly approved budget and provider prices remain unverified |
| Telemetry / independent ledger / diagnostic audit regions and plans | Not deployed/verified in this session. Must be independently provisioned with separate identities, TLS, backup and cost evidence |
| TLS | Operator setup/verification used verified public-host database TLS. Saved API configuration uses its existing render-internal mode; no TLS setting was changed. Live application endpoints use HTTPS. Certificate rotation and runtime socket evidence remain separate verification tasks |
| Backup expiry | Render reported point-in-time recovery AVAILABLE starting 2026-10-13T19:11:12Z before preparation. Exact configured retention and other provider windows remain unverified. No user-data dump was downloaded. Telemetry implementation accepts a verified backup horizon of at most seven days; erasure ledger lasts 30 days |
| Infrastructure/access logs | Render log retention and selective erasure unverified. Deleting telemetry does not assert deletion from provider logs |
| Staff/service access | Code restricts individual purposes; current console membership, MFA and credential inventory remain unverified. Owner must review staff, gateway recipient and image/controller access separately |
| Agent project, processor terms and retention | No provider adapter approved/activated; scripted synthetic diagnosis only. No claims of zero provider retention |
| Runner host | No disposable Linux/gVisor host configured here; real boundary suite remains an activation gate |
| Shadow observation / alert routing | Seven production/staging days not collected. Paging remains disabled. Independent probe, drop denominator, baseline and external scheduler integrations need operator configuration |

Historical observations are evidence of their recorded date only. Update this record with redacted console evidence and owner/date after confirmation; never store tokens, connection strings, private membership lists or user records here.

## Ownership and review

Proposed accountable owner: Daniel Ojeda, project owner. Operational assignments below require his confirmation before production use; this document does not assert that another person accepted duties.

| Responsibility | Named primary / backup / next evidence |
| --- | --- |
| Incident triage and external monitor | Pending owner assignment and approved contact route |
| Access review, case controls and privacy incidents | Pending owner assignment; verify staff/service inventory and MFA |
| Erasure, expiry and backup restoration | Pending owner assignment; verify backup horizon and recovery evidence |
| Release / image / sandbox approvals | Pending independent reviewer assignment; verify host/runtime/image digests |
| Agent budgets, provider processing and retention | Pending owner approval and console evidence |
| Monthly exercise and cost review | Pending scheduled owner/date; no recurring automation created |

Do not describe these responsibilities as operationally covered while assignments are pending. Use the monthly procedure in RUNBOOKS.md and complete the deployment record with exact evidence before enabling a capability.

## Privacy reconciliation

The English and Spanish source notices now conditionally describe the separate content-free technical pipeline, short event/span retention, aggregate metrics and restricted technical investigations. The provider inventory distinguishes these proposed stores and synthetic-only agent/runner from existing OpenAI user-facing guidance. These source edits are not a claim that new logging is deployed or provider-retention settings were verified. The legal reference notice remains a review draft; publish through the normal owner review/release workflow after actual settings are reconciled.
