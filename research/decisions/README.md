# Isolated Decisions observer — phases 1–2

> Production release update: the authenticated production entry point is documented in [Decisions production release](../../docs/voice-experience/DECISIONS_PRODUCTION_RELEASE.md). Local trial descriptions below remain historical. The isolated launcher still rejects production mode, and the research observer remains observe-only.

The application also has a separate, default-off comparison pilot. For an isolated API, set `ORIGEN_DECISIONS_COMPARISON_UPDATES=true` alongside `ORIGEN_BACKGROUND_RESEARCH=true`, `ORIGEN_LIVE_SERVER_CONTROL=true`, and `ORIGEN_RESEARCH_DELIVERY_V2=true`, and use a new authenticated Live call. It supports changing one 2026–27 California-resident entering undergraduate budget from a residence hall to living with family in a completed Berkeley/Davis comparison. Start with a report containing both verified budgets and their caveats. Ask for one campus by name, or establish which campus is closer to family before referring to it indirectly. An unsupported or unclear request cannot start a comparison lookup. The receipt supplies the unchanged estimate for immediate conversation while the existing worker checks the one changed scenario. This flag is separate from the observer, and the worker needs no new flag or migration.

For the current optional local conversational-support experiment, see
[meaningful support on v1.3](MEANINGFUL_SUPPORT_V1_3.md) and the
[local call launcher](local-call/README.md). The sections below document the
retained original observer; their “observe only” restrictions describe that
baseline, not the separately enabled local support path. Production remains
unchanged, and research Decisions remain observe-only in both paths.

Phase 3A now has a separate [local call observation bridge](local-call/README.md).
It wraps the existing controller only when explicitly constructed by a local
launcher and copies events to a separate thread. Two local-only factory hooks
connect it to the app; the default production controller is unchanged.

The next observation step broadens coverage across topics, still without any
delivery channel. The local worker uses `broad-rubric.mjs`; the original CLI and
rubric remain available as a narrow baseline. See the
[broad review](BROAD_OBSERVATION_REVIEW.md) and
[broad test results](BROAD_OBSERVATION_RESULTS.md).

| Observation area | Original observer | Broader observer |
| --- | --- | --- |
| Help getting oriented | Explicit starting point, simpler explanation, next action | Retains those distinctions across orientation, applications, family language needs, housing, financial aid and graduate study |
| Conversation changes | Source text was available | Separately records changed requests, unwanted repeated answers, and an explicit need for conversational direction |
| Research | Transcript words alone could not establish research state | Copies existing scoped job results, with status, revision, sources and complete qualifications; observes relevance and comparison problems |
| Uncertainty | Invalid responses and stale results are withheld | Also distinguishes missing research/scope from a negative finding; comparison sufficiency is separately logged |
| Influence on speech | None | None: no cue, prompt change, tool call or delivery action |

Several observations can coexist. The reporting cutoff of 0.5 is not a
calibrated action threshold. Research verification remains an assertion of the
existing backend record, not a new verification by Decisions. Neither a
transcript nor a completed job proves playback, hearing or understanding.

This laboratory belongs to `v1.3-decisions-integration`. Its CLI uses fictional
fixtures. The separate, explicitly authorized microphone launcher uses an
isolated local copy of Daniel's account, truthfully marked `isolated-copy`.
Nothing in the production application imports the laboratory. It cannot send speech, context,
research requests, binder updates, or student changes. No production feature
flag or service has been added. The observer's local mode defaults to `off`;
the only enabled mode is `observe`, which ends at diagnostics.

## What is implemented

| Phase | Before | Available here | Benefit to a later integration |
| --- | --- | --- | --- |
| 1: state and baseline | Existing runtime state was spread across the voice and research controllers. | A separate, immutable, bounded view with student, permission, connection, question and input revisions; fictional bilingual fixtures. | Lets an observer identify which question it evaluated and reject an answer after the situation changes. |
| 2: observe without intervening | No isolated Decisions evaluation path. | Standalone Decisions client, one-in-flight scheduler, newest-pending coalescing, durable spending reservations and local diagnostic records. | Measures whether a narrow classifier notices useful opportunities without changing the conversation. |

The three narrow opportunities are an explicit request for a starting point,
a simpler explanation, or a next step. `none` and `unclear` are first-class
results. A separate predicate estimates whether an assistant transcript already
addressed that request. It does **not** establish that the family heard or
understood anything. Probabilities and confidence remain separate fields.
Those paragraphs describe the retained original baseline, not the full scope
of the broader observation policy.

No paid classifier chooses student scope, asserts research is verified, saves
student facts, grants permission, or executes actions. The phase-3 delivery
mechanism is intentionally absent. The local launcher allowlists the copied
account and its students; this is not a production enablement.

## Run locally

From the repository root, with Node 24:

```powershell
node --test research/decisions/*.test.mjs
node research/decisions/cli.mjs
node research/decisions/verify-isolation.mjs
```

The default CLI only checks all 36 predefined fixtures. It makes zero API calls
and does not read environment files or application databases.

An explicitly authorized paid run uses the dedicated environment variable
`ORIGEN_DECISIONS_TEST_KEY` and:

```powershell
node research/decisions/cli.mjs --real --run-id example-run --cap-usd 5
```

Do not place a key in a command argument or a tracked file. The runner supports
only its predefined fictional fixtures, not arbitrary input files or real call
exports. `--fixture-ids` selects known cases and `--limit` bounds the run.
Changing `--run-id` does not reset spending. The approval ledger is shared by
all runs in `.local/approved-five-dollar-budget.sqlite`, with immutable limits:
$5 total, $0.05 reserved per request and 60 requests maximum. No hidden retries.
Timeouts, missing usage, or unexpected cache accounting keep reservations held.
The short, cache-disabled requests use the documented Decisions input rate;
reported costs are estimates from provider usage, not a billing invoice.

The broader fictional suite has its own explicitly approved **$2** ledger and
does not reset or consume the older microphone ledger:

```powershell
node research/decisions/broad-cli.mjs
node research/decisions/broad-cli.mjs --real --run-id broad-example
```

The first command is offline. The second requires the same dedicated test key
environment variable and a paid-test approval. Its fixed ledger is
`.local/approved-broad-two-dollar-budget.sqlite`: $2 cap, $0.05 reservations,
120 requests maximum, no automatic retries. It accepts only the predefined
fictional cases. Results keep model probabilities, applicability and failures
separate. This is authored-fixture development testing, not an independent
holdout, a microphone test or a naturalness measurement.

## State and evidence

`state.mjs` accepts accumulated transcript spans with IDs and timestamps.
Unfinished spans stay provisional. A transcript-complete marker is source text
evidence, not playback. `context_ack` and `playback` are distinct observations.
Reconnect gaps explicitly record unknown transcript continuity. Switching
students clears the old student's brief, question, findings and observations.
Revocation clears context and stops eligibility. Late or modified snapshots
cannot match the current state.

The view is limited to 24 KiB with bounded arrays. Findings are retained or
removed as whole records, keeping the fact, year, scenario, limitation and
source IDs together. Oversized input is rejected instead of silently clipping
a qualification. The CLI has no connection to the actual brief builder.

## Evaluation and durable diagnostics

The 36 authored cases have a fixed 18-case calibration / 18-case holdout split:
14 English, 14 Spanish and 8 mixed-language. Labels never enter provider input.
The report separates availability, category accuracy, already-addressed accuracy,
candidate precision/recall, language, split, and p50/p95 classification duration.
An optional threshold is chosen only from calibration cases. It is a shadow
measurement, not a production authorization threshold.

English and Spanish include paired scenarios and related templates across splits.
The holdout measures authored-fixture performance, not generalization to unseen
families or independent scenario types. Research fixtures test coexistence with
the current question, not factual research accuracy or real mid-speech delivery.

Each paid run writes `.local/<run-id>/observations.jsonl`, `results.json`, and
`summary.json`. Correlation includes fictional call/student IDs, source span IDs,
revisions, rubric version, provider request ID, duration, usage and suppression
reason. Raw input and provider error bodies are absent from diagnostic logs.
Fixed fixture text is inspectable in `fixtures.mjs`. Every record says no
intervention, no context sent, and no playback claim. Files persist locally
until deliberately removed; they are ignored by Git, not ephemeral service logs.
The budget database persists separately even when a test process fails.

These tests do not establish a naturalness percentage or speech latency.
Future live integration needs separate authorization, paired listening tests,
representative labeled conversations and measured benefit over the current
working flow. Intro, prompts, audio, brief delivery, Responses delegation,
research worker behavior remain unchanged. The isolation checker pins the two
reviewed local factory hooks and verifies the other 3,161 protected files against
the original baseline. Custom factories are rejected in production.

See [review coverage](REVIEW.md), [implementation results](RESULTS.md), and the
[original proposal](../../docs/voice-experience/DECISIONS_INTEGRATION_PROPOSAL_V1_3.md).
