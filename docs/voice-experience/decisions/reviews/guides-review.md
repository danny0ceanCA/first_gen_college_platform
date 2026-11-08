# Decisions integration: guide review and existing-code comparison

Reviewed on 2026-11-07 (Pacific) for the `v1.3-decisions-integration` proposal. This is a documentation-only audit. No runtime configuration, prompts, voice settings, worker behavior, database data, or production services were changed by this reviewer.

## Coverage

The assigned subset is ten manifest pages, totaling 285,854 bytes. Pass 1 read the full pages for capabilities and suitability. Pass 2 read the full pages again for contracts, failure cases, and timing semantics. SDK examples were included. Where a tool response truncated a page, the missing range was reread in bounded chunks; a truncated display was not counted as complete coverage.

The guide reviewer completed all ten first reads. The second pass was divided between that reviewer and the root reviewer. The page numbers below refer to the original 30-page manifest; the file path is the stable identifier if the inventory grows.

| Original page | File under this library | First full pass | Second full pass |
| --- | --- | --- | --- |
| 1 | `pages/api/docs/guides/decisions.md` | Complete: guide reviewer | Complete: guide reviewer |
| 2 | `pages/api/docs/guides/decisions-voice.md` | Complete: guide reviewer | Complete: root reviewer |
| 5 | `pages/api/docs/guides/live.md` | Complete: guide reviewer | Complete: root reviewer |
| 6 | `pages/api/docs/guides/live-conversations.md` | Complete: guide reviewer | Complete: guide reviewer |
| 7 | `pages/api/docs/guides/live-delegation.md` | Complete: guide reviewer | Complete: guide reviewer |
| 8 | `pages/api/docs/guides/live-prompting.md` | Complete: guide reviewer | Complete: guide reviewer |
| 13 | `pages/api/docs/guides/voice-agents.md` | Complete: guide reviewer | Complete: root reviewer |
| 14 | `pages/api/docs/guides/voice-server-controls.md` | Complete: guide reviewer | Complete: guide reviewer |
| 15 | `pages/api/docs/guides/voice-webrtc.md` | Complete: guide reviewer | Complete: root reviewer |
| 28 | `pages/api/reference/responses/overview.md` | Complete: guide reviewer | Complete: root reviewer |

All ten assigned pages have two completed full reads. This audit does not claim review of the remaining manifest pages; their assigned reviewers supply that coverage. Current official guidance verification is consolidated by the root reviewer. All ten assigned local files were available. This review covers saved text and code examples, not listening to every linked voice recording or executing the examples.

## Contracts that matter for Origen

1. **Decisions classifies; it does not conduct research or generate arbitrary advice.** The documented outputs are predicate probabilities, a choice from supplied options, or a rubric score. Use Responses for generated explanations, extracted objects, and tool-call arguments. A choice needs a no-action/other option; its confidence is not proof. Thresholds need labeled examples from this application.
2. **Managed Responses and transcript Decisions can coexist.** The voice Decisions guide distinguishes replacing `delegation.type` with `decisions` from adding transcript-driven `session.triggers`. Triggers run independently of delegation. Preserve Origen's managed Responses delegation; replacing it would also transfer more workflow ownership to the application.
3. **The API guides have different update scopes.** The general Live conversations guide describes Responses-only updates, while the newer Decisions voice guide adds Decisions configuration and trigger workflows. Verify the current primary Live/Decisions event contracts before implementing those additions. Do not infer that a guide limited to two delegation modes invalidates the newer documented trigger mode.
4. **Keep source and result identity.** Native `decision.event` results identify their trigger and source transcript event. Trigger results can arrive out of order and can represent combined pending deltas. Compare their source timeline and application revision, not arrival order alone. General transcript-trigger results have no client delegation ID; do not invent one.
5. **A transcript fragment is not a completed turn.** Preserve exact delta text and timestamps, including spaces and repeated words. There is no provider turn-complete event in these transcript deltas. A delivery gap is not evidence of silence, and a provisional grouping timer is not authority for a consequential action.
6. **Quiet context differs from requested speech.** `session.thinking.append` supplies facts without asking for immediate speech. `session.commentary.append` asks the model to speak/paraphrase. `session.instructions.append` changes behavior and can interrupt ongoing speech. Routine classifier cues should not use an interrupting instruction or force a new announcement.
7. **Appends have timing and side effects.** Content is limited to 500 tokens per append, with a required `delegation_id` (`null` for general context). Acknowledgment confirms estimated context delivery, not use, speech, or playback. Thinking/commentary appends also cancel pending automatic acknowledgments in client delegation. They do not guarantee silence, so any conversational intervention still needs live testing.
8. **One server owner should make changes.** A sideband attaches to the existing session; it does not send a second `session.start`. Duplicate browser/server handling can repeat tools, context, or continuation. A new observer should feed the existing authoritative server rather than become another provider writer.
9. **Keep speech and work independent.** Do not buffer voice or wait for classification before ordinary replies. Transcript-based guardrail guidance explicitly allows concurrent checks; buffering audio adds latency. Preserve the current model, voice, greeting, and research path while measuring the observer.
10. **Reuse task state and verified results.** The delegation and prompting guides say to reuse still-current results, discard outdated tasks, and preserve permissions in application code. Interrupting speech is different from cancelling research. A classifier must not turn a brief acknowledgment into a new request, cancel a job, or authorize a save.
11. **Measure actual outcomes.** Backend completion, transcript evidence, context acknowledgment, and heard audio are separate. Report timing and success separately; listen to English, Spanish, and mixed-language calls. Do not interpret a faster classifier as a guaranteed improvement in whole-call naturalness.
12. **Storage is a separate decision.** Live defaults to `store:false`. Forking requires permitted storage, a finalized recording, and separate restoration of application task state. The observer does not require enabling provider recording or sending the documentation library into runtime context.

## Read-only comparison with the existing code

Line references describe the code inspected for this proposal and may move in a later implementation.

| Existing component | Evidence | Proposed integration seam |
| --- | --- | --- |
| Live startup | `server/student-live-session.mjs:96` preserves `gpt-live-1`, `marin`, and `store:false`; line 101 selects managed Responses with `gpt-6-luna`. | Keep these choices. A native trigger would be an additional startup setting, not a delegation replacement. |
| Authoritative server | `server/voice-control.mjs:15` owns the physical call; line 95 receives native events. | Add an asynchronous, bounded observer at this raw event boundary. Its failure or timeout must not delay the existing channel. |
| Sideband connection | `server/voice-control.mjs:220` attaches to `/v1/live/sessions/{id}/attach`; line 230 forwards provider events. | Reuse this connection and ownership. A second worker or second sideband is not needed for initial classification. |
| Existing observation | `server/voice-control.mjs:58` observes application events after adaptation. | This is not enough for native Decisions source correlation: preserve raw transcript event IDs and `decision.event` before adaptation. |
| Event adaptation | `src/studentLiveChannel.mjs:171` receives native events; lines 193 and 217 handle input/output transcript fragments; line 254 handles nested Responses events. Unknown native event types fall through. | Handle Decisions explicitly in the server observer, preserving source IDs and timestamps. Do not assume existing adapter support. |
| Context delivery | `server/student-live-session.mjs:37` separates factual context from stable speech rules. `src/studentLiveChannel.mjs:397` converts generic application messages into `instructions.append`. | Do not reuse the generic message route for quiet Decisions cues. Use a narrowly typed factual context packet through the sole provider writer, with duplicate and stale-state protection. |
| Existing starting-point policy | `src/voiceStartingPoints.mjs:7` requires explicit uncertainty/request for ideas; lines 12–14 use known scope, allow a decline, and avoid research for starting ideas. `server/profile-voice.mjs:106` supplies this to the backend instructions. | Decisions could detect a missed opportunity to apply an existing policy. It should not introduce an intake interview or an automatic menu. Test whether any prompt alignment suffices before expanding intervention. |
| Existing conversation/research policy | `server/live-delegation-policy.mjs:34` reuses supplied information; lines 45–50 preserve responsiveness during research and latest-question delivery. | Observe whether these rules were applied. Do not create a competing research manager in phase 1. |
| Existing optional guidance | `server/adaptive-guidance.mjs:16` uses server-selected, scoped guidance and rejects inferred mastery/feelings. `server/conversation-opening.mjs:10` gates optional openings. | Preserve scope, declined/answered/completed suppression, and intro eligibility. Decisions results must not bypass these rules or become student facts. |
| Measurement | `server/live-measurements.mjs:14` creates a per-connection run and sanitized configuration fingerprint; lines 26 and 48 separate native and application evidence. | Add fixed Decisions categories, model/question version, source revision, latency, usage, and suppression reason. Keep protected transcript evidence separate from ordinary service logs. |

## Recommended initial use

Start with a shadow observer for one narrow question: **Has the caller explicitly asked for help getting started, and has that need already been addressed in the current exchange?** Include the current conversation and authorized state. Return a fixed category such as `no_action`, `starting_point_requested`, `smaller_explanation_requested`, or `unclear`. Never infer inability, anxiety, or educational understanding from accent, Spanish use, silence, or unfamiliar vocabulary.

The observer should not announce its classification. The live model remains free to respond immediately. If a later gated trial supplies a cue, first reject an outdated scope, stale request, repeated cue, answered question, declined offer, ongoing mandatory workflow, or finished session. Use a small factual statement suitable for the conversation, not a new command to interrupt or a second script to read.

For a first-generation family saying “I don't even know what I should ask,” the desired outcome is a warm, concrete starting point and one easy question. It is not an unsolicited research job, broad menu, confidence score, or durable label about the family. For “Can you explain that more simply?” the desired outcome is a smaller explanation of the same topic, not a change of subject.

## Native triggers versus standalone Decisions

Both paths can preserve managed Responses:

- **Native transcript triggers** are the documented direct Live integration. They reduce application request plumbing and include source-event linkage. They still need handling for combined deltas, out-of-order results, no-action results, cost, and application-state changes. Validate project access and current trigger contracts before choosing this path.
- **Standalone Decisions from the existing sideband** gives Origen explicit control over sampling, selected history, current app/task state, budgets, replay, and deduplication. It requires request scheduling and correlation code. The call must continue independently while that request runs.

Use the same versioned decision questions and replay suite for either path, but activate only one producer for a given cue. Choose from measured usefulness, false positives, timing, and cost. A second background service is not necessary for the first stage; long-running research already belongs to the existing worker. A separate worker becomes useful only if independent scaling, queue isolation, or durable offline analysis is demonstrated to be needed.

## Acceptance evidence before live intervention

- Replay labeled English, Spanish, and mixed-language examples, including “yes,” unfinished phrases, a genuine correction, declined help, and already-answered uncertainty.
- Verify that no-decision, refusal, timeout, invalid result, and delayed result all leave ordinary speech unaffected.
- Test scope changes, reconnects, session close, multiple results for the same source, and results arriving during an answer or research delivery.
- Keep the intro out of the initial observer's intervention window; preserve existing student selection and brief delivery.
- Compare useful spoken response time and human-rated naturalness, repetition, unwanted prompts, and factual completion against the current baseline. Classifier latency is a separate measure.
- Log observed cue, eligible cue, suppressed cue and reason, supplied context, acknowledgment, later transcript behavior, and playback evidence as distinct events. A supplied cue is not proof that the user heard or benefited from it.

No live classification calls, paid tests, or behavioral improvements were claimed during this review.
