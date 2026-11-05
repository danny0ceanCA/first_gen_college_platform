# Development voice latency — Phase 1

Implemented locally on `Origen-Development`, November 3, 2026.

## Purpose

Measure where a voice turn spends time before changing context selection,
prompts, retrieval order, or infrastructure. This phase adds instrumentation and
repeatable checks. It does not demonstrate a conversation-speed improvement.

## What is measured

| Boundary | Evidence and limits |
| --- | --- |
| Student starts/ends speaking | Realtime provider VAD, or Live transcript boundaries. Live's end is estimated after 1.1 seconds without transcript updates. |
| Context request | Browser monotonic duration through HTTP response headers; does not include JSON parsing. |
| Context preparation | Server durations for profile, memory, history, workspace, retrieval, continuity, coordinator context, session guards, opening selection, teachings, version checks and negotiation. Repeated stages are aggregated in `Server-Timing`. |
| Delegated model response | Live backend response-created to terminal event receipt, before waiting for input finalization and application tools. This is an observed interval, not pure model compute time. |
| Tool execution | Handler entry to function-call output, separate from model time. `returned` means an output was returned, not that a write succeeded. |
| Answer candidate | First transcript increment beyond a small English/Spanish acknowledgment vocabulary; known progress/farewell responses are excluded. This is a heuristic, not proof of a useful answer. |
| First/candidate audio | Non-silent remote audio samples, while the playback element is playing and unmuted. Candidate audio is the first observed sample after candidate text, not a precise alignment to the spoken word. Sampling is approximately every 100 ms. It cannot prove the user heard or understood the sound. |
| Turn outcome | Completed candidate, interruption, model failure/cancellation/timeout, or call closed before completion. |

Each private timeline has a session, connection attempt, turn index and monotonic
offset. Reconnection attempts remain separate. A late backend or tool result keeps
its original turn. Old audio cannot become the next turn's fast answer.

Fast answers can begin before Live's estimated speech-end boundary. These overlaps
are counted explicitly and excluded from latency percentiles. Missing measurements
remain missing; they never become zero-millisecond successes. Tool/request times
can overlap and must not be added together to calculate total response time.

The old `origen.backend.finished` event remains for existing response controls.
It can include input finalization and tool handling. Use the new
`backend_model` measurement for the model's observed interval.

## Storage, privacy and overhead

- Full timing markers use the existing batched, private diagnostic archive for the
  already opted-in account. This change does not enroll additional accounts in
  transcript capture or change its retention/access rules.
- Operational telemetry receives bounded numeric measurements and fixed stage
  names, not student names, transcript text, tool arguments, or answers.
- Only context-request, backend-model and turn-complete markers produce additional
  operational HTTP uploads; individual audio samples do not create requests.
- Server context phases use the existing diagnostic logger and response header.
  No migration, worker service, or new permissions are required.
- Logging failures do not change tool results, block replies, or retry writes.

## Inspecting a test

Export the existing private-capture records for the desired diagnostic session
using the authorized diagnostic read path. The report accepts its `{ "events":
[...] }` response, an array of records, or operational JSONL. Use one source per
report, rather than combining duplicate private and operational records. Include
all pages of a paginated export for the interval being measured.

```powershell
node scripts/voice-timing-report.mjs tmp/voice-timing-capture.json > tmp/voice-timing-report.json
```

The output includes per-call timelines, stage durations, outcome counts, missing
observations, and p50/p95/max latency. English and Spanish, and estimated versus
provider speech boundaries, are reported separately. The output omits transcript
content and account/provider identifiers. Request references remain available in
the original authorized archive if server log correlation is needed.

The private context-request marker also includes numeric `contextDurations` read
from the server response. Realtime remains a pass-through transport; its delegated
model interval is not reported as a Live backend measurement.

## Repeatable English/Spanish baseline

Use a fixed fictional student fixture, published teaching revisions, model settings
and release. Record browser/device, language, network conditions, active topic,
and whether context was prepared. Keep those conditions constant when comparing
future phases. Do not copy production student information into a test without
authorization.

| Scenario | English example | Spanish example | Review |
| --- | --- | --- | --- |
| Existing plan | “What were we considering for my transfer?” | “¿Qué opciones estábamos considerando para mi transferencia?” | Relevant saved context without reconstructing the history. |
| Specific recall | “What did I say about next term's statistics course?” | “¿Qué dije sobre estadística para el próximo periodo?” | Correct source, no invented enrollment or completion. |
| Missing fact | “What grade did I get in chemistry?” when no grade is saved | “¿Qué calificación saqué en química?” when absent | Acknowledge missing information instead of inventing it. |
| Correction | “That campus is an option, not my final decision.” | “Ese campus es una opción, no mi decisión final.” | Existing correction/confirmation safeguards are preserved. |
| Coordinator guidance | “What did my coordinator suggest?” | “¿Qué me sugirió mi coordinador?” | Only currently permitted guidance; suggestions are not accepted actions. |
| Official-source lookup | Ask a question requiring the existing official-source tool | Repeat the equivalent question in Spanish | Separate research time from model and playback time. |
| Interruption and recovery | Interrupt a delayed reply, then change the question | Interrupt and switch the question in Spanish | Old work does not act on a new turn or distort its timing. |
| Failure | Simulate a timeout, cancelled request and disconnected call | Same faults | Missing/failed results are counted, not hidden as successes. |

Start with smoke tests, then collect at least 20 eligible turns per language and
condition before treating percentiles as more than exploratory. A substantive
answer and warm tone still require transcript/audio review. Timing cannot certify
empathy, correctness or use of a teaching.

## Existing evidence, not a new end-to-end baseline

Previously saved isolated test artifacts showed a delegated response lasting
43,175 ms with medium reasoning. Saved runs after the earlier low-reasoning change
showed English backend intervals of 1,139–3,310 ms and Spanish intervals of
920–3,078 ms. Those tests reported history retrieval in tens of milliseconds.

These are small historical samples with different settings. They do not establish
current end-of-speech-to-answer latency or prove retrieval caused the delay. The
artifacts lack the new correlated speech/playback boundaries. No new paid voice
call or production test was made for this implementation.

## Local validation

Deterministic tests cover delayed tools, early acknowledgments in both languages,
actual audio observation versus text, interrupted and stale work, timeout/failure,
overlapping estimated boundaries, teardown, logging failures and safe reporting.
Existing onboarding consent, stale-write rejection, language switching and voice
handler tests run alongside them. The PostgreSQL-backed preparation test needs
`DATABASE_TEST_URL`; it is skipped when that fixture is not configured.

Phase 2 should use these measurements to select a specific bottleneck. A new
worker or a broad prompt rewrite is not justified by timing instrumentation alone.
