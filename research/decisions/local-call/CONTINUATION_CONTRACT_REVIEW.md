# Confusion and continuation contract review

Reviewed November 7–8, 2026, for the isolated local v1.3 experiment. This document records development preparation; it is not runtime model context.

## Coverage

- Reviewed all 53 non-guide manifest entries across the Responses, Decisions, and conversation-state libraries twice, using the previously authorized deduplication of repeated generated schemas. The review corpus contains 8,641 unique lines, including differing fields, descriptions, event semantics, and examples. Both passes covered lines 1–8,641; truncated tool output was reread in bounded chunks.
- Read all three saved references completely twice: `OPENAI_RESPONSES_REFERENCE.md`, `OPENAI_DECISIONS_REFERENCE.md`, and `OPENAI_CONVERSATION_STATE_REFERENCE.md`.
- Also read the complete older Responses reasoning guide (guide checklist ID 17) twice, including every SDK example and its final use-case links. The separately reviewed current reasoning variant (ID 36) covers the current official changes.
- Downloaded every unique current official source represented by those non-guide entries: 40 URLs. All 40 full contents matched the saved snapshots after CRLF normalization and trimming; no changed or unavailable pages. Both content-review passes therefore also cover the current versions. The local verification ledger is `.local/current-contracts-check.json` and the retrieval helper is `.local/check-current-contracts.mjs`.
- Guide pages, the local audit/measurement documents, and reference-only guide links are reviewed separately by the main implementation review. This record does not claim recursive review of every outbound hyperlink in the OpenAI documentation.
- No runtime code was changed before these contract passes. Initial sandboxed downloads failed; the read-only network retry succeeded for all 40 URLs.

## Contracts applied to this change

| Official contract | Application decision |
| --- | --- |
| [Decisions creation](https://developers.openai.com/api/reference/resources/decisions/methods/create) supports 1–400 independent questions with ordered typed answers, distributions, confidence, and per-question refusals. | Add two independent classifications to the existing ten-question local request. Validate identity, types, distributions, confidence, and refusals. Do not add a dependent model call. |
| [Decisions guide](https://developers.openai.com/api/docs/guides/decisions) recommends observable criteria and evaluation on application examples. | Anchor confusion and conversational acceptance to the latest caller contribution, with bilingual positive, negative, incomplete, and correction cases. Do not infer confusion from demographics or language. |
| [Live primary event reference](https://developers.openai.com/api/reference/resources/live/primary-websocket) defines transcript deltas without completed-turn events. | Treat locally assembled complete turns and idle boundaries as application estimates, retaining provenance and freshness checks. |
| `session.thinking.append` supplies quiet context, at most 500 tokens; it does not directly request speech. | Temporary explanation support can be supplied quietly only through the existing safe-delivery gate. Do not turn temporary confusion into an ongoing preference. |
| `session.instructions.append` can redirect conversation and persists through compaction. | A recovery instruction must be narrowly scoped, current, bounded, and sent only after safe idle checks. Never use it to cut off an existing answer. |
| Append acknowledgments confirm timeline acceptance, not behavior, exact speech, hearing, or completed playback. | Keep attempted delivery, acknowledgment, transcript, and audio evidence separate. Never report that support was heard merely because an append was acknowledged. |
| Any thinking/commentary append cancels all pending automatic delegation acknowledgments. | Do not continuously send status updates; inject only a useful fresh change and preserve pending research state in application-owned records. |
| Sideband attachment does not replay earlier events; reflected audio is PCM16LE at 24 kHz. | Preserve connection epochs and gaps; do not interpret missing events as proof of silence or a finished thought. |
| Live delegation, standalone Responses continuation, and Conversations storage have separate contracts. | Keep the classifier on standalone Decisions. No new Conversations storage, Responses steering, Live trigger mode, or research execution is needed. |

## Classification interface

`conversationSupport.confusion` contains an action, confidence, and selected probability. Actions are `needs_simpler_explanation`, `resolved`, `topic_changed`, `none`, or `unclear`.

`conversationSupport.continuation` contains the same metrics. Actions are `accepted_conversational_offer`, `declined`, `none`, or `unclear`. Acceptance is limited to an immediately preceding offer to explain, give an example, or discuss the next step. A brief acknowledgment after facts does not establish acceptance. Offers to research, apply, submit, send, save, purchase, or perform another external action are excluded. This classification cannot authorize consequential actions.

The existing two explicit ongoing style preferences retain their separate semantics. Confusion is temporary and scoped to the current question; a clear resolution or topic change must prevent it from following the caller into an unrelated subject.

## Verification limits

Offline schemas and authored bilingual cases validate request construction and classification handling. Real Decisions tests can measure classification accuracy and latency. Neither proves that a human heard a naturally timed response. End-to-end microphone/playback tests remain necessary to evaluate the complete spoken interaction.
