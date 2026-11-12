# Local call review and optional research table

Call: `d4c1fe49-71ec-4ef5-8c88-225e45b52380`, November 12, 2026. Local v1.3 only.

The caller reported liking the flow. Review used the isolated database's research traces and private browser diagnostics, plus the local observation transcript. There was no production access or new paid test call. Transcript evidence and browser playback observations are distinct; neither supplies a recording that proves subjective warmth.

## Research and table performance

| Campus | Queue to finished | Catalog lookup | Browser receipt to table render | Rendered table |
| --- | ---: | ---: | ---: | --- |
| Berkeley | 524 ms | 238 ms | 45 ms | 1 column, 8 populated cells |
| Davis | 594 ms | 125 ms | 17 ms | 2 columns, 16 populated cells |
| Riverside | 294 ms | 182 ms | 16 ms | 3 columns, 24 populated cells |

All three jobs matched the local catalog and completed. The returned figures were published-year benchmarks with applicability qualifications; completion is not proof of an exact future transfer-cohort quote. The long 16–29 second `reply_observed` durations include answer generation and speech observation; they must not be described as silent waiting for the useful fact. Provider context acknowledgments were approximately 2.4–2.7 seconds after supply and do not prove speech playback.

## Conversation findings

- The transcript shows student confirmation, one recap, cost comparisons, and a direct response to the new question about paying for college.
- Berkeley and Davis research utterances spanned about 26.6 and 30.2 seconds respectively. These were lengthy explanations, not equivalent to silent delay.
- The estimate-versus-bill qualification was repeated on the Davis answer and revisited during the aid explanation.
- Davis began with “What about?” before the caller had finished naming it, an early reaction to a split utterance.
- Berkeley had a `commentary_requested` after its answer was observed, followed by an interrupted delivery on the caller's next turn. This is an avoidable pending-announcement opportunity; the evidence does not prove that a full repeated answer was played.
- Riverside's mm-hmm overlap was classified as an acknowledgment overlap, with no unfinished research portion recorded.
- Conversational Decisions classification/support was disabled in this local launcher. These observations cannot establish a benefit from Decisions cues.

## UI change implemented

The table now has a labeled minimize button. Minimizing replaces the panel with a small research/cost-comparison pill above the call bar. New results continue updating retained state and can display an Updated badge without reopening the panel. Reopening restores the current comparison, history, hidden-column choices, and drag position. Call cleanup still clears the in-call state.

Only the table presentation and its local state were changed. No intro, speech prompt, research routing, audio controller, Decisions flag, or source amount was changed in this task.

Validation: 17 table-state tests passed, TypeScript passed, and the local Edge browser interaction check passed for English and Spanish minimize, quiet updates, reopen, and comparison retention. Screenshots are under `output/playwright/research-desk/minimized-updated-en.png` and `reopened-es.png`. Browser checks used a fixture with no voice or research API calls.

No commit, push, or deployment.
