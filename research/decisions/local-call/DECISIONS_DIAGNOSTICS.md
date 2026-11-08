# Local Decisions diagnostics

These diagnostics belong to the isolated `v1.3` experiment. They do not change the production model, its intro, research routing, prompts, or stored student profiles. Lifecycle wrappers record the existing observer path. The optional early path adds a separate provisional-evidence tracker, a bounded nine-predicate classifier, and independent delivery records, as described below.

The preceding continuation trial adds two classifications to the existing ten
questions, in the same request. It changes inference eligibility, not snapshot
retention. Its separate fixed validation allocation is described in
[current results](CONTINUATION_RESULTS.md); earlier results below remain historical.

## Earlier Decisions evidence and delivery

`ORIGEN_LOCAL_EARLY_DECISIONS=true` is default-off and requires approved local
classification, conversation support, and continuation support. It is available
only through the isolated launcher. It does not enable native Live Decisions
triggers or change the existing intro. Research classifications remain
observe-only. The new path may classify meaningful caller fragments before the
application groups them into a completed-transcript estimate. It never delays
the normal voice reply.

Correlate early rows using `callId`, `studentId`, `language`, `connectionEpoch`,
`scopeEpoch`, `contributionId`, and `revision`. `sourceEventIds` identify the exact
native transcript evidence. After reservation, `operationId` links the request
and returned candidate; `requestId` is the provider's HTTP request identifier,
and `reservationId` links budget accounting. A delivered candidate additionally
has a Live `eventId`; its acknowledgment matches `client_event_id`. Not every
row has every field: reset/closed rows, pre-request skips, and requests that fail
before a provider identifier exists must not be treated as uncorrelated successes.

| Event | What it establishes |
| --- | --- |
| `early_native_evidence` | A validated native fragment updated provisional caller evidence. Its interval and source ID do not prove a completed turn. |
| `early_evidence_application_boundary` | The application grouped matching transcript evidence into a boundary estimate. `playbackComplete` remains `unknown`. |
| `early_evidence_boundary_ignored` | A boundary could not be safely attributed to current native evidence. It cannot finalize the current turn. |
| `early_evidence_reset` / `early_evidence_closed` | Scope/connection invalidation or stopped observation; old evidence must not be reused. |
| `early_observation_started` / `early_observation_failed` | A coalesced provisional snapshot entered the bounded early observer, or the observer failed. Start records include `triggerBasis`, `quietAgeMs`, and contribution/call evaluation ordinals. These events do not send context. |
| `early_decisions_started` | A budgeted request started, with rubric version, source stamp, request bytes, question count, evaluation count, evidence age, and budget state. |
| `early_decisions_completed` | Usage was settled and typed answers parsed, with request ID, timing, nine predicate probabilities/refusals, derived policy decision, and `freshAtWorker`. Worker freshness is not delivery permission. |
| `early_decisions_skipped` | A closed/stale snapshot or exhausted per-call allowance prevented the request. |
| `early_decisions_failed` | Invalid evidence, transport/parsing/accounting failure, or abort; `reservationRetained` distinguishes held unknown usage. No automatic retry follows. |
| `support_early_need_retained` | A verified older prefix identified a need while newer caller words arrived. This provisional local observation cannot authorize delivery. |
| `support_early_need_suspended` | A current unfinished correction blocked the retained need pending fresh evidence. |
| `support_early_resolved` | Current classification explicitly cleared the need or found a substantive answer in observed output. This is not proof the caller heard or understood it. |
| `support_early_validated` | The parent matched current scope, contribution/revision, source IDs, retained support revision, and predicate policy. It has not yet sent context. |
| `support_early_deferred` / `support_early_skipped` | The exact freshness, intro, playback, current-output, pending-context, duplicate, or rate-limit reason that prevented delivery. |
| `support_early_sent` | One fixed quiet note was written with its Live event ID and classification-to-send/evidence-age timings. This is not proof of provider receipt or audible delivery. |
| `support_early_send_unconfirmed` | The write was ambiguous. It remains an attempt and is never automatically resent. |
| `support_early_context_acknowledged` | The provider acknowledged context injection, with correlation and elapsed time. It does not establish speech, playback, comprehension, or benefit. |
| `support_early_provider_rejected` / `support_context_unconfirmed` with `kind:early` | The provider rejected the append, or no confirmed delivery was observed. |
| `support_early_state_cleared` / `support_early_reset` / `support_early_closed` | Temporary local support expired, was cleared by fresh evidence, changed scope, or ended with the call. |

The parent permanently closes a contribution's early delivery window once
assistant output is observed, including a short acknowledgment. Late support may
remain local for up to 90 seconds and three later contributions, but a new related
classification is required before reuse. New speech invalidates an older revision;
the parent checks source IDs again immediately before writing. These conservative
rules can miss a useful opportunity. Logs should show that as a skip or deferral,
not as a successful intervention.

The first two observation opportunities use `triggerBasis:bounded_accumulation`
with a 160 ms accumulation window; the second requires at least 16 bytes of new
evidence. The third slot is reserved for `triggerBasis:reserved_quiet_gap`, after
350 ms without a new transcript fragment, and needs only one additional byte
since the prior observation. This does not increase the limits of three per
contribution or eight per call. `quietAgeMs` measures a transcript-arrival gap,
not silence on the microphone or proof that the person finished. Native output,
stale evidence, intro, and playback fences can still prevent delivery.

Early classification uses nine independent predicates for the requested help,
relevance, corrections, resolution, and observed assistant handling. Predicate
probabilities are truth estimates, not choice confidence. The application derives
actions from them. `supportRevision` and `assistantOutputRevision` identify the
retained context used; `sourceTextEnds` preserves exact prefix provenance.
It permits at most eight requests per call; the completed-snapshot observer
permits 24 while early mode is enabled. The immutable 200-request, $0.30
refinement ledger accounts for both. The existing automated voice ledger has a
$2.10 ceiling. Counting the previous full $2.50 voice allocation and
$0.0635401 of exhausted prior Decisions usage gives **$4.9635401** maximum exposure
under the $5 total cap. Prior unknown reservations remain held. Budget failures
stop optional classification without blocking the ordinary voice conversation.

Keep runtime files frozen throughout paid baseline/enabled comparisons and record
the tested source version and flags with results. Compare input-evidence age,
classification duration, classification-to-send time, blocked-window reasons,
append acknowledgment, actual output transcripts, and browser audio/playback
separately. `contextSent` and `playbackClaim:false` deliberately prevent a model
result or an append from being counted as a heard answer. This instrumentation
does not itself demonstrate improved naturalness. See the version-specific
[classifier results](EARLY_CLASSIFIER_VALIDATION.md) and the separate
[audio comparison report](EARLY_RESULTS.md); do not combine pass rates from
different rubric versions or confuse label accuracy with timely context delivery.

## Where the evidence stays

Each call appends JSONL records to `research/decisions/.local/<call-id>.jsonl`. The worker does not truncate the file, expire records, rotate it, or delete it when a call closes. Its bounded in-memory maps do not remove disk records. These private local artifacts are ignored by Git.

Every row includes UTC `at`, `schemaVersion`, `callId`, `workerRunId`, `workerSequence`, and `workerElapsedMs`. `workerRunId` distinguishes workers that append to the same call file after a restart; sequence numbers are contiguous within a worker run. A `decisions_worker_closed` row confirms orderly completion. Its absence does not prove the call or inference completed.

The existing transcript observations remain separate rows. New API lifecycle rows contain identifiers, typed classifications, counts, timings, and accounting data. They do not contain API keys, authorization headers, raw request bodies, arbitrary provider error text, generated prose, or private model reasoning.

## Follow one observation

Join by `callId` and `fingerprint` before a request is reserved. After reservation, use `operationId`; after the HTTP response arrives, use `requestId` as the OpenAI request identifier. `reservationId` joins the durable budget entry. `studentId`, `questionId`, `sourceTranscriptIds`, `questionRevision`, `inputRevision`, `scopeEpoch`, and `connectionEpoch` explain which caller evidence was examined. Preference candidates additionally retain their separate caller/scope stamp.

| Event | What it establishes |
| --- | --- |
| `decisions_worker_started` | Worker settings, rubric version, approved ledger state, and research observe-only status. |
| `decisions_worker_packet_received` | Parent-to-worker arrival, original parent monotonic time, worker receipt time, and transfer delay. This is not browser/audio timing. |
| `decisions_snapshot_offered` / `decisions_enqueue_result` | Snapshot offered, whether queued, and duplicate/closed/limit decisions. |
| `decisions_request_prepared` | Request size and question names/count; time waiting for the worker's inference slot and building the request. Request contents are omitted. |
| `decisions_budget_reserved` / `decisions_budget_rejected` | Whether the existing durable budget authorized the request. |
| `decisions_api_started` | One attempt began. The client still has its bounded timeout and no automatic retry. |
| `decisions_api_completed` | Transport and JSON decoding completed, provider request ID, model and token/cache usage. The classification has not yet been validated. |
| `decisions_api_failed` | Known transport/status error or local timeout/abort. A timeout does not establish that provider work stopped or had no cost. |
| `decisions_budget_settled` | Reported usage was accounted, with cost and remaining allocation. |
| `decisions_budget_outcome_unknown` / `decisions_budget_settlement_failed` | Usage could not be safely settled; the reservation remains held under the existing rules. |
| `decisions_response_parsed` | Typed answers validated, refused, or invalid; classification results and parse duration. This is not eligibility to change the conversation. |
| `decisions_observation_finished` | Final observation status, stale/coalesced reason, total worker time, API/parse time and cost when known. |
| `decisions_preference_candidate_filtered` | Missing caller stamp, wrong scope, ineligible status, invalid result, or an already-forwarded caller contribution. |
| `decisions_candidate_forwarded` | An enum-only proposal reached the parent gate. Scope, confidence, intro, research, and playback checks still decide whether it can be used. |
| `support_preference_*` | Parent gate's validation, changed/unchanged state, deferral, send, provider acknowledgment, rejection, or uncertain delivery. These records are distinct from API completion. |
| `decision_observation_skipped` | Snapshot retained without inference: assistant-only context, duplicate caller evidence, or unchanged research. Records whether a paid request began. |
| `support_conversation_validated` / `support_conversation_skipped` | Typed confusion/continuation labels, confidence, current offer provenance, scope and caller-stamp checks. Validation alone does not send context. |
| `support_conversation_deferred` | Exact blocking reason, including speech underway, missed pre-answer window, uncertain playback, pending context, or rate limits. |
| `support_conversation_continuation_suppressed` / `support_conversation_continuation_expired` | A native answer already appeared, or the recovery opportunity expired. Transcript evidence does not prove playback. |
| `support_conversation_sent` / `support_conversation_context_acknowledged` | Attempted context delivery versus provider receipt, with operation/request correlation, timing and boundary evidence. Neither establishes that the listener heard it. |
| `support_conversation_provider_rejected` / `support_context_unconfirmed` with `kind:conversation` / `support_conversation_send_unconfirmed` | Provider rejection or uncertain delivery. Uncertainty does not cause an automatic resend. |
| `local_research_terminal_state` | Existing quiet research-state packet clarified, unchanged, or skipped, with job/revision evidence. It never establishes that a spoken answer was delivered. |
| `decisions_worker_failed` / `decisions_worker_closing` / `decisions_worker_closed` | Local observer termination and final budget state when an orderly close was possible. |

`transportAndJsonMs` includes the existing HTTP transport and JSON parsing. It does not separate provider inference from network time or measure first-byte arrival. `parseMs` measures application validation of typed answers. `totalWorkerMs` begins at snapshot offering, so a coalesced snapshot can have worker time without an API call. Candidate forwarding always records `contextSent: false` and `playbackClaim: false`.

The parent gate records delivery separately, including the provider acknowledgment delay and estimated quiet/playback boundary. A thinking-append acknowledgment confirms context delivery, not that a student heard, understood, or benefited from it. Live output transcripts and browser playback remain separate evidence.

## Relevant OpenAI contracts

- [Decisions guide](https://developers.openai.com/api/docs/guides/decisions): independent questions, typed answers, refusals, separate confidence/distributions, application thresholds, and usage accounting. The local experiment asks ten questions in one standalone request; it does not enable native Live Decisions triggers.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): application-owned task state, current request versions, quiet thinking context, and the distinction between append acknowledgment and spoken delivery.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations): transcript fragments and context acknowledgment are not authoritative complete-turn or playback evidence.
- [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization): measure the separate stages and avoid unnecessary serial model work. Logging stays in the existing local worker; no extra inference or voice-side wait was added.

The full saved library was reviewed before implementation. The separate local review record documents coverage and current official checks. These documents are development references and are never included in runtime model input.

## Validation and limitations

Offline tests cover lifecycle correlation, queue/API/parse timing, stale/coalesced observations, timeouts with unknown usage, retained reservations, redacted request/provider text, and forwarding without a delivery claim. Existing observer, bridge, isolation, and bilingual preference-session tests also run unchanged.

Run `node research/decisions/local-call/validate-decision-diagnostics.mjs` for a preflight. `--execute` makes exactly one fictional Decisions request through the actual worker and reuses the existing approved budget. It never opens a Live voice session. The initial real-worker check passed all ten checks, recorded 20 durable rows, and cost $0.0004235. Its transport/JSON time was approximately 468 ms. This validates the logging path, not natural conversation or playback.

The final authored bilingual classifier set had 64/64 correct raw preference action labels. Applying the actual conservative whole-snapshot confidence gate yields 31/32 passing scenarios (15/16 English, 16/16 Spanish). One English retraction was withheld because the unrelated `unchanged` pacing classification was uncertain. No thresholds were relaxed to hide that limitation. The corrected `eligibility-review.json` is retained beside the original `results.json`, and earlier runs remain available. A real microphone test is still needed to assess the experience across varied phrasing and timing.
