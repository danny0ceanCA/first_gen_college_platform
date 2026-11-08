# Lasting preferences and quiet delivery: guidance review

Reviewed 2026-11-07 for the isolated `v1.3-decisions-integration` experiment. The live production configuration, intro, research workflow, and stored student records are outside this change.

## Coverage

Read all three saved references in full: `OPENAI_RESPONSES_REFERENCE.md`, `OPENAI_DECISIONS_REFERENCE.md`, and `OPENAI_CONVERSATION_STATE_REFERENCE.md`.

The three manifests contain 57 guide entries representing 36 distinct text snapshots after CRLF/LF newline normalization (51 byte-distinct files). All unique guide prose, tables, and fenced examples were reviewed. Exact duplicate text and repeated generated paragraphs/example lines were deduplicated under the user's existing permission; different versions were compared, including the newer preserved-reasoning paragraphs in the Decisions/conversation-state copies. Truncated tool output was reread in smaller ranges. This is a review of actual unique content, not just indexes or summaries, and not a claim that every duplicate expansion was read verbatim twice.

Guide prose and examples were divided among three reviewers. The companion [contract review](PREFERENCE_CONTRACT_REVIEW.md) covers the 53 non-guide manifest documents, generated API/SDK contracts, and its assigned guide examples. Together these reviews cover every manifest entry. No local document was unavailable. Relevant current official sections were checked separately; this is not a claim that every current web page was reread in full.

## Guidance applied to the implementation

| Guidance | Application to this experiment |
| --- | --- |
| Live thinking appends provide quiet facts; commentary asks for spoken content; instructions can interrupt behavior. | Deliver a short factual preference snapshot with `session.thinking.append`, a unique event ID, and `delegation_id: null`. Do not request another answer or change the intro. |
| Each append is limited to 500 tokens. | Use bounded templates generated from two typed preferences, never a raw transcript or model-generated instruction. |
| Thinking/commentary appends cancel all pending automatic acknowledgments, including other delegations. | Wait while research, delegation, selection, or other context delivery is pending. Do not use preference delivery to suppress normal research acknowledgments. |
| An append acknowledgment confirms estimated timeline insertion, not speech, playback, comprehension, or improved behavior. | Log attempted, acknowledged, rejected/unconfirmed, and later observed behavior separately. Never label an acknowledgment as a successfully improved answer. |
| Transcript deltas are fragments with approximate timestamps; there is no native transcript-done turn boundary. | Combine the application's completed-thought estimate with fresh browser playback idle and a quiet interval. Label this an application heuristic, not provider-confirmed completion. |
| New context may not affect an answer already in progress. | Keep ongoing preferences valid after an ordinary answer begins, but deliver only between thoughts. Do not delay a normal answer waiting for classification. |
| Decisions questions are independent classifications with probabilities, confidence, and possible refusal. | Treat explicit ongoing preference classifications as evidence. Unknown, refusal, malformed, low-confidence, one-off, quoted, or third-person requests leave preference state unchanged. |
| Later speech can change a request; stale and out-of-order results must be discarded. | Correlate preferences with the user turn, student/language scope, and revision. New speech pauses delivery; explicit corrections supersede earlier state. |
| App-owned state, Responses continuation, Conversations storage, and Live session context are distinct. | Store preferences only for this call and selected student/language. No new Conversations object, `previous_response_id`, binder lookup, or persistent student mutation is needed. |
| Removing application state does not erase earlier model context. | Send a newer bounded correction snapshot for an explicit withdrawal; scope any retained instruction to its student/language. Do not claim local reset retracts a prior append. |
| Live interruption does not cancel backend work; permissions and task state belong to the application. | Keep research observe-only and leave research execution/cancellation untouched. |
| Short, natural replies and ordinary follow-ups should remain conversational. | Limit support to explicit requests for plain language or one step at a time. Do not infer needs from being first-generation, speaking Spanish, or showing emotion. |
| Reuse known state and avoid unnecessary models/tools on the critical path. | Use the existing asynchronous observer. No new worker, preparatory research, or extra Responses rewriting pass is required. |

The proposed idle duration, confidence threshold, correction cooldown, and maximum attempts are Origen safeguards to test. OpenAI does not guarantee natural delivery from a particular timing number.

## Current official guidance checked

The following official pages were consulted for their current relevant sections after the local library review:

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): append events, 500-token limit, task IDs, session-wide acknowledgment cancellation, backend ownership.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations): transcript fragments, context timing, acknowledgments versus playback, opening behavior.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting): warm concise replies, spoken style, natural continuation during delegated work.
- [Decisions](https://developers.openai.com/api/docs/guides/decisions): independent questions, typed choices, uncertainty, thresholds, pricing/caching concepts.
- [Decisions for voice](https://developers.openai.com/api/docs/guides/decisions-voice): source-event correlation and handling newer context/out-of-order decisions.
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state): continuation and persistent storage are separate from application-owned call state.

No conflicting current contract was found for this scoped approach. Standalone Responses examples, Realtime examples, and native Live contracts must not be mixed. In particular, `response.steer`, Responses `response.create` request bodies, and Conversations storage are not quiet Live preference-delivery mechanisms.

## Validation requirements

Offline tests should cover explicit ongoing enable/disable/unchanged, one-off requests, ambiguity/refusal, quoted and third-person statements, source mismatch, stale/out-of-order classifications, assistant answers arriving before classification, new caller speech, intro and selection locks, incomplete thoughts, fresh versus stale playback, pending research/context, language/student changes, reconnect, duplicate delivery, failed/unacknowledged sends, and withdrawal after a previous successful append.

English/Spanish real-call validation should use fictional dialogue and real microphone-equivalent audio over WebRTC, allow Origen to answer normally, and record native transcripts separately from browser audio activity. A provider acknowledgment plus captured audio validates transport and timing; it does not prove causal conversational improvement. Two short calls are a smoke test, not a naturalness benchmark or a dependable latency percentile.

## Guide manifest checklist

The following entries were reviewed in full unique content; identical copies were checked by hash and divergent copies by their differing content. Paths are relative to each named library.

| Library | Document | Coverage |
| --- | --- | --- |
| responses | `pages/api/docs/guides/live-delegation.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/live-prompting.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/live-conversations.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/voice-server-controls.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/text.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/structured-outputs.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/function-calling.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/conversation-state.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/websocket-mode.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/tools.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/background.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/images-vision.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/tools-file-search.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/tools-computer-use.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/tools-web-search.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/tools-connectors-mcp.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/reasoning.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/prompt-caching.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/safety-best-practices.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/flex-processing.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/fast-mode.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/file-inputs.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/your-data.md` | Reviewed unique content |
| responses | `pages/api/docs/guides/streaming-responses.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/decisions.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/decisions-voice.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/function-calling.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/latency-optimization.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/live.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/live-conversations.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/live-delegation.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/live-prompting.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/private-link.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/prompt-caching.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/safety-best-practices.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/structured-outputs.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/voice-agents.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/voice-server-controls.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/voice-webrtc.md` | Reviewed unique content |
| decisions | `pages/api/docs/guides/your-data.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/compaction.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/conversation-state.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/function-calling.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/images-vision.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/live-conversations.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/live-delegation.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/preserved-reasoning.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/prompt-caching.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/reasoning.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/streaming-responses.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/structured-outputs.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/tools-computer-use.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/tools-connectors-mcp.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/tools-file-search.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/tools-web-search.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/websocket-mode.md` | Reviewed unique content |
| conversation-state | `pages/api/docs/guides/your-data.md` | Reviewed unique content |
