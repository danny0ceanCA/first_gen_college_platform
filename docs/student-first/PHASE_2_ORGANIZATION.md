# Phase 2: automatic conversation organization

Implemented locally on 2026-10-21, starting from `d0fe03e80b6b106d4ff57f9ec005efc122ede891`. Phase 1 documentation and browser-helper repairs are preserved. No commit, deployment, production migration, account creation or production configuration change is included.

## Student experience

With the feature enabled, the student speaks normally and ends the conversation. After the existing summary save is acknowledged, the existing background worker organizes useful information, including while the browser is closed. Reopening the binder shows the resulting personal details and topic notes. When a binder remains open, completion receipts refresh its memory view automatically.

Example: a summary says “The student is considering nursing. The student works evenings. Which aid application is needed?” The binder receives a tentative nursing goal in **What Origen remembers → Goals**, the evening-work constraint in **Practical needs**, and the unresolved question under **Paying for college**. Each sentence is filed once. No application, decision, completed step or coordinator publication is created. Existing edit, remove and confirm controls remain available.

The UI labels tentative details “Still exploring,” unresolved questions “Open question,” and explicit reported decisions “Reported decision · To review.” Source details explain that evidence comes from a saved summary, not a verbatim transcript or verified policy. Parent-origin material remains attributed to the parent. A reported decision remains a suggested ordinary note; it never enters “Decisions I made” automatically.

Clarifying questions, broad spoken correction, undo and pre-summary checkpoints are later phases. This phase starts after a summary has been saved. It does not recover a conversation closed before that acknowledgement.

## Architecture and rationale

| Component | Responsibility and reason |
| --- | --- |
| `server/binder-organization-policy.mjs` | Defines the version and server-only enablement/readiness checks. Organization requires its own flag, the existing worker, and subject-eligible personalization extraction. A client cannot turn it on. |
| `server/binder-organization.mjs` | One bounded extraction contract and one transaction that writes existing note/memory stores and both receipts. Provider work occurs outside the transaction. This prevents half-organized conversations without adding a queue or new content store. |
| `server/topic-notes.mjs` | Routes enabled `suggest` work into the unified service; retains legacy generation, manual notes and translations otherwise. HTTP load/sync still use the existing durable job boundary. |
| `server/student-memory.mjs` | In unified mode, load/sync reports or enqueues the same binder job instead of running another extractor. Existing manual mutation controls remain. Legacy extraction is fenced if unified mode becomes enabled while it is running. |
| `server/binder-jobs.mjs` | Reuses claims, original permission revision, lease fencing, retries, per-account budgets and status UI. Capacity errors now become immediately failed/retryable rather than cancelled or repeatedly billed. |
| Migration `062_binder_organization.sql` | Captures the reporting account role when a new summary is saved; adds organization metadata to existing items and version/fingerprint fields to existing receipts. Existing source cascades, RLS and sharing lineage apply. |
| `src/OrganizationEvidence.tsx`, `src/TopicNotebook.tsx`, `src/StudentMemory.tsx` | Show compact uncertainty/provenance labels, refresh memory when binder receipts change, and display background progress without requiring a separate “organize” action. Preference labeling now accommodates general preferences. |
| `server/production-config.mjs`, `server/index.mjs`, `render.yaml` | Validate dependencies and migration readiness. The repository deployment default for `ORIGEN_BINDER_ORGANIZATION` is **false**. |

### Why extract complete sentences

The new model output selects exact complete sentences from the saved summary instead of rewriting them. The server verifies sentence membership and keeps qualifiers, attribution and conditions together. This deliberately favors faithful organization over polished paraphrases in Phase 2. It reduces the chance that “might study nursing” becomes “will study nursing.” Sentences that mix topics awkwardly should be omitted, not split into unsupported fragments.

The summary itself remains model-derived. Exact quotation proves support in that summary, not truth about the world or perfect transcription. Classification and sensitive-content omission still require real-provider evaluation in Phase 9. Deterministic guards reject obvious sensitive identifiers and several unsupported commitment patterns, but are not a general semantic proof or comprehensive sensitive-data detector.

### Why each item has one destination

Goals, constraints and preferences go only to `origen_student_memories`, with `status='proposed'`. Questions, explanations and explicit reported decisions go only to `origen_topic_notes`, with `status='suggested'` and `origin='conversation'`. Decisions use ordinary note storage, not a confirmed decision or action. This avoids mirrored copies that would diverge when the student edits one. The existing memory section is already part of the binder; no second dashboard is introduced.

Open questions from this contract therefore live on the appropriate topic page. Existing legacy memory questions remain supported and unchanged. This is an explicit routing choice, not a removal of old data.

## Contract and persistence

Provider output is a strict object with `items`, at most six entries, of which at most four may be personal details. Each item contains only:

```json
{
  "topic": "options",
  "category": "goal",
  "certainty": "tentative",
  "language": "en",
  "quote": "The student is considering nursing."
}
```

Topics: options, transfer, costs, applications. Categories: goal, constraint, preference, question, explanation, decision. Certainty: tentative, stated, unresolved. Questions must be unresolved; reported decisions must have explicit decision language and cannot contain detected uncertainty/negation. Entries remain unconfirmed regardless of `certainty`. Quotes must be complete source sentences, 8–1,000 characters, and cannot repeat within the batch. Unknown fields, forged ownership fields, invented quotes, invalid classification combinations and oversized results reject the whole result without receipts.

Metadata is server-generated: organization version, category, certainty, captured reporter, `evidenceKind='saved_summary'`, and source-content version. Account, student, IDs, stored status, origin and attribution are never chosen by the model. New summaries capture the account role at save time, so later changes to that role cannot relabel old source material. Existing summaries default to `unknown`; they are not retroactively attributed based on the current role. Family-scoped memory remains family-scoped.

The write transaction reacquires the account guard, rereads the source and receipts, verifies the source hash and memory revision, enforces account capacities, inserts the routed items, then inserts both completion receipts. It rechecks enablement and the worker's lease before commit. No raw transcript, audio or token is added to storage.

Reporter capture describes the signed-in account's role when saving. It does not identify a speaker acoustically or prove who was talking; shared-device and mixed-speaker conversations still need careful model handling and later clarification.

### Idempotency and suppression

- Existing source receipts prevent re-extraction even after all generated items are removed. Empty successful results also receive both receipts.
- Concurrent independent processors can both spend a provider request, but account serialization and receipts permit only one persisted batch. Normal durable worker claims avoid that duplicate request in the first place.
- Existing normalized content and account/student-salted fingerprints avoid exact repeated sentences across later summaries. Fingerprints remain in source receipts after item dismissal, with no duplicate text copy. They are scoped; one student's dismissal does not suppress another student's information.
- Fingerprints are removed with their source summary. Semantic paraphrases are not merged automatically; conflict resolution and richer correction/undo remain Phase 3. A corrected/removed source already suppressed by existing memory controls cannot be organized again.
- An existing legacy topic receipt is left alone. If legacy memory extraction already finished, or wins a race while organization runs, the unified service records an empty topic receipt and does not duplicate the old extraction. There is no automatic rebuild of already-processed legacy content.

## Failure and privacy boundaries

Provider failure, malformed output, stale source, source deletion, changed memory revision, account closure, revoked permission, expired worker lease and disabled feature prevent partial writes. Ordinary provider failures reuse the existing bounded worker backoff. A capacity error leaves the summary intact and exposes the existing retry control after space is freed; it does not repeatedly call the model automatically. No new public retry endpoint is added.

Generated topic entries retain `origin='conversation'`. Existing coordinator-sharing policy excludes them from automatic publication. Personal memory is not added to sharing snapshots. Phase 7 must explicitly design reviewed sharing of eligible derived information. Model output cannot choose a coordinator, grant or recipient.

The existing deletion cascades remove source-linked rows and receipts; existing RLS and runtime roles enforce ownership. Source fingerprints are scoped metadata, retained only as long as their summary/receipt. Existing logs record provider/database/job outcomes and timing without item text; no new content-bearing telemetry is introduced.

## Configuration, migration and rollback

Required for future activation:

```text
ORIGEN_BINDER_ORGANIZATION=true
ORIGEN_BINDER_JOBS=true
ORIGEN_PERSONALIZATION_MODE=cohort   # or on after pilot validation
ORIGEN_PERSONALIZATION_SUBJECTS=<explicit pilot subjects when cohort>
ORIGEN_PERSONALIZATION_EXTRACTION=true
```

The existing restricted application and separate maintenance credentials/worker must already be configured. Startup rejects incompatible flags or a missing migration 062 ledger entry. Existing migrations must be applied in sequence using the repository's migration procedure and runtime grants. **Phase 1 observed production missing migration 061**; that finding has not been rechecked or changed here. Do not apply 062 by skipping its predecessors.

All schema changes are additive, with no automatic content backfill. Keep the organization flag false while applying/verifying the migration and shipping code. Use a small cohort only after the synthetic checks and human-reviewed provider cases. Turning the organization flag off prevents new unified work and preserves existing readers and manual controls; already-created items remain. Turning the existing worker flag off stops background work. Neither switch reverses persisted data or removes schema; rollback must not drop tables or rewrite applied migrations.

Disabling only organization resumes the legacy extraction behavior for future unprocessed work. It does not mean all AI organization is disabled. Use the worker and personalization extraction controls deliberately when a broader stop is required.

## Verification and remaining work

Final local results: **763 server tests, 35 operations tests, 20 offline contract cases, and six English/Spanish browser journeys passed**. Logging policy, TypeScript, production build and diff whitespace checks passed. The final full-suite harness recorded unchanged source. See the [evidence summary](../../output/student-first-phase2-2026-10-21/README.md) and [machine-readable result](../../output/student-first-phase2-2026-10-21/final-verification/verification.json). These are synthetic/local checks; real-provider quality and deployment readiness are separate gates.

Fresh evidence is under `output/student-first-phase2-2026-10-21/`. The new `server/binder-organization.test.mjs` covers contract rejection, English/Spanish uncertainty, role-at-save attribution, account/student/family boundaries, atomic rollback, duplicate workers, dismissed-item deduplication, source deletion, late corrections, flag disablement, legacy races, worker retry, permission/lease fencing and capacity recovery. Existing server and operations suites cover legacy paths and shared infrastructure.

`scripts/binder-organization-smoke.cjs` uses separate headless local Chrome, synthetic authentication/audio/providers, and real isolated local API/PostgreSQL/worker paths. It exercises speaking, summary save, closing the browser, organization, reopening, visible goals/constraints/questions and no automatic plan at widths 1280, 390 and 320 in English and Spanish. It is not evidence of real speech quality or real Auth0 sign-in. Test screenshots contain synthetic information only.

The final evidence summary records exact test counts, reruns and any limitations. No paid-model run or production activation occurred. Remaining work: Phase 3 correction/removal/undo semantics across derived records; Phase 4 useful clarification and natural spoken changes; Phase 5 continuity/freshness and the prior Spanish retrieval miss; Phase 6 earlier durability; Phases 7–10 sharing, coordinator follow-through, integrated evaluation and release/pilot readiness. The historical coordinator burst issue remains outside this implementation.
