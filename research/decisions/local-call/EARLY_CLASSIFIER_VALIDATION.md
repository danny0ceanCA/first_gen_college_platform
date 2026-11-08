# Early Decisions classification validation

Initial run: November 8, 2026 UTC. This is an isolated local validation of
provisional text. It does not measure live voice delivery or prove a more
natural conversation.

The reviewed guidance distinguishes transcript fragments from completed turns,
classification from authorization to speak, and context acknowledgment from
playback. The classifier therefore evaluates semantic sufficiency separately
from the proposed support action, and application thresholds still gate use.

## Initial real API result

Run artifact (ignored local directory):
`research/decisions/.local/early-classifier-1794119666313/results.json`

| Measure | English | Spanish | Combined |
| --- | ---: | ---: | ---: |
| Authored fictional cases | 8 | 8 | 16 |
| Exact expected result, including thresholds for useful support | 4 | 7 | 11 |
| Expected support actions eligible for delivery | 3 of 5 | 4 of 5 | 7 of 10 |
| Inappropriate actionable support in ordinary/quoted/unfinished cases | 0 of 3 | 0 of 3 | 0 of 6 |

Median request time was **158 ms**; the 95th percentile was **562 ms**.
Provider-reported input-token cost was **$0.000913**. All 16 calls returned
complete usage; there are no unknown charges from this run. It consumed 16 of
the fixed 80 new Decisions requests, leaving 64 requests.

Five strict mismatches remain in this initial result:

- English unfinished speech selected `simplify`, but with low confidence and
  `meaning_ready: false`. The application correctly withheld support.
- Both languages missed continuation of the earlier unresolved explanation.
  They selected `none` with low confidence. This is a missed opportunity,
  not an unsafe injection.
- The English changed-topic case selected `clear`, below the delivery threshold.
- The English quoted-confusion case selected `clear`, below the delivery
  threshold. It did not cause actionable support.

No confidence thresholds were lowered and no retries were performed for this
initial result. These are authored development cases, not an independent holdout.
Live English/Spanish testing is still required to measure timely use,
interruptions, unnecessary speech, and preservation of the intro.

## Rubric clarification and one fixed retest

`early-conversation-2` clarified classification priority: explicit resolution or
topic change and follow-ups about an unresolved explanation take precedence
over the generic ordinary-question rule. A `clear` classification requires
existing temporary support. Confidence thresholds stayed unchanged.

The same 16-case suite was run once after all four rubric unit tests passed.
Its artifact is
`research/decisions/.local/early-classifier-1794119807715/results.json`.

| Measure | English | Spanish | Combined |
| --- | ---: | ---: | ---: |
| Exact action and semantic-readiness labels | 8 of 8 | 8 of 8 | 16 of 16 |
| Strict success including delivery threshold | 7 of 8 | 8 of 8 | 15 of 16 |
| Expected support actions eligible for delivery | 4 of 5 | 5 of 5 | 9 of 10 |
| Inappropriate actionable support in negative cases | 0 of 3 | 0 of 3 | 0 of 6 |

Both languages now recognized continuation of the unresolved explanation. The
remaining strict miss was an English acknowledgment of understanding: the
correct `clear` label had selected probability 0.89, below the required 0.90,
so local state was not cleared from that classification. This did not authorize
a spoken cue, and it must not be described as a perfect pass.

The retest median was **156 ms**, with a **447 ms** 95th percentile. It cost
**$0.0010442**. Immediately after those two runs, the new Decisions ledger had **32 of 80 requests**,
**$0.0019572 spent**, **no held charges**, and **48 requests remaining**. These
classifier timings are independent of speech/playback latency. The revised
rubric was developed against this same suite, so a separate holdout and real
call evidence remain important limitations.

## Later partial-clause checks: versions 3 and 4

Two later authored checks examined whether a complete statement of confusion
remains meaningful when the caller continues with unfinished background, while
an unfinished correction should still be withheld. These are different case
sets and rubric versions; their scores must not be combined with the original
16-case results or treated as an independent holdout.

| Rubric and scope | Exact action/readiness labels | Strict success including thresholds | Useful support eligible | Inappropriate actionable support in negative cases |
| --- | ---: | ---: | ---: | ---: |
| `early-conversation-3`, 4 English and 4 Spanish cases | 6/8 | 5/8 | 1/4 | 0/4 |
| `early-conversation-4`, 2 English and 2 Spanish cases | 4/4 | 2/4 | 0/2 | 0/2 |

Version 3 artifact:
`research/decisions/.local/early-classifier-1794120875266/results.json`.
Strict success was 2/4 English and 3/4 Spanish. The English complete-clause case
selected the expected `simplify`/ready labels but did not meet the confidence
gate. Both elaboration cases were incorrectly classified as `unclear` with
meaning not ready. All four unfinished-correction/object cases were withheld.
Median request time was **197 ms**, the 95th percentile was **449 ms**, and usage
cost was **$0.000582**. All eight requests reported usage.

Version 4 artifact:
`research/decisions/.local/early-classifier-1794120995396/results.json`.
This is the **current final rubric**, which distinguishes unfinished background
after an identifiable confusion from an unfinished correction of the confusion
itself. Both elaboration cases now returned the expected `simplify` and ready
labels, but their readiness confidence remained too low: English confidence
0.40 / selected probability 0.70, Spanish 0.50 / 0.75. Both were correctly
withheld by the unchanged delivery gate. The two unfinished-correction negatives
returned the expected `unclear`/not-ready labels and caused no actionable cue.
Strict success was 1/2 in each language. Median request time was **182 ms**, the
95th percentile was **574 ms**, and usage cost was **$0.0002547**. All four requests
reported usage.

No confidence threshold was weakened: both the action and meaning-readiness
classification still require confidence at least 0.85 and selected probability
at least 0.90 before a useful support action is eligible. These results expose
missed opportunities rather than prove effective early delivery. The original
full 16-case suite **was not rerun under version 4**; its earlier 15/16 strict
score belongs only to version 2. There were zero voice calls, research calls, or
Live cue deliveries in either partial-clause classifier check. Real audio
comparisons and their separate timing/evidence limitations belong in
[EARLY_RESULTS.md](EARLY_RESULTS.md).

## Budget accounting

The user's increased **$5 total cap** includes the prior validation:

- The two old Decisions ledgers are exhausted at 80 and 20 requests, with
  $0.0527733 settled total and no held Decisions charges.
- The complete earlier voice allocation of $2.50 is counted, including its
  $1.60 of unknown reservations. Nothing was released or reset.
- The new voice allocation is $2.10 and the new Decisions allocation is $0.30.

The conservative maximum combined exposure is **$4.9527733**. The budget helper
opens prior ledgers read-only, checks limits before every new reservation, and
preserves all unknown usage until verified.
