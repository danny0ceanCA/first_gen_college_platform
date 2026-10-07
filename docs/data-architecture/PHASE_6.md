# Phase 6 — operational readiness

Implemented October 6, 2026: an evidence register, a validator that refuses incomplete approvals, a synthetic stale-restore/deletion rehearsal, CI regression checks, and operational runbooks. Provider metadata was read on October 7 UTC (October 6 Pacific). This phase prepares evidence; it does not certify conformance, approve research, deploy changes, or authorize a pilot.

## Run the kit

- `npm run test:ops` checks stale evidence, missing owners/approvals, stale-restore deletion replay and linked-family conflict handling.
- `npm run ops:rehearse` uses isolated pg-mem fixtures, never DATABASE_URL, and writes `ops/latest-recovery.json`.
- `npm run ops:readiness` writes `ops/latest-readiness.json`. Exit 2 means required evidence/approval is missing. This is the expected current result. Exit 0 means the register is complete and current, not that evidence is independently certified.

`ops/evidence.json` lists nine launch gates. Every gate needs a named accountable owner, reviewer, dated evidence reference, expiry and verified status. Confidential rosters/contracts belong in restricted storage; put redacted references here. Do not mark a simulation as a real restore or a smoke check as accessibility conformance. Refresh evidence after material configuration/release changes even before its expiry date.

## Live observations and actions

Read-only Render metadata is summarized in `ops/render-observation.json`:

- API and PostgreSQL region: Oregon. Latest API deployment was live at commit `5386585a4413ea3d40b575ee5b98799ec61c2842`. These local phases have not been deployed.
- API health-check path is blank. The source has `GET /healthz`; configure that path after review. It checks process responsiveness, not database/provider health. Use a synthetic authenticated staging flow to evaluate dependency readiness.
- Database external inbound rule is `0.0.0.0/0`. Review needed external clients and restrict access to their approved ranges; keep backend connectivity through the internal URL. Record the approved change and successful connectivity checks. No networking settings were changed here.
- Database is available, PostgreSQL 18, 1 GB storage, no high availability. These are configuration facts, not reliability promises. Backup window, restore capability, log expiry and provider agreements remain unverified.

Auth0/OpenAI project region, retention, MFA and contracts are also unverified. `store:false` alone does not establish zero retention. See the provider evidence checklist in the operations runbook.

## Recovery coverage

The rehearsal creates two synthetic accounts, takes an old snapshot, closes one account, restores the old snapshot into another isolated fixture and replays closure receipts twice. It verifies removal, closed-identity blocking, surviving-account preservation and idempotence. A separate test ensures family-link conflicts halt replay without removing students.

Limitations: snapshot includes accounts/students/summaries only. No real PostgreSQL backup/PITR, phase 2/3 restore coverage, performance measurement, identity-provider deletion or independent durable closure ledger is proven. Real recovery remains a blocking gate. All restored traffic must stay offline until replay and permission reviews finish, including reinstated links, research withdrawal and revoked institutional access.

## Acceptance still pending

Complete a dedicated staging PostgreSQL restore and deletion replay, actual administrative access/MFA review, comprehensive accessibility evaluation, security findings disposition, incident tabletop with primary/backup owners, and sponsor-approved pilot commitments. Research remains synthetic until the separate protocol and permissions are approved. Use `docs/vendor-readiness/OPERATIONS_RUNBOOK.md`; phase 7 can draft a pilot while these gates stay open.
