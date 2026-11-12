# Warmer conversation and preamble timing — local v1.3

November 12, 2026. Branch: `v1.3-decisions-integration`. Local changes only.

## Library review

Before implementation, the review covered all 45 pages in the Responses manifest: 25 guides and 20 reference pages. Repeated generated schemas were deduplicated by exact normalized content, using the previously approved review method; unique definitions and differences were read. No manifest document was unavailable. The saved Responses reference, local configuration audit, and measurement plan were also reviewed. The older audit was treated as historical findings, not proof of current defects.

Current official guidance was checked and relevant sections revisited during implementation:

- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting): let Live choose ordinary wording; distinguish listening cues from reply acknowledgments; test the actual voice and prompt combination.
- [Personality during tool calls](https://developers.openai.com/api/docs/guides/live-prompting#personality-during-tool-calls): casual transitions and useful verified updates, without repeated status or padding a wait.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#keep-updates-accurate-and-useful): report actual task state; a backend result or context acknowledgment is not evidence that the caller heard an answer.
- [Managing Live sessions](https://developers.openai.com/api/docs/guides/live-conversations): transcript fragments and generated audio are distinct from client playback.

No library documents are supplied as runtime context. The managed Responses delegation mode, tools, voice, and playback pipeline are unchanged; the client-delegation acknowledgment-delay recipe was not applied to this different mode.

## Changes

| Area | Local change | Purpose |
| --- | --- | --- |
| Ordinary wording | Optional contextual recognition or transition, followed by the useful point; no required opener or phrase rotation | Give Live room to sound casual without adding filler |
| Research speech | A genuine new lookup can have a brief explanation; saved or ready results need no checking announcement | Avoid making a fast lookup sound like another wait |
| Progress | Useful, verified changes or a meaningful delay can warrant an update; receipts alone stay quiet | Keep progress truthful and avoid repeated checking |
| Prompt overlap | Remove a duplicate research-answer paragraph and conflicting blanket opener restrictions | Reduce competing wording instructions |
| Timing | Separate acknowledgments, progress, incomplete lead-ins, and substantive-answer candidates in English and Spanish | Avoid counting a varied preamble as a useful answer |
| Evidence | Version the classifier and label audio-energy observations separately from transcript classifications | Preserve the limits of what the logs establish |

No artificial waiting, new model calls, timers, Decisions settings, or research-routing changes were added. Mandatory readbacks retain their exact wording. Natural transitions remain optional; they are not scripts to perform. Source qualifications stay with the facts they affect.

## Preservation and verification

The selection acknowledgment, recap policy, correction/mm-hmm instructions, and slow articulation policy were preserved. Fingerprint checks verified that the table component, table styling, comparison state, opening-brief implementation, handoff implementation, research delivery controller, and Live channel were unchanged by this task. Existing earlier changes in the working tree were retained.

Local tests use fictional input, fake provider events, and deterministic clocks. They cover English and Spanish progress, useful partial findings, clarification, interrupted and overlapping responses, recap precedence, research delivery, and column removal/restoration. No paid voice calls or production access were used.

Final verification: **484 tests passed**, with no failures or skipped tests, across the policy, timing, intro, handoff, delivery, and table-state suites. `npx tsc -b --pretty false` and the scoped diff whitespace check passed. The timing changes also passed the 14-test observability suite. Final fingerprint checks again confirmed the protected implementations and the selection/interruption instruction sections were unchanged.

Local test output: `output/warm-preamble-final.tap`. These are regression results, not a measured improvement in live speech latency or listener-rated naturalness. The revised classifier is versioned `preamble-v2`; comparisons with older timing logs must account for its more conservative definition of a substantive transcript candidate.

Timing remains a heuristic. A candidate is observed substantive transcript content, not proof of correctness, comprehension, or the exact first useful word heard. An unfinished streamed clause must not permanently start that timer. Audio energy after a candidate is explicitly labeled as an estimate; it cannot identify which word was playing. Missing playback evidence stays missing.

A new microphone call is still needed to judge actual warmth, pacing, spontaneous wording, and whether transitions feel natural. Passing offline tests does not establish those listening outcomes.
