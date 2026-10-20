# Coordinator production activation — October 20, 2026

The product owner authorized migration 057, refreshed permissions, enabling coordinator registration, commit and push, then explicitly expanded activation to **all coordinator features**.

The six authorized switches are `ORIGEN_COORDINATOR_ACCOUNTS`, `ORIGEN_COORDINATOR_LINKING`, `ORIGEN_COORDINATOR_VOICE_LINKING`, `ORIGEN_BINDER_SHARING`, `ORIGEN_COORDINATOR_BINDER_VIEWING`, and `ORIGEN_COORDINATOR_FEEDBACK`, each set to the string `"true"`.

## Operation and evidence

- Target: existing Origen API, frontend, and database in Render **My Workspace**. No new service, provider, credential, or unrelated feature activation is needed.
- Migration/grant preparation: `PRODUCTION_PREPARATION_2026-10-20.json`. The preparation script deliberately holds the existing flags off while upgrading and checking compatibility.
- Student permission migration: `PRODUCTION_STUDENT_PERMISSION_2026-10-20.json` confirms migration 058, refreshed restricted grants, all eleven readiness checks, live-version compatibility, and preserved enabled settings.
- Saved activation configuration: `PRODUCTION_ACTIVATION_2026-10-20.json`. The activation script checks all eleven database readiness conditions and production configuration, preserves unrelated environment values, and saves the switches without a separate deployment.
- Pushing `main` triggers the existing API/frontend automatic deployments. Verify both deployed commit SHAs and health before reporting the feature live. An environment save alone is not live activation.
- `render.yaml` documents the same enabled coordinator switches. The existing services are managed through Render's service settings; no Blueprint sync or new Blueprint is created.

`node scripts/activate-coordinators-render.mjs status` returns sanitized deployment/configuration/health status. After both deploys are live, run `node scripts/activate-coordinators-render.mjs verify <new-report-path> <exact-commit-sha>` for migration/grant checks and exact-release verification. All credentials remain in memory.

Do not run the old preparation script's `apply` mode after activation unless intentionally disabling all coordinator switches. It writes `"false"` by design. Its historical October 19 report describes the earlier disabled release.

## Access still requires approval

Keadrian's entry point is `https://origenedu.ai/#coordinator-register`. Self-registration creates a pending application. An independent reviewer verifies the organization; its owner invites the applicant to join the team; the reviewer approves coordinator access. MFA is required for the coordinator workspace. See [self-registration instructions](SELF_REGISTRATION.md).

The product owner subsequently authorized student-controlled sharing without operator enrollment. Migration 058 uses existing account permission (adult or unexpired guardian approval), verified student ownership, and explicit connection/publication confirmations. Students do not need a pilot record. Family-linked profiles and family-derived material remain private. Permission changes directly revoke connections, grants and published content without relying on pilot records. Reapproval never restores old grants. This supersedes the adult-only/manual-student-enrollment instructions in the historical phase documents.

Students confirm the coordinator connection and choose eligible binder content to publish. Family conversations and family-derived material remain excluded. Guidance remains attributed to its coordinator. No existing binder is automatically shared.

## Verification limits

Local restricted-PostgreSQL tests and browser checks exercise synthetic identities. Production schema/permission checks and healthy deploys do not prove a live Auth0 signup/email/MFA or OpenAI voice session. Existing tenant actions must still be verified during the first real sign-in. Provider restore rehearsal, partner usability/retention review, and the full staged pilot evidence from Phase 8 remain outstanding; this owner-authorized activation does not mark them complete.

Migration 058 is applied using `node scripts/prepare-coordinator-render.mjs apply-preserving-flags <new-report-path>` so the already-authorized activation settings remain unchanged. The original `apply` mode deliberately disables features and is not used for this follow-up.

## Local verification

The final release report is `RELEASE_VERIFICATION_2026-10-20.json`. The verification command uses a disposable loopback PostgreSQL cluster. Parallel schema tests require adequate lock capacity (`max_locks_per_transaction=512` was used locally); this does not change production settings. The pre-existing voice-memory test now measures the bounded memory addition independently of shared voice instructions, and the publication withdrawal fixture now withdraws account permission rather than relying on removal of a pilot record. No voice behavior changed in this release.
