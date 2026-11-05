# Complete the selection acknowledgment

Branch: `v1.1`. Diagnostic revision: `natural-conversation-complete-acknowledgment-2026-11-05`.

## Observed problem

In session `b0825b25-3ed0-4525-bb66-7dd0e16f77d2`, the acknowledgment ended with an unfinished clause about getting the selected student's information. This happened before the confirmed brief was supplied. A redundant selection-pending thinking append was sent during the acknowledgment. The archive establishes that timing, but does not prove that this append caused the audio cutoff.

The adapter's estimated speech-completion event updates transcript/UI state; it does not stop the audio track. There was no reason to change playback timers or transport for this fix.

## Changes

- Keep pending selection observations local. Dispatch no longer injects a status packet into an unfinished acknowledgment.
- Ask for one complete, gently spoken acknowledgment, such as “Of course.” or “Claro.”, without extending it into a promise to fetch information.
- Distinguish background updates from caller interruptions. Finish the short thought already underway before using background context; yield immediately when the caller interrupts.
- Preserve authorization checks, the compact confirmed brief, the existing single Responses continuation, and caller-first behavior before and after the receipt. No new delay, speech request, buffering, or model call was added.

## Guidance reviewed before editing

Read [OPENAI_RESPONSES_REFERENCE.md](OPENAI_RESPONSES_REFERENCE.md) in full and read the linked page content, including the Responses overview, quickstart, text and images, structured outputs, function calling, conversation state, WebSocket mode and tools. Reviewed the relevant Live guidance against the current implementation and checked current official pages.

The sections applied to this change were:

- [Live prompting: interruptions](https://developers.openai.com/api/docs/guides/live-prompting#interruptions) and [personality during tool calls](https://developers.openai.com/api/docs/guides/live-prompting#personality-during-tool-calls): separate a short acknowledgment from listening; preserve the caller's ability to interrupt.
- [Live delegation: update types](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update): avoid unnecessary steering and use quiet context for facts. Client-delegation acknowledgment suppression is not a setting for this managed Responses flow.
- [Context timing](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model): context delivery acknowledgment is not proof of completed speech or playback.
- [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live): preserve a single action owner and direct playback. Audio buffering would add latency and is unnecessary here.

## Validation

- 143 selection observer/channel tests passed, including new English/Spanish acknowledgment-fragment cases across dispatch and delayed configuration. No provider context or speech-control event is emitted by pending tracking; successful selection still supplies one quiet brief and resumes Responses once.
- 77 session, selection-timing, voice-control, brief and receipt tests passed. These include existing caller-first, research-delivery, authorization and provider-voice checks.
- TypeScript/Vite production build passed. Vite required its usual filesystem access; the existing bundle-size warning remains.
- No paid voice calls were run. Simulated transcript and playback-state tests cannot prove audible phrase completion or warmth. Review the next actual call with this revision, including caller interruption during acknowledgment and a question arriving before the recap.

This is a targeted reduction in avoidable interference, not a guarantee that prompting can prevent every provider-side audio cutoff.
