# Conversation flow timing and the next context design

Date: November 4, 2026. Branch: Origen-Development. Local changes only; no commit, push, deployment, migration, or production write.

> The sections below describe earlier iterations. The latest validation is the Natural Conversation Step 3 section at the end of this report.

## Finding

The largest avoidable delay in the measured essay-support turn was a forced specialist handoff before Origen could offer ordinary encouragement. The database was not the dominant delay. In the earlier Spanish trace, the context HTTP request took 89 ms, while two sequential backend responses took approximately 3.07 and 2.94 seconds. Updating the provider context and returning to speech added more time. The substantive transcript began about 10.98 seconds after the synthetic user audio ended.

The handoff policy required essays to switch guides even for empathy. That coupled conversational support to specialist retrieval. A worker would not remove that policy bottleneck.

## Changes in this iteration

- Allow feelings, reflection, encouragement, phrasing help and adequately supported follow-ups to continue directly across topics.
- Allow one short clarification for a small missing detail or current preference. Do not require retrieval merely because information is absent.
- Preserve retrieval for missing historical evidence that cannot reasonably be clarified, conflicting evidence, genuine specialist teaching and current official requirements.
- Keep student-scope selection, durable writes, sharing, permission checks and recovery on their existing guarded workflows.
- Clarify that encouragement cannot introduce unsupported claims about what admissions readers expect.
- Strengthen the exact save-readback instruction, including pronouns. A clarification result is not a saved receipt.
- Add an offline timing report that separates backend response spans, context HTTP requests, matched provider context acknowledgments, tool invocations and transcript timing. Its output excludes transcripts, prompts, IDs and request bodies.

The official-source tools remain available. Current UC Berkeley cost of attendance, for example, requires an official-source check for the relevant year and circumstances; it is not answered from encouragement or an old personal summary.

## Measured comparison

Same fictional account, existing synthetic audio, real Live API, local isolated database. The earlier and new calls are separate runs, not a controlled production benchmark.

| Essay encouragement | Earlier run | First run after routing change | Backend responses after change |
| --- | ---: | ---: | ---: |
| English | 7.58 seconds | 0.81 seconds | 0 |
| Spanish | 10.98 seconds | 1.45 seconds | 0 |

These timings measure synthetic WAV playback end to the substantive transcript segment, not physical speaker onset. Transcript groups are inspected alongside the tool trace; the reporter's length/gap heuristic alone does not establish answer quality. Small samples do not establish production percentiles or an overall speedup.

A later Spanish repetition still chose an unnecessary handoff for encouragement (8.46 seconds). The policy was tightened to give conversation/clarification priority over topic keywords and divider highlighting. The subsequent focused English run answered encouragement in 1.32 seconds, asked a simple housing question in 1.31 seconds and accepted a conversation-only correction in 0.96 seconds, with no backend response or tool invocation for those three turns. This variability is why routing should continue to be evaluated rather than treated as a deterministic guarantee.

The final focused Spanish run answered encouragement in 0.99 seconds and asked a housing clarification in 0.85 seconds, also without backend calls or tools. The two-minute test-call guard stopped that run before its correction turn; that last Spanish case is untested, not a pass. Initial context confirmation remained slower: 7.94 seconds in the focused English run and 6.80 seconds in Spanish. The change improves unnecessary routing; it does not eliminate startup or genuine evidence latency.

Necessary operations are still slower. In the additional English run, an explicit essay-teaching request loaded the admissions teaching and answered in about 8.51 seconds; initial target selection took about 13.41 seconds. Earlier-history retrieval in the first English and Spanish runs took approximately 5.49 and 4.49 seconds. Removing unnecessary operations helps; it does not make necessary operations fast.

## Saving finding

The first English and Spanish runs exposed paraphrased mandatory readbacks. The application correctly refused to save; the Spanish speech nevertheless implied that a step had been saved afterward. Those runs are not successful save validations. The revised policy requires the complete readback word for word and distinguishes clarification from a successful save receipt. The subsequent English and Spanish checks each produced one saved plan after approval and correctly recalled it without writing another plan. More wording variants remain worth testing; a prompt is not a guarantee.

## Intended experience

Origen should behave like a prepared advisor: read a short brief, greet the person naturally, listen, and use relevant context without reciting the file. Missing or possibly changed details usually call for a quick question. The current conversation takes precedence over stale assumptions. Questions such as “what did my coordinator suggest last month?” justify targeted retrieval when the evidence is absent. College requirements and current costs still justify official research.

The current code has an important boundary: the fuller student context is delivered to the backend guide. The speaking model chiefly receives that information through completed backend answers; it does not yet receive the proposed compact private-history brief directly. The routing changes above should not be described as that larger redesign already being implemented.

## Proposed next phases

### 1. Deliver a compact brief at the start

Use the already authorized server-selected context to supply a small speaking brief after student scope is confirmed. Include the current school/stage, relevant goals, a few recent conversation threads, unresolved concerns and appropriate coordinator guidance. Carry source date, attribution and uncertainty. A parent's report stays a parent's report; a suggestion stays a suggestion. Do not supply all binder content or other students' context.

The brief is evidence, not an instruction source. Use it only when relevant, avoid an unsolicited dossier recital, and ask a short question when a plan may have changed. Conversation-only corrections should take effect immediately within the call without falsely claiming that permanent records changed. Scope changes must replace the brief and discard stale results before the next personal answer.

First validate the brief using existing context construction. Do not add a worker merely to deliver data already assembled quickly.

### 2. Prepare and maintain the brief outside the reply path

A worker can organize completed conversation material, deduplicate proposed notes and prepare a versioned brief before the next call. Build on existing summary/note processing rather than creating a second writer. Trigger jobs from relevant saved changes, coalesce repeated jobs, and use idempotency keys and source revisions. Recheck permissions and deletions before publishing an artifact.

Keep model-derived records distinguishable from confirmed student decisions, accepted next steps and independently verified completion. Background organization must not authorize sharing or claim a coordinator suggestion was accepted.

A call reads an authorized current brief; it never waits for a worker job to finish. If the artifact is unavailable or stale, fall back to available verified context and a natural clarification, without inventing history. Useful background preparation is the worker's role, not serving every utterance synchronously.

### 3. Retrieve only when the conversation needs it

Reuse the brief and evidence already delivered in the call. Prefer one focused question for mundane missing details. Retrieve a bounded historical item when necessary, and retain official-source research for fresh institutional facts. Refresh evidence at a safe turn boundary rather than repeatedly replacing the entire prompt mid-sentence. Do not suppress required workflow acknowledgments to shave off latency.

### 4. Measure conversational quality as well as time

Track time to a useful response, unnecessary retrievals/handoffs, correct reuse of earlier evidence, attribution, unsupported assertions, interrupted or stale writes, and repeated confirmation loops. Include English and Spanish, corrections, topic changes, uncertain goals and multiple-student accounts. Separately measure save receipt latency and end-of-call summary/note persistence. A quick “let me check” is not a completed answer.

## Evidence and limits

- Baselines: `tmp/exhaustive-remaining-pause-en/report.json` and `tmp/exhaustive-remaining-pause-es/report.json`.
- First routing checks: `tmp/exhaustive-flow-timing/report.json` and `tmp/exhaustive-flow-timing-es/report.json`.
- Save/teaching checks: `tmp/exhaustive-flow-final-en/report.json` and `tmp/exhaustive-flow-final-es/report.json`.
- Focused conversation/clarification checks: `tmp/exhaustive-flow-clarify-en/report.json` and `tmp/exhaustive-flow-clarify-es/report.json`.
- Reusable timing reader: `scripts/live-conversation-timing-report.mjs`.
- The combined local validation passed 101 tests; the final prompt/policy budget recheck passed 34 tests. The build passed. Cumulative tracked API spending across the guarded test ledger is approximately $4.17, below its $7 ceiling; this is a usage estimate, not an invoice.
- Test calls use fictional students and isolated PostgreSQL schemas. The harness does not implement production end-of-call summary persistence. It is not a full production voice or acoustic benchmark.
- One attempted Spanish call was blocked by the test campaign's call-count guard before a paid session was created, then rerun separately. The monetary cap remained in force.

The existing transport continuation follows the [OpenAI Live delegation documentation](https://developers.openai.com/api/docs/guides/live-delegation). This change avoids unnecessary delegations; it does not skip required tool-result continuations.


## Consolidated-guide comparison: November 4, 2026

**Result: ordinary conversation remains fast and uses context directly; the consolidated guide is not a uniform speed improvement.** Two complete 14-turn English/Spanish calls were compared with the previous continuous opening-brief test. No specialist-guide switches occurred in either completed call. All nine ordinary discussion turns per language had zero backend responses and zero tool calls. Historical recall and current official-source research still used tools.

Branch: `Origen-Development`, uncommitted working tree. No commit, push, deployment, production database write, or new TTS generation. Calls used the same cached synthetic audio and fictional Aiden/Elodie fixtures in a disposable local database. Source fingerprints: `tmp/unified-guide-cap5/metadata.json`.

### Timing trend

Seconds from synthetic input-audio completion to the beginning of a substantive transcript response; initial selection measures the ready-to-continue response. These are **not physical speaker-onset timings**. The CSV separately preserves first post-input detected output audio, backend-response counts and tool names. Acknowledgments such as “let me check” are excluded from substantive timing.

| Scenario | EN previous | EN current | ES previous | ES current |
|---|---:|---:|---:|---:|
| Select Aiden / ready to continue | 10.07s | 10.60s | 8.65s | 10.15s |
| Known college plans | 1.09s | 1.42s | 1.12s | 1.21s |
| Essay encouragement | 1.61s | 1.25s | 1.69s | 1.07s |
| Reflect on cousin/homework example | 0.05s | 1.29s | 0.96s | 1.51s |
| One gentle question | 1.32s | 1.51s | 0.87s | 1.16s |
| Clarify missing housing information | 1.60s | 1.66s | 0.83s | 0.72s |
| Prepare a commuting question | 6.28s | 1.87s | 1.76s | 1.68s |
| Correct option vs decision | 0.83s | 0.96s | 0.90s | 0.94s |
| Recall April 2024 campus visit | 7.38s | 10.43s | 5.07s | 5.50s |
| Verify current Berkeley costs | 30.86s | 23.41s | 35.30s | 29.57s |
| Explain cost of attendance vs bill | 1.15s | 0.90s | 0.70s | 1.00s |
| Recall earlier essay example | 1.24s | 1.27s | 0.83s | 1.29s |
| Switch to Elodie | 5.11s | Not answered | 4.82s | 5.22s |
| Return to Aiden | 7.05s | 5.47s | 3.72s | 4.30s |

English turn 13 produced “What school stage and plans do you have for Elodie?” after 11.02 seconds, although the new session configuration included her 11th-grade profile. This is an unsuccessful answer, not an 11-second successful lookup. Input transcription also dropped part of “interests”; that does not explain asking again for the school stage already supplied. Spanish turn 13 correctly used 11th grade and art.

The automated 90-character transcript heuristic initially reported Spanish official research at 35.94 seconds and return-to-Aiden at 10.30 seconds. Manual transcript review identified substantive answers beginning at **29.57** and **4.30** seconds respectively. Those reviewed values appear above; raw analyses remain unchanged and the overrides are recorded in `manual-review.json`. These corrections supersede the preliminary run commentary.

| Aggregate | Previous EN | Current EN | Previous ES | Current ES |
|---|---:|---:|---:|---:|
| Ordinary-discussion median | 1.240s | 1.289s | 0.901s | 1.164s |
| Backend responses on those nine turns | 1 | 0 | 0 | 0 |
| Specialist-guide switches | 1 | 0 | 1 | 0 |

Ordinary turns are 2–8, 11 and 12. English research improved by about 7.45 seconds, and Spanish by about 5.74 seconds using reviewed answer boundaries. Essay encouragement improved in both runs. Initial scope selection remained around 10 seconds; English historical recall and the Elodie handoff worsened. A single paired scenario per language does not establish production percentiles or statistical significance. The near-zero earlier English turn-4 value reflects response/input overlap, not a general 50ms performance claim.

### Conversation and context findings

- **Familiarity:** both calls used Sierra College, environmental studies and the tentative Santa Cruz option without another binder lookup or asking again for Aiden’s identity.
- **Empathy:** English began “That sounds discouraging for him.” Spanish began “Entiendo, y eso puede desanimar mucho.” Both invited an ordinary experience and a manageable reflection instead of writing the essay. The wording aligns with the supplied teaching/style guidance; this is observable behavior, not proof of internal reasoning or a causal attribution to one particular prompt. Vocal warmth was not independently rated.
- **Continuity:** both retained the cousin/homework/patience example across housing and financial-aid discussion and recalled it without a tool. Both treated Santa Cruz as an option and preserved the requested conversation-only correction.
- **Appropriate tools:** each completed call used one historical-recall tool and one official financial-aid research tool. Topic changes caused no specialist-guide switch. Both still used `highlight_binder_topics` before research, which consumed a separate backend step.
- **Scope defect:** English failed to use Elodie’s available profile after switching. Spanish answered it correctly. Both returned to Aiden’s correct college and tentative university status. No cross-student mix-up was observed, but scope continuity is not yet reliable enough to call solved.
- **Content defect:** Spanish called housing/food “gastos indirectos estimados” while answering an on-campus residence-hall example; the source result classified residence-hall housing/food as direct budgeted charges. The follow-up correctly explained that university housing/meal charges can be directly billed. The later correction does not erase the earlier misleading sentence.
- **Initial-attempt recovery defect:** the interrupted English attempt invoked research before the input turn finished; the application correctly returned `superseded_turn`. The model then unnecessarily asked the user to repeat the question before retrying. Only one paid research request ran in that attempt. Keep the stale-turn guard; improve how the model recovers from it.

The completed calls reported no browser page errors and provider usage was finalized for all sessions. Zero plans or student-memory records were added; four pre-existing fixture topic notes remained. The harness intentionally does not implement production conversation-summary persistence: expected 404s at scope-change summary requests mean this is **not** an end-to-end save or production validation.

### Where the wait remains

| Stage | English completed rerun | Spanish completed rerun |
|---|---:|---:|
| Official research HTTP request | 18.83s | 21.30s |
| Official research backend responses | 3 | 3 |
| Initial student selection, substantive ready response | 10.60s | 10.15s |
| Historical recall, substantive answer | 10.43s | 5.50s |

For English historical recall, the first backend response alone took 6.21 seconds, followed by another 1.31 seconds; the database is not the only source of delay. In the earlier captured English attempt, initial context HTTP took 0.68 seconds, while the session configuration acknowledgment took another 2.95 seconds. New student sessions contained approximately 80–87 KB of configuration. These stages overlap with other work; do not sum every diagnostic duration as a critical path.

Next work should be targeted: retain the single conversational guide; make scope-switch completion use the new brief before asking a question; keep visual highlighting off the research critical path; and replace the misleading “repeat your request” response after superseded early calls. A worker could let source research continue while conversation stays responsive, but it would not by itself remove provider search time or fix these scope/turn-boundary defects. No such product changes were made in this test task.

### Budget and interrupted attempts

Fresh user-approved ceiling: **$5** for the entire campaign, including retries. Four calls were attempted: one English call interrupted after 11 completed turns, one manually interrupted partial Spanish call, and the two complete reruns used in the main table. The English interruption involved 368.28 seconds of synthetic input playback on turn 12 and incomplete input transcription; its subsequent response timeout is excluded as a valid response-latency measurement. Its underlying browser/host cause is not established. The partial Spanish call was stopped while recovering diagnostics, not classified as an application failure. A 45-second input-playback timeout and per-turn diagnostic checkpoints were added to the test harness before reruns.

All finalized voice/backend usage estimates across the four calls total **$1.1646**. Keeping **$3.00** conservatively reserved for three official-research requests, plus **$0.20** voice safety margins, gives **$4.3646 accounted for**, below the $5 cap. Research reservations are not claimed as actual charges; this is not a provider invoice. No additional paid calls remain running.

### Evidence

- Baseline: `tmp/opening-brief-long/{report,analysis}.json` and `findings.csv` (preserved).
- Complete English rerun: `tmp/unified-guide-cap5-en/{report,analysis}.json`, `transcripts.txt`, `en-output.webm`.
- Complete Spanish rerun: `tmp/unified-guide-cap5-es/{report,analysis}.json`, `transcripts.txt`, `es-output.webm`.
- Interrupted attempts: `tmp/unified-guide-cap5/report.json` (preserved, not substituted for completed runs).
- Combined table and review: `tmp/unified-guide-cap5/comparison.csv`, `comparison-summary.json`, `manual-review.json`.
- Cumulative budget: `tmp/unified-guide-cap5/budget.json`. Raw artifacts are local/ignored; this report is the durable tracked summary.


## Follow-up implementation: items 1-3 (local, November 4)

Branch: `Origen-Development`. No commit, push, deployment or production mutation.

| Item | Local implementation | Still requires live validation |
| --- | --- | --- |
| Student handoffs | Confirmed selection answers the pending question from the new authorized profile/brief. Only name-only selections invite a new question. Scope restarts retain logical-call continuity while clearing the old provider context. | Elodie handoff should use her supplied stage without another stage question. Prompt contracts cannot guarantee model compliance. |
| Avoidable waiting | Live no longer exposes the presentation-only divider tool. Conservative English/Spanish transcript hints and known research categories update the UI locally through existing scope/turn checks. Ambiguous hints do not guess. Research/workflow tools remain intact; Realtime retains its highlight tool. | Confirm removal of the extra backend highlight step and measure useful-answer latency. Official search latency itself is unchanged. |
| Research/recovery | Stale early calls stay fenced but instruct the model to use the latest complete request without asking for repetition. Research progress starts after four seconds, defers during speech and remains capped/cancellable. Result instructions preserve source billing classifications. | Retest interrupted research and campus housing/meal explanations in both languages. Progress acknowledgments are not substantive answers. |

New `configuration_ack` diagnostics measure a matching context-update acknowledgment separately from existing context HTTP and backend-model timings. This does not itself shorten initial selection; it makes the next critical-path comparison more precise. The student privacy boundary and provider acknowledgment remain required.

Validation: focused suites passed, including supplied-stage handoffs in both languages, divider hints, stale-action guards, configuration timing, four-second progress and evidence preservation. One database-dependent integration case was skipped without `DATABASE_TEST_URL`. TypeScript and Vite build passed (bundle-size and Auth0 directive warnings). Existing payload-size caps are unchanged and pass. No new paid calls were made; the table above remains the measured baseline. No new latency improvements are claimed yet.

Local logs: `tmp/voice-items123-tests.log`, `tmp/voice-items123-extra.log`, `tmp/voice-items123-build.log`.


## Ten-question follow-up: items 1-3 live validation (November 4, 12:05-12:20 PST)

**Outcome: ordinary conversation remains fast; student handoffs are not reliable enough yet, and official research is still slow.** No commit, push, deployment or production data writes. Testing completed on `Origen-Development`.

Two continuous logical calls, one English and one Spanish, each used the same ten prompts and cached spoken audio. Fixtures were fictional: Morgan, Aiden at Sierra College, and Elodie in 11th grade interested in Art. No real family history was sent. The harness uses the actual browser voice component, API handlers and Live provider with an isolated local PostgreSQL schema.

### Manually reviewed answer timing

Time is from the end of synthetic input playback to the first substantive answer transcript delta. Acknowledgments and echoed user words are excluded. These are not first-audible-sound measurements or production latency percentiles. Previous results use the same prompt/audio subset from the prior 14-question campaign; surrounding turn order differs. One run per language cannot establish a reliable trend.

| Question | English before | English now | Spanish before | Spanish now |
| --- | ---: | ---: | ---: | ---: |
| Confirm Aiden / opening | 10.60s | 6.64s | 10.15s | 10.16s |
| Use known college plans | 1.42s | 1.11s | 1.21s | 0.89s |
| Encourage essay reflection | 1.25s | 1.36s | 1.07s | 1.39s |
| Discuss cousin / patience | 1.29s | 0.14s | 1.51s | 1.23s |
| Recall April 2024 visit | 10.43s | 7.14s | 5.50s | 5.80s |
| Verify Berkeley attendance costs | 23.41s | 30.95s | 29.57s | 26.66s |
| Explain budget versus bill | 0.90s | 1.01s | 1.00s | 0.77s |
| Recall cousin from this call | 1.27s | 0.94s | 1.29s | 0.64s |
| Switch to Elodie / known stage | Not answered | 13.21s | 5.22s | Not answered |
| Return to Aiden / no final decision | 5.47s | 13.19s | 4.30s | 4.90s |

Matched ordinary-turn median: **EN: 1.27s before, 1.01s now; ES: 1.21s before, 0.89s now**. All five ordinary questions in each language used zero backend tool calls. Background memory HTTP activity still exists; zero tool calls does not mean zero network activity. The 0.14s English example response is unusually early and sensitive to synthetic playback/VAD boundaries.

### Quality and regression findings

- **Opening and current history:** both languages used Sierra College / environmental studies / UC Santa Cruz as an option, not a confirmed choice. English mentioned biology programs; inspection found the seeded note `Compare biology programs.` in supplied context, so that reference was grounded.

- **Empathy and essay ownership:** English began with recognition of discouragement and invited one ordinary moment. Spanish also acknowledged discouragement and emphasized authentic everyday experiences. Both supported reflection without writing the essay. This is transcript-content evidence, not a listening assessment of vocal warmth.

- **Older history and in-call recall:** both found the April 2024 botanical-garden visit through the explicit recall tool, and later remembered cousin/homework/patience without another tool. Database retrieval itself took 83ms EN / 102ms ES; model delegation and resumption contributed most of the remaining wait.

- **Elodie handoff remains a failure:** English eventually used 11th grade / Art, but first recited the caller request. The automatic metric incorrectly marked 5.12s as a useful answer; manual review places the actual answer at about 13.21s. Spanish asked the caller for stage/interests instead of answering. The supplied Spanish configuration did contain Elodie, 11th grade and Art. This is a context-use/handoff problem, not simply missing stored fields. No observed Aiden facts were attributed to Elodie.

- **Return handoff:** English spoke a caller-like uncertainty preamble before answering correctly. Its automatic 4.21s metric was misleading; the useful answer began around 13.19s. Spanish returned correctly at 4.90s. Prompt-only handoff changes have not fixed this reliably.

- **Official research:** source answers arrived at 30.95s EN / 26.66s ES. The provider search request alone took 22.63s / 19.53s. No `highlight_binder_topics` or guide-switch backend call occurred. Removing that tool did not guarantee a faster overall research answer: English was slower than its earlier sample, Spanish faster. Both correctly explained that campus residence/meal charges are billed while the complete attendance budget includes non-billed estimates.

- **Recovery and progress:** English made one early stale research call; the guard returned `superseded_turn`, then the current request ran once successfully without asking the caller to repeat. Spanish executed one research request. Progress speech began 9.02s EN / 8.29s ES after input ended, roughly 4-5 seconds after research began. It acknowledged the wait; it did not provide an additional conversational exchange during research. Both sessions finished without browser page errors. This does not exhaustively test cancellation, disconnects or interrupted writes.

### Timing interpretation and next priority

Initial context HTTP was 0.49s EN / 0.57s ES; matching configuration acknowledgments took 2.87s / 2.14s. Total initial answer waits were 6.64s / 10.16s. Stages overlap and should not be added as if all are sequential. The source lookup and post-handoff model behavior are larger concerns than local database retrieval speed.

Next, repair handoff resumption so the speech model receives an unambiguous pending-question instruction without voicing the caller request. Verify supplied-profile use in both languages. Separately prototype asynchronous official research with a concise acknowledgment and safe conversational continuation, delivering results only to the still-current scope/turn. Adding a worker alone would not fix the observed handoff failures or shorten the search provider request. No further application code changes were made during this measurement campaign.

### Budget, boundaries and evidence

Fresh authorized ceiling: **$5**. Finalized voice/backend usage estimates total **$0.6864** across all physical sessions. Retaining **$2.00** conservatively for the two research calls and **$0.10** safety margins gives **$2.7864 accounted for**, below the cap. Research reservations are not actual charges; this is not an invoice. Cached audio incurred no new TTS generation. All test calls have ended.

This test validates conversation behavior, context delivery and tool flow, not production microphone conditions, summary persistence or binder-writing behavior. The fixture omits the final-summary endpoint; expected summary persistence failures there are not classified as production defects. Existing fixture notes were not created by the test conversation.

Evidence: `tmp/items123-cap5-ten/{report,analysis,manual-review,metadata,budget}.json`, `comparison.csv`, `transcripts.txt`, `en-output.webm`, `es-output.webm`, and `run.log`. Raw artifacts remain local/ignored. Source hashes and the branch were captured in metadata. The same source was used for both calls.

## Natural Conversation Step 3 — local validation

Branch: **Origen-Natural-Conversation**. Implemented and tested locally; no commit, push, deployment, new migration, or production write.

The existing research call now produces a short source-linked brief and a retained detailed report together. The brief includes the answer, material qualification/unknowns, and an optional next step. Live receives that complete brief and its cited sources; invalid or oversized briefs fall back to the full report without cutting off conditions. The server-owned `read_research_details` tool can retrieve the current completed report without repeating a web search. Ordinary explanations still use the conversation and supplied context directly.

Live testing also exposed a circular handoff wait: the server awaited a browser continuation while the browser held it until the server finished. All required tool results now trigger server continuation immediately. Late browser continuations are deduplicated so they cannot resume or close a newer tool batch. The initial trace had a 35-second callback timeout with zero results outstanding; the comparison traces below had no callback timeouts.

### Observed comparison

Real synthetic audio, the isolated copy of Aiden's account data, the actual local research worker, and official-source searches were used. Seven prompts covered student selection, a source check, essay encouragement, simplifying an explanation, applying the findings, missing-detail recall, and thanks.

| Language / result | Prompts sent | Research | Context packets / bytes | Context injection ACK | Ordinary first sound, median | New searches on ordinary turns | Outcome |
|---|---:|---:|---:|---:|---:|---:|---|
| English / full report | 7/7 | 23.24 s | 11 / 4,840 | 3.91 s | 1.56 s, n=4 | 0 | All prompts sent |
| English / brief | 7/7 | 17.65 s | 4 / 1,742 | 1.96 s | 1.57 s, n=4 | 0 | All prompts sent |
| Spanish / full report | 3/7 | 25.87 s | 12 / 5,363 | 4.32 s | 1.25 s, n=1 | 0 | 65-second wait cutoff |
| Spanish / brief | 7/7 | 24.71 s | 4 / 1,835 | 1.89 s | 1.32 s, n=4 | 0 | All prompts sent |

The brief reduced supplied context bytes by about **64–66%** in these examples, and context acknowledgment took roughly half as long. English ordinary first sound was essentially unchanged. The research duration varied; this small sample does not establish a causal improvement in search speed. Origen continued answering ordinary questions while research ran, with no new external searches on those turns.

“First sound” can be an acknowledgment, not a substantive answer. A context ACK confirms injection, not that the model used the finding correctly or that the caller heard it. Review the recordings alongside the transcripts. A transcript group already underway while the caller was speaking is not counted as a fast answer candidate.

The Spanish full-report answer combined essay support with a long cost recap, exceeding the harness's per-turn wait. It is an incomplete scenario comparator. A prior brief run reached the 200-second overall call limit; its completed repeat used a 300-second limit. These cutoffs remain in the raw evidence, and completion is not presented as a controlled speed improvement. The English pair predates advertising `read_research_details`; the Spanish repeat includes it. Direct report reading passed offline scope/revision and authorized API checks; these voice scenarios did not specifically request that tool's additional detail.

### Budget and evidence

The new authorized ceiling was **$5**. The ledger conservatively accounts for **$4.3709**, including initial diagnostic attempts, retries, retained uncertain reservations, and safety allowances. That is an upper accounting allowance, not an invoice. Existing WAV files were reused, so there were no new TTS generation charges. All paid test calls ended.

Final automated verification: **206 tests passed, zero failures or skips**, including disposable PostgreSQL checks, server/browser transport, stale continuation and scope guards, brief/citation parsing, and diagnostic reporting. `npm run build` passed with the existing bundle-size advisory. The isolated test database was returned to its prior stopped state.

The final-summary provider endpoint was excluded by the test budget gate; expected summary-save failures in this harness are outside this conversation/research comparison. No production records were accessed for writes.

Sanitized measurements: [timing summary](../../output/playwright/natural-step3-final/timing-summary.json). Recordings: [English full report](../../output/playwright/natural-step3-final/full-en.webm), [English brief](../../output/playwright/natural-step3-final/brief-en.webm), [Spanish brief](../../output/playwright/natural-step3-spanish-complete/brief-es.webm). Raw local traces and the budget ledger are under `output/playwright/natural-step3*` and `tmp/natural-step3/`; they remain uncommitted. The offline timing utility is `scripts/live-conversation-timing-report.mjs`.
