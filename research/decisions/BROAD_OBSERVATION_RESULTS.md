# Broader Decisions observation — step 1

Branch: `v1.3-decisions-integration`. Prepared November 7, 2026 Pacific
(test artifact timestamps use November 8 UTC). Changes remain uncommitted.

The observer now covers several conversational situations across topics. It
still ends at diagnostics. No observation can send a cue, alter an intro,
start research, change a student, update a binder, or control speech.

## What changed

| Before | Available now | Why it matters |
| --- | --- | --- |
| Three narrow support categories: starting point, simpler explanation, next action | Those categories plus independent observations for changed questions, research relevance, incompatible comparisons, unwanted repetition and an explicit need for conversational direction | A family can ask for a simpler explanation while also changing a research question; the observer can record both |
| Transcripts without research state | A read-only copy of results already returned by the existing research owner | Research completion and relevance can be assessed against actual supplied findings rather than the assistant saying “I checked” |
| No scoped research evidence in the local bridge | Job/revision/status, question, source references and complete fact qualifications | Late results from another student and obsolete evidence are excluded; missing evidence stays explicit |
| Comparison facts could have scope in prose | Whole answer, subject, aspect and qualification are read together, with a separate sufficiency check | Null year/scenario fields do not hide dimensions that are explicitly stated in the answer |
| Narrow classifier logging | Versioned independent probabilities, applicability, task correlation and separate transcript/playback records | Reviewers can see a missed signal, a withheld judgment, or insufficient evidence without treating any of them as a delivery decision |

Coverage includes orientation, applications, financial aid, housing, family
language needs and graduate study. There are 24 paired situations: 24 English
and 24 Spanish cases. No real student records were used in the paid tests.

## Library preparation

The [review record](BROAD_OBSERVATION_REVIEW.md) documents reuse of the earlier
complete unique-content review, fresh checks of all 110 manifest pages
(Responses 45, Decisions 30, conversation state 35), fresh full rereads of the
relevant references/contracts, and current official guidance checks. All saved
pages were present and unchanged. This does not claim another literal reread
of every repeated generated schema.

The guidance shaped three important choices:

1. Independent Decisions questions share one evidence snapshot. Probabilities
   remain observations, not permissions or calibrated delivery thresholds.
2. The application owns research state and revisions. Findings retain their
   qualifications, and copied backend verification is not independent checking.
3. Standalone Decisions remains separate from Live delegation. No native
   trigger, append, speech command or cue channel was added. Source transcript
   intervals, estimated turn boundaries and browser playback stay distinct.

See the official [Decisions guide](https://developers.openai.com/api/docs/guides/decisions),
[voice Decisions guide](https://developers.openai.com/api/docs/guides/decisions-voice),
and [Live transcript guidance](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas).

## Verified preservation

- **121 laboratory tests passed**, including the original observer checks.
- **52 existing voice-controller regression tests passed**. Total: **173**.
- English and Spanish simulations through the real controller produced the
  same provider commands, research requests and application event types with
  observation enabled. These are simulated transcript tests, not audible calls.
- The research tap returns the original value/promise/error and makes no extra
  research requests. Repeated polls are deduplicated. Scope changes, late jobs,
  partial results, cancellation, missing evidence and queue failures are covered.
- Research received during an unfinished caller or assistant span is captured
  immediately; its classification waits for an estimated boundary. Observation
  never holds up the original voice path.
- The isolation checker matched all **3,163** protected baseline files, with
  the two previously reviewed local-only factory hooks pinned separately:
  **3,161 runtime files unchanged**. Those hooks were not changed in this step.

## Real Decisions tests

The completed retest used `conversation-observation-3`, eight named questions
per snapshot, model `gpt-6-luna`, and the standalone Decisions endpoint.
The original narrow rubric and CLI remain unchanged as a baseline.

| Final real test | English | Spanish |
| --- | ---: | ---: |
| Cases completed | 24/24 | 24/24 |
| Cases matching every expected observation/status | 22/24 | 22/24 |
| Median classification request duration | 216 ms | 191 ms |
| 95th percentile request duration | 461 ms | 346 ms |
| Support category correct | 24/24 | 24/24 |
| Support already addressed correct | 24/24 | 24/24 |
| Changed question, eligible completed cases | 23/23 | 23/23 |
| Research relevance, eligible cases | 8/9 | 8/9 |
| Comparison mismatch, eligible cases | 4/5 | 4/5 |
| Unwanted repetition, eligible completed cases | 23/23 | 23/23 |
| Need for conversational direction, eligible completed cases | 23/23 | 23/23 |

“Eligible” excludes expected unavailable/provisional judgments rather than
counting them as correct negative classifications. Relevance had fourteen
unavailable and one provisional case per language; comparison had eighteen
unavailable and one provisional case per language. Binary examples are small
and mostly negatives: there were only three changed-question, one repetition,
and two direction-needed positives per language.

The final aggregate is **44/48 exact cases**. Median request duration across
both languages was **204 ms**, p95 **461 ms**. This is observer inference time;
it is not added spoken delay, a turn-taking measurement or a naturalness score.

## What the test exposed

The initial completed run matched 39/48 authored cases under rubric version 2.
Two of those failures were fixture-label errors: asking for an interrupted word
(“the welcome what?”) was labeled as asking for a simpler explanation. The
words were preserved and only those two labels corrected, with rationale in
the fixture file. The original run artifacts were not rewritten.

Other failures informed a general rubric refinement: a useful partial finding
does not have to complete the whole answer; an added question need not cancel
an earlier request; and an explicitly incompatible dimension can be useful
even when the desired comparison remains incomplete. A short acknowledgment
is now tested as the literal latest utterance, matching the local projector.

The final run still exposes **two weaknesses, each occurring in both languages**:

| Remaining case | Observed behavior | Implication |
| --- | --- | --- |
| Comparison plus a request to explain a term | Support and changed question were recognized, but comparison was withheld as unavailable. English raw mismatch probability was 0.79 with sufficiency 0.17; Spanish mismatch was 0.08 with sufficiency 0.02. | Multiple active requests and comparison sufficiency need more representative calibration. Keep both raw judgments in diagnostics. |
| Bare figures without essential scope | The model marked research relevant even though year, scenario, units and qualifications were absent. Comparison itself correctly remained unavailable. | Relevance alone must never authorize delivery. Missing-scope relevance needs more work before any cue integration. |

These four mismatches are retained and reported. Gates were not weakened or
labels changed to hide them. This is acceptable as an observation experiment;
it is **not** a readiness claim for automated conversational intervention.
The paired cases were used during development, so they are not an independent
holdout and the exact-match result is not a real-world accuracy estimate.

## Cost and durable artifacts

The new approved cap was **$2**, separate from the older microphone ledger.
There were 96 completed Decisions requests across two full runs. Three earlier
transport failures under restricted network access were stopped before the
approved network retry; their outcomes remain conservatively reserved.

| Budget item | Amount |
| --- | ---: |
| Estimated usage from provider token reports | $0.0307234 |
| Held for three unresolved transport outcomes | $0.15 |
| Unreserved under the $2 cap | $1.8192766 |
| Total request reservations | 99 of 120 |

No voice API or research-generation charges were incurred by this validation.
Costs are usage estimates, not an invoice. The immutable local ledger and raw
diagnostics remain in the ignored `.local/` directory until deliberately removed:

- `broad-en-es-20261108-a/`: restricted-network attempt and conservative holds.
- `broad-en-es-20261108-b/`: original 48-case run and original expectations.
- `broad-en-es-20261108-c/`: final 48-case retest, including all four mismatches.
- `approved-broad-two-dollar-budget.sqlite`: approval-wide spending ledger.
- `broad-offline-tests.log` and `broad-controller-tests.log`: final local checks.

A non-private aggregate is saved in `broad-validation-summary.json` beside
this report. The runner supports offline validation without API credentials.

## What still needs a microphone call

The broader observer has not been evaluated during a new human microphone
call. That is needed to check noisy transcripts, real interruptions, longer
conversations, the twelve-evaluation per-call limit, and any observable
resource overhead. Observation alone intentionally cannot improve spoken
behavior yet. Its next use is to gather evidence before choosing a narrowly
tested, separately authorized intervention.

The already-running local app was not restarted by this step. On a later
local launch the worker loads the broader policy; its existing microphone
ledger and limit remain unchanged. The new $2 approval was only for fictional
validation. No cues, commits, pushes, deployment or production changes occurred.
