# v1.2 research corrections after the 8:12 a.m. call

## Scope

Local changes on `v1.2`, based on `2098ca65333a4e8bab482f763cb30b6afdd14bee`. No commit, push, deployment, production configuration change, or paid API call was made for this implementation.

The diagnostic reviewed before implementation was `7bb50483-4828-4fcd-a241-f2d4d1f3654d`, November 7, 2026, approximately 8:09–8:12 a.m. Pacific. The archive contained 924 captured events and reported 119 dropped events. Transcript and application events establish the sequence below; they do not establish exactly what the listener heard. Private transcripts remain outside this document.

## Documentation preparation

Before editing, reviewed all unique content in all **45 official snapshots** listed in [the manifest](../manifest.json), including the generated API contracts. Exact repeated schema paragraphs were deduplicated using the user's previously approved approach; distinct content was retained and read. All 45 files matched their manifest hashes after normalizing Windows line endings. No requested local document was unavailable.

Also read the complete [saved Responses reference](../../OPENAI_RESPONSES_REFERENCE.md), [library README](../README.md), [configuration audit](../LIVE_CONFIGURATION_AUDIT.md), [measurement plan](../LIVE_MEASUREMENT_PLAN.md), and prior implementation review. Checked relevant current official [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations), and [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting) guidance against the code and diagnostic timeline. The documentation remains development material, not runtime model context.

## Findings and changes

| Problem in the call | Change | Expected effect |
| --- | --- | --- |
| A correction to off-campus housing arrived after the residence-hall check completed. Clearing the active job also discarded the identity needed to accept that correction, so the application rejected it as stale. | Keep one bounded terminal receipt per call. A material correction matching the latest request and revision can create the next revision after completion or failure. A new task, explicit cancellation, student change, or call close invalidates that receipt. | The corrected scenario can actually be researched without asking the caller to restart the request. Completed work is not cancelled, and stale duplicate corrections do not enqueue another job. |
| The old residence-hall report was read after the rejected correction, and absence of an off-campus figure was treated as failed verification. | Retained reports now include the exact searched question, institution, request ID and revision. Receipts and prompts distinguish an unaddressed scope from a fact that was searched but could not be verified. A rejected attempt reports `searchStarted: false`; it makes no claim that the currently accepted task lacks the requested evidence. | Origen has explicit evidence of what was checked and can reuse relevant facts or request the actual gap without claiming a search happened. |
| The natural answer mentioned Berkeley and the off-campus total, but the finding's generated subject also contained population and housing details. Exact subject matching missed that paraphrase and requested another announcement. | Recognize the institution within rich subject labels, with word boundaries and conservative English/Spanish scenario handling. Preserve explicit campus, academic-year and housing distinctions when considering an answer already discussed. | A useful paraphrased answer can retire the optional announcement without requiring every figure in the report to be recited. An unfinished interrupted answer remains available quietly. |
| Useful figures were preceded by a lengthy explanation of narrower details that remained unverified. | Research instructions lead with the supported answer and its year/scenario, followed by the material qualification. If the latest requested portion has no verified answer, explain that gap first. Reading an existing report is not described as an ongoing lookup. | Shorter, more direct answers while retaining the limitations that affect their meaning. |

In the diagnostic, the fresh off-campus lookup eventually took about 28 seconds. A useful amount appeared in the output transcript roughly 14.5 seconds after the result became available. The native answer boundary was followed about 250 ms later by an optional announcement request. These are event intervals, not precise playback latency. This implementation targets unnecessary rejection and delivery overhead; it does not claim to accelerate the external search itself.

## How the guidance shaped the implementation

- **Application-owned task state:** a request and its revision outlive a spoken turn or completed polling cycle. Changed requests are reconciled against that state; old or duplicate revisions cannot silently replace newer work. This follows the task-state and changed-request guidance in [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation).
- **Quiet facts and optional speech stay separate:** findings continue through `session.thinking.append`; an optional contribution uses `session.commentary.append` after the existing quiet/playback checks. No new `session.instructions.append`, speech cancellation, backend response request, or model call was introduced by the delivery fixes. Append acknowledgments remain distinct from spoken delivery, as described in [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations).
- **Useful, complete information:** facts retain their year, scenario, qualification and citations. Existing atomic multipart updates and the conservative 480-byte append bound remain intact. No caveat is truncated to make an announcement fit.
- **Natural conversation:** ordinary concerns and explanations continue directly from known context. Research instructions avoid repeated progress promises and unnecessary lookups. The introductory recap rules, warm voice/personality instructions, voice choice, playback controls, and steady call indicator were not edited. [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting) informed the focused research wording changes.
- **Evidence limits:** transcript overlap is only conservative duplicate suppression, not proof of accuracy, understanding, or word-level playback. Managed Live continuation events remain separate from standalone Responses API contracts.

## Verification

| Check | Result |
| --- | --- |
| Research, delivery, intro/selection, interruption, session and server-control regression suite | **593 passed, 0 failed, 5 skipped**; 598 tests, 53.03 seconds. Execution time is not conversation latency. |
| English and Spanish completed-check correction | Both languages accept a new scenario as revision 2, preserve both reports' searched questions, start exactly two jobs total, and send no cancellation for already finished work. |
| Failure and invalidation | Corrections after failure are accepted; cancelled, different-student and superseded identities remain rejected. Duplicate calls do not repeat completed jobs. |
| English and Spanish answer delivery | Rich-label paraphrases suppress the second announcement. Wrong campus, explicit wrong year and wrong housing scenario do not count as the requested answer, including explanations of unverified figures. Mid-answer arrivals wait; interrupted tails remain quiet. |
| Existing conversation regressions | Includes brief acknowledgments, genuine interruptions, changed questions, partial/final results, retained qualifications and citations, local WebSocket control, and selection recovery. Provider responses and speech are simulated. |
| Production build | Passed with `npm run build -- --configLoader runner`, including TypeScript. The default Vite config loader encountered a Windows sandbox directory-access error; runner mode avoided it. Existing dependency/bundle warnings remain nonfatal. |
| Logging policy and whitespace | `npm run check:logging` and `git diff --check` passed. |

The five skipped tests require an isolated `DATABASE_TEST_URL`, which was not configured for this run. No queue schema, database persistence, or ownership policy changed.

The separate prompt-size suite has **4 passing and 18 failing tests**. Re-running that suite with the original HEAD versions of all changed prompt-building modules loaded in memory reproduced the same 18 failures. These existing budget overruns were not fixed by changing the intro or relaxing test limits. For the English planning fixture, speech instructions changed from 32,485 to 32,466 characters and backend instructions from 64,369 to 64,439 characters. The broader prompt-size issue remains outside these four fixes.

## Still needs live validation

Fresh English and Spanish voice calls are needed to judge provider adherence, audible warmth, pacing, and how gracefully an update enters real overlapping speech. The automated checks verify application decisions and event contracts, not generated conversational quality. No new latency percentile, naturalness score, or audio-quality improvement is claimed.

For the next call, compare the accepted request/revision and searched question, completed research state, context acknowledgment, native spoken amount and qualification, duplicate-suppression event, and browser playback evidence. A commentary request alone is not proof that a second answer was heard.
