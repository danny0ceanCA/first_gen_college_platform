# Phase 4: useful questions and spoken corrections

Local implementation, 2026-10-21. Baseline HEAD remains `d0fe03e80b6b106d4ff57f9ec005efc122ede891`; earlier phase changes are preserved. No commit, push, deployment, production migration or settings change is included. `ORIGEN_GUIDED_CONVERSATION` defaults to false.

## Student experience

The student continues talking. There is no new intake form, required questionnaire or coordinator workflow.

Example: Alex's binder says “I work evenings.” While comparing class schedules, Origen can ask “Which days do you work? You can skip this if you prefer.” It avoids that question when the current profile or relevant binder content already states the days. A tentative work schedule is not treated as certain. If Alex declines, Origen continues helping and suppresses that question for seven days in this account/student scope.

Alex can say “Actually, I work Tuesdays and Thursdays.” Origen recalls the current item, reads its old and proposed new wording, and asks whether to save that correction. A complete spoken confirmation followed by an explicit yes updates the existing item. A generated transcript alone, an interrupted readback, silence, an unrelated yes, an expired proposal, or a changed item does not authorize the write.

“En realidad, tal vez ingeniería” remains tentative. The server matches the whole replacement clause, preventing a tool from silently reducing it to “ingeniería.” Memory categories and original attribution are preserved; note topic/kind are preserved. A note does not become a decision simply because its text was corrected.

All removals and edits to existing decision notes require spoken confirmation, even when the initial command is exact. An explicit full “Change [old text] to [new text]” command can update an ordinary item directly. Ambiguous references require a readback. If multiple items have identical normalized wording, the server refuses to choose and directs the person to identify/edit the intended binder item. This limited fallback is preferable to silently changing the wrong record.

## Scope and decisions

The initial question catalog is deliberately small:

| Question key | When it may help | Evidence that suppresses it |
| --- | --- | --- |
| `work_days` | Class/schedule discussion with a work constraint | Relevant workdays in the profile, current utterance or current binder evidence; uncertain days still warrant clarification |
| `aid_progress` | FAFSA/CADAA/financial-aid application discussion | Existing evidence about starting or submitting that application |
| `entry_term` | Application-cycle/deadline discussion | A saved entry term or relevant stated start term |
| `interests` | Choosing colleges or what to study | Existing interests/goals, including tentative interests |

The current registered user turn must support the topic trigger. The model cannot make an unrelated question eligible simply by choosing a topic argument. Generic explanations such as “What does a major mean?” do not start a questionnaire. The model is instructed to answer what it can first and use the policy only when missing context materially changes the advice.

This is a bounded deterministic policy, not a general semantic reasoner. It supports an initial English/Spanish vocabulary and four gaps. Model tool selection, naturalness, speech recognition and multilingual phrasing still need actual-provider evaluation. The software does not prove those qualities through simulated provider events. Expanding the catalog should follow observed student need, not an exhaustive intake checklist.

## Responsibilities and contracts

| Module | Responsibility |
| --- | --- |
| `server/guided-conversation.mjs` | Bilingual question catalog, known-context checks, cooldown metadata, exact spoken correction intent, server readiness and tool instructions |
| `server/live-memory.mjs` | Existing account/session/turn capability, one current proposal, version checks, confirmation, question commands, replay and atomic correction integration |
| `server/binder-corrections.mjs` | Phase 3 mutation semantics; now accepts an existing transaction and abort signal so content, suppression, correction receipt and voice receipt commit or roll back together |
| `server/profile-voice.mjs` | Advertises new tools only through server-owned feature/personalization controls and a confirmed live scope; clients cannot forge enablement |
| `server/personalization-controls.mjs` | Gates questions with adaptive personalization and live access; incorporates the new flag in active-call/preparation policy identity |
| `src/voicePresentation.mjs` | Matches response creation, successful completion, actual audio start/drain and transcript; rejects interrupted, cleared, stale, failed and duplicate delivery |
| `src/voiceMemoryTools.mjs`, `src/ProfileVoice.tsx` | Route tool requests through the existing authenticated live-memory API, serialize presentation before the next turn, suppress stale responses and refresh acknowledged writes |
| `server/privacy-controls.mjs`, `server/account-lifecycle.mjs`, `ops/privacy-recovery.mjs` | Erase/export scoped question metadata and discard restored pending confirmations/cooldowns during recovery |

Two new tools use the existing `POST /api/live-memory` endpoint:

```json
{"name":"get_guidance_question","arguments":{"topic":"transfer"}}
```

The client adds the current session ID, independently captured transcript, turn ID and sequence. The server reads only the session's owned student/family scope. It returns `question` with one catalog key/text/reason, or `no_question`. The client reports `question-present` only after completed playback; the server checks the current proposal and expected wording. It never stores the question's answer as a confirmed fact.

```json
{
  "name":"correct_binder_item",
  "arguments":{
    "store":"memory",
    "kind":"update",
    "id":"<recalled current item UUID>",
    "version":2,
    "content":"I work Tuesdays and Thursdays."
  }
}
```

`store` is memory or note; `kind` is update or delete. The model cannot supply account/student ownership, provenance, note topic/kind, or permission revision. Existing memory/next-step tools remain available according to their current gates. Profiles, plan revisions, sharing and coordinator messages are outside this new correction contract.

Natural correction prefixes include “Actually,” “I meant,” “En realidad,” and “Quise decir.” The replacement must match the whole normalized clause, not a semantic paraphrase or a substring omitting qualifiers. Broader explicit change commands can prepare a readback when their complete replacement clause matches. Unsupported wording does not mutate storage; the person can clarify the wording or use binder controls. This favors a bounded, reviewable first implementation over a second model that guesses intent.

## Data, privacy and concurrency

Migration `064_guided_conversation.sql` adds:

- `origen_guidance_questions`: account, scope/student, one of four question keys, asked/answered/declined status, updated timestamp and seven-day expiration. RLS isolates accounts and foreign keys cascade student/account deletion. At most four rows exist per scope.
- Three metadata columns on existing live sessions: current gap key, turn sequence and whether its question was presented.

No question answer, transcript, proposed correction text, raw audio or additional model output is archived in these new fields. Answered means a supported response to that prompt was observed, not that a durable fact was confirmed. Answers can enter the binder later through the existing saved-summary organization flow, with its existing uncertainty/provenance rules.

All three cooldown statuses suppress repeated prompting for seven days. Expired metadata is deleted lazily on the account's next question-policy request; inactive accounts may retain these bounded rows longer. This is a cooldown duration, not a guaranteed physical retention period. Privacy erasure of memories, notes or summaries also clears scoped question metadata and closes outstanding live capabilities. Account export includes the metadata. Recovery deliberately discards all restored question cooldowns and live sessions/receipts rather than treating old confirmations as current permission.

The existing live-session lifetime and two-minute confirmation window remain. Confirmation must follow the exact presented proposal on the immediately next registered user turn. The original proposal hash includes target identity/version and complete normalized command. A changed payload, another student, a newer turn or version, expired session, erased source, permission failure or cancellation prevents a stale write. Request/turn receipts and the Phase 3 receipt share one database transaction. Cancellation after the correction but before the voice receipt commits rolls back both.

Presentation also requires the browser's audio player to be ready. Pause, mute, playback error or cleared audio invalidates the local delivery record. A new assistant response invalidates a previous correction readback until the new response finishes and matches the proposal; an unrelated follow-up cannot inherit permission from an earlier readback. Presentation updates are serialized before registering the next user turn. These checks establish software playback evidence, not proof that the person understood or physically heard the audio.

Correcting a source-linked item retains Phase 3 suppression and sharing invalidation. It never revives a removed source or republishes information. The server performs no additional model request for choosing these questions or executing corrections. Existing API telemetry records bounded outcomes; raw content is not added to logs.

## Rollout and rollback

Apply forward migrations through 064 using the existing restricted-runtime grant procedure. Enabling `ORIGEN_GUIDED_CONVERSATION` requires migration 063, migration 064 and `ORIGEN_BINDER_CORRECTIONS=true`. Existing personalization eligibility/cohort controls still apply; adaptive personalization gates question selection and live-write controls gate mutations. Phase 2 automatic organization remains a separate feature.

New metadata does not modify note row digests; the sharing-refresh effect belongs to prerequisite migration 063 and remains part of release planning. Startup rejects an enabled feature without its dependencies. Keep the default false through schema/deployment rehearsal and real-provider validation.

Disabling the flag removes new tools/policy at negotiation, rejects outstanding new commands and changes active-call policy identity so existing polling refreshes/stops old sessions. Content already saved remains saved. If Phase 3 corrections remain enabled, legacy explicit memory-update/delete tools continue through Phase 3's correction service; rollback does not silently discard its provenance/suppression safeguards. The completed-playback requirement remains for legacy spoken confirmations as well. Never roll back by dropping columns or rewriting an applied migration.

## Verification and remaining limits

See [Phase 4 evidence](../../output/student-first-phase4-2026-10-21/README.md) for final counts, fingerprints and retained preliminary results. Tests exercise the policy, known/uncertain/declined context, full-clause matching, negative/expired confirmations, duplicate delivery, ownership/version checks, cancellation rollback, export/erasure/recovery and flag boundaries. Browser journeys use separate headless local Chrome, synthetic auth/media/provider events, and real local API/restricted-role PostgreSQL at desktop and phone widths in both languages.

The existing successful-live-write flow reconnects with current saved context. It also clears the pending call-summary buffer; earlier unsaved discussion may therefore not reach the binder when a spoken write triggers that reconnect. This preexisting behavior was retained to avoid replaying old context as new facts. **Phase 6 must address preserving unsummarized discussion across this boundary before broad rollout.** This phase does not claim crash recovery or complete conversation capture.

There is no spoken undo or cross-view undo history. Phase 3's ten-minute browser-view undo still applies to edits made through those binder controls; a voice save does not populate that view's undo buffer. Semantic merging across independent records, general policy freshness and broader Spanish retrieval remain Phase 5. Actual-provider speech/confirmation behavior, microphone/playback failures, accessibility and cost/latency measures remain integrated validation work. Local Node 24.15.0 differs from production's configured Node 22; matching-runtime release rehearsal remains required.
