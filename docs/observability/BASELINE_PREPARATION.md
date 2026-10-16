# Existing Render baseline prepared — October 16, 2026

Completed with the user's authorization in confirmed My Workspace. Verification finished at approximately 1:19 PM America/Los_Angeles (20:19 UTC). This prepares the existing application for the pending code release; it does not activate diagnostic infrastructure. The separately documented recovery-test failure was subsequently resolved locally as recorded below.

## Target and changes

The existing API is Origen Edu (`srv-db02or0u01pc738ktekg`) and the existing PostgreSQL database is Origen_Edu_Database (`dpg-db0806hsrm7s73efcupg-a`). Workspace and repository identities were checked before changes. Render reported recovery available before the migration. No backup/user-content export was downloaded and no new service, database or paid resource was created.

- Applied pending application migrations 040, 041, 042 and 043; earlier migration checksums were verified by the migration runner.
- Refreshed the existing restricted API runtime grants.
- Created a separate restricted `origen_maintenance` login and granted the reviewed maintenance permissions. Its random password was generated in memory and saved only as part of Render's secret environment value; it was not printed or written to a local credential file.
- Saved `MAINTENANCE_DATABASE_URL` on the API, preserving the existing application database/host/port and using the separate cleanup identity.
- Saved `false` for `OBSERVABILITY_OPERATION_LINKS`, `OBSERVABILITY_EXPORT`, `OBSERVABILITY_DETAILED_SPANS`, `SUPPORT_DIAGNOSTICS_ENABLED`, `DIAGNOSTIC_AGENT_ENABLED` and `DIAGNOSTIC_RUNNER_ENABLED`.
- Preserved unrelated API environment variables; no migration-owner secret was added to the API.

## Verification

An independent read-back verified migration 043, runtime isolation, maintenance isolation, production configuration and saved disabled flags. Public healthz and readyz checks both returned HTTP 200. The latest live API deployment remains `dep-db8q0s3bc2fs738p2b90`, commit `4a1685f253971fd3b17123cb37321728b6ad36f6`, finished at 2026-10-16T03:57:17Z. No deployment endpoint was called. New environment values take effect on the next deployment.

The operator helper is `scripts/prepare-render-baseline.mjs`. It is pinned to these verified resource IDs and repository/workspace. With an already configured private `RENDER_API_KEY`, `inspect` reports safe metadata, `apply` performs this explicit setup, and `verify` checks it without modifying configuration. It uses verified external database TLS from the operator machine, holds credentials only in memory, refuses an owner login in the API, and prints only coarse stage/status information. Do not use it for another project by replacing secrets or bypassing target checks.

## Release status

No commit, push or code deployment was performed. Both Origen services automatically deploy commits to main, so a main-branch push is a release action. The known `test:ops` shared-family recovery failure is resolved locally; review the complete pending change before release. Additional telemetry stores, support gateway, model adapter, isolated runner host and shadow monitoring are still inactive and require their own provisioning/verification.

## Recovery regression resolution — October 16, 2026

The failing test expected linked-family account closure to reject with HTTP 409. That expectation was stale: the current lifecycle intentionally detaches the link, preserves the other account's latest shared academic fields and private records, and closes only the requested account. No production lifecycle or deletion behavior was changed for this fix.

Replaced the stale assertion with owner/member closure cases covering survivor academic fields, private notes and history, closed-identity blocking and repeated replay. Added separate membership/reviewer cases confirming institutional obligations still reject closure before changing family records. Updated the synthetic rehearsal's scope wording and regenerated `ops/latest-recovery.json`.

Focused verification passed: `npm run test:ops` (6 tests), account lifecycle/link tests (6 tests), the synthetic recovery rehearsal, logging policy and whitespace checks. The subsequent `npm run check:onboarding` release check passed with 485 server tests passed, zero failures, 18 skips, a successful production build and unchanged source fingerprint. PostgreSQL integration and other environment-dependent checks were not configured for this follow-up run; no browser scenarios were requested. The report is `output/onboarding-release-check.json`. These fixture checks do not establish actual PostgreSQL backup/PITR recovery or resolve the remaining infrastructure activation gates.
