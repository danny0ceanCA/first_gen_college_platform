# Coordinator sharing Phase 1 privacy foundation

Date: October 18, 2026. Status: Phase 1 implemented and verified locally. Scope: [privacy boundaries and data foundation](IMPLEMENTATION_PLAN.md#phase-1-privacy-boundaries-and-data-foundation). No production migration, deployment, coordinator enrollment, or sharing enablement has occurred.

## Implemented behavior

Migration `050_coordinator_sharing_foundation.sql` creates the proposed coordinator profiles, codes, connections, grants, publications, feedback, replies, access evidence, and notification tables. Composite keys bind publications and entries to the exact account, student, and grant. Feedback stores its author attribution and remains a student-owned receipt when the coordinator relationship is later removed. Its insertion/update trigger verifies the parent grant and optional publication item.

All 13 new tables have row-level security. The application role receives **no privileges on the 11 sharing tables** and only account-scoped SELECT on the two lineage tables. New sharing tables have no permissive application policies. No coordinator can read a binder yet, including a coordinator with a synthetic grant inserted by a test owner.

`server/binder-sharing-policy.mjs` centralizes the publication eligibility contract and an allowlisted entry serializer. It checks student ownership, adult eligibility, organization membership, coordinator assurance, accepted connection, current grant, topic, saved entry status, complete source ancestry, version/digest, and confirmed unexpired preview. These functions accept trusted repository facts; they are not an HTTP publication service. Later phases must load and lock those facts on the server. Supplying `allowed: true`, a student ID, or a coordinator code cannot authorize publication.

## Source protection

The database tracks current content-free provenance for saved summaries and topic notes. It stores the source identifier, classification, source digest, version, revision, account/student scope, and dependency edges. It does not copy the source text into the lineage table.

Database triggers cover existing note creation, summary extraction, edits, translation cache writes, source deletion, late conversation attribution, account role changes, and memory suppression. Parent and family classifications propagate through recorded dependencies. A mixed family/student conversation is protected across the entire session; moving to a student divider does not erase the earlier family context.

Every existing entry and every new entry without complete verified evidence remains private. The migration does not certify any entry as `student_only`, and ordinary application requests cannot create that certification. Parent-originated notes remain protected when an account role changes. A translation or edit does not clear the source relationship.

There is no dedicated note-copy API in the current app. Explicit source edges support copies and propagate restrictions, with cycle detection and per-account graph serialization. A newly typed or pasted note receives unknown provenance and is therefore not shareable. Arbitrary retyped text cannot be reliably identified as a copy by semantic inspection; this phase does not pretend otherwise.

Source edits, added/removed dependencies, and protection changes synchronously invalidate affected publication items and erase their copied text. Source deletion removes affected publication items. Deleting a student or closing an account cascades through the new metadata. The existing private account export includes that account's lineage and edges; it includes no other account's provenance.

## Disabled routes and flags

The six planned coordinator/sharing route groups return a generic unavailable response after authentication, before body processing or database access. This is a hard Phase 1 boundary even if an activation flag is accidentally set in development. Production configuration validation rejects activation.

Leave these flags absent or set them to `false`:

```text
ORIGEN_COORDINATOR_ACCOUNTS=false
ORIGEN_BINDER_SHARING=false
ORIGEN_COORDINATOR_FEEDBACK=false
ORIGEN_COORDINATOR_VOICE_LINKING=false
```

No additional secret, model key, or external service is required. Startup isolation checks reject application credentials that can modify source provenance or access the sharing tables. Phase 2 and later must deliberately update these gates and privilege checks along with their tested authorization policies; setting a flag alone will not enable them.

## Verification

The new focused tests use only synthetic identities and text. PostgreSQL tests run on a disposable local PostgreSQL 18.4 instance, using a non-owner runtime role without superuser or row-level-security bypass privileges. The test owner can seed otherwise inaccessible records solely to exercise database constraints; that ability is not exposed through the app.

Coverage includes:

- Family, parent-originated student-scoped, mixed, unknown legacy, edited, translated, and copied material.
- Wrong account/student/recipient, expired grants, changed membership/permission revisions, and stale previews.
- Forged ownership and source classifications in the existing note API.
- Protected ancestors, lineage cycles, source suppression, source deletion, and account closure.
- Synchronous invalidation of previously seeded publication items after a source edit.
- Missing table privileges, default-deny RLS even if SELECT is mistakenly granted, and startup rejection of excessive grants.
- Runtime isolation from private summaries, notes, lineage, and the proposed sharing records.
- No content or code values in disabled-route responses or captured diagnostic logs.
- Upgrade from migration 049, repeated migration execution, conservative legacy backfill, and continued use of the existing note APIs.

Final verification on October 18, 2026:

| Check | Result |
| --- | --- |
| Complete server test suite with all three disposable-database test settings | 631 passed, zero failures, zero skips |
| New focused policy and PostgreSQL cases, included in that suite | 17 passed, zero skips |
| `npm run check:logging` | Passed |
| `npm run build` | Passed; existing Auth0 directive and large-chunk warnings remain |
| `git diff --check` | Passed |

The final test command was `node --test --test-concurrency=4 server/*.test.mjs`, with `DATABASE_TEST_URL`, `ORIGEN_TEST_DATABASE_URL`, and `TELEMETRY_TEST_DATABASE_URL` all pointing to the disposable loopback PostgreSQL instance. The suite used restricted runtime roles and cleaned up its generated schemas, roles, and databases. The temporary instance was stopped after verification. No production database URL was used.

The first broad run encountered the Windows sandbox's existing esbuild directory restriction and a source-fingerprint mismatch while files were still being edited. The complete suite was rerun on the host with source files held fixed; the final results above replace that intermediate run. No tests were weakened or skipped to obtain the passing result.

## Deployment procedure when deployment is requested

1. Keep the coordinator flags absent or false. Confirm a backup and retain the current application release for rollback.
2. Run `npm run db:migrate` using the migration credential against the intended environment. Do not modify applied migrations; migration 050 is additive.
3. Run `npm run db:grant-runtime` using the existing provisioning procedure for the restricted application role. Do not give the HTTP process the migration credential. This step preserves lineage SELECT and removes all application privileges on sharing tables.
4. Run `npm run db:check-runtime`, `npm run check:production`, and `npm run check:logging` with the intended environment configuration.
5. Deploy the compatible server release. Verify ordinary note creation/edit/translation, private exports, and account deletion in staging. Coordinator endpoints must remain unavailable.
6. Record the applied migration, application revision, runtime checks, environment, and rollout status here. No step in this document authorizes production deployment by itself.

The metadata backfill visits existing summaries and notes and adds triggers/indexes. Rehearse it with a representative staging data size before production and schedule an appropriate migration window. It does not publish, reclassify legacy content as safe, or change the student's saved prose.

## Rollback and phase boundary

Keep the flags false and stop any rollout if validation fails. Leave migration 050 and its privacy triggers in place; the existing note API remains compatible. Do not drop the new tables as a rollback. If restoring an older application release, do not run its older broad runtime-grant provisioner against the new schema: use the current restricted grant procedure. Repair forward with a new migration once 050 has been applied outside disposable test databases.

Phase 1 prepares storage and protection only. It does not provide coordinator onboarding, Auth0 MFA setup, invitation delivery, spoken-code tools, consent UI, a live publication service, coordinator reads, or red-ink feedback screens. Those remain assigned to later phases. No production record is currently eligible for publication through this release; a future verified source-evidence and confirmation path must be implemented without weakening the family exclusion.

Before permitting writes to sharing tables in later phases, complete the corresponding state transitions, current-recipient RLS policies, immutable publication enforcement, consent evidence, grant revisions, revocation/expiry handling, retention, and restore reconciliation from the implementation plan. The current seed-only schema and default-deny policies do not substitute for those services.
