# Decisions need continuity — isolated v1.3 validation

Implemented November 8, 2026 UTC on `v1.3-decisions-integration`.
The experiment remains default-off. No commit, push, deployment, migration,
production access, or microphone-app restart was performed.

## Changes

| Improvement | Implementation | Boundary |
| --- | --- | --- |
| Recognize the help a caller needs | Nine independent Decisions predicates distinguish simpler explanation, example, starting point, related follow-up, correction, resolution, revised need, missing subject, and observed assistant handling. | The application derives eligibility. Uncertain classifications cannot force a cue. No classifier-generated prose enters Live. |
| Keep an unresolved need available | Exact native transcript prefixes can retain a provisional observation while background words arrive. New evidence and the retained state revision must be reclassified before delivery. | Scope, source IDs, connection, output evidence, 90-second expiry and three-contribution limits remain enforced. A retained prefix alone cannot authorize delivery. |
| Deliver only useful quiet support | Short fixed English/Spanish thinking notes support an explanation, example, or manageable starting point. Current assistant evidence can suppress unnecessary support. | Existing intro, output, playback, research/delegation and pending-context protections remain. No response wait, forced announcement, audio cancellation, or duplicate retry was added. |

The classifier is optional and parallel. Research classifications remain
observe-only. Temporary support is local call state, not a permanent student
label, provider conversation object, or private model reasoning.

## Library review

[Review record](NEED_CONTINUITY_GUIDANCE_REVIEW.md) documents complete manifest
coverage of 45 Responses, 30 Decisions and 35 conversation-state entries using
the approved unique-content method, plus saved references and current relevant
official guidance. No saved document was unavailable. Prior complete Decisions
coverage was reused with focused contract rereads; this is not a claim of two
new full-library passes.

OpenAI's guidance shaped the separation between independent observable
classifications and application-owned actions, between provisional transcripts
and completed turns, and between a quiet append, its acknowledgment, and
actual audio. Predicate probability is not multiple-choice confidence. The
thresholds are experimental application policy, not provider guarantees.

## Real classifier results

All examples are fictional. No live voice or research tool is used by this test.

| Rubric / dataset | Full expected result | Classifier p50 | Classifier p95 | Interpretation |
| --- | ---: | ---: | ---: | --- |
| v5, 40 development cases | 13/40 | 178 ms | 471 ms | Overlapping multiple-choice judgments withheld too much support. |
| v6, same 40 development cases | 32/40 | 167 ms | 512 ms | Independent predicates improved recognition; partial background and state changes still failed. |
| Final v7, same 40 development cases | 36/40 (EN 17/20; ES 19/20) | 212 ms | 564 ms | Prompt clarification improved resolution and replacement needs. Two EN partial-background and two topic-change cases still missed. |
| Final v7, independent 28-case holdout | 21/28 | 170 ms | 546 ms | EN 9/12; ES 9/12; mixed language 3/4. Not used for prompt tuning. |

The holdout had 12 correct eligible results, no unwanted eligible results,
four missed eligible results, and 12 correct withheld results. Required local
clearing succeeded in 2/5 cases. Both unfinished-background cases and both
corrected-subject cases missed support. Both already-addressed cases and a
mixed-language topic change failed to clear the old need. Withholding a cue
is not the same as correctly recognizing that Origen already handled it.

The frozen holdout source hash is
`80b57098dc93f45fc3921cea044bca2727de346d5a6aa9167dac01bc378129a5`.
The independent author prepared the text before receiving development results;
the file was published only after the final rubric freeze. No holdout labels
or prompts were changed after the test.

Reports, with provider IDs, source versions, probabilities, timing and costs:

- `../.local/early-classifier-1794123643962/results.json` — v5 development.
- `../.local/early-classifier-1794124032019/results.json` — v6 development.
- `../.local/early-classifier-1794124182172/results.json` — v7 development.
- `../.local/early-classifier-1794124287659/results.json` — frozen holdout.

## Voice comparison

The paired comparison uses the same fictional confirmed student, cached caller
audio, voice configuration, intro path, and local support settings in both
conditions. Only early note delivery changes: shadow records eligibility without
writing, enabled permits the protected note. English runs shadow first; Spanish
runs enabled first. Existing lasting-preference and accepted-offer support are
held constant. Each call has four questions and a 180-second hard ceiling.

This is a small synthetic comparison, not a human warmth rating or statistical
proof of improved conversation. The model hears the caller's confusion directly
in both conditions. Browser RMS detects audio activity, not intelligibility or
understanding. The fixture starts with an already confirmed student; it does
not reproduce a fresh account login or a multiple-student selection.

| Language / mode | Intro first audio | Median first audio after caller audio ended | Range | Early notes / acknowledged |
| --- | ---: | ---: | ---: | ---: |
| English, shadow | 0.79 s | 1.80 s | 1.41–1.89 s | 0 / 0 |
| English, enabled | 0.95 s | 1.49 s | 1.22–2.23 s | 1 / 1 |
| Spanish, shadow | 0.89 s | 1.42 s | 0.87–1.86 s | 0 / 0 |
| Spanish, enabled | 0.83 s | 1.70 s | 1.19–1.88 s | 1 / 1 |

All four calls ran four scripted questions, with no provider/browser errors or
hard-limit cutoff. These timings measure first detected browser audio, including
acknowledgments, **not time to a complete or useful answer**. There is no
consistent speed improvement: English was slightly faster and Spanish slightly
slower in this small sample. Native voice never waited for Decisions.

Both enabled calls sent exactly one simplification note while caller input was
still open, before observed assistant output. Provider acknowledgment preceded
the first answer's detected audio by 7.28 seconds in EN and 6.54 seconds in ES;
append-to-ack times were 534 and 672 ms. This confirms timely context receipt in
these cases, not that the note caused the eventual wording. No repeated early
note or forced speech command occurred. The preceding v4 Spanish trials had
zero early notes delivered; this v7 Spanish call delivered one.

Both conditions explained grants and loans in ordinary language. The enabled
Spanish answer used a gift-versus-borrowing example. Enabled Spanish follow-ups
still included `Déjame revisar`/`Déjame pensar`, so the result does not establish
elimination of filler or a consistently warmer voice. There were three native
delegations in each enabled call, versus zero EN/one ES in shadow; no research
tool ran. The sample does not establish a causal effect on delegation frequency.

**Test-driver limitation:** the Spanish shadow follow-up initially returned only
`Déjame aclarar eso para ti.` to the harness's two-second quiet estimator. Full
events show a substantive answer resumed during the following three-second
simulated-caller pause, and the next prerecorded question began before that
resumed thought finished. This is a test-driver advancement error, not evidence
that the model finished its answer. Do not count that reply as a successful
completed answer or use its first-audio time as useful-answer latency.

After the frozen comparison, the driver was corrected to recheck fresh audio
and transcript quiet before advancing and to include resumed output in its turn
text. Two offline checks reproduce resumed-output and fresh-transcript cases.
No new paid run was performed with that driver correction. Future validation
also checks sufficient classifier request allowance before starting paid voice.

Report: `../.local/need-continuity-live-1794124327858.json`.
All runtime hashes remained frozen for the four-call run. JSONL traces and
recorded WebM audio remain in the ignored local artifact directories; there is
no automatic deletion. No human listening assessment was performed here.

## Post-comparison state guard

The holdout audit exposed a concrete state bug: a confirmed changed subject
with an unidentified new support kind could leave the old validated need stored.
After the voice run, the parent guard was changed to clear that old need and
pending cue, advance its revision, and reject older in-flight candidates. It
sends nothing to Live. EN/ES regressions verify this behavior and prevent a
later continuation without an anchor; independent code review found no further
issue in the guard.

This conservative change is covered by **52 passing targeted offline tests**,
including two new regressions. It was not included in the four paid calls.
The tested pre-guard file is preserved as
`../.local/need-continuity-voice-frozen-early-support-delivery.mjs`.
The classifier remains v7 and the reported holdout scores are unchanged.

## Offline checks and isolation

Before voice validation, 433 Decisions tests passed and 63 existing voice
regressions passed. One database-dependent prepared-brief integration test was
skipped; no database was opened to run it. The saved 3,163-file isolation
baseline matched: 3,161 runtime files and the same two pre-existing reviewed
local hooks. This work did not edit those hooks.

Checks cover exact provenance, newer fragments, retained-need revisions,
short suffixes, delayed worker messages, corrections, missing output intervals,
scope/reconnect/language changes, intro protection, output winning the race,
stale playback, duplicate/ambiguous writes, bounded inference, durable logs,
budget holds and default-off configuration.

Final isolation verification still matches the baseline. The new state guard
and test-driver checks do not edit the production controller, intro, brief,
voice configuration, research routing, or UI. The cumulative distinct checks
are 437 Decisions/test-driver tests plus 63 existing voice regressions; the
final two changes received targeted reruns rather than a claim of another
complete 500-test run. One database-dependent test remains skipped.

## Cost and remaining allowance

Additional estimated settled usage for this task was **$0.528225638**:
$0.044245 Decisions plus $0.483980638 voice. Cached test audio was reused;
no new TTS requests were made. Three initial transport-unknown Decisions
attempts keep **$0.075 reserved** rather than being treated as free.

Including earlier usage and all retained unknown reservations, accounted
exposure under the combined $5 approval is **$3.461331213**. The allocation's
conservative maximum, counting both entire voice ceilings, is **$4.9635401**.
No budget ledger was reset or overspent. The refinement ledger reached its
fixed 200-request limit; it cannot classify another test until a separately
reviewed allocation is supplied. Monetary room does not automatically reopen
that request allowance. The microphone app was not restarted or enabled by
this task.

## Limits and next evidence

This implements the three mechanisms but does **not** establish reliable
conversation improvement in both languages. Keep the intervention experimental
and default-off. The next accuracy work should use a larger separately labeled
set focused on partial background, corrected subjects, topic changes and
already-addressed needs. Reuse these failures as development evidence, then
create a new untouched holdout. Do not relax speech or intro protection to
improve the apparent delivery rate.

Human microphone testing should assess whether the explanation is clearer,
shorter and warmer, whether a late cue is ever noticeable, and whether ordinary
replies remain immediate. A classifier result or provider append acknowledgment
alone is not evidence that the conversation improved.
