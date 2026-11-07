# Research continuity and call presence

Date: November 7, 2026. Branch: `v1.2`. Starting commit: `11226f11075496984f4e7e4ddfc01dae01549f04`.

This is a local implementation and regression review following the findings from call `36d31706-9b65-4783-8356-902f6791463a`. No new production call was made. Changes remain uncommitted; nothing was pushed, deployed, migrated, or changed in production.

## Library review

Before edits, the team reviewed the saved `OPENAI_RESPONSES_REFERENCE.md`, the local configuration audit and measurement plan, and all 45 pages in the November 6 manifest. Repeated generated schemas were reviewed using the previously approved unique-content approach, with duplicate/schema differences checked. No document was unavailable or intentionally omitted.

Manifest coverage, using zero-based positions:

| Reviewer | Manifest entries | Count |
| --- | --- | ---: |
| Primary | 0, 2–5 | 5 |
| API/schema reviewer | 1, 6–17, 39–44 | 19 |
| Research backend reviewer | 18–30 | 13 |
| Call indicator reviewer | 31–38 | 8 |

Relevant current official guidance was checked, then revisited during implementation and the independent review:

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): preserve task context, reuse still-valid results, distinguish backend completion from spoken delivery, and return complete useful findings. Standalone Responses and Live event contracts remain distinct.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting): keep ordinary conversation responsive and delegate work when needed. No new live prompt, forced speech instruction, or interruption mechanism was added.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations): context acknowledgment is not proof of speech or playback. Tests continue to treat these separately.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema compliance does not establish factual accuracy. Application validation preserves qualifications and new uncertainty.
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search): retain source-linked evidence and citations. Inherited sources keep their original check time.

The library is development reference material; it is not added to runtime model context.

## Changes

| Problem | Change | Intended effect |
| --- | --- | --- |
| The research handoff cleared the caller's actual question. A generated comparison question then made older campuses appear equally important. | Preserve accepted caller turns across the handoff and subsequent evidence versions. Prefer the latest explicit request; treat comparison prefaces as background. Recognize brief English/Spanish corrections. | Answer the question the caller just asked and avoid an unrelated comparison announcement. |
| A fall-entry cohort plus its academic year, or an annual amount with term breakdowns, incorrectly blocked reuse. | Match the same cohort/year and retain an explicitly cited annual amount even when it includes semester/quarter details. Keep changed-year, population, scenario, and freshness checks. | Avoid needless repeat lookups without deriving unsupported totals or extending evidence to a different student population. |
| A failed repeat check could downgrade a still-valid earlier answer. | Restore the exact server-selected verified finding only for a compatible, uncited failed recheck. Preserve its original qualification and source date. Never overwrite newly cited uncertainty/conflict. Record `retainedFindingCount` in the result. | Keep already-established facts available while preserving genuinely new evidence. |
| “Tuition separately from total cost of attendance” caused optional budget research and warnings. | Share a bounded English/Spanish requested-aspect parser across research preparation, recovery, reuse, and delivery. Explicit requests for both still retain both. | Research the narrow question first and skip recovery for an unrequested budget. |
| A material caveat appeared only in the top-level brief and disappeared from the selected finding. | Require material caveats per finding; propagate clearly attributed, source-linked clauses by subject and aspect. Decline ambiguous attribution. Keep the 700-character bound; use the complete qualified report if a unit would exceed it. | Short answers keep their applicable limitations, without mixing campuses' qualifications. |
| The research cancel button added an unwanted control during a call. | Remove the visible Cancel search button. Call-end cleanup and internal cancellation remain available. | Simplify the call surface without changing research lifecycle behavior. |
| The call signal needed a more polished continuous animation. | Add slow sage/copper orbital rings, satellites, a central O, and a subtle aura, driven only by active-call state. | Signal an ongoing call without implying that the user is interrupting Origen. |

The intro, voice selection, greeting/recap timing, microphone/audio transport, and binder behavior were not changed. Existing quiet context delivery, native answer tracking, and safe announcement opportunities remain in place. No extra model pass or artificial waiting period was introduced.

## Verification

| Check | Result |
| --- | --- |
| Conversation, research delivery/replays, actual adapter event ordering, intro/selection/style/startup, and presence regressions | 407 passed; 4 existing database-dependent tests skipped |
| All server research tests plus shared question-intent tests | 119 passed; 4 existing PostgreSQL-dependent tests skipped |
| Combined distinct automated checks | **526 passed, 0 failed, 8 skipped** |
| TypeScript and Vite production build | Passed; existing large-chunk warning remains |
| Rendered call indicator at 1342px desktop, 390px mobile and 320px mobile | No horizontal overflow; English/Spanish labels checked |
| Reduced motion | Zero running indicator animations |

The conversation command was:

```text
node --test src/researchPrimaryReplay.test.mjs src/researchDelivery.test.mjs src/researchConversationReplay.test.mjs src/researchFindings.test.mjs src/liveResearchContext.test.mjs src/researchDiscussion.test.mjs src/researchSpeechObservation.test.mjs src/studentLiveChannel.test.mjs src/voicePresenceState.test.mjs server/voice-selection-recovery.test.mjs server/voice-selection-timing.test.mjs server/voice-style.test.mjs server/voice-startup.test.mjs server/voice-welcome.test.mjs
```

Backend and build commands:

```text
node --test server/*research*.test.mjs src/researchQuestion.test.mjs
npm run build -- --configLoader runner
```

English/Spanish fixtures cover brief acknowledgments, genuine interruptions, short campus corrections, changed questions, explicit comparisons, partial/final result ordering, research arriving mid-answer, failed rechecks, qualified retained findings, and the actual fall-cohort/annual-period shapes from the reviewed failure. Eight new adapter tests exercise the transcript → task handoff → mid-answer evidence → final recovery sequence. The existing welcome test's stale case-sensitive assertion was made case-insensitive; its runtime wording was unchanged.

An independent code review found two additional edge cases in the first backend draft: overwriting newly cited uncertain evidence, and losing separately attributed caveats in a multi-campus paragraph. Both were corrected and regression-tested before completion. A final exact mixed-campus fixture verifies that Irvine's unnamed eTech discrepancy survives when Berkeley's retained comparison is present, without transferring that caveat to Berkeley or transferring an inaccessible budget-page limitation to the tuition answer.

## Limits and next live check

These are deterministic replays, mocked worker/provider responses, and rendered UI checks—not new English/Spanish voice calls. They establish application behavior, not provider speech quality, actual listening experience, or a measured production latency improvement. Paid API spend for this task was $0. The skipped database checks require an isolated PostgreSQL test environment.

On the next authorized live test, confirm that the intro remains natural; ordinary follow-ups continue while research runs; a new campus answer arrives once with its caveat; a failed repeat check does not retract a compatible earlier finding; and the indicator stays steady across speaking, listening, and research. Inspect transcript and browser playback evidence separately. No claim of improved production timing is made from these offline tests.

The existing model-rephrased reused-citation parser still relies on source validation rather than independent numeric equivalence checking. This change's failed-recheck restoration uses exact prior validated findings and does not rely on that rewrite path. Subject matching also requires the subject to be present in returned evidence; malformed results omitting it remain a separate limitation.
