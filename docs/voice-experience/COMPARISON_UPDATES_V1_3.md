# Comparison updates across topics — v1.3

Implementation and isolated validation, November 8–9, 2026. Branch: `v1.3-decisions-integration`. Comparison updates are enabled in the isolated local launcher. The application default remains off.

## Purpose

A family can change one part of a comparison without making Origen research everything again. Decisions chooses a saved entry only after application code establishes a clear clue. The worker verifies the changed condition. Origen receives the other complete findings immediately and continues through the existing conversation and delivery flow.

| Before | Now | Benefit |
| --- | --- | --- |
| Berkeley/Davis, one fixed housing change and academic year | Saved subjects and facets, including costs, deadlines, eligibility and other guidance | The same implementation supports different schools, programs and topics |
| One unchanged figure | Up to seven unchanged entries, retaining their original source dates, scope and caveats | Growing comparisons keep useful work instead of repeating it |
| Campus-specific lookup template | One scoped request containing only the changed entry and condition | The research model does not receive or rewrite unrelated findings |
| Latest change only | Completed changes remain associated with each retained entry | Repeating an identical completed change need not trigger another lookup |
| Scope sometimes existed only in a title | Original subject labels travel with the evidence | Labels such as graduate students or online programs survive reuse |

## How it works

1. Use a completed report belonging to the same authenticated account, call and selected student. Require current source-linked findings and material qualifications.
2. Interpret the caller's actual recent words. Match a named subject and compatible facet, or a narrowly grounded relative reference. Multiple changes, contradictory requests and unclear references receive a short clarification. They do not start Decisions or a lookup.
3. Ask Decisions to select among bounded saved entry IDs, with an explicit `unclear` option. It receives public labels and the independently grounded reference. It does not verify facts or establish permissions.
4. Revalidate the request after classification. Queue only the changed item. Return the unchanged complete findings through the existing function result and continuation flow. Revalidate again after enqueue so a caller's new question does not receive the obsolete announcement.
5. Reconstruct the plan on the server from authorized saved data. Ignore caller-supplied findings, plans and source overrides. Redact private identity details before research.
6. The existing worker makes one Responses request, with at most two hosted-search actions, restricted to the changed entry's official source domains. It preserves applicable year, term, scenario and limitations, and returns verified, partial or unverified status.
7. Validate scope, citations and completed search provenance. Merge unchanged evidence in application code, preserving its original age. Other facets of the changed subject are marked unverified if they might be affected. The existing quiet research delivery handles the result.

No intro, voice selection, audio playback, call indicator or ordinary-turn prompt was changed. No new worker service or database migration is required.

## Boundaries

For the production trial, deploy the API and the existing research worker from the same `main` revision before enabling `ORIGEN_DECISIONS_COMPARISON_UPDATES=true` on the API in Render. Start new calls for the English and Spanish checks. To end the trial, set the flag to `false` and deploy the API with that setting.

- The experiment is enabled only by an explicit `ORIGEN_DECISIONS_COMPARISON_UPDATES=true` with existing background research, server control and research-delivery-V2 prerequisites. Unset/false remains disabled.
- A starting report needs 2–8 verified entries with caveats and approved official sources checked less than five minutes ago. Reusing an entry does not refresh its age.
- One clearly identified item changes at a time. At most three comparison classifications run per call. A later distinct change uses the latest completed merged report, not an already-superseded base.
- Multiple saved scenarios with the same subject and facet, partially verified starting reports, missing official evidence, and new options absent from a report use the existing clarification or ordinary research route. They are not silently guessed.
- A new target condition may invalidate other facets for that subject. Those older values are not presented as unchanged; other subjects remain usable.
- The source policy remains college guidance: official `.edu` domains and the existing approved education/government services. “Across topics” does not mean arbitrary internet domains.
- Probability is a routing threshold, not evidence that an answer is true. Model-generated caveats still require evaluation against sources. No automated suite guarantees natural speech in every call.

## Guidance reviewed and applied

The team reviewed all 45 entries in the Responses manifest before implementation, plus the saved Responses reference, Decisions guide/native/create contracts and relevant conversation-state guidance. Generated schema expansions and equivalent SDK renderings were covered as unique contracts, following the user's approval to deduplicate repeated content. No assigned snapshot was unavailable. This is not a claim to have reread millions of repeated schema tokens literally. The current Live delegation Markdown URL was unavailable through the web reader; the official HTML page was reviewed instead.

| Guidance | Application |
| --- | --- |
| [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation) | Keep task revisions and full evidence in the application; use function results and continuation; distinguish context receipt from speech/playback; avoid routine interrupting instructions |
| [Decisions](https://developers.openai.com/api/docs/guides/decisions) | Bounded choices and an explicit uncertain outcome; application code checks relevance and authorization independently |
| [Web search](https://developers.openai.com/api/docs/guides/tools-web-search) | Restrict official sources, preserve actual citations and trace them to completed hosted actions |
| [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | Strict changed-item schema; reject refusal, incomplete output and mismatched subject, facet or requested change |
| [Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create) | Bound tool calls and output. Extra tool attempts can be ignored when the cap is reached; a completed answer can still be accepted if every cited source came from completed work |
| [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | Preserve completed operations and per-entry changes rather than rebuilding a comparison from an older report |

The library is development reference material; none of it is injected into runtime context.

## Validation

Paid tests used fictional records and a new user-approved **$3 maximum**. Initial reservations were split between provider and native-voice tests. Recorded worker usage allowed a conservative settlement and a second voice run; the final combined amount accounted for is **$2.97**, including unused safety margins. This is a conservative budget ledger, not an invoice.

### Automated checks

| Check | Result |
| --- | --- |
| Current core, controller and logging-schema suites | **120/120 passed**: 42 core, 72 controller, 6 logging |
| Current worker suite | **29/29 passed**, including five topic families in both languages |
| Original research-job and trace suites against disposable PostgreSQL | **26/26 passed, no skips**, including ownership, restricted roles, source-plan reconstruction and durable trace retention |
| Wider intro, session, recovery, reuse, delivery and background-job regressions | **320 passed**, with one database-only trace test skipped in that run and subsequently passed in the PostgreSQL run above |
| Diff whitespace check | Passed |

These suite counts overlap and must not be added together. Tests cover unclear and contradictory requests, punctuation-free voice transcripts, changed callers/student scope, stale evidence, repeated updates, partial/unverified results, citation provenance, source-only scope labels, same-subject dependencies and disabled gates. The disposable PostgreSQL service was stopped afterward.

### Real provider checks

| Check | English | Spanish |
| --- | --- | --- |
| Decisions selection across budget, deadline, eligibility and another guidance facet | **4/4 correct**, 133–615 ms | **4/4 correct**, 106–236 ms |
| Real scoped Responses research | **9.70 s**; retained unchanged finding and returned a partial deadline result with its cycle limitation | **10.83 s**; retained unchanged finding and returned a partial eligibility result with its applicability limitation |

Both real research responses initially exposed a parser issue: a completed response included an unexecuted third tool attempt after the two-call cap. The parser was corrected to accept only source evidence from completed actions, then both exact saved provider responses passed replay. Extra unexecuted attempts cannot provide citation provenance. This correction also has deterministic regressions.

### Native Live audio tests

Four calls were made: an initial English/Spanish pair and a corrected pair. Native calls used real Live and Decisions with fictional queued research, while the separate worker checks above used real web research. No production records were used.

The first pair did **not** pass: punctuation-free input combined “change Eastview” and “keep Pine Valley the same,” incorrectly triggering clarification. That application bug was fixed and retested. The initial harness also advanced after a progress response, so the corrected harness waited for source-backed content.

| Corrected run | English: application deadlines | Spanish: scholarship eligibility |
| --- | --- | --- |
| Decisions selection | Correct, **504 ms** | Correct, **230 ms** |
| Research jobs | Initial comparison + exactly one changed-item job | Initial comparison + exactly one changed-item job |
| Unchanged finding and caveat spoken | Yes: January 15, stated cycle/applicant type, possible earlier program deadlines | Yes: 12 credits, no award guarantee and limited funds |
| Updated finding and caveat spoken | **Not fully verified**: the harness's date predicate also matched the unchanged January 15 result, advanced too early, and interrupted the beginning of the March 15 update | **Observed in output transcript and independent audio transcription**: six credits for the stated part-time scholarship cycle, with funding/award limitations |
| Ambiguous request | Asked which option/applicant type; no third lookup, but said an unnecessary “let me check” first | **Did not clarify**: assumed Eastview and said it would adjust; no third lookup or persisted change actually occurred |
| First non-silent audio after clear-change caller utterance | **2.11 s** | **1.54 s** |
| First non-silent audio after ambiguous utterance | **2.13 s** | **1.71 s** |

First-audio times include acknowledgments and do **not** measure time to the correct final answer. The calls also contained unnecessary checking/pending wording after information was available. These results do not establish that the generalized feature is production-ready or that its naturalness improved. Backend controls correctly withheld unsupported work; spoken behavior still needs validation and refinement before enablement.

The harness recorded provider transcript events, native PCM and separate ASR output. Its playback clock was simulated; this is **not browser-speaker playback or evidence that a human heard or understood the answer**. The Spanish ASR also rendered the fictional school name differently from the provider transcript. The normal product intro was not exercised in these focused research calls; unchanged intro behavior is covered by regression tests, not a new microphone test.

### Diagnostics and artifacts

`voice.comparison.update` records bounded stages: checking, selected, clarification, rejected, superseded, queued, reused, duplicate and deferred. It links call, base job and new job through the same hashed correlation scheme as existing research logs. Durations, request revision, research mode and retained/invalidated counts are recorded. These metadata logs do not include raw transcripts, questions or identities.

Local artifacts (not committed):

- `tmp/comparison-generalized-provider-results.json`: real classifier/research records and corrected parser replays; private reasoning removed.
- `tmp/comparison-generalized-provider-budget.json`: conservative usage-backed worker settlement and classifier reservations.
- `output/comparison-generalized-native-2026-11-09/`: initial native-call JSON and WAV evidence.
- `output/comparison-generalized-native-2026-11-09-retry/`: corrected native-call JSON, per-turn WAV and complete-call WAV evidence.
- The adjacent `*-budget.json` files retain all native-call reservations, including failed runs.
- `tmp/comparison-final-controller.tap`, `tmp/comparison-route-final.tap`, `tmp/comparison-worker-final.tap`, and `tmp/comparison-regressions.tap`: automated results.

Before enabling this experiment, run a stricter English final-answer check (match the changed subject **and** March 15, not either school's date), verify Spanish ambiguity handling, and confirm completed results stop attracting pending/checking language. A human microphone/browser test should then verify warmth and actual playback. No production setting has been changed.
