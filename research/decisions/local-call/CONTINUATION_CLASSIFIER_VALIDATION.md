# Confusion and conversational continuation validation

Validated locally on November 7–8, 2026. This suite sends fictional text to standalone Decisions; it has no voice connection, tools, student records, or ability to deliver a live cue.

## What changed

The existing ten-question request now includes two independent classifications. Temporary confusion is separated from ongoing communication preferences. Conversational acceptance is anchored to the immediately preceding offer to explain, give an example, or discuss a next step. It cannot authorize research, saving records, submitting forms, or other actions. The application separately decides whether a current, unsatisfied request can be delivered safely.

The complete real classifier suite below tested `conversation-support-2`. The parser rejects malformed answers, wrong question identity, incomplete probability distributions, and individual refusals. Caller/assistant transcript anchors are selected from vetted input; expected labels and account identifiers are excluded from API input.

## Real Decisions results

| Run | English | Spanish | Overall | Median request time | 95th percentile | Actual cost |
| --- | --- | --- | --- | --- | --- | --- |
| Initial policy | 15/16 | 16/16 | 31/32 | 186 ms | 557 ms | $0.0165173 |
| Clarified explicit-offer policy | 16/16 | 16/16 | 32/32 | 251 ms | 573 ms | $0.0166869 |
| Policy 3 targeted refinement | 4/5 | 4/5 | 8/10 eligible; 10/10 raw labels | 298 ms | 745 ms | $0.0052877 |

The initial failure classified a move to a new topic after reassurance as a declined offer. It was below the delivery thresholds (0.80 probability, 0.73 confidence), so it would not authorize recovery. Clarifying the difference between an explicit offer and general reassurance corrected the case. The complete suite was rerun once to check the changed classification instructions.

Both languages cover explicit confusion, unfamiliar terminology, explicit understanding, changed topics, ordinary acknowledgments, accepted examples, accepted next-step discussion, declined offers, incomplete speech, standalone acknowledgment, research offers, record-saving offers, quotations, stale offers, an already-delivered example, and ordinary follow-up questions.

Offline checks verify request construction, provenance anchors, incomplete latest speech, all valid label combinations, malformed values, refusal handling, isolation, input limits, and independent confidence gates. The existing preference tests also pass.

After that suite, a review identified a fragmented-acknowledgment edge case. `conversation-support-3` now retains the offer across at most two earlier brief affirmative caller spans (three total), within four seconds, in the same connection epoch and without intervening substantive speech. The latest caller identity remains current. Four additional English/Spanish chronology fixtures and boundary/epoch/incomplete-input tests cover the change offline; they do not expand the default paid 32-case suite. The 32/32 result above must not be described as a fresh full-suite result for version 3. Subsequent live validation is recorded separately.

The separately authorized `--refine` run tested ten fixed cases on policy 3: confusion, direct accepted example, excluded research offer, repeated acknowledgment, and changed question followed by acknowledgment, each in English and Spanish. All ten raw labels matched expectations. Both repeated-acknowledgment cases fell below the delivery threshold and therefore failed the actionable acceptance test:

| Repeated acknowledgment | Selected probability | Confidence | Result |
| --- | --- | --- | --- |
| English | 0.89 | 0.85 | Correct label; suppressed below 0.90 probability threshold |
| Spanish | 0.82 | 0.76 | Correct label; suppressed below probability and confidence thresholds |

The two changed-question negatives passed. The implementation safely avoids recovering an uncertain offer, but repeated affirmations can still miss useful recovery. No thresholds or runtime instructions were changed after this result, and no automatic rerun was performed. The per-case report is `.local/conversation-classifier-1794118217085/results.json`.

## Budget and evidence limits

The durable ledger is `research/decisions/.local/approved-continuation-decisions-budget.sqlite`: $0.50 allocated from the newly approved $3 budget, 80-request maximum, $0.05 reservation per request. These two runs used 64 requests and **$0.0332042 total**; no reservations or unknown charges remained. The local machine keeps full per-case provider request IDs, usage, latency, and classifications in the two `conversation-classifier-*` report directories.

Subsequent voice-observer tests exhausted that original ledger's 80-request limit at $0.0419885 total actual spend, with no unresolved reservations. The original ledger was retired rather than reset. A fixed refinement ledger (`approved-continuation-refinement-decisions-budget.sqlite`, $0.10 maximum, 20 requests) reused part of the unspent approved allocation; its guard requires the original ledger to be fully retired with no reserved charges and actual spend at most $0.40. Together with the fixed $2.50 voice allocation, the maximum remains within the approved $3.

The targeted classifier run began after seven refinement voice-observer requests and used ten more. The refinement ledger now contains 17/20 requests and $0.0091601 actual spend, with $0.0908399 unreserved and three request slots remaining. Combined actual Decisions spend across both ledgers is **$0.0511486**, including the voice-observer classifications. Voice/audio charges are tracked separately in the live validation report.

These are authored cases, not an independent holdout. API latency measures the classifier only; it is not caller-to-audio latency. Passing classifications does not prove that a cue was injected, a response was spoken, playback completed, or a person experienced natural conversation. The separate live validation must verify those stages and preserve the current intro.
