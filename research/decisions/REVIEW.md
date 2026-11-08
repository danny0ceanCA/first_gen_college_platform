# Library review and implementation checkpoints

Prepared on the local `v1.3-decisions-integration` branch, November 7, 2026
(America/Los_Angeles). No production data or voice calls used.

## Preparation coverage

- Read the saved Responses, Decisions and conversation-state references.
- Reused the Decisions library's prior two-pass audit: full guides/supporting
  documents and exact unique-content API-schema review, with relevant nested
  contracts rechecked. Recorded source hashes were checked for changes. This
  does not claim every repeated generated schema was literally reread twice.
- Reviewed all 45 Responses manifest pages and all 35 conversation-state
  manifest pages before editing. Exact identical content reused prior review;
  differing content was read. API-reference duplication was handled using the
  user's approved unique-content method.
- The large reference group produced 5,900 distinct blocks / 622,595 annotated
  characters. Three reviewers covered `[0,420000)`, `[420000,540000)` and
  `[540000,622595)` without gaps. All truncated outputs were reread.
- Reviewed the local Live configuration audit and measurement plan.
- No unavailable documents or unreviewed assigned sections remained.

The current official pages checked against the saved contracts were:

- [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- [Create a decision](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)

The API client uses the standalone Decisions contract. Responses continuation,
Conversations storage, Live triggers and Live append events are separate
contracts and are not enabled by this work.

## Guidance translated into implementation

| Guidance | Implementation / check |
| --- | --- |
| Typed named choice/predicate answers; a question can refuse. | Strict name/order/type/distribution validation. Refusal and malformed results stay unavailable. |
| Calibrate probabilities using application examples. | Fixed multilingual calibration/holdout splits; report counts and errors. No confidence-to-action shortcut. |
| Transcript fragments can be unfinished or corrected. | Partial spans and revised questions; immutable state fingerprints and stale-result rejection. |
| Application owns authorization, scope and task state. | Fictional scope and permission epochs; classifications cannot alter them. |
| Avoid blocking the conversation on optional work. | Synchronous enqueue, one request in flight, one newest pending snapshot; no app hooks or live dependencies. |
| Keep completed text, context injection and playback distinct. | Separate evidence arrays; no claim that classifier or transcript proves an answer was heard. |
| Endpoint-specific caching, usage and storage behavior. | Explicit cache mode without breakpoints; bounded standalone requests; no borrowed `store`, `background`, tools or Responses settings. |
| Evaluate task success, latency and cost independently. | Classification accuracy and API time measured separately from live speech, which this experiment does not change. |

## Checkpoint 1

State tests cover scope changes, corrections, stale findings, partial utterances,
forged snapshots, reconnect gaps, revocation, byte limits and evidence separation.
All 36 fictional fixtures fit the state and request bounds. No app files are
imported. The baseline fingerprint covers 3,163 existing non-document files.

## Checkpoint 2

Transport, budget, observer, integration and evaluation checks cover provider
failure, refusal, malformed usage, timeouts, newest-pending coalescing, duplicate
snapshots, stale completion, per-call limits and durable concurrent reservations.
The complete result and API-test limitations are recorded in RESULTS.md.
