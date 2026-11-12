# On-campus apartments and cost comparison arithmetic — local v1.3

November 12, 2026. Based on call `4fbf8d93-abc7-4ba6-93fa-f0dd5aebff71`.

## Repairs

The isolated catalog now recognizes on-campus apartments, apartments on campus, Spanish apartment wording and studios separately from residence halls. A source apartment record is selected and labeled as an apartment. An explicit campus alternative is protected from the previously known off-campus plan. The Davis regular-apartment replay returns one $47,803 published test record, with no rental/family question; the source qualifications remain intact. A studio request selects the studio record, and residence-hall requests keep their own record.

Cost differences are computed in application code from current sourced budget amounts. Prepared facts name the subject, peer, year, currency, period, housing categories, metric, signed difference and explicit lower/higher/equal direction. This distinguishes total cost from tuition-and-fees:

| Published comparison | Total difference | Tuition/fee difference |
| --- | ---: | ---: |
| Riverside minus Davis | -$431 (lower) | -$1,473 (lower) |
| Davis minus Berkeley | -$4,932 (lower) | +$49 (higher) |

These are qualified published benchmarks, not verified personal bills. Different years, cohorts, populations, currencies, periods, incompatible housing categories, unverified findings and expired sources do not provide comparison facts. Generic published off-campus and rental figures can be compared only as labeled benchmarks, with their source uncertainty retained.

The facts travel through a small quiet-context update, separately from the primary result's delivery acknowledgments. They add no model call, speech request, tool action, forced pivot or wait on the primary answer. Unchanged facts are suppressed. When the latest evidence has no compatible comparison, an explicit quiet replacement clears the previous comparison context. State is student-scoped and resets with scope changes.

Comparison context supplied/acknowledged/failed stages are logged against the research job. Receipt is not proof that the model spoke or correctly applied a fact. Transcript and playback evidence remain separate.

## Verification

- English/Spanish isolated database tests: standard apartment versus residence hall versus studio; apartment table amount and column hide/restore; correct comparison differences reaching the quiet voice channel; all context packets within the existing byte bound; context acknowledgment observed without a spoken command.
- Database/table regression suite: 86 passed, including prior campus, housing and column-control tests.
- Follow-up apartment/arithmetic/fee delivery campaign: 10 passed; final apartment/table/arithmetic proof rerun: 7 passed.
- Intro, voice and delivery regression run: 372 passed. Final channel/policy rerun after adding comparison receipt diagnostics: 238 passed.
- Controller/arithmetic suite: 104 passed. TypeScript build and whitespace checks passed.

Evidence is retained in ignored `.local/4fbf-apartment-*.txt` files. Tests used isolated catalog data and simulated voice transport. No paid model, microphone or generated-audio call was run. A microphone call is still needed to assess actual spoken arithmetic and naturalness.

## OpenAI guidance

Used the retained approved full unique-content review of the 45-page Responses library. Rechecked every snapshot against its manifest: unchanged, none missing. This was not a new literal reread of repeated generated schemas. Revisited the saved Responses reference and relevant current/saved guidance during the code review and implementation.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#share-ui-context): application-derived concise facts need no formatting model call; quiet context uses thinking appends with null delegation ID. Full records and qualifications remain in the backend. Provider receipt and spoken delivery are separate.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#personality-during-tool-calls): answer the actual request, retain natural conversation, avoid repetitive status and unnecessary recap. The existing opening, pace, listening and interruption policies remain in place.

No table styling or column-control behavior changed. No financial records, source dates, production data or production flags changed. Nothing committed, pushed or deployed.
