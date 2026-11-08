# Earlier Decisions support: guidance review

Branch: `v1.3-decisions-integration`. Scope: the isolated local experiment. This document records development preparation and design decisions; it is not model runtime context.

## Review coverage before editing

The team completed the library review before the implementation gate opened. Coverage was split across reviewers rather than represented as one reviewer independently reading every page. The user-approved method reviews all unique content and checks duplicate snapshots for differences.

| Library | Manifest entries | Checklist |
| --- | ---: | --- |
| Responses | 45 | [Responses manifest](../../../docs/voice-experience/responses/manifest.json) |
| Decisions | 30 | [Decisions manifest](../../../docs/voice-experience/decisions/manifest.json) |
| Conversation state | 35 | [Conversation-state manifest](../../../docs/voice-experience/conversation-state/manifest.json) |
| Total | 110 | All three manifests report no unavailable saved pages. |

The review inventory contains 37 distinct guide snapshots after duplicate guide content is accounted for, plus 53 non-guide entries. The non-guide review covered 8,641 lines of unique contracts, including schema differences, event descriptions, and examples. These are different counts: manifest entries are not the same as unique documents or unique contract lines.

The guide assignment was recorded in `research/decisions/.local/continuation-guide-review-index.json`. The early-delivery reviewer read guide IDs 0–3, 7, 17, and 25–36: Live delegation, prompting, sessions, server controls, Decisions, voice triggers, function calling, reasoning, latency, Live setup, Private Link, voice agents, WebRTC, compaction, conversation state, and preserved reasoning. The function-calling and reasoning variants were checked using the complete earlier bodies plus the complete differences. Truncated reads were recovered in smaller chunks. Other reviewers covered the remaining guides and the non-guide contracts; the main reviewer reconciled coverage before authorizing edits.

The saved [Responses reference](../../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md), [Decisions reference](../../../docs/voice-experience/OPENAI_DECISIONS_REFERENCE.md), and [conversation-state library](../../../docs/voice-experience/conversation-state/README.md) were included in the preparation. The [earlier contract review](CONTINUATION_CONTRACT_REVIEW.md) preserves the broader two-pass contract inventory and current-source comparison record. That document describes the prior completed-turn classifier; its twelve-question request is not the new early classifier.

## Current official comparisons

For the early-delivery assignment, the relevant current official content was checked against the saved snapshots and implementation:

| Current official guidance | Verified requirement | Consequence for this experiment |
| --- | --- | --- |
| [Connect voice to Decisions — transcript triggers](https://developers.openai.com/api/docs/guides/decisions-voice#react-to-transcripts) | Input/output transcript triggers run independently of delegation. Results identify a source transcript event, pending deltas can be combined, and results can arrive out of order. | Preserve the existing research delegation. Use exact native source-event provenance and the newest matching evidence revision. The local experiment does not require switching to Decisions delegation. |
| [Live delegation — react to transcript fragments](https://developers.openai.com/api/docs/guides/live-delegation#react-to-transcript-fragments) | Application logic or a lightweight model may process meaningful accumulated transcript text before delegation. Later speech can change the request; outdated results must be discarded. | Begin optional interpretation before the application finishes grouping a caller turn. Corrections and further input invalidate old in-flight classifications. |
| [Live delegation — choose the update type](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update) | Thinking appends provide quiet context; commentary asks for spoken paraphrasing; instructions may interrupt. Appends have a 500-token limit. Their acknowledgments do not prove speech or playback. | Send only a short, fixed, current-reply thinking note. Never use this path to request speech, announce that confusion was detected, or interrupt a response. Keep attempted delivery and provider acknowledgment separate from audio evidence. |
| [Live delegation — automatic acknowledgments](https://developers.openai.com/api/docs/guides/live-delegation#suppress-automatic-acknowledgments-while-tools-run) | A thinking or commentary append cancels all pending automatic acknowledgments. It does not stop existing audio or prevent independent model speech. | Retain the existing delegation/context fences. Do not append continuously, and do not describe a quiet append as guaranteed silence. |

Additional saved guidance read in full includes [managing Live sessions](../../../docs/voice-experience/responses/pages/api/docs/guides/live-conversations.md), [server controls](../../../docs/voice-experience/responses/pages/api/docs/guides/voice-server-controls.md), [voice-agent evaluation](../../../docs/voice-experience/decisions/pages/api/docs/guides/voice-agents.md), and [Decisions classification](../../../docs/voice-experience/decisions/pages/api/docs/guides/decisions.md). These establish the distinction between transcript fragments, application-estimated boundaries, output generation, and actual playback, and the need to evaluate thresholds with representative examples.

This record claims the current official checks listed above, not a recursive fresh reread of every outbound hyperlink contained in the documentation.

## How the contracts shaped delivery

- **Partial speech is not a completed turn.** Native transcript fragments remain provisional. Semantic readiness means enough meaning exists to classify support; it does not mean the caller stopped speaking or gave permission to interrupt. The application’s completed-turn timer remains unchanged.
- **Evidence must still match when used.** Delivery compares call, student, language, connection epoch, scope epoch, contribution ID, revision, and the exact ordered source-event IDs. Further words, corrections, scope changes, and reconnects invalidate old candidates. Both the support choice and semantic-readiness choice need sufficiently confident results.
- **The live response never waits.** Optional classification runs alongside the conversation. If assistant audio or transcript output begins first, this path misses its opportunity. Later idle or a completed-turn boundary cannot reopen that contribution for a support append.
- **Useful observations can survive locally.** A temporary explanation need may remain in application state for 90 seconds or three subsequent caller contributions. A fresh classification must confirm that a follow-up concerns the same unresolved idea before support is reused. Resolution, a changed topic, expiry, or changed scope clears it. This is neither a student profile update nor a permanent preference.
- **Delivery is bounded and quiet.** Only fixed English/Spanish current-reply notes leave this controller. It permits at most four write attempts per call, with a 2.5-second cooldown. Intro, student selection, output, browser playback, delegation, and context fences still apply. An ambiguous write is logged and never retried.
- **Logs describe evidence, not certainty about hearing.** Source timing, classification timing, state changes, deferrals, attempts, and acknowledgments can be correlated. An output transcript is not playback evidence; an append acknowledgment is not proof the caller heard or benefited from it.

The classifier returns explicit labels and confidence values. Neither Decisions nor `session.thinking.append` exposes the live model’s private reasoning. The latter supplies application-authored context; it does not read internal thoughts.

## Verification and remaining uncertainty

The delivery module passed 27 offline tests in English and Spanish, including actual shared-tracker integration. Covered cases include open caller input, late results, corrections, related follow-ups, topic resolution, intro protection, exact scope/source matching, output overlap, silent versus malformed audio frames, expiry, limits, and ambiguous writes.

The deterministic integration test models a classification arriving 350 ms after native input and verifies delivery before the later application boundary. This is a simulated timing check, not measured Decisions latency or a live-conversation result.

The policy intentionally treats even a brief assistant backchannel, or a prior answer’s tail overlapping new caller input, as closing the optional delivery window. That can miss helpful support, but avoids treating an answer already in progress as a safe injection opportunity. A caller may also correct a statement after a note has already been sent; an earlier append cannot be retracted without another update. Current-reply wording and fresh revalidation limit that risk but do not eliminate it.

Real audio validation must still establish whether early notes arrive usefully, affect explanations, and preserve the intro, timing, and natural flow. No live effect or improvement percentage is established by these offline tests.

Subsequent validation and the bounded scheduling refinement are recorded in
[EARLY_RESULTS.md](EARLY_RESULTS.md). One final English call demonstrated early
delivery; Spanish results remained withheld. That evidence does not establish
reliable bilingual conversational improvement or an improvement percentage.
