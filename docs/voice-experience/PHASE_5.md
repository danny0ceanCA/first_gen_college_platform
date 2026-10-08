# Phase 5: Truthful, bounded research updates

The live client uses `src/voiceResearchProgress.mjs` for delayed spoken updates
only on uncached, permitted research requests. Fast responses, cache hits, invalid
arguments and research-budget rejections do not start a spoken progress timer.

An update becomes eligible at 10 seconds; a second at 35 seconds. Busy assistant
audio, user speech and pending transcription defer it through the existing turn
controller. There are at most two updates per lookup and three per physical call.
Messages vary without invented reading details, findings, estimated completion
times or repeated “hmm.” Their language is read when the update is sent, so a
language change does not leave the next status in the earlier language.

The guide may say it is checking sources, that the check is taking longer, or that
it is waiting for the check to finish. The backend request is opaque to the client;
these messages do not claim to know which page the research model is reading.
The existing visual status remains available after the spoken allowance is used.

Progress responses remain outside conversation history (`conversation: none`),
cannot call tools, and request the same voice, volume and pace with no greeting.
Existing turn handling cancels them on speech and waits before delivering the
final answer. A failed send or closed transport no longer leaves a nonexistent
progress response blocking the research reply. Completion, errors, call cleanup
and obsolete call generations stop future updates.

Tool output now distinguishes `reused_verified_result` from `source_check_completed`
and retains evidence, sources and the original check timestamp. The guide must
not claim a fresh search for cached evidence or findings before a returned result.
It still explains only supported facts, preserves uncertainty, and acknowledges
failed verification. Source links are visible rather than read aloud.

## Cost and validation

Spoken updates are audio model responses and consume tokens; they are not free.
The call-wide cap reduces the previous allowance of three updates per lookup.
This phase adds no research requests or new model/provider and does not change
the research cache, verification rules or lookup budget.

Fake-clock tests cover fast results, delayed variation, call/lookup limits,
busy speech, language changes, cleanup and stale timers. Tests also cover evidence
reuse and progress transport failures. Existing interruption/history tests ensure
status audio is excluded from saved conversation content and serialized with the
answer. Build and contract tests do not establish perceived audio quality.

Listen before release with a slow lookup, a cache hit, a failed lookup, Spanish
after an English start, and a user interruption during a status. Confirm a brief
truthful update, no duplicate narration, stable volume and a natural final answer.
