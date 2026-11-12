# Call 51ecfa24 diagnostic assessment

Read-only review of `51ecfa24-ddec-4257-9911-0cb12df8762e`, November 12, 2026.
955 private capture events, 298 research trace events and four job snapshots
were inspected from the isolated local database. No runtime changes.

## Backend and table performance

| Campus | Worker duration | Browser receipt to DOM commit | First total transcript fragment after table commit |
| --- | ---: | ---: | ---: |
| Berkeley | 262 ms | 47 ms | 10.1 s |
| Davis | 280 ms | 19 ms | 6.4 s |
| Irvine | 178 ms | 42 ms | 6.4 s |
| Merced | 234 ms | 19 ms | 24.3 s |

All four jobs logged `catalogReason=matched`, zero research input/output tokens,
and recovery `not_needed`. No worker Responses search was started. Queueing,
polling, delegated response work and audio are separate from worker duration.
For example Merced was queued about 7.7 s after the completed user transcript;
its table committed about 0.96 s after the final result was saved.

DOM commit is observed browser presentation, not proof of paint or attention.
The total timings above use transcript fragments, not end-of-answer timestamps;
they include spoken lead-in and cannot all be classified as silence.

## Confirmed issues

- Both Berkeley housing scenarios were initially displayed correctly, but no
  rental/family clarification was spoken. The caller later explicitly supplied
  renting. At that point the controller republished the original two-column
  report instead of projecting only the confirmed active scenario.
- Later additions grew the table to three, four and five columns, retaining
  the unwanted Berkeley family scenario. The reducer deliberately extends
  comparisons, so a confirmation needs an explicit scoped projection rather
  than relying on ordinary append/merge behavior. History should remain intact.
- The conversational follow-up about living expenses received “I'll look into
  that,” despite no new research job. This is a misleading preamble for an
  ordinary explanation, not a new research failure.
- Davis's natural answer was followed by a commentary request, and “It's not a
  bill” repeated. Irvine and Merced repeated the same caveat again. The
  unsolicited-delivery scheduler still permits extra contributions after
  native speech when semantic overlap/qualification recognition is incomplete.
- Merced's table was already populated at 17:36:48.284Z. A checking-style spoken
  message began around 17:36:55.287Z; its amount appeared around 17:37:12.630Z.
  This remaining delay is in spoken delivery/coordination, not the catalog.

## Rows and financial scope

The attached screenshot still contains Berkeley and Davis housing and food
amounts. Irvine's source groups these into one $22,541 allowance, so its separate
housing/food rows are blank. Earlier campuses have separate rows and no combined
source figure. These cells should communicate “included in combined amount” or
use a common parent row with inspectable components, rather than imply erasure.

Irvine's returned record has no separately reported insurance value. Its tuition
and fee grouping has a note warning against adding insurance without resolving
composition. The missing cell is not evidence of zero cost; it needs a visible
scope explanation. No new official-source financial verification was performed
in this diagnostic review. Davis's tuition/fee grouping also contains the $185
document fee in the saved component label; separating recurring and one-time
charges would improve the comparison without changing the published total.

## Guidance comparison and next repair

The saved Responses reference, relevant Live prompting/delegation and session
guidance were compared with the code and logs, along with current official
[Live prompting](https://developers.openai.com/api/docs/guides/live-prompting)
and [delegation](https://developers.openai.com/api/docs/guides/live-delegation).
These distinguish brief clarification from backend work and context receipt
from actual spoken delivery. This was a relevant-guidance review, not a new
complete reread of every saved snapshot.

1. Ask the meaningful housing question once; on explicit confirmation, narrow
   the active table without deleting saved alternatives or making a new lookup.
2. Reconcile mixed combined/separate categories visibly, preserving source
   amounts and avoiding double counting. Make unreported amounts explicit.
3. Once the relevant amount and caveat have been spoken, suppress additional
   unsolicited commentary for those same facts. Completed catalog results
   should not lead to another checking message.

No commit, push, deployment, flags, database writes or voice tests during review.
