# Decisions API contracts review

Reviewed November 7, 2026 for a proposed Decisions integration. This is a documentation and read-only implementation review. No runtime code, configuration, production data, or provider session was changed. No paid API request was made.

## Review coverage and method

This reviewer owns manifest entries **18–27 and 29–30** (one-based), including the CLI, Python, TypeScript, HTTP, usage, Live creation, and both WebSocket references. All 12 files were available. Other manifest entries are assigned to the other reviewers; this note does not claim their coverage.

Both passes of **every unique content block** are complete: first for understanding, second for contract and edge-case verification. This is the user-approved unique-content review, not a claim to have read every repeated generated schema literally twice. The source files total **964,314 UTF-8 bytes**. Exact paragraph deduplication produced **2,564 distinct blocks, 156,865 content characters**, or 174,811 characters with manifest-index labels and separators.

Method: process the 12 files in the order below; split on `\n\s*\n`; strip only each block's leading/trailing whitespace; retain the first occurrence of each otherwise exact string. Differing wording, fields, limits, examples, and nullability are retained. There is no semantic summarization or approximate matching. The four endpoint-only pages introduce zero distinct blocks after their full resource pages. Those files were still parsed and compared. The 21 blocks unique to sideband are retained separately, including its no-replay and no-start semantics.

Paragraph deduplication does not preserve every repeated parent/child position. To address that limitation, the intact nested Live session schema was reread for all three question variants, delegation configuration, and transcript triggers. The ordered event contracts were checked again against current official pages and the actual adapter. Full request-shape tests are still necessary before implementation; this document does not establish API availability or runtime success.

| Entry | Snapshot (under `pages/api/reference/`) | Bytes | Blocks first introduced | Pass 1 | Pass 2 |
| --- | --- | ---: | ---: | --- | --- |
| 18 | `cli/resources/decisions.md` | 17,890 | 139 | Complete | Complete |
| 19 | `cli/resources/decisions/methods/create.md` | 5,804 | 0 | Compared/reused | Compared/reused |
| 20 | `python/resources/decisions.md` | 30,915 | 154 | Complete | Complete |
| 21 | `python/resources/decisions/methods/create.md` | 18,978 | 0 | Compared/reused | Compared/reused |
| 22 | `resources/admin/subresources/organization/subresources/usage/methods/decisions.md` | 8,947 | 103 | Complete | Complete |
| 23 | `resources/decisions.md` | 36,337 | 99 | Complete | Complete |
| 24 | `resources/decisions/methods/create.md` | 22,781 | 0 | Compared/reused | Compared/reused |
| 25 | `resources/live/methods/create.md` | 42,259 | 392 | Complete | Complete |
| 26 | `resources/live/primary-websocket.md` | 384,993 | 1,584 | Complete | Complete |
| 27 | `resources/live/sideband-websocket.md` | 346,844 | 21 | Complete | Complete |
| 29 | `typescript/resources/decisions.md` | 30,046 | 72 | Complete | Complete |
| 30 | `typescript/resources/decisions/methods/create.md` | 18,520 | 0 | Compared/reused | Compared/reused |

Exact source SHA-256 values at review time:

```text
18 ff746ca7b07db014fa55591c4244fbea3214a2308e65036f0c646cdd7a19705b
19 57589e9637a10300767fa4bc656f02b3351c0051039b992df795c5acac40d367
20 7b8ac9cc6ac58736db036fca8de82190ca053ec068695162ed6ae72e6b8ec797
21 7f29346cd7e803da52e10e1896a3c76c4e6f202964ff120560ac6e94e529994f
22 d30ace68b17e620f5c6fd06a4470117ce5889a82070f7cb621ce48857a48006e
23 02ba35060641fb10a7b962fe52e8aaeff57ab7372386f90f9ec2cd1890974cd9
24 81ed3d5acafa86851393852652fbaa33b1f44b2a85ac1a7ca14b273d4a9d06cd
25 5c7289656e05f2b7b8c31c9f5ea99dc04ac51e8b07e4591860940f0cb29dbbfc
26 d1d7071a9034840834d21fa9992070b10f64cce80960e774ed79277b0b3167a8
27 efcb6e9a56cc17a88ac9a61bcfb1c5414cda60f12c6db1b34cd71b957593448f
29 e75b79c39871068b5e9a13d5d362a30ef220a0155ef56cd9b7632ae5fa95d0cc
30 5cf5caabaa817cd03f115f400621f97f55ed3458712c0b352f0eff2aaa3a9f62
```

## Important contracts

### Classification and tool authority

Standalone `POST /v1/decisions` classifies supplied input with predicate, choice, or score questions. The reviewed contract supports `gpt-6-luna`, 1–400 questions, ordered answers, and per-question refusals. A classification is not a tool call, consent, selected student, verified research result, or completed action. Function calls/results in its input are evidence to classify, not instructions for Decisions to execute those functions. Keep all existing application authorization and guarded tool execution.

Require stable question names in Origen even though names are optional in the API. Validate answer count, type, name, finite probabilities, allowed typed choices, and refusal. A refusal, timeout, malformed answer, or unknown label is an unavailable classification, not `false`. Application thresholds require evaluation; confidence is not independently verified truth. Choice values can be strings or booleans, which remain distinct. Score levels number 2–10. These contracts were checked in the [current standalone reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

### Live supports two materially different options

The intact saved Live creation reference at lines 825–1039 configures **Decisions delegation**; lines 1205–1235 configure **independent transcript triggers**. They must not be confused. Native triggers can run while the existing delegation owner remains Responses. At most two triggers are allowed, one for each input/output transcript event type. The native questions accept choice, predicate, and score, with a maximum of 64. Trigger updates preserve omitted settings, replace supplied lists, and disable with an empty list. This was rechecked in the [current Live creation reference](https://developers.openai.com/api/reference/resources/live/methods/create).

No classifier cadence, debounce, concurrency, token budget, or per-call spending field is documented in the native trigger object. An application can disable triggers, but that is not proof of an exact per-evaluation cap. Trigger results identify a transcript delta using `source_event_id`; `trigger_id` identifies the firing rather than an Origen policy version. Do not assume one trigger result equals one completed caller turn. Do not replace `delegation.type: responses` with `decisions`: ownership is immutable within a session, and doing so for new calls would replace the working Responses tool workflow.

`decision.create` asks Live to evaluate configured questions and requires a unique event ID. The selected API reference alone does not establish which question set a manual evaluation selects when only independent triggers are configured. Do not build a supposed throttled native path around that assumption without the specific guidance and a contract test.

### Context and event boundaries

`decision.item.create/delete` change future Decisions inputs, not Live speech context, and creating an item does not itself evaluate questions. Native triggers use the transcript and shared Decision items. Input/output transcript deltas are fragments without a provider transcript-done event. App silence grouping remains an estimate. `decision.event` contains `event.type: decision.completed`, answers and usage, plus nullable delegation/source/firing IDs. Append acknowledgments show context acceptance, not spoken delivery. These distinctions were rechecked in the [current primary WebSocket reference](https://developers.openai.com/api/reference/resources/live/primary-websocket).

Native Decision items need application-side ownership by call, authenticated account, authorized student, permission revision, task revision and content version. On student change, revoke previous items for future evaluations, wait for the relevant acknowledgments, and reject results tied to the old revision. Deleting supplemental items does not erase earlier conversation history. Never interpret stale classification as permission to use old student data. A standalone request can instead supply an explicitly scoped bounded input snapshot.

Keep input and output transcript evidence separate from browser playback reports. Sideband attachment does not replay earlier events; missing history after a disconnect is a gap, not evidence that the user said nothing. No second provider writer is needed. Model instructions and voice are startup-only; ordinary Decisions integration should not change either.

### Cost and failures

Standalone caching supports a 30-minute TTL, an optional cache key, and explicit breakpoints. Explicit mode without breakpoints disables caching. Keep the reusable classifier rubric stable, but isolate account-specific input and use bounded recent context. Record input, output, cached, cache-write and reasoning token usage, latency, outcome, policy version and provider request ID per evaluation. Organization Decisions usage is aggregate accounting, not a substitute for per-call diagnostics. Do not sum cumulative Live audio usage events or confuse Responses token usage with Decisions usage.

The native automatic acknowledgment delay is not a guarantee of silence. Thinking/commentary appends cancel pending automatic acknowledgments session-wide. An observe-only classifier should emit neither of those events. Later classification-driven assistance should use the existing narrow delivery path; never introduce repeated instruction appends or forced speech on every transcript fragment.

## Current code and integration implications

Line numbers refer to the code reviewed in this working tree.

| Existing behavior | Evidence | Implication for Decisions |
| --- | --- | --- |
| Student calls use managed Responses with `gpt-6-luna`, low reasoning, low text verbosity, and server-side tools. | `server/student-live-session.mjs:96–101` | Preserve this owner and voice configuration. Add a separate observer rather than replacing delegation. |
| One native provider writer serves each physical call. Browser callbacks are bounded leases. | `server/voice-control.mjs:13–25`, `:63–91` | Keep one writer. A classifier returns observations to this owner, not independent tool executions or speech commands. |
| Raw provider events reach measurements before the adapter. | `server/voice-control.mjs:94–95`, `:220–230` | A small observer hook here can see native IDs and deltas without waiting for browser callbacks or altering speech. |
| Server-owned scope creates research queries, and scope changes clear reports/cache and cancel prior work. | `server/voice-control.mjs:47–53`, `:121` | Reuse these authorization boundaries. The classifier cannot accept account/student identity from its own answers. |
| Frontend data-channel authority is restricted; updates require a server-issued handle and current permission revision. | `server/student-live-session.mjs:98`, `server/voice-control.mjs:201–204`, `:240–249` | Do not expose arbitrary Decisions items/triggers to browser commands. Shared items must be server-generated. |
| Input is grouped after 1.1 seconds of quiet; continuation can reopen a provisional turn. | `src/studentLiveChannel.mjs:137–153`, `:193–215` | Do not treat the synthetic `transcription.completed` as provider certainty. Later fragments invalidate a classification's revision. |
| The adapter dispatches managed Responses events and has no `decision.event` branch. | `src/studentLiveChannel.mjs:247–329` | Turning on triggers alone would discard their results. A native integration needs explicit event/usage/error handling before enablement. |
| Generic native measurement tracks `response.event`, not Decisions events. | `server/live-measurements.mjs:26–46` | Add explicit Decisions metrics without changing current speech, Responses, or research timing. |
| The existing output boundary combines playback freshness, transcript punctuation and silence. | `src/studentLiveChannel.mjs:78–85`, `:155–169` | A classifier can advise on relevance/completion but cannot bypass playback/interruption guards or prove the listener heard an answer. |
| Live quiet context and managed Responses task state are updated separately. | `src/studentLiveChannel.mjs:340–350` | A Decisions state store is a third distinct context. Do not assume any of these stores automatically synchronize. |

The saved local reviews of bounded selection recovery, research continuity, and durable diagnostics were also read. They describe concrete earlier failure modes and deterministic checks, including a missed delegation, superseded questions, and the separation of context acceptance from playback. This reviewer did **not** retrieve new production diagnostics or listen to audio. Those historical review notes cannot establish the latest call's subjective naturalness or a new measured improvement.

## Recommended initial architecture

Use **standalone Decisions from the existing server controller, observe-only first**, while preserving managed Responses and the current worker. This is an engineering recommendation based on control requirements, not an OpenAI mandate to choose that mode.

1. Accumulate bounded transcript context and the existing authorized task state. Consider evaluation only when meaningful new text or task evidence arrives; skip unchanged text and trivial acknowledgments unless they materially change an open question.
2. Run a small named question set together, for example ordinary conversation versus new verified-research need, whether a correction changes the active request, whether relevant evidence already answers the current question, or whether the person appears to need help choosing a starting point. Classification does not generate the spoken answer.
3. Allow at most one request in flight per call and one coalesced newest pending snapshot, with hard per-call/per-account budgets and a short timeout. Never put the classifier in the audio or ordinary-reply critical path. Late results are discarded by scope/task/input revision. A classifier outage leaves current conversation behavior operating.
4. Persist decisions as observations with the transcript evidence span, policy version, proposed disposition and separate actual application action. Compare against human labels and existing behavior in English, Spanish and mixed language before allowing actions.
5. If calibrated evidence supports it, let narrowly eligible results advise the existing research-reuse/delivery controller. Only the guarded application can start research or schedule a warm, brief helpful suggestion at a genuine conversational opportunity. A classifier result alone must not select a student, write a record, cancel a task, or force speech.

Native **input transcript triggers alongside managed Responses** are a legitimate later alternative. They provide provider-side event correlation and shared Decision inputs. Compare their measured cadence, cost, latency and handling of corrections with the bounded standalone path. Output triggers multiply evaluations and invite reacting to Origen's own phrasing; defer them until a specific measured need exists. A new Render worker is not necessary for this first observer. If concurrency measurements later justify isolation, a classifier service can run the same bounded work while the existing server remains the sole Live writer.

## Required verification before enabling

- Schema fixtures for all answer variants, refusal, malformed answers, unknown labels, errors and timeouts; policy thresholds tested separately from schema validation.
- English/Spanish/mixed-language replays covering partial utterances, acknowledgments, correction after a pause, student change, research already complete, new campus/scenario, and results arriving during speech.
- Revision/order tests: one in-flight request, newest-pending coalescing, stale result discarded, permission revoked, browser resume, sideband loss, duplicate event, and no replayed tool or spoken announcement.
- Proof that observe-only mode adds no native speech/context/update events and changes no intro prompt, microphone/audio behavior, research action or stored student fact.
- Later paired live calls measure ordinary-response latency, useful research delivery, unnecessary lookups, repeated announcements and perceived warmth. Offline contract checks cannot establish those outcomes or a percentage of naturalness.

No Decisions integration is enabled by this review. The library remains development reference material and is not runtime context.
