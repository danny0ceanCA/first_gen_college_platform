# Preference integration: API contract review

Date: 2026-11-07. Branch: v1.3-decisions-integration. Review only; no runtime edits by this reviewer.

## Coverage and method

Reviewed the full unique content of all 53 non-guide documents across the Responses, Decisions, and conversation-state manifests. All files were available. Generated SDK/reference duplicates were deduplicated by exact paragraph and then exact stripped-line equality, using the user's earlier authorization to review unique generated content rather than millions of repeated schema tokens. The corpus contained 672,725 characters after paragraph deduplication and 437,795 characters / 8,641 unique lines after line deduplication. Every unique line was read; output ranges that were truncated were reread in smaller batches. This is not a claim that every repeated field expansion was reread verbatim. Relevant full original contracts and current official pages were checked for context. Guide prose coverage is recorded by the companion guide reviewer. This reviewer additionally read every unique fenced-example line in Responses structured-outputs, function-calling, tools-computer-use, and tools-connectors-mcp, plus the Decisions function-calling copy: 8,460 example lines before exact duplicate reduction, 2,541 unique lines afterward. The examples were checked for refusal/incomplete handling, SDK input/output conversion, call-ID matching, bounded loops, and application-owned permission checks; none is treated as a Live event contract.

## Relevant contracts and implications

The additional fenced examples in Responses `tools-file-search`, `tools-web-search`, `reasoning`, and `prompt-caching` were also reviewed in full unique form (1,078 lines / 45,047 characters). These reinforce checking indexing readiness, retaining source/filter qualifications, handling incomplete responses independently of text availability, preserving replayable reasoning/output items and assistant phase in standalone continuation, and keeping stable cache prefixes separate from changing user state. None requires adding another request or cache mechanism to the Live preference delivery path.

- Standalone Decisions supports 1–400 questions; choice questions allow 2–255 unique typed options. Ten questions are valid. Live-native Decisions has a separate 64-question limit. Standalone classification must remain distinct from Live delegation and triggers.
- Decisions answers arrive in question order, include typed probabilities/confidence, and may individually refuse. Refusal, malformed output, missing answers, or low confidence must not silently disable an existing preference.
- A classification is evidence for application-owned state, not permission to mutate records, run research, or speak. Scope and current request revisions remain application responsibilities.
- Live `session.thinking.append` provides quiet context, limited to 500 tokens. General context requires `delegation_id: null`. It can influence later speech; it is neither a secrecy boundary nor a guarantee of silence or behavior.
- Live append acknowledgments confirm insertion into the timeline. They do not prove the model used the preference or the caller heard anything. Log candidate, deferred, attempted, acknowledged, rejected/unconfirmed, and audible observation separately.
- Native Live transcript deltas have no transcript-done event and do not define complete turns. Existing application transcript-done events are estimates. A safe delivery check therefore combines application thought-boundary evidence, subsequent fresh browser playback idle, quiet time, current input state, and no competing context/delegation; it must not label this provider-confirmed completion.
- Any thinking or commentary append can cancel pending automatic delegation acknowledgments session-wide. Preserve exclusion while delegation/research/context delivery is pending.
- Live startup voice, instructions, and input are immutable. `session.update` changes delegation/triggers, not voice style. Responses `text.verbosity` configures backend text, not spoken delivery. No need to change startup instructions or the intro for this experiment.
- Live instructions append can interrupt behavior and survives compaction; quiet preferences should use bounded factual thinking context rather than force a new spoken answer.
- Application preference expiry/reset cannot erase an already appended Live item. A newer explicit preference correction must supersede earlier context. Do not claim that dropping local state retracts provider context.
- Standalone Responses state (`previous_response_id`, Conversations storage, compaction), Live context, and the application's student/task state are distinct. A small local call/student preference state needs neither Conversations API storage nor a new provider conversation.
- Responses `response.steer` is queued user input and may interrupt at a safe output boundary; it is not a Live quiet-context primitive. Do not use it here.
- Sideband attach neither creates the session nor replays earlier events. Reconnect must reset eligibility until new scope/readiness/playback evidence is known. No speculative replay after an uncertain append outcome.
- Responses backend completion and Live transcript evidence are not browser playback evidence. The SDK response output list order is not guaranteed; Live nested lifecycle snapshots also omit output arrays. Existing granular event handling remains necessary.

## Current code assessment

Read `research/decisions/local-call/support.mjs`, `worker.mjs`, `session.mjs`, and `research/decisions/observer.mjs`.

1. Existing support is deliberately a race against a 4-second question window: every assistant transcript/audio event invalidates the support stamp. A fast natural answer invalidates help before classification returns. This is appropriate for one-time answer suggestions, but wrong for an explicit ongoing request such as asking for plain language throughout the call.
2. The observer independently discards snapshots when assistant context changes, and the worker forwards only completed rows. Merely extending the gate TTL cannot fix this; validated preference extraction needs an independent user/scope revision path while broad research classification keeps its existing stale behavior.
3. The gate already blocks during the intro, pending selection receipt, audio, research, backend/delegation, pending context, and missing/stale playback. Preserve those protections. Keep the normal production launcher and voice engine unmodified.
4. Scope confirmation, student/call identity, language, worker gaps, and reconnect state already provide useful isolation boundaries. Add preferences to those boundaries, not to broad student records.

## Recommended implementation

Keep an allowlist of two explicit ongoing communication preferences: plain language and one step at a time. Carry their state only in this call and student scope. A single-question simplification request stays transient. Do not infer durable preferences from demographic identity, language/accent, emotional state, or an assistant suggestion. Require explicit caller evidence and confidence, with unknown/refusal leaving state unchanged.

Each preference revision should retain source user-turn ID and user/scope revision. Assistant output does not invalidate an explicit preference; new caller speech pauses delivery and newer explicit changes replace the state. Deliver the latest compact state once after a completed application thought estimate and fresh idle interval, never by holding the voice reply or forcing another response. If delivery waits, recheck every condition before sending; do not queue old speech or retry an uncertain send. Explicit withdrawal creates a newer factual snapshot saying the earlier preference no longer applies.

Tests should separate unchanged/enable/disable; one-off and ongoing requests; negation; quotes/third-person requests; latest corrections; English/Spanish/mixed language; assistant answering before classifier completion; interjections; genuine interruption; intro; pending research/context; stale browser idle; disconnect/scope change; duplicate/out-of-order candidate; unacknowledged provider sends; source evidence mismatch; and any attempt to inject raw generated wording.

## Current official verification

Checked on 2026-11-07:

- [Decisions create](https://developers.openai.com/api/reference/resources/decisions/methods/create): current 1–400 questions, choice bounds, ordered answers.
- [Live primary WebSocket](https://developers.openai.com/api/reference/resources/live/primary-websocket): quiet append contract, null delegation ID, 500-token limit, acknowledgment limits, native transcript-fragment semantics.

No contradictory change found for the proposed local experiment. Timing thresholds and preference confidence thresholds are Origen safeguards to validate, not OpenAI guarantees.

## Independent implementation verification

Reviewed the new `preference-delivery.mjs`, `preference-candidates.mjs`, support-gate integration, and isolated wrapper test. Added `preference-delivery.test.mjs` and `audio-activity.test.mjs`: 35 offline tests pass in the current working tree. Coverage includes English and Spanish, a classifier result arriving after the assistant starts answering, explicit withdrawal, current caller and scope provenance, coalescing during research, deduplication, malformed/refused/uncertain inputs, generated wording exclusion, intro and research fences, incomplete thoughts and ellipses, playback idle timing, trailing audio safety, scope/language resets, expiry, attempt bounds, uncertain sends, and failed diagnostic sinks.

Two review findings were corrected during implementation: triple-period fragments no longer count as a complete thought, and send/log failures cannot escape the delivery helper. Only observer results discarded specifically for `stale_after_request` can enter the independent preference revalidation path; budget failures and unrelated discarded records remain excluded.

The helper does not claim that a transcript boundary or append acknowledgment proves the caller heard anything. Its completed-thought estimate requires punctuation plus browser idle and a quiet interval, with the support gate separately enforcing freshness and intro/research/context exclusions. Nonzero or unknown audio arriving after an estimated boundary restarts the quiet interval and requires fresh playback evidence, while preserving the completed text because audio can trail transcript grouping. New transcript text invalidates that estimate until another complete thought arrives. Offline tests prove the gates and failure isolation, not perceived warmth or provider compliance with the preferences.

Real validation exposed continuous silent sideband audio frames. Rechecked the complete `session.output_audio.delta` contract in the saved Live sideband reference: reflected audio is mono PCM16LE at 24 kHz; it is distinct from primary WebSocket audio in the session-selected format. The local helper ignores only canonical base64 that decodes to nonempty, complete PCM16 samples containing exact zeros. It does not use a speech-detection threshold, manufacture browser idle evidence, or change playback. Malformed base64, odd byte lengths, and even a single nonzero byte remain activity. Review identified noncanonical padding bits (`AAB=`) as an incorrectly accepted zero frame; canonical round-trip validation corrected it, and the new regression passes. English/Spanish tests verify silent frames cannot starve a finished-thought delivery, trailing real audio restarts the safety interval, and unfinished new text remains blocked even when subsequent audio is zero.

## Manifest checklist

| Library | Document | Coverage |
| --- | --- | --- |
| responses | `pages/api/reference/responses/overview.md` | Reviewed unique content |
| responses | `pages/api/reference/python/resources/responses.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/beta/subresources/responses/streaming-events.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/beta/subresources/responses/websocket-events.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/methods/cancel.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/methods/compact.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/methods/create.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/methods/delete.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/methods/retrieve.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/subresources/input_items/methods/list.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/subresources/input_tokens.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/streaming-events.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/responses/websocket-events.md` | Reviewed unique content |
| responses | `pages/api/docs/quickstart.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/conversations.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/conversations/methods/create.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/conversations/methods/delete.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/conversations/methods/retrieve.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/conversations/methods/update.md` | Reviewed unique content |
| responses | `pages/api/reference/resources/conversations/subresources/items/methods/list.md` | Reviewed unique content |
| decisions | `pages/api/docs/pricing.md` | Reviewed unique content |
| decisions | `pages/api/reference/cli/resources/decisions.md` | Reviewed unique content |
| decisions | `pages/api/reference/cli/resources/decisions/methods/create.md` | Reviewed unique content |
| decisions | `pages/api/reference/python/resources/decisions.md` | Reviewed unique content |
| decisions | `pages/api/reference/python/resources/decisions/methods/create.md` | Reviewed unique content |
| decisions | `pages/api/reference/resources/admin/subresources/organization/subresources/usage/methods/decisions.md` | Reviewed unique content |
| decisions | `pages/api/reference/resources/decisions.md` | Reviewed unique content |
| decisions | `pages/api/reference/resources/decisions/methods/create.md` | Reviewed unique content |
| decisions | `pages/api/reference/resources/live/methods/create.md` | Reviewed unique content |
| decisions | `pages/api/reference/resources/live/primary-websocket.md` | Reviewed unique content |
| decisions | `pages/api/reference/resources/live/sideband-websocket.md` | Reviewed unique content |
| decisions | `pages/api/reference/responses/overview.md` | Reviewed unique content |
| decisions | `pages/api/reference/typescript/resources/decisions.md` | Reviewed unique content |
| decisions | `pages/api/reference/typescript/resources/decisions/methods/create.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/models.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/python/resources/conversations.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/methods/create.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/methods/delete.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/methods/retrieve.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/methods/update.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/subresources/items/methods/create.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/subresources/items/methods/delete.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/subresources/items/methods/list.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/conversations/subresources/items/methods/retrieve.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/responses.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/responses/methods/compact.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/responses/methods/create.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/responses/methods/delete.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/responses/methods/retrieve.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/resources/responses/subresources/input_items/methods/list.md` | Reviewed unique content |
| conversation-state | `pages/api/reference/typescript/resources/conversations.md` | Reviewed unique content |
