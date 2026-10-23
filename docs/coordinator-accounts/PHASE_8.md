# Phase 8 — Pilot readiness and staged launch

Local release tooling and rehearsal are implemented. **The real partner pilot is not launched.** Live staging evidence, provider checks, partner selection and product-owner approval remain required. No production account, feature flag, service, migration or permission was changed in this phase.

Subsequent authorized deployment preparation on October 19, 2026 applied production migrations through 056, refreshed the restricted role grants and saved all coordinator flags as false. The existing app remains healthy; application code has not yet been deployed. See the current [production preparation record](PRODUCTION_PREPARATION.md). The local verification and pilot-launch limitations below still apply.

## Deliverables

- `npm run coordinator:verify` runs the complete server suite against an explicitly designated disposable loopback PostgreSQL database, the operations/observability tests, the logging policy check and the production build. It rejects skipped/cancelled/failed tests, captures counts and logs, and compares source fingerprints before and after execution. Output goes into a new directory; prior evidence is never overwritten. It does not accept an application database URL as a substitute for `DATABASE_TEST_URL`.
- `npm run coordinator:readiness -- database` performs read-only schema/checksum, restricted runtime, restricted maintenance, same-database/separate-role, and capability checks. It checks all implemented coordinator capabilities even when rollout flags are off. It never migrates, grants access, delivers notifications or enables a flag. Failures return fixed check names rather than database exception text or credentials.
- `npm run coordinator:readiness -- assess` checks an operator evidence record against the current source fingerprint and generated verification report. Missing/stale/duplicate evidence, mismatched releases, skipped tests, oversized cohorts, missing live-provider coverage or unresolved privacy defects keep readiness blocked. This validates the record's completeness, not its authenticity; an authorized owner reviews the underlying evidence.
- `server/coordinator-pilot.test.mjs` rehearses the connected English/Spanish workflow through real API handlers and restricted PostgreSQL roles: staff invitation acceptance, code issuance, voice preparation, explicit confirmation, coordinator acceptance, preview/publication, guidance, explicit reply, withdrawal and revocation. It checks private sentinels across coordinator payloads and audit/outbox records, denial for coworkers/owners/operators, duplicate submissions, each kill switch, and retained student controls.
- The real React screens can use that same disposable API through `output/playwright/coordinator-phase8-server.mjs`, `coordinator-phase8-preview.js` and `coordinator-phase8-flow.js`. Only identities and identity-provider responses are synthetic. The harness is outside the app entry points and is not a production authentication mechanism.
- Partner quick guides are provided in [English](PARTNER_GUIDE_EN.md) and [Spanish](PARTNER_GUIDE_ES.md). The launch record starts with every external gate pending in [PILOT_RECORD.template.json](PILOT_RECORD.template.json).

No new production environment variable, migration, model, email provider or external queue is introduced by this phase. A separate isolated staging deployment is still needed for live provider verification if one is not already available.

## Current deployment discovery

A read-only inspection of the previously authorized Render **My Workspace** found Origen's API, static frontend and application database in the same environment. No separate Origen staging API/database was identified in that inventory. Service listing and database availability do not establish deployment correctness, MFA behavior, feature flag values or backup retention. No secret environment variables or database connection strings were requested. Do not reuse unrelated projects' staging resources.

## Reproduce local verification

Use a dedicated disposable PostgreSQL cluster with a loopback listener and an operator capable of creating isolated test schemas and roles. Never point these tests at production or a partner database. The fixtures destroy their own schemas and roles. The verification command does not create or destroy the cluster itself.

```powershell
$env:DATABASE_TEST_URL = '<disposable-loopback-PostgreSQL-URL>'
npm run coordinator:verify -- --disposable-database --output tmp/coordinator-release-check
```

The command supplies the same disposable URL to `ORIGEN_TEST_DATABASE_URL` and `TELEMETRY_TEST_DATABASE_URL` for the child tests. The generated `verification.json` records the source fingerprint, suite results and build/logging status. Preserve it with the reviewed release evidence; logs contain synthetic fixture metadata and should not be published as student analytics. Do not change source files during verification. Re-run against the final committed release before staging.

For browser rehearsal, run Vite on a separate port, then `node output/playwright/coordinator-phase8-server.mjs` with the disposable database variable. It writes temporary fixture routing information to `tmp/coordinator-phase8-browser.json`. In temporary copies of the two browser scripts, replace `__PHASE8_BROWSER_FIXTURE__` with that JSON. Open a separate Playwright CLI browser at the local Vite URL, run the preview script, then the flow script. The four flow variants use English/Spanish at 390px/1280px. Send `stop` to the fixture server's stdin afterward; close that browser and Vite. Remove the temporary routing file. Never mount the synthetic identity transport in the production server.

## Staging checklist, in order

1. **Choose the release and isolated staging target.** Commit/review the candidate, retain its commit SHA and generated source fingerprint, and deploy that exact candidate with all six coordinator flags false. Use a separate database and synthetic identities. Record API/frontend deployment IDs and exact origins. A local build alone does not satisfy this step.
2. **Apply and verify database capabilities.** With the migration credential, run `npm run db:migrate`, `npm run db:grant-runtime` and `npm run db:grant-maintenance`. Keep that credential out of the API environment. With restricted runtime and maintenance credentials in a protected operator shell, run `npm run coordinator:readiness -- database --output <new-report.json>`, `npm run check:production` and the existing database checks. Require all checks to pass. The database report has no row contents or connection strings.
3. **Verify live Auth0.** Follow the existing [staff MFA setup](../PRIVACY_SECURITY_PHASE_3.md). Verify enrollment, OTP challenge, work-email verification, signed authentication/MFA timestamps, 12-hour verification expiration, refresh without renewed timestamps, suspension and token reset. Use independent `manage:institutions` reviewers. A synthetic test shim or locally decoded unsigned token is not evidence for this gate.
4. **Approve only the synthetic organization and students.** Use the coordinator workspace's independent organization approval and owner-managed capabilities. Enroll exact adult student-owned profiles using `scripts/provision-coordinator-student.mjs` and the Phase 3 procedure. Never infer identities from names/emails, share guardian permission across recipients, or use `test@test.org` to bypass sharing eligibility. Keep minors and parent-managed profiles excluded.
5. **Enable in stages in staging only.** Set accounts, then linking, then sharing, viewing and feedback. Enable voice linking only after its provider check. These are the existing flags documented below. Verify a successful `coordinator-lifecycle` job, low queue age, no failed deliveries and current cleanup time. Re-run the read-only database check using the actual deployed flag configuration.
6. **Complete all four live workflow variants.** English/Spanish × desktop/mobile: staff invitation, real login/MFA, exact spoken-code lookup, on-screen confirmation, acceptance, eligible manual-note preview, publication, limited shared view, attributed red guidance, explicit reply, item withdrawal and stop sharing. Check keyboard order, dialog focus/escape, screen-reader labels, 200% zoom, contrast, narrow viewports and clearing after blur/offline/revocation. Confirm no private content in browser storage, coordinator responses, logs or notifications. Record proof references without transcripts, codes, note bodies or tokens.
7. **Rehearse incident disable and restore.** Exercise the matrix below and the [Phase 7 recovery procedure](PHASE_7.md#account-export-and-recovery) in isolation. Restore a backup containing formerly active grants and deleted guidance, apply current migrations and replay trusted independent deletion evidence with traffic/writers stopped. Confirm sharing is reset, erased material stays erased and retries cannot recreate it. Local transaction tests are not a provider restore rehearsal.
8. **Verify retention with the actual provider.** Record the application's real backup/PITR horizon, restore capability and expiry evidence. Keep independent deletion evidence for at least that horizon, with access controls and a verified authoritative source. Approve the documented Phase 7 retention defaults and partner terms. Do not infer backup retention from the database's plan name.
9. **Approve the partner cohort and guide.** Name one verified organization, two or three coordinators and five to ten consenting adults. Keep identities/contact details in the restricted operational register, not Git. Confirm the response schedule, incident owner, support channel, partner training, student sharing comprehension and unaided stop-sharing exercise. The product owner approves the actual named cohort and guide before production activation.
10. **Assess and record the launch decision.** Copy the template into a restricted evidence location. Fill dated evidence and reviewer references for every gate, the final SHA/fingerprint, deployment references and all four live variants. Gate evidence expires within the recorded window and is rechecked after any release/configuration change. Run the assessment below. A pass does not deploy, enable flags or substitute for an owner's review of the evidence.

```powershell
npm run coordinator:readiness -- assess --record '<restricted-pilot-record.json>' --verification '<final-verification.json>' --output '<new-readiness-report.json>'
```

Exit status 0 means the recorded checks pass; 2 means blocked/incomplete; 1 means the command could not complete. Keep all required gates in the record. Do not mark a provider gate verified using the synthetic local harness.

## Flag and incident matrix

| Action | Immediate server behavior | Follow-up |
| --- | --- | --- |
| `ORIGEN_COORDINATOR_FEEDBACK=false` | Blocks new guidance/edits and shared replies; existing student receipts remain | Investigate guidance-specific issue |
| `ORIGEN_COORDINATOR_BINDER_VIEWING=false` | Blocks staff binder and feedback access | Student stop-sharing and receipts remain available |
| `ORIGEN_BINDER_SHARING=false` | Blocks publication and dependent staff access | Keep deletion/redaction and maintenance running |
| `ORIGEN_COORDINATOR_VOICE_LINKING=false` | Blocks voice preparation; typed linking can remain | Use typed fallback; investigate exact-code behavior |
| All six flags false, including `ORIGEN_COORDINATOR_LINKING` and `ORIGEN_COORDINATOR_ACCOUNTS` | Closes new provisioning/linking/publication/staff access | Student revocation/removal and existing receipts remain; do not drop tables |
| Suspend organization / disable or remove a staff member | Permanently invalidates their existing relationships and publications | Reapproval does not revive grants; students must approve fresh recipients |

Flags are process configuration: apply the change through the normal deployment procedure and verify the running release. Do not assume a saved environment edit has already reached every instance. A flag pause alone does not permanently revoke existing grants; restoring flags may restore otherwise valid access. Use organization/staff suspension or student revocation when access must remain ended. Preserve compatible maintenance and redaction code. Do not restore an old database as an incident rollback.

## Pilot operation and evaluation

Start with a supervised synthetic orientation, then enroll only the approved adult cohort. Review delivery failures, queue age and cleanup success daily during the first week. Escalate any unexpected disclosure, failed revocation/deletion or stale authorization immediately; pause the affected capability and keep a content-free incident reference. Agree on coverage hours before inviting students.

Use a restricted, manually reviewed tally for this small pilot; no new cross-student analytics endpoint or diagnostic-agent access is added. Track invited/connected/published counts, submitted/delivered guidance counts, aggregate response time, voluntary helpfulness and whether students can explain their selection and stop sharing unaided. Use only consented operational metadata and direct, voluntary feedback. Record denominators, test-account exclusions and the observation period. Do not infer risk, engagement or need from private conversation content. In a cohort this small, treat even aggregates as restricted and do not publish subgroup breakdowns.

Before expanding, review the recorded findings with the partner and product owner. Require zero unauthorized disclosure, no unresolved revocation/deletion defects, successful cleanup/restore rehearsals and understandable sharing controls. Approve each additional organization explicitly. Automatic sharing, coordinator exports, minor enrollment, group assignments and staff handoffs remain separately scoped work.

## Verification record

Local verification completed October 18, 2026 (October 19 UTC). [Generated release evidence](PHASE_8_LOCAL_VERIFICATION.json) records the exact tested source fingerprint. [Browser evidence](PHASE_8_BROWSER_VERIFICATION.json) records all four variants.

| Check | Result |
| --- | --- |
| Complete server suite, disposable PostgreSQL 18 | **704 passed, 0 failed, 0 skipped, 0 cancelled**, 224.9 seconds |
| Operations and observability suite | **35 passed, 0 failed, 0 skipped, 0 cancelled**, 33.1 seconds |
| Production TypeScript/Vite build | Passed; existing Auth0 directive and large-chunk warnings remain |
| Production logging policy | Passed |
| Source unchanged during verification | Passed |
| Read-only database readiness | Passed with all rollout flags off; deliberate extra table privilege and altered migration checksum were correctly rejected |
| Incomplete pilot record | Correctly returned blocked; no live gate was inferred from local results |
| Browser workflow | English/Spanish × 390px mobile/1280px desktop all passed against the disposable API/database |
| Guidance presentation | Screenshots visually inspected; no horizontal overflow; body text contrast approximately 7.7:1; keyboard activation of replies passed |
| Browser privacy/errors | No note content in local/session storage; zero application JavaScript page errors |
| Patch whitespace | Passed |

The complete browser flow exercised confirmation, acceptance, exact note selection, publication, limited staff reading, red guidance, explicit replies, item withdrawal and stopping access. Initial navigation under concurrent build/test load timed out; remounting the test view between scenarios resolved the harness delay. One Spanish selector was corrected to match the actual UI label. Synthetic account switching caused expected rejected cleanup requests from the previous actor; a Vite development WebSocket also timed out during heavy local work. These were not live-provider verifications.

PostgreSQL used its normal durability settings for this phase. Restricted roles and isolated synthetic schemas were used throughout. The browser fixture, separate Vite server and disposable database were shut down after verification. Temporary transport credentials, database files and raw test logs were removed; sanitized evidence and reproduction scripts remain.

**Still pending:** exact committed release and staging deployment; live Auth0/MFA and OpenAI speech checks in all four variants; screen-reader/zoom and partner usability review; provider backup/PITR and restore rehearsal; retention/operating-guide approval; named partner cohort and product-owner launch approval. No production deployment, partner invitation, migration, environment change, commit or push was performed. Phase 8's local implementation is complete; its real-world launch acceptance criteria are not yet complete.
