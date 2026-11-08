# Local conversational-support contract review

Date: 2026-11-07. Branch: `v1.3-decisions-integration`.

This review supports the isolated local experiment only. It does not authorize production changes, paid calls beyond the existing ledgers, new research actions, or changes to the established opening.

## Review coverage

The preceding work in this chat completed a full unique-content review of all 110 manifest pages: 45 Responses, 30 Decisions, and 35 conversation-state pages. The user authorized reviewing shared generated schemas once per unique contract rather than repeatedly reading identical copies. This review reuses that completed review; it does **not** claim a second fresh full reading of every page today.

Before this experiment, every manifest file was read for integrity verification: UTF-8 BOM removed, line endings normalized to LF, and SHA-256 checked against the manifest. All 110 matched; no page was missing or changed. The three saved top-level references were reread in full. The full Live delegation and conversation-state guides were reread, with focused rereading of Live session startup, transcript boundaries, context injection, Decisions typed classification, and native Decisions integration. Current official pages were checked against the saved contracts on 2026-11-07. Relevant current contracts agreed with the saved copies; this was not a complete resnapshot of all official pages.

Prior complete-review record: [broad observation review](../BROAD_OBSERVATION_REVIEW.md). Local sources: [Responses reference](../../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md), [Decisions reference](../../../docs/voice-experience/OPENAI_DECISIONS_REFERENCE.md), and [conversation-state reference](../../../docs/voice-experience/OPENAI_CONVERSATION_STATE_REFERENCE.md).

## What the contracts require

| Contract | Implication for this experiment |
| --- | --- |
| A thinking append supplies factual context without requesting an immediate spoken announcement. Instructions can redirect speech; commentary asks for speech. | Optional conversational support should be short factual context, not an interrupting instruction or a scripted additional answer. |
| Thinking and commentary appends cancel all pending automatic delegation acknowledgments, including unrelated delegations. | An apparently quiet update can still affect the research experience. Do not send optional support while delegation/research delivery may own that acknowledgment. |
| Context acknowledgments identify estimated context delivery, not model use, speech, or browser playback. | Record candidate creation, send, provider acknowledgment, transcript, and playback as different evidence. An acknowledged cue is not proof that the caller heard its effect. |
| Input and output transcripts arrive as fragments, can overlap, and do not expose an authoritative completed-turn event. | Application turn boundaries remain estimates. New fragments invalidate earlier candidates; absence of a fragment is not proof of silence. |
| Primary connections must finish startup before append events. Session-wide context uses `delegation_id: null`; append content is a plain string with a 500-token limit. | Preserve startup and the existing student introduction. Send only after the current session is established and application gates allow it, with a unique event ID and a small fixed content template. |
| Decisions returns typed assessments, not generated guidance or permission to act. Thresholds need labeled examples. | Restrict enabled choices to the validated conversational-support subset. Refusal, uncertainty, malformed output, and unsupported research/comparison categories produce no cue. |
| Application state, Responses continuation, Conversations storage, and Live session state are separate. | Keep scope, question revision, and latest transcript fingerprint in the application. No new Conversations object, Responses chain, or native Live trigger is needed for this local adapter. |

The current official sources for these contracts are [Managing GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations), [Delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation), [Decisions](https://developers.openai.com/api/docs/guides/decisions), and [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state). Relevant native integration reference: [Connect voice to Decisions](https://developers.openai.com/api/docs/guides/decisions-voice).

## Recommended local delivery design

Keep the existing voice engine responsible for its ordinary reply. The independent observer may suggest one of three factual observations: the caller wants a starting point, a simpler explanation, or a manageable next step. The application chooses whether the suggestion is still timely. For example: “The caller's latest request is for a simpler explanation of the current topic.” This conveys observed intent without scripting speech, adding research, or demanding an extra turn.

Use a small allowlisted adapter outside the production voice controller. Its only possible provider action is one short `session.thinking.append` with `delegation_id: null`. Do not give the classification worker a general provider socket or a tool-execution capability. Do not send raw model explanations, arbitrary transcript text, research classifications, or code-selected speaking instructions to Live.

Immediately before sending, check the current call, student, language, scope generation, question revision, and transcript fingerprint. Also check startup/intro completion, current connection, known browser playback state, recent input/output activity, pending context delivery, and active delegation/research delivery. A candidate invalidated by a new utterance, an answer already beginning, a changed student, disconnect, or expired deadline should be dropped. Do not keep a queue that can resurrect an old cue later. When safe timing cannot be established, the ordinary model reply remains the fallback.

The adapter must never await Decisions in the audio or normal reply path. A slow, failed, over-budget, or disconnected observer has no reason to delay speech. Use a per-turn deduplication key, a bounded session count, and a cooldown to keep support occasional. Reconnect must invalidate the old candidate and its session-scoped event IDs. A provider acknowledgment timeout is an ambiguous delivery outcome: log it and do not retry the same support automatically.

Research remains observe-only in Decisions. Existing research can still run through the established architecture; this adapter cannot start, cancel, revise, suppress, or announce research. Because even a thinking append has the acknowledgment side effect above, the conservative initial behavior is to skip support when research/delegation is active. Supporting conversational cues during research is a separate timing expansion that requires evidence about acknowledgment ownership.

## Comparison with the existing local bridge

The existing local wrapper constructs the original voice controller first, copies bounded event projections to a worker, and isolates worker failures from voice. Keep those properties. Its worker currently logs classifications only and its observer already invalidates stale snapshots. The added behavior should be a narrow local callback from a validated observation to the adapter, followed by a second freshness check on the main thread. Checking only inside the worker would leave a race between classification completion and new caller speech.

The bridge already records native transcript fragments and application-completed transcript events separately. Preserve that distinction. Browser playback can validate that the browser reports busy/idle, but it cannot prove which words reached the listener. Log the provenance and version of this signal rather than converting it into “caller heard answer.”

## Validation needed

| Scenario in English and Spanish | Expected result |
| --- | --- |
| Caller requests a simple explanation after the intro | At most one short factual support cue when still timely; normal reply is never held. |
| Caller is unsure where to begin | Eligible only after opening/student selection is complete; no replacement greeting or repeated recap. |
| Caller asks for one manageable next step | Supported without a new research request or automatic saved action. |
| Origen already addressed the request | No additional cue. |
| A new question or partial transcript arrives during classification | Candidate dropped as stale. |
| Origen begins answering before classification finishes | No interruption and no delayed second answer. |
| Research starts or a result is being delivered | Research classifications stay observation-only; optional support does not steal acknowledgment ownership. |
| Student/language changes, reconnect, unknown playback, or observer failure | No stale injection; original conversation continues. |
| Duplicate result, provider error, or missing append acknowledgment | One send at most; explicit outcome logging without blind retry. |

Offline replay can verify these gates, payloads, and isolation. Real Decisions calls can verify classifications. Neither proves warmth, timing, or perceived interruption in actual audio. A microphone call must separately establish that the local cue reaches Live, that the first useful reply remains timely, and that the intro, research flow, and voice delivery still feel natural. No percentage improvement should be inferred from classification accuracy alone.

## Final implementation review

The local implementation now uses this conservative policy:

- Support is explicitly enabled by the local launcher and requires approved classification. Production rejects the local wrapper. The worker remains an observer and sends only an allowlisted candidate to the main thread; it has no Live connection or research-execution capability.
- Only `starting_point`, `simpler_explanation`, and `next_step` can produce one fixed English or Spanish note. Required thresholds are selected probability at least 0.90, confidence at least 0.85, and already-addressed probability at most 0.10 with `alreadyAddressed === false`. These are experimental application thresholds, not promises of calibrated accuracy.
- Each candidate must still match the active call, selected student, latest user transcript, question timestamp, and main-thread generation. Its question must be no more than four seconds old. New speech, context commands, scope changes, or disconnect invalidate it.
- The browser must report idle playback within 1.5 seconds. The existing browser channel supplies a heartbeat every 500 milliseconds; this does not require changing browser audio behavior. Unknown or busy playback blocks support.
- Native delegation IDs are tracked separately from backend response IDs. A completed backend cannot clear a different pending delegation. Active research, pending delegation/backend work, and unacknowledged context appends block the optional cue.
- The initial already-confirmed session can complete its existing supplied intro through an assistant transcript boundary followed by fresh idle playback. A later student selection sets an additional fence: the original controller's selection receipt must arrive, followed by a **new** assistant boundary and idle playback. A quick acknowledgment before the receipt, or the provider's context acknowledgment alone, cannot unlock support. The existing caller-first selection path resets this readiness so the normal answer gets priority.
- At most two notes can be sent per call, at least 30 seconds apart, with one attempt per question. There is no waiting queue, delayed delivery timer, or automatic resend. The ordinary voice response never awaits classification.
- Sent, acknowledged, rejected, skipped, and unconfirmed outcomes have separate logs with no playback claim. A missing acknowledgment is logged once after ten seconds on subsequent activity/status checks, or on suspension/close. It remains a blocking fence rather than triggering a retry.

An independent reread of `support.mjs`, `session.mjs`, and `worker.mjs` after the intro-fence changes found no new blocking integration issue. The wrapper receives the existing selection lifecycle events through the unchanged server controller, so the receipt fence is connected to the actual local call path. The former early-intro readiness concern is covered by the revised gate and regressions.

Reverification command: `node --test research/decisions/local-call/support.test.mjs research/decisions/local-call/session.test.mjs`. Result: **47 tests passed, 0 failed**, including English/Spanish event preservation, quiet payloads, cross-student fencing, mid-answer research observation, pending-delegation isolation, quick acknowledgment before recap, caller-first selection, and uncertain delivery. These are offline checks; they do not substitute for observing actual voice behavior. No paid request was made by this review.
