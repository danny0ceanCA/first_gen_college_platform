# Phase 6: Flexible conversation flow

`flexibleVoiceFlow` in `src/voiceStyle.mjs` replaces the earlier follow-up paragraph.
It is shared by every specialty, welcome override and in-place update. The guide
follows the latest understandable request, correction or interruption, including
a topic change during research, rather than forcing an obsolete explanation.

There is no mandatory acknowledge-answer-example-question sequence. A useful
answer can end without a question. Connected steps requested by the person do
not require repeated permission prompts. Sentence counts are defaults, not caps
on requested detail; the duplicate two-to-three-sentence policy was removed.
The finance guide no longer requires the exact “I gave you too much at once” apology.

Follow-ups are limited to one useful question about genuinely missing context or
an explicitly requested next step. Known answers, comprehension checks and examples
should not be repeated. Thanks or a simple acknowledgement does not require a
new lesson. A request for a moment, or “that's all,” calls for a brief acknowledgement
and space to respond, without automatically ending the live session or claiming
that a summary saved. Silence is still not agreement.

This flexibility preserves required onboarding identity, scope confirmation,
source verification and app-confirmed saves. Phase 3 options remain conditional,
not a menu at every transition. The existing turn controller queues understandable
interruptions and research follow-ups; specialty/language changes keep the same
audio session. Student changes retain the existing privacy boundaries.

## Validation and listening

Tests cover policy delivery across guides, roles and languages; welcome overrides;
scope and save tools; interruptions/corrections during research producing one queued
reply; and Spanish/specialty updates preserving context without replacing audio.
Existing memory prompt bounds and evaluation contracts remain enforced. This phase
adds no model call, research lookup, schema or fixed dialogue state machine.

Prompt and event tests do not prove spontaneous spoken behavior. Listen to:

- A direct question: a direct answer without an obligatory follow-up.
- “Shorter” or “more detail”: adapt immediately, retaining essential conditions.
- “I'm confused”: a smaller explanation without a repeated stock apology.
- A new question while research is pending: address the latest request when results return.
- An English-to-Spanish topic change: continue naturally, without Hola or audio reset.
- “Thanks,” “give me a moment,” or “that's all”: brief acknowledgement, no new lesson.
- An unresolved parent scope or requested profile save: required safeguards still apply.

Actual listening quality, latency and cost measurement belong to the next evaluation
phase; no live-audio quality or cost reduction is claimed from these checks alone.
