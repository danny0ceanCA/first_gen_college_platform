# Production migration and deployment record

Completed from the existing Project Elo-Em workspace on October 21, 2026, approximately 5:24 p.m. Pacific. Daniel explicitly authorized retrying the denied environment read and applying production migrations. The earlier production-readiness document describes the state before this work.

## Database changes verified

Target: **My Workspace**, Origen production database `dpg-db0806hsrm7s73efcupg-a`, database `origen_edu_database`, PostgreSQL 18. The operator script checked the service owner/repository/database identities and kept connection strings and keys in process memory.

- All 60 previously applied migration checksums matched the repository.
- Render reported point-in-time recovery available, with recovery history beginning October 18. A fresh provider-managed logical backup export was created before the migration; its completion/download availability was verified without downloading production data or recording its signed URL.
- Ordered migrations **061–071** committed through the existing transactional migration runner. The ledger now has **71 migrations**, no pending files, and matching checksums. Existing applied files and ledger entries were not rewritten.
- Existing roles `origen_api` and `origen_maintenance` received the current runtime and maintenance grants. No login was created or rotated, and the migration owner was not installed as an application credential.
- Runtime and maintenance isolation passed. All **11** coordinator database checks passed: flag dependencies, runtime isolation, maintenance isolation, separate roles on the same database, migration checksums, provisioning, linking, publication, viewing, guidance and lifecycle.
- Read-only function-definition checks verified that all four affected coordinator commands have the revised `NO KEY UPDATE` account lock and no longer contain the old account `FOR UPDATE` lock.

Metadata-only local receipts are in the ignored `output/student-first-production-2026-10-21/` directory. The operator helper stays in ignored `tmp/`. Credentials, private database rows and backup download URLs are not in the PR.

## Actual deployment and configuration

During preparation, PR #6 was merged externally as `31db52fc6f4e6ce93beb9d167e52e3e76c4577df`. This task did not perform that merge. Render automatically deployed the frontend, but its initial API update failed at startup while the database was still missing migrations. The previous API deploy remained live during that failed update.

After migration and grant verification, the production API's settings were reconciled:

- Set `NODE_VERSION=22`; Render's new deployment log confirms **Node 22.23.4**.
- Set all nine new student-first flags explicitly to `false`: preparation, binder jobs, organization, corrections, guided conversation, continuity, recovery, derived sharing and coordinator follow-through. Existing personalization and coordinator settings were preserved.
- Set the API HTTP health-check path to `/healthz`, matching the repository configuration.
- The environment update initiated API deploy `dep-dbclf5om7kps73c4dpu0`; no duplicate manual trigger was issued. It reached **live** on the merged `31db52f` commit. The frontend deploy `dep-dbclcuc9v7es73bm9aq0` is also **live** on the same commit.
- Fresh HTTP checks returned **200** for API `/healthz`, API `/readyz` and `https://origenedu.ai/`. The new API instance emitted the finite `service.database.verified` event for that same release.

The `/readyz` endpoint checks a base schema requirement; it does not replace the separate complete migration, restricted-role and function checks above.

## Remaining limits

This completes the authorized schema/grant preparation and restores matching live API/frontend commits. It does **not** enable the new student-first workflow flags or establish model quality. Phase 9's correction/continuity/language concerns, Daniel's bilingual recording review and realistic interactive voice validation remain open.

PR #7 fixes a CI test that incorrectly assumed default telemetry release metadata is always `unknown` even when GitHub supplies a valid `GITHUB_SHA`. Its application job passed, including onboarding checks, operations tests and production dependency audit. Full PostgreSQL/telemetry CI must still be evaluated separately; no incomplete or failed run is described as green. The fix changes a test assertion, not production telemetry behavior.

Keep forward schema changes in place on rollback; do not destructively downgrade the new tables or rewrite migration history. Any code rollback must account for strict maintenance privilege checks against the forward schema. A production restore must follow the established deletion-journal replay and privacy verification procedure before returning restored data to service.
