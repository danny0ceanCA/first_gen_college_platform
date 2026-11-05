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

## Cause and change

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

## Validation

- Focused prompt, scope, brief, client-channel and selection tests: 144 passed.
- Server control and bilingual selection/refresh integration tests: 30 passed.
- TypeScript and Vite production build passed. The first attempt hit sandbox directory-read restrictions; the permitted local retry completed. Vite retained its bundle-size warning.
- Deterministic EN/ES scenarios include name-only selection, a caller question spanning context confirmation, a later same-student refresh, failed or superseded selection, and native tool continuation. They assert no additional speech request, cancellation, muting or caller-transcript replay.
- The existing prompt-size suite has 18 failing size assertions on unchanged baseline `7d0ea983` as well. Limits were not relaxed. Tool counts are unchanged; this is a separate existing prompt-size issue.
- No paid model calls were run. These checks validate prompt and transport behavior, not actual generated speech. The next voice test should cover name-only selection, a question spoken with the name, and a question started while the brief loads, in both languages.

Diagnostic revision: `natural-conversation-selection-recap-2026-11-05`.
