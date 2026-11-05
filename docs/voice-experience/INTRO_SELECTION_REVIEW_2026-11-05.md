# Student-selection intro review

Reviewed on November 5, 2026. Working branch: `v1.1`.

## What the two calls show

Read-only private diagnostics were compared for the requested intro windows. Times below are client-observed events, not precise acoustic boundaries.

| Observation | Preferred call `e14484d9-ae25-466f-b954-bdaf49e6d9ba` | Abrupt call `36793c30-8e72-4dec-9fcd-8bc6da9c1592` |
| --- | --- | --- |
| Initial opening | One scope question | General help question followed by scope question |
| After selection | Quick acknowledgment and a brief bridge to getting the information | Acknowledgments followed by an invitation before the recap |
| Student-context request | 2.645 seconds | 2.225 seconds |
| Configuration acknowledgment | 4.526 seconds | 4.364 seconds |
| Selection tool duration | 7.456 seconds | 6.853 seconds |
| Continuation | Short orientation, then one invitation | Invitation, then recap, then another invitation |

The preferred call was not faster at loading context. Its sequencing better matched a conversation. In the abrupt call, the first post-selection invitation ended at 20:09:52.975 UTC; another assistant fragment began at 20:09:53.525, about 0.55 seconds later. The recap began before the entire configuration was acknowledged at 20:09:55.232. An unclear input transcript overlaps that period; it does not establish what the caller intended to say. Diagnostics do not prove audio clipping.

The preferred call also began responding before the complete configuration acknowledgment and included repeated acknowledgments. It is a useful example of the desired flow, not proof that the earlier implementation guaranteed that flow.

## Earlier change (`9ea0816`)

The Live prompt explicitly requested an invitation while the first student selection loaded. The continuation policy did not explicitly request the intended short recap. Quiet context then became available while Live was already inviting the caller to speak.

The revised rules agree across startup instructions, brief guidance and the target-confirmation receipt:

1. Open with one scope question when scope is unknown.
2. After a name-only selection, give one quick, warm acknowledgment. Leave room for the caller, without an early generic invitation or repeated progress narration.
3. After successful selection, give one recap of at most two relevant facts in one or two connected sentences, then one invitation.
4. If the caller has started a question or concern, listen and answer it, using relevant brief details within that answer. Omit the separate recap and generic invitation.
5. If an invitation or recap was already delivered, do not repeat it. If meaningful brief facts are unavailable, omit the recap. General-family scope does not receive a student recap.

Context remains quiet. This change adds no lookup, timing gate, speech-forcing append, playback cancellation or transcript classifier. Existing authorization, acknowledgment tracking, native Responses continuation and later student-switch protections remain in place.

## OpenAI guidance reviewed

Read [OPENAI_RESPONSES_REFERENCE.md](OPENAI_RESPONSES_REFERENCE.md) in full, then consulted the current linked guidance relevant to this fix:

- [Responses overview](https://developers.openai.com/api/reference/responses/overview): separate the standalone Responses interface from Live's integration contracts.
- [Managing Live sessions](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model): context acknowledgment estimates delivery; it is not a speech or playback guarantee. The model can react before consuming the full update.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#interruptions): keep conversational directions clear, yield to interruptions and follow the latest request. Prompting does not guarantee exact interruption timing.
- [Delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update): quiet facts use thinking updates; spoken updates and behavioral directions serve different purposes. Preserve the native tool-result continuation.
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state): preserve the ongoing conversation rather than treating new context as a fresh exchange.

## Earlier validation

- Focused prompt, scope, brief, client-channel and selection tests: 144 passed.
- Server control and bilingual selection/refresh integration tests: 30 passed.
- TypeScript and Vite production build passed. The first attempt hit sandbox directory-read restrictions; the permitted local retry completed. Vite retained its bundle-size warning.
- Deterministic EN/ES scenarios include name-only selection, a caller question spanning context confirmation, a later same-student refresh, failed or superseded selection, and native tool continuation. They assert no additional speech request, cancellation, muting or caller-transcript replay.
- The existing prompt-size suite has 18 failing size assertions on unchanged baseline `7d0ea983` as well. Limits were not relaxed. Tool counts are unchanged; this is a separate existing prompt-size issue.
- No paid model calls were run. These checks validate prompt and transport behavior, not actual generated speech. The next voice test should cover name-only selection, a question spoken with the name, and a question started while the brief loads, in both languages.

Diagnostic revision: `natural-conversation-selection-recap-2026-11-05`.

## Follow-up: warmer, shorter intro

The next call, `6a4dfe1c-335c-4f09-935a-a9b2a24fcc85`, showed that the earlier prompt change was insufficient. Daniel reported rushed, unwarm delivery and confirmed that he said nothing after selecting Aiden. Transcript timestamps support the repeated opening, but cannot independently establish perceived warmth or exact speaking speed.

| Event | UTC time / duration |
| --- | --- |
| Final recorded student choice | 20:26:32.676 |
| Initial acknowledgment | “Okay—one moment.” |
| Extra status speech started | 20:26:34.468, before profile loading finished |
| Claim that the profile was available finished | 20:26:36.206 |
| Profile request actually finished | 20:26:36.406; 3.285 seconds |
| Quiet configuration acknowledged | 20:26:41.833; 4.509 seconds |
| Successful target receipt | 20:26:41.925 |
| Recap began after an earlier invitation | 20:26:43.920 |

The premature status claim preceded even the profile HTTP result; it was not caused by the completed brief interrupting speech. The backend's orientation also contained conflicting wording: it claimed a profile was already available and requested a familiar opening even when scope was unconfirmed. The late receipt then carried another generic recap/invitation instruction without explicit observations of the conversation during loading.

The current fix on `v1.1`:

- Removes the conflicting orientation instructions. Pending selection never claims readiness; an ongoing call leaves continuation to the existing receipt.
- Requests one timely, gentle acknowledgment, followed by listening. A ready brief is a casual continuation, never an urgent announcement.
- Narrows the recap to one main thread in one short sentence, then one short question. It does not ask the model to enumerate every known fact.
- Specifies unhurried articulation and brief natural sentence breaks, preserving that pace after results arrive. It does not add a timer or lengthen pauses.
- Sends a small, quiet pending-selection state, then enriches the existing confirmation receipt with observed speech during loading. If a question was already asked, the receipt leaves the floor with the caller. If new caller words arrived, it prioritizes listening and answering without a separate recap.
- Treats punctuation-only transcription as insufficient evidence of a new caller question. It does not claim to correct the underlying speech recognizer. Incomplete words remain fragments, not proof of a completed turn.
- Keeps the initial scope question separate from speech observed during the selection backend response, including when playback/transcript groups overlap.

There is still exactly one native Responses continuation per completed tool batch, with the original call ID. No additional model request, public research, forced speech, microphone muting, playback gating or session restart is introduced. Existing later-student-switch protections remain intact. The new `origen.selection.delivery` diagnostic records the chosen continuation path and timing, not a claim that speech was heard.

### Two-pass documentation review

Read the saved reference twice. Reviewed the explanatory content and relevant JavaScript/JSON contracts of all linked Responses guides twice, with an independent second pass of all four linked Live guides. Equivalent SDK examples in other languages were not needed for this TypeScript implementation. Rechecked the applicable sections before editing:

- [Live personality, pacing, and tool-call behavior](https://developers.openai.com/api/docs/guides/live-prompting): separate vocal delivery from conversational behavior, avoid repeated waiting announcements, audition the voice with its prompt.
- [Context delivery](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model): quiet context and its acknowledgment do not guarantee silence or completed playback.
- [Live tool continuation and updates](https://developers.openai.com/api/docs/guides/live-delegation): preserve function results and native continuation; use session-wide quiet updates with a null delegation ID in Responses mode. Client-only acknowledgment-delay configuration is not added to this Responses session.
- [One owner and playback tradeoffs](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live): keep one control owner; buffering speech adds latency and discarded audio still exists in model context.
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling): supply application-known state in the result rather than adding a second model call to reconstruct it.

### Current validation

- Initial focused regression run: 197 passed, including English/Spanish selection and real local control-socket tests.
- Follow-up client/prompt run after separating the old scope question: 137 passed, including two added fast-selection cases.
- Final server control run: 34 passed, including English/Spanish selection and background research over local WebSockets.
- TypeScript and Vite production build passed after the sandbox-limited attempt was rerun with permitted filesystem access. The existing bundle-size warning remains.
- No paid voice calls were run. These tests check state handling, prompts, authorization boundaries and transport behavior; actual pacing, warmth and listening quality still require an audio audition.

Diagnostic revision: `natural-conversation-gentle-intro-2026-11-05`. Changes are local and uncommitted; production has not been changed by this fix.
