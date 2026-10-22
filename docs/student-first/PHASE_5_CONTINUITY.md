# Phase 5: carry current context into the next conversation

Local implementation, 2026-10-21. Baseline HEAD remains `d0fe03e80b6b106d4ff57f9ec005efc122ede891`; Phases 1–4 remain in the working tree. No commit, push, deployment, production migration or production setting change is included. `ORIGEN_CONVERSATION_CONTINUITY` defaults to false.

## Student experience

Alex returns after correcting “I work evenings” to “I work Tuesdays and Thursdays.” The next conversation receives the current corrected memory, with its original attribution, rather than the suppressed earlier source. It can use that schedule without asking Alex to start over. A tentative interest stays tentative. Origen should mention at most one useful detail and follow Alex's current question, rather than announce a recap or run through unfinished work.

If Alex recently declined a question about working days, the returning call receives that bounded status and its expiry. The guide is instructed to keep helping without asking the same detail again. An answered prompt is not automatically a confirmed student fact. Questions still stored as questions remain available; a question explicitly changed to a note or removed no longer appears in the open-question references. Completed and deferred actions keep their existing states.

If Alex asks whether an old application deadline still applies, the guide receives the saved entry term and any retained source dates. Those links are labeled historical references requiring a fresh official check. A recent stored date does not prove verification, and a saved entry term is the intended cycle, not proof of eligibility or an official deadline. Missing cycle information may warrant one clarifying question. A failed lookup must remain unverified.

This adds no form, dashboard, transcript store, vector database, new research provider or automatic background lookup. Existing binder correction/removal controls remain the source of durable changes.

## Implementation and rationale

| Component | Change and reason |
| --- | --- |
| `server/conversation-continuity.mjs` | Small continuity assembler: scoped recent-question metadata, open-question references, saved entry term, bounded source pointers and conversational policy. Reuses existing content instead of creating another memory store. |
| `server/profile-voice.mjs` | Adds the assembled context after loading current brief/workspace/history. Clears client-supplied continuity metadata. Checks account context revision around assembly; rejects a concurrently changed snapshot. Prepared contexts use existing one-use, revision- and policy-bound caching. |
| `server/voice-workspace.mjs` | Adds owned source citations to selected/current notes and conversation points when enabled. Suppressed sources do not contribute references. Existing topic selection, attribution, action statuses and prompt budgets remain. |
| `server/history-retrieval.mjs` | Keyword retrieval v2 removes accented interrogative stop words and generic “problem/concern/problema” filler from coverage. Original accented content words remain for PostgreSQL stemming. Optional continuity metadata includes current note kind and source dates. |
| `server/live-memory.mjs` | Existing recall tool returns the same continuity policy and scoped question/source metadata. Checks memory and account-context revisions and the feature gate before returning results. No new model tool or endpoint. |
| `server/migrations/065_continuity_revision.sql` | Adds the existing voice-context revision trigger to `origen_guidance_questions`. Question changes now invalidate prepared context; no new content columns or table. |
| `server/personalization-controls.mjs`, `server/production-config.mjs`, `server/index.mjs`, `render.yaml` | Server-owned enablement, startup/dependency checks and policy identity for prepared/active-call rollback. |

The existing Phase 3 suppression rules do the difficult work of excluding corrected source summaries and their stale derivatives. Phase 5 keeps those rules intact. It does not choose which of two independent contradictory records is true or merge them semantically; the guide must clarify. Question resolution is based on explicit current record state, not an inferred answer or the mere existence of a later conversation.

## Data and provenance contract

The additional prompt metadata contains:

```json
{
  "asOf": "<server assembly time>",
  "applicationCycle": "Fall 2027",
  "openQuestionRefs": ["note:<current owned ID>"],
  "recentQuestions": [
    {"key":"work_days","status":"declined","recordedAt":"<timestamp>","expiresAt":"<timestamp>"}
  ],
  "savedReferences": [
    {
      "url":"https://www.calstate.edu/apply",
      "recordedCheckedAt":"2025-01-01T00:00:00.000Z",
      "evidenceClass":"saved_reference",
      "freshness":"stale",
      "requiresFreshLookup":true,
      "effectivePeriod":null,
      "sourceRef":"summary:<owned summary ID>"
    }
  ]
}
```

At most four recent question states, six open-question references and six deduplicated saved source links are supplied. Source metadata has per-record and aggregate byte budgets. No answer text is copied into the question-status table. Existing source summaries, memories and notes retain their own provenance and uncertainty.

Source freshness is deliberately conservative: a stored timestamp at least 24 hours old is labeled stale; a more recent one is recent but unverified. Missing, invalid or future timestamps are unknown. **All saved references require a fresh lookup for current policy claims**, regardless of that label. These thresholds are product policy, not a statement that official rules always change daily. No effective academic period is inferred from a URL, retrieval timestamp or the student's intended entry term.

Only bounded HTTPS references without credentials, query strings or fragments enter the new metadata. This filtering does not prove a domain is official. Existing research handlers still validate their supported source domains and require completed searches with citations. Stored references are never fetched automatically. Existing provider-privacy controls still minimize public research arguments; private binder text must not be copied into a search.

The existing research cache lasts five minutes within a physical call, with a 12-entry bound; it is not reused across calls. Existing explicit-refresh behavior and lookup budgets remain. A new conversation therefore cannot use a prior call's cached research response in place of a new requested lookup. The software supplies the policy and tools; whether the live model chooses them correctly still needs Phase 9 actual-provider evaluation.

## Spanish retrieval finding

The frozen `es-renta` case originally missed because two factors combined:

1. The existing coordinator-code privacy sanitizer turns “renta vence” into `[connection code omitted]`, because two five-letter words match a possible code pattern.
2. Accented “cuál” and generic “problema” counted against search coverage even though they do not identify the saved subject.

Keyword v2 removes that question filler while retaining the existing 0.34 minimum coverage threshold. The remaining deposit term now retrieves the saved, redacted evidence. The privacy sanitizer is unchanged; the missing wording is not reconstructed. This closes the retrieval miss, **not the upstream false-positive redaction**. A future redaction change needs separate analysis of the connection-code leakage tradeoff.

The unchanged 28-case catalog improved from English 12/12 and Spanish 11/12 to 12/12 in both languages. All four no-relevant-source cases and account/student/family isolation checks passed. This is synthetic source retrieval, not a claim of complete recall, semantic understanding or model answer quality.

## Concurrency, privacy and recovery

Question reads require the authenticated account and exact student/family scope, with RLS and existing account guards. Unresolved voice scope gets no return-context metadata. The handler ignores forged client snapshots. Source deletion and correction invalidate current/prepared content through existing revisions; migration 065 adds question metadata to the same mechanism.

Concurrent changes during assembly return `memory_changed` instead of negotiating with a mixed snapshot. The live recall path likewise checks revision and current flag state before returning. Expired question metadata is omitted from the snapshot; prepared snapshots re-evaluate expiration when used. The underlying seven-day question cooldown still uses Phase 4's lazy physical cleanup, rather than promising seven-day deletion for inactive accounts.

There is no additional durable content store, mutation API or undo operation in this phase. Existing erasure, export and restore handling for summaries, notes, memories and question metadata continues to apply. No private text is added to telemetry. The reusable guidance-configuration hash uses a constant continuity policy marker, not the student's metadata or timestamp.

## Enablement and rollback

Keep the default false until release rehearsal and actual-provider validation. Enabling requires migrations through 065 and `ORIGEN_BINDER_CORRECTIONS=true`; existing personalization eligibility and retrieval must also be enabled. Phase 4's question tool remains independently gated. Phase 5 can use already-existing question metadata without enabling new question generation.

Turning off `ORIGEN_CONVERSATION_CONTINUITY` removes new metadata on negotiation/recall and invalidates prepared contexts through policy identity. Existing active-call polling stops/refreshes sessions using the old policy. It does not erase stored content or reverse migration 065. The small keyword-tokenization fix applies to existing retrieval even with the new flag off; reverting that fix requires a code rollback, not toggling the continuity flag. Do not modify applied migrations or drop columns for rollback.

## Verification and limits

See [Phase 5 verification evidence](../../output/student-first-phase5-2026-10-21/README.md) for final test results and fingerprints. Tests cover cold and prepared returning calls, source-linked corrections/removal, explicit question-state changes, account/student isolation, expired prompts, forged context, stale-source metadata, source deletion, concurrent assembly and flag rollback. Browser journeys use separate headless local Chrome, real local API/restricted PostgreSQL, and synthetic auth/media/provider responses.

No actual provider speech, model tool choice, official policy content, or pilot outcome is validated by these tests. Older questions are not semantically auto-resolved, conflicting independent records are not merged, and private data is not shared with a coordinator. Production Node 22 still needs a matching-runtime rehearsal; local verification uses Node 24.15.0.

Phase 6 remains necessary: the existing successful live-write reconnect clears unsummarized discussion. Acknowledged binder corrections are durable, but Phase 5 does not recover discussion that was never saved or repair that reconnect boundary. No production activation is claimed.
