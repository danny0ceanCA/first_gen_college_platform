# Useful-gap worker test: rules versus Decisions

November 11, 2026. Branch `v1.3-decisions-integration`. Fictional callers and isolated queues only. No application code, production data, flags, Render services, commits, pushes or deployments were changed by this test.

## Design and baseline qualification

The scenario was registered in `research/worker-comparison/gap-scenario.mjs` before the calls: a parent wants to help an incoming UC Davis undergraduate settle into a comfortable first-week routine; the student will need the bus because she has no car. The next turn asks for one small practical step, followed by a switch to brainstorming an essay. The English and Spanish prompts are equivalent and unchanged across conditions.

The current model retained its research tools and ordinary instructions. It was not told to avoid research or omit a benefit. A baseline that attempted a lookup would have been screened out rather than being supplied with fake failed research. Both baseline calls completed all three turns with zero formal research requests. They gave route-practice advice, without naming a verified student transit benefit, Unitrans/Yolobus eligibility or AggieCard requirements. English offered to check; Spanish said it would check, but no lookup followed. This is a demonstrated open gap in these sampled calls, not a claim that the current model never researches transport.

Three conditions were compared in each language:

1. Current Origen, with no proactive worker.
2. Second-worker prototype selected by bilingual rules; Decisions off.
3. Same worker role selected by Decisions using the repaired admission policy.

Both added conditions used the same candidate catalog, source validator, stale-result fence and quiet-context formatter. Clear bus/campus clues were available to the rules as well as Decisions. A favorable result for the rules worker must not be attributed to Decisions.

## Sources and research

Actual `gpt-6-luna` Responses web research ran during the original rules calls through `processResearchJob`, with an in-memory queue and public query only. English research finished in 11.14 seconds; Spanish in 12.19 seconds, both one pass with complete requested coverage. The records established undergraduate student access and required card conditions.

- English: [Unitrans fares and passes](https://unitrans.ucdavis.edu/passes), also opened independently during this review. It supports the undergraduate AggieCard condition, the named bus systems and the restriction on card images.
- Spanish: [Unitrans preguntas frecuentes](https://unitrans.ucdavis.edu/es/preguntas-frecuentes-0), retrieved and cited by the research provider. An independent browser fetch returned a cache miss; that is a retrieval limitation, not evidence the policy is missing. The English official page corroborates the core benefit and card condition.

These facts are public student-service information, not an individualized eligibility determination or a guarantee that a route serves the student's home. No private caller/student information was placed in search queries.

## Harness error and exclusions

The original Spanish rules trial is excluded from conversation-quality scoring. The test adapter tried to read `result.voiceBrief` while research was still pending. This incorrectly returned `research_unavailable` and prevented the later standalone result from being supplied. The research itself succeeded; this was an experiment-adapter bug, not evidence that the active Origen service failed.

The remaining process was stopped after the bug was identified, interrupting an English Decisions attempt. Its reservation remains counted and partial audio is retained. No app server or production process was stopped. Original files remain in `output/worker-useful-gap-20261111/voice/`; the interrupted call did not finish writing a full JSON report, and its complete research payload is unavailable.

The pending-job adapter was repaired to register a pending job without reading a result prematurely. Corrected calls are under `voice-retest/`. To avoid paying for duplicate searches and to hold evidence constant, they replay the already verified public findings at their measured 11.14/12.19-second research durations. Thus the original rules English trial exercised research during speech; the corrected matched retests isolate selection/delivery with real research replay. They must not be represented as new live web searches. All attempts, including excluded/interrupted ones, remain charged against the same approved $5 ledger.

## Interpretation and evidence boundaries

### Retained results

| Condition | English | Spanish |
|---|---|---|
| Current model alone | No lookup; no transit-benefit/card information | No lookup; no transit-benefit/card information |
| Worker using rules, Decisions off | Accepted; quietly supplied facts without a formal lookup; benefit and card restriction spoken | Accepted; formal lookup joined the pending worker task; benefit and valid-card condition spoken |
| Worker using Decisions | Accepted; formal lookup joined the task; benefit and undergraduate-card condition spoken | Accepted; quietly supplied facts without a formal lookup; benefit and valid-card condition spoken |

The strongest standalone Decisions result is Spanish: no formal research tool was called, six quiet context packets were sent and all six received matching provider acknowledgments, and the initial spoken answer then added Unitrans/Yolobus access with the condition of a current AggieCard. It followed the caller's first-week routine discussion and asked where the student would live. The specific card fact appeared in the output transcript 17.96 seconds after the first quiet append. This demonstrates useful information reaching the conversation through the extra worker, rather than only a classification being logged.

The original rules English call demonstrates the same capability without Decisions: no formal lookup, a successful concurrent research pass, six quiet packets, and the benefit/card restriction in speech. Rules were sufficient for the clear campus-and-bus clue here. This experiment does not show an exclusive Decisions advantage; it shows that the second-worker research path can close a gap left open by the sampled baseline.

| Retained trial | First audible response | Ordinary follow-up first audio | Card fact in transcript after initial caller finished |
|---|---:|---:|---:|
| Current English | 1.67 s | 2.01 s | Not supplied |
| Current Spanish | 1.79 s | 1.19 s | Not supplied |
| Rules English | 1.80 s | 1.72 s | 20.84 s |
| Rules Spanish, corrected | 2.14 s | 1.64 s | 55.98 s |
| Decisions English, corrected | 1.73 s | 1.47 s | 24.39 s |
| Decisions Spanish, corrected | 1.87 s | 1.83 s | 32.07 s |

These timings separate an audible response from the specific useful fact. They include ongoing conversation and the caller's follow-up, not just computation. The 55.98-second Spanish rules result is not 55.98 seconds of silence: the conversation continued, but the useful fact arrived late. Its card fact appeared 41.36 seconds after context was supplied. Decisions English took 10.46 seconds from context append to that fact; Decisions Spanish took 17.96 seconds. Delivery timeliness therefore remains uneven and should not be called solved.

All six retained calls completed with no provider API errors and followed the switch to discussing the essay without returning to a transit-fact announcement. The rules English answer repeated the route-planning suggestion within its initial answer. The corrected rules Spanish answer referred to a preceding cost discussion that was not present in the supplied conversation. The Decisions Spanish answer introduced the benefit after completing general routine advice, without a new greeting or a forced commentary append. Those observations support useful enrichment, but not a claim of universally natural flow.

The formal requests in two worker trials are real observed variation: the model did request a lookup in those arms despite not doing so in either baseline sample. Those requests joined the scout task and did not buy another web lookup. They are not evidence that the model would never research this scenario on a different baseline run. Only the rules-English and Decisions-Spanish trials demonstrate standalone quiet enrichment without a formal lookup.

The active app's intro, voice, pacing, audio-floor and binder behavior were untouched. Fictional students were already selected, so the opening recap was not exercised. These calls use generated caller PCM, actual provider output PCM/transcripts, and a simulated playback clock. Human microphone/speaker quality and perceived warmth were not independently measured.

Provider receipt, source completion and spoken use are separate checks. Corrected calls record append event IDs and matching acknowledgments; those acknowledgments do not prove playback. A newly spoken specific fact appearing after context delivery provides behavioral evidence, not access to the model's private reasoning.

One call per condition/language, fixed order and a single scenario are not a statistical effectiveness benchmark. No instruction forced the worker fact into the spoken answer. Ordinary follow-ups and topic changes remained caller-led. Final metrics, transcripts, admission reasons and budget are in `output/worker-useful-gap-20261111/comparison.json`.

## Guidance review

The preceding full 45-page Responses review remains applicable; the same snapshots were checked against the manifest in the prior comparison. The saved Responses and Decisions references and relevant Live delegation/transcript-processing, typed Decisions interpretation, quiet/spoken append semantics and measurement guidance were consulted again before the experiment. Current official Live delegation and Decisions guidance was checked. This is not claimed as a new full reread of all generated SDK schemas. No documentation was supplied as runtime model context.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): speculative work from useful transcript evidence; quiet facts for later replies; stale-result rejection and no unnecessary extra lookup.
- [Decisions](https://developers.openai.com/api/docs/guides/decisions): typed routing with application-owned actions and evidence-based admission.
- Local measurement plan: separate source progress, transcript evidence, provider receipt and actual playback.

39 local gate/context tests passed. Six calls form the retained comparison; the invalid Spanish harness trial and interrupted English Decisions attempt bring the campaign to eight call attempts. The shared ledger conservatively accounts for/reserves **$4.7027 of the approved $5**, including excluded/interrupted attempts. This is not a final provider invoice. No more paid calls were started after the planned corrected comparisons finished.

No implementation was activated in the app. The pending-job correction lives only in the isolated experimental harness. The result supports further testing of a bounded second worker, while leaving open whether Decisions beats better rules on less explicit contextual needs. Delivery timing, concise answers and repetition need separate measurement before production integration.
