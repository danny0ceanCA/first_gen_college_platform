# Phase 3: dependable corrections, removal and recent undo

Local implementation, 2026-10-21. HEAD remains `d0fe03e80b6b106d4ff57f9ec005efc122ede891`; Phase 1 and Phase 2 work is preserved. No commit, push, deployment, production migration or settings change is included. `ORIGEN_BINDER_CORRECTIONS` defaults to false.

## Student experience

Students keep using **Edit**, **Remove**, and **Confirm detail** in the existing binder. A successful change offers **Undo last change** in that view for ten minutes. English and Spanish use the same behavior. There is no new history dashboard or correction form.

For example, correcting “The student works evenings” to “I work only Tuesdays and Thursdays” keeps the current memory ID, advances its version, preserves its original summary attribution, and supplies the corrected text to future guidance. The old summary remains in conversation history as a historical record, but is excluded from future guidance. Related unreviewed memory suggestions are withdrawn conservatively. Topic entries retained for reference are labeled as excluded when loaded; an explicitly corrected or restored entry can supply its current content without bringing the old summary back into voice context.

Undo restores only the selected item. It does not undo other independent changes, revive the whole summary, restore other withdrawn suggestions, recreate a deleted conversation, or restore sharing. Confirm/undo-confirm changes review status without withdrawing unrelated suggestions. A detail deliberately restored by undo is not withdrawn again merely because a related note is edited later.

Undo is available only while the current view retains the prior text in memory. Reloading, closing the view, changing account/student context, privacy reset, or expiration clears it. Undoing an edit retains the item ID and creates a newer version. Undoing a removal creates a replacement ID: the erased ID and its deletion journal stay erased. The operation receipt relates the replacement to the original; restored notes also retain `restored_from`. This identity change is deliberate to respect existing deletion safeguards.

## Architecture and decisions

| File or module | Responsibility |
| --- | --- |
| `server/binder-corrections.mjs` | Validates bounded explicit commands, checks ownership/current versions, handles operation replay and undo, preserves provenance, suppresses stale sources, and commits changes atomically. No model call. |
| `server/binder-corrections-policy.mjs` | Server feature gate and migration readiness check. |
| `server/migrations/063_binder_corrections.sql` | RLS-protected metadata receipts; current-context markers; private restoration provenance; compatibility refresh for current preexisting note digests. |
| `server/student-memory.mjs`, `server/topic-notes.mjs` | Advertise controls when enabled and reject older mutation requests that omit the new operation contract. Creation, translation, reading and disabled-mode behavior remain available. Topic loads mark suppressed historical entries. |
| `server/history-retrieval.mjs`, `server/voice-workspace.mjs` | Accept current explicitly corrected/restored content while excluding suppressed summaries. Selected corrected notes do not attach the old summary to voice context. Existing confirmed-memory precedence remains. |
| `src/useBinderCorrections.ts` | Keeps the prior snapshot and uncertain request identity only in browser memory, retries the same intent with the same ID, enforces privacy leases, and expires undo. |
| `src/StudentMemory.tsx`, `src/TopicNotebook.tsx` | Existing edit/remove controls, recent undo, conflict/reload feedback and withdrawal explanation. If saving succeeds but refresh fails, explicitly report that the change was saved. |
| `server/index.mjs`, logging catalogs, `render.yaml` | Existing authenticated/permission-controlled API dispatch, startup readiness, bounded telemetry vocabulary, and disabled deployment default. |

The ten-minute browser-only design avoids adding an archive of removed text or an ongoing server cleanup job for undo payloads. The tradeoff is no undo after reload and no general history/redo stack. A future persistent history feature would need a separate retention decision.

## API and data contract

`POST /api/binder-changes` uses the existing API authentication, account closure checks, eligibility lease, origin policy, rate limit and no-store responses. Its body is limited to 32 KB. Core fields:

```json
{
  "operationId": "<new UUID per intent; reuse for retry>",
  "store": "memory",
  "action": "update",
  "studentId": "<owned student ID, or null for family scope>",
  "id": "<current item UUID>",
  "version": 2,
  "before": {"...": "the existing item snapshot from the loaded view"},
  "value": {
    "category": "constraint",
    "content": "I work only Tuesdays and Thursdays.",
    "language": "en",
    "speaker": "student"
  }
}
```

Supported actions are update/delete/confirm (memory only)/undo. Existing validators govern edited fields, including explicit decision confirmation for notes. The service canonicalizes a whitelist of snapshot fields and checks it against the server's current row. Client-supplied ownership, status, provenance or feature flags cannot authorize a change. Undo requires the original receipt ID, its exact snapshot, result identity/version, valid permission revision and unexpired deadline. The client cannot substitute different prior text.

Responses contain the resulting identity/version, replay status, number of withdrawn suggestions, and an optional undo descriptor. The descriptor includes the verified prior snapshot sent by this browser, not historical content fetched from a server archive. A successful replay returns the same result identity/version with current undo availability. It never writes another version. Reusing an operation ID with a different normalized payload is a conflict.

`origen_binder_changes` stores only account/student scope, store/action, item/result IDs and versions, account-salted request/snapshot hashes, source ID/hash, permission revision, undo linkage, timestamps and withdrawn count. No prior/current item text, transcripts or audio are stored there. Account/student/source deletion cascades applicable receipts. Receipts older than 90 days are removed on the next change for that account; inactive accounts can retain this metadata longer. A 20,000-receipt account cap bounds growth. The replay guarantee is within the retained receipt window; old item-version preconditions still apply afterward.

## Transaction and recovery

The service locks the existing subject/account guard, validates permission and exact scope, checks replay and the current version/snapshot, validates source existence/version, applies source suppression and the selected change, advances the memory revision, records the receipt, and rechecks permission and enablement before commit. Content, suppression, privacy/sharing triggers, revision and receipt roll back together on failure.

The provider-facing revision changes invalidate active/prepared context through existing mechanisms. The UI also emits the existing memory-context notification. No automatic retry of a changed or ambiguous intent occurs. An uncertain transport response retains its operation ID for an explicit retry. Concurrent duplicate submissions produce one mutation. A later edit blocks an older undo; a changed or erased source, permission revision change, expiration, account closure or feature shutdown also blocks it.

Removal preserves the original conversation unless the student separately deletes that conversation. Memory deletion clears the current text and quote using the existing tombstone policy; topic-note deletion removes the row. Undo does not revive deletion-journal IDs. Restored notes are explicitly private, even if the account role changed from parent to student. Existing coordinator snapshots are invalidated by source changes; grants/publications/previews are never restored by the correction command. Re-sharing is a separate reviewed operation.

Restored removed notes remain ineligible under the current sharing rules, even when the original note was eligible. Phase 7 must provide an explicitly reviewed eligibility path if students need to share those replacements. Editing an existing eligible note still permits a fresh review/publication through the existing sharing flow; undo itself never performs that publication.

Source-level suppression is intentionally conservative because a summary is not a structured set of independently verified facts. Unrelated unreviewed suggestions from that source may need another review. Independently confirmed records, profile fields and plans are not silently rewritten. Semantic contradictions across different conversations still require the clarification/continuity work in Phases 4-5; this phase does not guess which separate statements describe the same fact.

## Migration and rollout

Apply migrations in order, including 061/062 prerequisites, with the repository's migration and restricted-runtime grant procedure. Phase 1 observed production missing 061; this turn did not recheck or change production. Startup refuses enabled corrections without migration 063. Keep the flag false while shipping compatible readers and verifying schema; activate only after the release rehearsal. The correction gate is independent of the Phase 2 organization gate.

Adding note metadata changes the whole-row digest used by existing sharing checks. Migration 063 refreshes only digests provably matching the pre-062 or pre-063 current row and version. It preserves classification/active/completeness, never certifies a stale digest, and advances lineage revision. **Existing prepared/shared snapshots affected by this refresh are invalidated and require fresh review/publication.** Plan this release effect explicitly; applying the migration is not a no-op merely because the feature flag is false.

Flag-off rollback stops new correction/undo commands and restores legacy UI mutation paths. It preserves current content, suppression, private restoration markers and schema; it does not undo previously saved changes or restore sharing. Old browser tabs encountering `correction_operation_required` must reload. Never drop the receipt table or rewrite an applied migration as a rollback.

## Verification and scope

Evidence is under `output/student-first-phase3-2026-10-21/`; the [evidence summary](../../output/student-first-phase3-2026-10-21/README.md) distinguishes preliminary runs from the final unchanged-source checks. The final run passed **783 server tests, 35 operations tests, logging policy, TypeScript checks and the production build**, with `sourceUnchanged: true`. The focused suite passed 36 tests, the browser harness passed six journeys, and all 20 offline software-contract cases passed. Tests cover English/Spanish corrections, exact retry, concurrent duplicates, stale/forged/expired undo, source deletion/change, parent attribution, role-change restoration, permission/scope boundaries, rollback, HTTP protection, current voice/retrieval content and sharing revocation. A preexisting-data migration test verifies digest refresh without upgrading stale/protected records.

The browser harness uses separate headless local Chrome, synthetic authentication/provider output, and real local API/restricted-role PostgreSQL. It covers memory and note edit/remove/undo, a dropped successful response, reload persistence, browser-only undo loss, and three viewport widths in both languages. No paid provider or production calls are involved. Local Node is 24.15.0; the production-configured Node 22 still needs a matching-runtime release rehearsal. Real speech/model quality and broader accessibility remain later integrated-validation work.

No general undo is added for profile fields, plans, raw conversation deletion or coordinator publication. No spoken-correction grammar is added here; that is Phase 4. The existing coordinator burst issue and Spanish historical-retrieval miss remain assigned to later phases.
