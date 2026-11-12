# Broad research, phases 1–5 — local review

Date: November 11, 2026. Branch: `v1.3-decisions-integration`.

These changes are local and uncommitted. No push, deployment, production configuration change, or production migration was performed. Database checks use disposable schemas and fictional accounts in the isolated local database. Paid research used public questions, and voice validation used fictional callers. Decisions reply recovery remains off.

## What changed

| Phase | Before this increment | Now | Practical benefit |
|---|---|---|---|
| 1. Track the question | A model could describe its own returned subset as complete. | The application retains the original question, requested entities and recognizable fact requirements, scope, and revision. It audits those requirements separately from provider completion. | A deadline does not silently answer a request for a deadline **and** fee; an omitted college stays requested. |
| 2. Reuse verified parts | A missing comparison member or harmless rewording could defeat reuse. | Compatible verified facts survive; only missing or changed facts go to research. Refresh, source age, cycle, population, program and ambiguity guards remain. | More useful reuse without silently applying a different year's or program's policy. |
| 3. Research the responsible source | Planning research could inherit an admissions-oriented checklist. | One shared process selects the responsible campus office, department, official program or government source. Recovery is bounded and targets the actual gaps. | Dates, fees, requirements, processes, programs and support-office questions use the same framework. No additional worker service or speech-rewriting model call is required. |
| 4. Validate and retain evidence | One malformed companion record could obscure good evidence; recovery completion could be mistaken for a complete answer. | Independent good findings survive, requested gaps and conflicts remain explicit, and valid ordered steps tolerate repeated category identifiers without altering their facts. | Fewer false failures; no invented dates, missing steps, amounts or eligibility conclusions. |
| 5. Deliver and display the same evidence | A follow-up could receive an old broad summary; unavailable comparisons could disappear. | Requested facts retain scope, caveats and citations in voice context and the table. Requested entities remain visible. Supplemental facts wait for their own context acknowledgment. Completed limitations are distinguished from work still running. | Clearer answers, retained comparisons and fewer repeated announcements, while existing intro and floor control stay intact. |

## Guidance and review

All **45 manifest pages** in the Responses library were reviewed before implementation, using the user's previously approved deduplication of identical generated schemas and equivalent SDK examples. The saved Responses reference and local configuration audit/measurement plan were included. The team checked relevant guidance during implementation and reviewed the library against the completed changes again. No manifest page was missing. The page checklist is in `output/broad-research-phases-20261111/library-checklist.json`.

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): shape conformance is not proof of factual accuracy or requested coverage. Application validation remains mandatory; incomplete steps and unsupported dates remain incomplete.
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search): retain actual citation annotations and official-source provenance. A consulted URL or completed search is not itself evidence for a claim.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): keep application task state and full records outside the voice model; use concise quiet context and useful spoken updates with the correct append contract. A context acknowledgment is not proof of playback.
- [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization): reuse relevant results, avoid unnecessary serial model calls, and publish useful initial evidence before optional recovery.
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state): retain relevant state and revisions while keeping standalone Responses state distinct from Live conversation state.

Current official web-search, structured-output, latency and Live-delegation guidance was checked in addition to the saved snapshots. The documentation library is never injected into runtime context.

## Findings from real research validation

Eight provider-backed research runs used the approved shared $5 validation budget: six initial English/Spanish runs across admissions, support-office information and FAFSA steps, followed by two fresh FAFSA retests after correcting ordered-step handling.

| Scenario | First run | After the repair | Interpretation |
|---|---|---|---|
| FAFSA invitation steps, English | 41.3 s, two passes; structured steps rejected | 19.9 s, one pass, complete requested coverage | Repeated step identifiers had discarded valid evidence and caused unnecessary recovery. |
| FAFSA invitation steps, Spanish | 38.9 s, two passes; structured steps rejected | 19.1 s, one pass, complete requested coverage | Same repair works in Spanish. |
| Stanford deadline and fee, English | First publication 20.5 s; bounded recovery finished at 40.0 s | Replaying the recorded responses retains the verified fee while keeping the requested cycle's deadline unconfirmed | A known month/day must not be converted into an invented year. |
| Stanford deadline and fee, Spanish | First publication 23.7 s; bounded recovery finished at 45.5 s | Same verified-fee/unknown-cycle separation | A usable fact can coexist with an unresolved request. |
| UC Davis first-generation office contact/hours | 33.8 s English / 30.8 s Spanish including bounded recovery | Requested email/hours remain unverified; source limitations are retained | The retrieved pages did not establish those details. This is not a successful retrieval of the requested contact/hours. |

These are small individual trials, not statistical latency benchmarks. Replaying saved provider output is an offline regression, not a new provider test.

## Voice evidence and limits

Native Live validation uses generated caller audio, real provider output PCM/transcripts, production controller logic, and an isolated job adapter replaying the paid public research results. The fictional student is already selected, so these paid trials do not exercise the opening recap. They do not verify a physical microphone, browser speaker playback, or a human perception of warmth. Provider receipt, transcript evidence, simulated playback and task completion are kept separate.

The first English/Spanish fee follow-ups answered in about 1.5 seconds with no additional research request. The initial useful fee took about 17 seconds from the end of the question despite a much earlier spoken acknowledgment. This distinction is deliberately retained: a quick acknowledgment is not a quick useful answer.

Validation also caught a repeated completed limitation and one Spanish run that said $90 despite saved evidence containing $100. That run is a factual failure, not a successful delivery. The final pair captures the exact outgoing context: both languages received $100 and both said $100. This single subsequent success does not establish that spoken factual accuracy is solved.

| Final native voice trial | English | Spanish |
|---|---|---|
| Initial audible acknowledgment | 1.55 s | 1.44 s |
| Correct $100 amount appeared in the output transcript | 15.91 s after caller audio ended | 18.26 s after caller audio ended |
| Ordinary follow-up | Answered in 1.55 s; no new lookup | Not reached in the final trial; earlier trial answered in 1.39 s without a lookup |
| Requested deadline | Correctly unconfirmed | Correctly unconfirmed, then repeated |
| Support-office request | Clearly said the check did not confirm email/hours | Not reached |
| Overall trial outcome | Completed all three turns; an extra checking phrase remains | Failed the 43.5-second turn-completion limit; repeated the deadline limitation and implied a later update despite the check being finished |

The useful-fact timings above are **transcript-arrival timings**, not independently verified browser playback timings. These calls replay already-retrieved findings through the controller; they are not measurements of a fresh web search plus speech. The final Spanish run is not counted as a passing conversation. It exposed an additional duplicate-announcement path for a completed, unverified deadline; its follow-up repair and local regression result are documented below. Another provider-backed bilingual call and a human microphone check are still needed after that final repair.

### Final repair from the captured Spanish call

The current answer already disclosed the scoped deadline limitation and the $100 fee. At 42.881 seconds on the test clock, the application requested an additional spoken deadline announcement. Its detector required the institution name to be spoken again, rejected the answer because an earlier sentence mentioned checking, and did not recognize the phrasing `no la tengo verificada`.

The repair suppresses that optional repeat only for one explicit current subject, a complete matching limitation, and confirmed non-interrupted speech before a later caller question. It rejects other campuses/scenarios, questions, incomplete speech and multi-subject ambiguity. It does not mark the whole research request delivered, and later verified evidence remains eligible for an update. Four additional English/Spanish regression tests cover the positive cases and those exclusions. No intro or interruption control was changed. This last repair has offline regression evidence, **not** a new paid voice retest.

## Automated and local checks

- 509 targeted tests passed after the final voice-derived repair, across task coverage, reuse, recovery, evidence parsing, context/delivery, table state, and opening/session safeguards.
- 173 controller/comparison/trace tests passed, with one database-gated test skipped in that batch.
- 27 isolated database checks were verified across the initial run and the corrected single-test rerun. The initial mock incorrectly expected one provider pass for a vague response; the new coverage audit correctly required bounded recovery, and the fixture was corrected. This is not represented as one all-green database run.
- 28 browser states passed across English/Spanish and two viewport widths, including missing deadlines, retained comparison members, and exact named-program matching.
- The production build passed. Existing bundle-size and third-party `use client` warnings remain.

Eight real research runs and six native voice calls were attempted in this campaign. The shared ledger conservatively accounts for/reserves **$4.9771 of the approved $5**. Voice/TTS reservations remain charged against the cap; this is not a final provider invoice. No further paid validation was started after reaching that reservation level. Decisions reply recovery and comparison Decisions were disabled in the native trials, so these results do **not** establish a new Decisions benefit.

## Remaining boundaries

- Requirement recognition is deliberately conservative and lexical. The original question is retained, but arbitrary compound research questions are not guaranteed to be understood perfectly.
- The existing eight-finding response limit remains. Missing requested entities/facts are now exposed rather than silently counted as complete.
- Official-source eligibility covers educational `.edu`/`.gov` sources and established application/transfer systems. Unknown private scholarship organizations are not automatically trusted.
- Recovery is bounded. A source can remain inaccessible or fail to publish the requested detail.
- Intro wording, voice selection, speaking pace and existing interruption/floor rules are not changed by these phases. No guarantee of universally natural speech is inferred from automated checks.

## Validation artifacts

All current artifacts are under `output/broad-research-phases-20261111/`: research inputs/output and timing, offline replays, fresh retests, shared spending ledger, native voice PCM/transcripts and controller events, and local test output. Browser artifacts are under `output/playwright/research-desk/`, including the new `broad-missing-deadline-*` cases. Existing earlier artifacts were preserved.
