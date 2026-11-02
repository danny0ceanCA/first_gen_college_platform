# Reliable outcome evidence — Phase 4, step 1

Implemented locally as a restricted foundation. `ORIGEN_OUTCOME_EVIDENCE` defaults to **false** and requires student-controlled follow-up. This step defines claims, private evidence references, lifecycle rules and read/erasure contracts. Student approval writers, coordinator observations, assessment, voice/UI integration and evaluation remain later steps. Even with the switch enabled, this foundation returns `canRecord=false` and `canAssess=false`.

## Definitions and compatibility

`src/outcomeEvidence.mjs` supplies a frozen, versioned registry and strict typed contracts. Migration `109_outcome_evidence_foundation.sql` stores the same registry; a database test compares the complete definitions. Each definition includes English/Spanish labels, an exact criterion, allowed basis categories, institution/term/cycle scope, an explicit local-date observation window and freshness requirements.

The initial observation window is at most 366 calendar days, including both endpoints. This bounds a case's scope; it is not a scientifically validated outcome horizon or an automatic reminder. Passing the window does not establish failure. Historical event dates remain historical; applicability depends on the same source version and cycle.

| Version 1 definition | Contract example | Does not establish |
| --- | --- | --- |
| `office_contacted` | “I spoke with the aid office.” An unanswered call is an attempt, not contact. | Submission, acceptance or approval. |
| `document_submitted` | “I submitted the employer letter and am waiting for review.” | Document acceptance or waiver approval. |
| `document_accepted` | “The office said the letter meets its document requirements.” | A decision or benefit approval. |
| `decision_received` | “I received a denial for this term.” The decision was received; its result is separately `denied`. | Waiver approval or successful advice. |
| `waiver_approved` | “I received waiver approval for this term.” It remains a student-origin claim at this stage. | Independently authenticated institutional verification, other aid awards or causal effectiveness. |

The eight bilingual examples in `server/fixtures/outcome-evidence-cases.mjs` were authored and checked against these contracts. They include an unanswered call, a denial, a pending decision and a general policy page that cannot establish an individual's approval. They are contract fixtures, not model-comprehension results or an institutional review of policy.

Phase 3 compatibility is explicit: generic reported action/outcome, helpfulness, a coordinator reply and a shared update do not map themselves to a specific outcome. Existing reports retain `student_reported` provenance. Missing reports remain missing; declined and unknown responses cannot carry invented claim results. Association with a definition and cycle needs new exact approval in step 2. No data or permission is backfilled.

## Restricted storage and API

The migration adds three tables: the definition registry, owner-scoped outcome episodes, and reserved private evidence references. An episode identifies one accepted action, definition/version, institution, term and cycle. A uniqueness constraint prevents retry observations from creating duplicate episodes for that identity. The institution label is scope information, not proof of an institutional affiliation or decision.

Episodes capture the server-resolved student, accepted plan version/action hash, exact response version and original access-validity ceiling. Existing acceptance alone creates no episode. The foundation has no application insert/update command; synthetic tests seed rows using the disposable migration owner. Step 2 must add exact approval before any runtime writer is introduced.

Private evidence references the exact owned report ID/version and episode instead of copying or independently editing the report's prose. Database guards require the same student and accepted action, source state, report version, response state, event date and saved time zone. Known dates must fall within the approved window, share its zone and not be in the future. Unknown dates stay null and are never replaced with a save timestamp.

These reserved rows enforce `student_reported`, `student_account`, `not_assessed`, `private_record`, `institution_verified=false` and `evaluation_allowed=false`. Declared record review and coordinator observation appear in the broader definition contract but cannot be inserted into this private store. Their separate authority and disclosure flow is step 3. Supporting/contradicting assessments remain step 4. No model or client flag supplies approval, ownership, verification, evaluation permission or a writer.

`POST /api/outcome-evidence` accepts only:

| Operation | Behavior |
| --- | --- |
| `definitions` | Return the versioned catalog to an authenticated account. |
| `load` | Load the owner's selected action's private episode/evidence metadata; return at most 50 episodes and 100 references, with an explicit truncation indicator. No outcome assessment or prose extraction occurs. |
| `delete-episode` | Check the owned action, episode and version, then erase the episode and its evidence references. Repeating a completed deletion is harmless. Existing reports and canonical actions remain. |

The SQL command also has an internal owner-scoped export operation, used by account export and excluded from the public HTTP contract. Authentication, account locking, origin/content-type checks, request limits, no-store responses and normal API rate controls apply. Private history and erasure remain accessible while the capability or AI assistance is paused.

All three tables have RLS enabled and no raw runtime or maintenance access. Runtime receives only the scoped command. Internal trigger/reconciliation/restore helpers remain inaccessible. The endpoint is registered with the existing content-free logging catalog. No coordinator projection, notification, progress aggregate, model context or training dataset receives the new records.

## Invalidation, erasure and recovery

Selected-action changes invalidate the episode; unrelated sibling changes preserve it. The plan editor replaces step rows in one transaction, so deferred triggers inspect the final plan before pruning removed actions. Removing a selected action, plan, student or account cascades its outcome records.

Correcting or deleting a referenced private report erases its evidence links and marks the episode as needing review. The underlying report correction/deletion still completes normally. No superseded report prose is copied into a second history store. Deleting an episode preserves the independently saved report and action. Neither operation modifies an already approved coordinator publication.

Source changes and permission/role changes require fresh review. Reads reconcile expiry as well as mutations. The original validity ceiling is retained, so a later extension of access cannot extend an earlier evidence approval. Undoing an action edit or restoring a role does not silently reactivate an episode. The foundation exposes no reactivation command.

Account export includes the owner's episode metadata and private report references, without account IDs or action hashes in that projection. The existing private-report export supplies the source statements. Protected restore manifests add content-free episode/evidence ID/version fences. Restore removes records absent from those fences or at a different version, and marks retained episodes `needs_review` with reason `restored`. Older manifests without these fields conservatively remove the new records. Replaying a manifest does not recreate a row or reactivate consent. These manifests require the existing trusted operator handling; a checksum detects damage, not authenticity.

## Configuration and deployment boundary

The default-off flag is registered in configuration validation and `render.yaml`. Startup requires migrations 104–109 as applicable, the scoped command grant and denied raw/helper access. The read-only coordinator readiness command includes the foundation even when flags are off. Runtime grants, account export and the isolated release verifier have been extended; the existing CI server suite also discovers the new tests.

For a later compatible deployment, apply migration 109 with the separate migration credential and refresh runtime grants. Keep the capability off until the remaining implementation and release checks are complete. Preserve the schema during compatible rollback and use the privacy recovery procedure after a restore. This implementation did not migrate or modify production, call a real voice provider, or add a database service.

## Validation

Validation used the existing isolated PostgreSQL runner, disposable schemas and synthetic identities. **168 affected regression tests passed**, including 20 outcome-foundation cases/subcases, with zero failures, skips, cancellations or TODOs. The final run covers the contracts and migration, exact source ownership/version/date guards, raw-table/helper denial, operator exclusion, report correction/deletion, selected versus sibling plan edits, source/permission/expiry invalidation, erasure, account export/deletion, restore fences, configuration and readiness, plus existing follow-up, sharing, plan and lifecycle behavior.

TypeScript, the isolated production build and production logging checks passed; the build retains the existing large-bundle advisory. Evidence logs are `/tmp/origen-outcome-step1-regression-final.log`, `/tmp/origen-outcome-step1-types.log`, `/tmp/origen-outcome-step1-build.log` and `/tmp/origen-outcome-step1-logging.log`. Preliminary failures were retained separately and corrected before the final run, including ensuring the report-invalidation trigger allows the underlying report edit/delete to complete.

No browser controls or provider prompts were added in this foundation step. Browser flows, real-provider listening, physical devices and deployed authorization are not certified by these backend tests. Phase 3's release report remains evidence for its earlier source snapshot.

Next: step 2 connects explicit student-approved evidence recording to the existing binder and voice flows.
