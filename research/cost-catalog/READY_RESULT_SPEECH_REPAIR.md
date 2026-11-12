# Ready-result speech delivery — local v1.3

November 12, 2026. No production changes, commit, push or deployment.

## Evidence and repair

Call `941720f0-acc8-4849-80f3-2a3f0f69c2bb` used the catalog successfully. Database work took 184–342 ms and browser table commits followed receipt in 20–53 ms. These are separate measurements from spoken delivery.

The Berkeley transcript began a generic estimate explanation after the table arrived, reaching the amount roughly 19 seconds after result supply. The number was unfinished when the caller moved to Davis. Merced received another checking/comparison acknowledgment after its result was available; result-specific speech began around 10.5 seconds after supply. Transcript timestamps establish generated words, not precise physical playback or comprehension.

Changes:

- Seed research-only instructions to lead with the requested figure, year and scenario, then the material caveat. Keep the existing relaxed pace, intro, floor control and optional one-time table explanation offer.
- A completed assistant courtesy or narrow checking acknowledgment releases the pending result opportunity. It does not count as factual delivery. Active caller speech, unfinished/interrupted speech and playback guards still prevent a new contribution.
- For total-plus-tuition requests, send the total and requested tuition component instead of every line item. Full components and qualifications remain in the retained evidence and table.
- Treat the request-template modifier “if available” / “si están disponibles” as optionality in this presentation selection, rather than an additional availability question. Genuine availability questions still preserve the full response.
- Remove completion-status wording from the concise requested-result cue. No runtime instruction append, forced interruption, new backend call or playback cancellation was introduced.

Saved-request replay reduced Berkeley and Davis answer text from 326 to 165 characters, and Merced from 342 to 157. All three qualifications and component records were preserved. This measures payload concision, not proven spoken latency.

## OpenAI guidance and coverage

The retained approved full unique-content review covers all 45 manifest pages. This pass checked all 45 snapshots against their manifest checksums: unchanged, none missing. It revisited relevant saved/current Live delegation, prompting and conversation guidance, plus the local measurement guidance. This is not a new literal full reread of the generated reference schemas.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): keep full records in the backend, return concise complete facts, distinguish quiet context from spoken results and acknowledgment from delivery. Preserve the existing Responses delegation contract; client-only acknowledgment suppression was not applied to managed Responses.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#personality-during-tool-calls): lead results with their useful fact, avoid repeating progress or padding the wait, and preserve natural conversation during work.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations): transcript fragments, estimated context injection and playback observations are different evidence.

## Verification

Local English/Spanish tests cover completed acknowledgments, progress-only replies, active playback, caller speech, interrupted fragments, ordinary follow-ups, topic changes, duplicate suppression and preservation of qualifications. Catalog tests cover all nine campuses and multi-campus table retention. Existing opening and voice configuration checks remain in the regression suite.

Evidence files are in the ignored `.local/` directory: `9417-delivery-final.txt`, `9417-delivery-regressions.txt`, `9417-delivery-local-catalog.txt`, and `9417-delivery-typecheck.txt`. The initial regression run skipped the two explicit database suites; they were then rerun with `COA_LOCAL_PG_TEST=true` and passed without skips.

No paid provider or microphone call was run. Automated scheduling shows a single result cue on the next allowed 250-ms delivery tick after a completed acknowledgment, without the former extra reply hold. A real microphone call must verify first useful spoken figure, absence of repeated checking, and perceived warmth; neither the scheduling test nor provider acknowledgment guarantees those outcomes.
