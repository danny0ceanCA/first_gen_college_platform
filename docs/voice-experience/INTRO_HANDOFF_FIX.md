# Natural introduction and student selection

November 5, 2026 — local changes on `v1.1`.

## Finding

Session `18129d26-2fbf-44dd-92c3-df3c685731b2` had roughly 15.6 seconds between the caller saying Aiden and the start of the useful follow-up. The application loaded context, replayed the speech prompt through many instruction appends, updated the backend, then continued the tool response. The intervening speech was fragmented. Transcript and application timestamps are estimates of speech timing, not verified microphone-to-speaker measurements.

## Guidance reviewed

Read [OPENAI_RESPONSES_REFERENCE.md](OPENAI_RESPONSES_REFERENCE.md) completely, then reviewed the current official Responses overview and relevant Live guidance:

- [Context delivery and appends](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model): context acknowledgment is separate from spoken delivery; initial context belongs at startup.
- [Choosing an update event](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update): factual context can arrive quietly; instruction appends can interrupt speech.
- [Conversational prompting and delegation](https://developers.openai.com/api/docs/guides/live-prompting#delegation): ordinary conversation can remain with Live while the backend handles authorized work.

## Implementation

| Before | After |
| --- | --- |
| Full speech policy and student facts replayed as instructions after selection | Stable conversational policy at startup; student facts arrive through quiet context |
| Representative parent selection generated 31 instruction appends | Ordinary parent selection generates no instruction appends; actual language changes and newly applicable mandatory workflows retain their instructions |
| Any new caller turn could invalidate an already accepted initial selection | Ordinary follow-ups preserve loading; an explicit different selection supersedes and queues behind the old operation |
| Neutral and screen-selected student prepared | Also prepare one other named student, sequentially, within the existing three-handle cache |
| Backend configuration acknowledgment alone reported readiness | Require matching backend and voice-context acknowledgments; expire incomplete updates after ten seconds and reject late acknowledgments |

The first name-only selection permits one warm question about the caller's priority while loading, based only on what the caller has said. The completed receipt follows the latest question and does not repeat that invitation. No proactive history recital was added.

Student/account authorization, freshness checks, corrections, mandatory consent readbacks and cross-student handoff protections remain. Stale tool proposals made before a clear selection is accepted still require backend reevaluation; an ordinary follow-up is not permission to bypass that guard. Research delivery behavior is unchanged.

## Validation and limits

- English/Spanish transport and server tests cover ongoing speech during selection, quiet factual delivery, acknowledgment order, a single backend continuation and no forced new speech.
- Tests cover missing/rejected acknowledgments, late updates, explicit student corrections, duplicate selection, closure, preparation bounds and language changes.
- Disposable local PostgreSQL tests use synthetic records and verify prepared-context reuse, invalidation and account/student isolation. No production database changes or paid model calls.
- Production build and TypeScript checks pass. The build retains its existing large-chunk warning.
- The older broad prompt-budget suite has existing failing limits on the base commit; its unrelated caps were not raised. Moving stable policy earlier increases the unconfirmed-parent startup prompt, so first-greeting latency remains a live-validation metric.

These tests validate orchestration, not how a real model sounds. A fresh voice test must measure time to the first useful reply, interruption/fragmentation after selection, repeated invitations, and later research delivery. No new live latency result is claimed. Use client revision `natural-conversation-smooth-selection-2026-11-05` to identify the updated adapter.

No commit, push or deployment is part of this change.
