# Completed research without a stalled conversation

November 5, 2026 — local changes on `v1.1`; intro and student-selection behavior preserved.

## What the reviewed call shows

Session `82e1f7ea-9757-4ef8-aafd-18d1c73af388` completed its first Berkeley source check at 19:47:24 UTC after about 47.4 seconds. Tuition was verified, but the full budget was unresolved. The terminal evidence reached Live, yet later speech promised continued checking without an active job. The next job began only after the caller asked “Anything?” and finished about 24.8 seconds later.

A correction to the earlier review: the later saved **transcript deltas** do contain the off-campus total, $49,692, at about 19:49:07–10 UTC. The call ended without a final transcript-completion event for that utterance. This establishes generated words, not independently verified playback. The observable problem is stale progress language, delayed follow-through, and unnecessarily repeated figures; it is not evidence that the total was never generated.

These amounts describe the historical test and are used as regression fixtures, not current college-cost advice. The intro from the subsequent session `e14484d9-ae25-466f-b954-bdaf49e6d9ba` is the experience to preserve.

## Changes

- Send a compact, explicit task state to Live. Completed or failed checks have `researchPending: false`; a missing fact does not imply continuing research or that the figure is unpublished.
- Pass terminal app state to the managed Responses conversation as a passive message. This replaces the stale pending receipt without generating a response, repeating a tool result, or starting a lookup.
- Give the voice contribution the focused answer, subject, and full qualification when they fit. The historical off-campus finding fits in 454 UTF-8 bytes. Oversized evidence remains complete in quiet context, with a bounded reference for delivery.
- Allow newly obtained requested evidence to contribute after a partial answer. An unchanged finding or status-only update remains quiet. Observed speech and provider context acknowledgments remain distinct diagnostics.
- Preserve a total-budget request when the caller narrows its living scenario. Explicit requests for housing alone still select housing, not the total.
- Clarify that a caller-requested missing fact can be delegated, while ordinary explanations and status questions use existing state. A promise alone never counts as a running lookup.

The changes add no research worker, database migration, speech interruption, forced response timer, or extra model call. The existing checks for caller speech, playback, student scope, cancellation, and duplicate findings remain in place. The intro prompts, opening trigger, and selection flow are unchanged. Diagnostic adapter revision: `natural-conversation-research-completion-2026-11-05`.

## OpenAI guidance reviewed

Read [OPENAI_RESPONSES_REFERENCE.md](OPENAI_RESPONSES_REFERENCE.md) in full, then consulted current official guidance before editing:

- [Delegation: choosing updates and tracking task state](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update): quiet context and speakable results serve different purposes; report verified task state.
- [Live context timing](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model): an append acknowledgment does not prove spoken delivery or playback.
- [Live backend input items](https://developers.openai.com/api/reference/resources/live/primary-websocket): `response.item.create` queues backend input; `response.create` separately requests generation. No new generation is requested for a terminal state update.
- [Prompting during tool calls](https://developers.openai.com/api/docs/guides/live-prompting#personality-during-tool-calls): report supplied state and results, avoid invented progress, and keep useful conversation brief.

## Validation and limits

All 309 targeted checks pass. English/Spanish offline replays cover a pending check, ordinary conversation, terminal partial evidence, a newly verified off-campus total, and duplicate suppression. Tests also cover complete qualifications, unchanged recovery results, explicit housing-only questions, stale versions, no automatic new lookups, and the existing intro and scope-selection behavior. The production build passes.

The separate prompt-budget suite has 18 existing failures at baseline commit `dd2eaff`, independently reproduced without these changes. Its limits were not raised. English planning already measured 29,965 speech characters and 63,391 backend characters; this research clarification adds 531 and 455 respectively. Broader prompt reduction is outside this fix so the approved conversational setup is preserved.

No new paid voice test was run. Offline checks verify application behavior, not acoustic warmth or a guaranteed spoken response. A fresh call should confirm that terminal state is respected, the requested result is woven in at a natural pause, and the preferred intro still sounds right. Nothing was committed, pushed, or deployed as part of this change.
