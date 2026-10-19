# Production database and Render preparation

Prepared October 19, 2026, following the product owner's instruction to apply migrations, update permissions and keep coordinator accounts disabled. This prepares the existing release for a subsequent commit/push; it does not launch the coordinator pilot.

## Completed on the existing Origen resources

- Verified the intended My Workspace API, frontend, repository and application database before changes. Render point-in-time recovery was available, with a reported recovery start of `2026-10-14T19:11:16Z`. No recovery or new service was created.
- Applied pending migrations **044–056**. All 56 migration checksums now match the repository. The migration runner applied the pending SQL inside its existing transaction and advisory lock, using a five-second lock timeout and separate migration identity.
- Refreshed the existing restricted application and maintenance role grants. Reused all existing credentials; no password was rotated or written into the repository. The API environment still contains no migration credential.
- Passed all eleven coordinator database readiness checks: flag dependencies, runtime isolation, maintenance isolation, same database with separate roles, migration checksums, provisioning, linking, publication, viewing, guidance and lifecycle capabilities. All implemented database capabilities were checked despite the rollout flags being off.
- Loaded the currently deployed release's own runtime and maintenance role checks and verified they still pass after the upgrade. This checks compatibility with the running release as well as the candidate.
- Ran the coordinator maintenance function using the restricted maintenance role and retention scope. It completed with zero delivered/suppressed notifications and zero expired grants.
- Saved these six Render API variables explicitly as the string `"false"`: `ORIGEN_COORDINATOR_ACCOUNTS`, `ORIGEN_COORDINATOR_LINKING`, `ORIGEN_BINDER_SHARING`, `ORIGEN_COORDINATOR_BINDER_VIEWING`, `ORIGEN_COORDINATOR_FEEDBACK` and `ORIGEN_COORDINATOR_VOICE_LINKING`. All unrelated environment values were preserved and compared without printing them.
- Verified the production configuration and the frontend's API/Auth0 configuration. The existing API and frontend remain healthy. Automatic deployments from `main` remain enabled. The live API deploy and its commit were unchanged by this operation.
- Updated `render.yaml` to document the same disabled coordinator defaults and existing maintenance secret requirement. It passed Render's current public JSON Schema. The existing services are managed through their Render settings, not this Blueprint; no Blueprint sync was performed. Do not create a new Blueprint from this template expecting it to adopt the differently named existing services.
- Added Git ignores for disposable `tmp/` content and Playwright session captures so those artifacts are excluded from the upcoming commit.

The sanitized machine-readable result is [PRODUCTION_PREPARATION_2026-10-19.json](PRODUCTION_PREPARATION_2026-10-19.json). It contains no passwords, connection strings, invitation codes or student content.

## What the next push does

Commit the complete implementation, including its new/untracked source files and migrations. Pushing `main` triggers the existing Render application builds and deploys. The database and permissions required by this candidate are already prepared; **no additional migration step is needed for this exact release**. The saved disabled flags will be used by the next API deploy, so coordinator accounts and binder sharing remain unavailable to users.

This operation did not commit, push or deploy application code. The current deployment had the coordinator flags absent, which also defaults to off. Render saved the explicit false values for the next deployment. Current health does not substitute for checking the new deploy after the push.

Future schema changes still require a deliberate migration/grant step. Do not put the migration database credential into the HTTP service or use it for an automatic application startup migration. Do not roll back by restoring an old database or dropping the new tables.

## Repeat verification

With the authorized Render API credential held only in the operator environment:

```powershell
node scripts/prepare-coordinator-render.mjs inspect
node scripts/prepare-coordinator-render.mjs verify '<new-sanitized-report.json>'
```

`inspect` checks pinned resource identities, existing roles, frontend configuration, recovery availability and current flags. `verify` also checks candidate and running-release privileges, migration checksums and all coordinator capabilities, runs one scoped coordinator maintenance check, and verifies existing deployment/health/configuration. `apply` is an authorized operator mutation: it applies pending migrations, refreshes existing grants and saves the six disabled flags. It does not create credentials or trigger a deployment. All modes reject unexpected targets and avoid printing database exception details or secret values. The current live Git revision must be available locally for the compatibility check.

The previous Phase 8 local regression evidence remains a historical record of the tested application implementation. This preparation adds an operator script and deployment configuration; its live readiness checks, four readiness unit tests, logging policy and whitespace checks passed. No additional application/runtime feature logic was changed.

## Still separate from this preparation

Coordinator activation remains subject to [Phase 8](PHASE_8.md): isolated staging, live Auth0/MFA and voice verification, recovery rehearsal, retention approval and an approved adult partner cohort. Recovery availability is verified here; a full provider restore rehearsal and independently protected deletion-evidence retention are not established by this database upgrade. No partner or student was enrolled.
