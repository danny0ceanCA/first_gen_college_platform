# Validation and Decisions admission repair

November 11, 2026. Branch `v1.3-decisions-integration`. Local implementation and isolated fictional-data validation. Nothing committed, pushed, deployed, migrated, or changed in production.

## Scope and guidance

The application research validator and generation schema are repaired. The Decisions admission change applies to the isolated second-worker scout experiment; it does not enable that worker in the app or loosen live conversation/reply-recovery safeguards. Opening prompts, selected voice, speaking pace, audio floor, delivery timing rules and binder behavior were not edited.

The preceding complete 45-page Responses review is retained; the unchanged snapshots were verified against their manifest with Windows newline normalization during the comparison. Saved Responses and Decisions references and relevant Decisions, Structured Outputs, Live delegation, conversation/session-state and measurement guidance were reread for this repair. Current official guidance was checked before editing and relevant contracts checked again after changes. This is not represented as a fresh complete reread of every SDK schema this turn. No documentation enters model runtime context.

- [Decisions](https://developers.openai.com/api/docs/guides/decisions): choice probabilities and confidence are separate; set routing thresholds against labeled evidence and the costs of false positives/negatives.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): enforce supported nested `anyOf` field shapes at generation and keep application factual/coverage validation. Schema conformance is not source verification.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): background work must not block ordinary conversation; use the existing quiet-context path and keep receipt, speech and playback evidence separate.

## Changes

| Problem | Repair | Safeguard retained |
|---|---|---|
| Generic service metadata such as “FAFSA federal” was treated as a different academic program. | Recognize narrowly defined general admissions/FAFSA labels in both task coverage and reuse. | Named degrees, programs, campuses, applicant types and explicit years still require matching scope. |
| An institution label followed by “first-year applicants” was treated as a different institution. | Accept that bounded applicant suffix when the validated admissions record supports it. | Other campuses, nursing programs and arbitrary appended names remain excluded. |
| Recovery called different prose or step wording a conflicting value. | Preserve the independently cited first fact and quarantine the alternate text for review. Different step sequences are not merged or promoted to complete. | Changed numeric/date values still become explicit conflicts; different prose is not declared semantically equivalent. |
| The model returned prose in numeric-only fields or exceeded prose limits, discarding otherwise useful research. | Nested fact-type schema branches enforce null fields and the same prose length bounds used by the validator. Conditions belong in qualifications or separate cited facts. | No silent removal of conditions, conversion of unsupported prose into verified numbers, or relaxation of source/citation validation. |
| A correct task choice was withheld solely because confidence was below .8. | Require independent support probability ≥.8, chosen-option probability ≥.6, margin over runner-up ≥.2, and confidence ≥.3. | Malformed/refused answers, weak support, near ties, known work, refusals and stale requests remain blocked. Ordinary replies never wait for this optional classification. |

The scout records `classification_completed` with the raw choice, confidence, choice probability, support probability, margin and admission reason. Reasons distinguish invalid choice/distribution, insufficient support, weak choice, ambiguity, low confidence and admission. Existing pending/known-task coalescing and revision fencing remain in effect.

## Verification

### Offline and regression checks

529 targeted tests passed, including bilingual scope checks, citation/record validation, saved research replay, recovery, voice/table context, opening/session safeguards and scout gates. An additional controller suite passed 173 tests with one database-gated skip. The new tests preserve incomplete step sequences, reject unrelated campus/program matches and retain numeric conflicts. A final audit also corrected the top-level summary so a quarantined alternative cannot leak back into speech when the accepted record retained the original sequence; the 529-test suite was rerun successfully afterward. The build passed; the existing bundle-size warning remains.

The previous four saved public research cases now have complete requested coverage when replayed through the repaired validator. This is offline replay evidence, not a new source lookup. The earlier Spanish FAFSA case no longer discards valid first-pass steps because of generic program metadata.

### New Decisions test set

After freezing the new policy, 16 new authored bilingual cases were tested through the real Decisions API: four positive opportunities and four negative cases per language. Decisions admitted all eight useful tasks and withheld all eight negatives. Negatives included ambiguous references, emotion without a research need, a resolved/superseded task and quoted fictional dialogue. On these same returned Decisions responses, the old .8 confidence cutoff would admit only three of eight positive tasks. This comparison isolates the admission rule on saved responses; the new request also asks an independent support question, so it is not a randomized old-prompt/new-prompt experiment.

This is a small authored holdout, not a production calibration or universal accuracy claim. The original 22-case comparison outputs remain available unchanged.

### New public-source research

| Task | Earlier comparison | Final fresh retest |
|---|---|---|
| Fee-waiver options, English | 24.85 s, two passes, incomplete coverage | 14.81 s, one pass, complete coverage |
| Fee-waiver options, Spanish | 29.37 s, two passes, incomplete coverage | 11.61 s, one pass, complete coverage |
| Parent accepting FAFSA invitation, English | 12.36 s, one pass, complete | 9.63 s, one pass, complete |
| Parent accepting FAFSA invitation, Spanish | 27.62 s, two passes, downgraded steps | 13.33 s, one pass, complete |

The first two fee-waiver retests still failed because the model populated invalid numeric/prose fields. Those failures are retained in the artifacts; they motivated the schema repair. The fee-waiver figures above are fresh subsequent calls using that repair. The FAFSA calls preceded the final schema tightening but used the same repaired coverage logic and returned valid field shapes. These single runs do not establish statistical latency improvement or rule out future source failures.

### Native voice

English/Spanish native call results and exact outgoing context are under `output/worker-validation-repair-20261111/voice/`. The harness uses generated fictional caller audio and real provider PCM/transcripts, with the same eight-second replay delay as the preceding comparison. It replays this campaign's freshly retrieved FAFSA results rather than performing another web search during the call. Human microphone/browser playback and the opening recap are not tested. Decisions reply recovery remains off.

| Native trial | English | Spanish |
|---|---:|---:|
| First audible response | 2.38 s | 1.75 s |
| Parent-account fact appeared in initial output transcript | 11.20 s | 9.74 s |
| Account follow-up first audio | 1.53 s | 2.06 s |
| Scout candidate | Accepted | Accepted |
| Extra lookup on account follow-up | None | None |
| Topic change to essay | Followed | Followed |

Both three-turn calls completed with no provider API errors. Both stated that the parent must use their own account, rather than the child's, and followed the request to discuss the essay. No simulated overlap was recorded at the account follow-up. This is not physical speaker/talk-over verification.

The English classification had confidence .76, selected-choice probability .82, support probability .99, and margin .64: it would have been withheld by the old confidence-only gate, but the new evidence-based gate admitted it. The Spanish result had confidence .92 and was accepted; its new research record no longer suffered the earlier false downgrade. Formal tool requests joined the scout work, so the accepted result reached the existing formal research-delivery path; no separate standalone quiet enrichment was exercised. Context receipt or a correct answer that could come from model knowledge is not itself proof of a causal improvement in speech. One call per language does not establish universal naturalness or a statistical speedup.

The final top-level-summary safeguard was added after these calls and verified offline. The live trials used the fresh one-pass records, so they did not exercise that recovery-alternative branch.

## Artifacts and limits

`output/worker-validation-repair-20261111/` contains the shared approved $3 ledger, 16-case Decisions output, public research responses, preserved failed fee tests, final schema research retests, offline replays, regression results, native audio/transcripts and build results. The campaign accounts for/reserves **$2.16316 of the approved $3**. Unknown voice/Decisions/TTS reservations remain conservatively counted rather than being presented as an exact provider bill. No additional paid tests were started after completing the planned checks.

The scout remains a bounded prototype with three candidate tasks. Its gate is not applied indiscriminately to other Decisions integrations. Text alternatives are quarantined without deciding which phrasing is correct; genuine conflicting free-text policies can require further source review. Requirement recognition remains conservative and cannot guarantee perfect coverage for every compound question.
