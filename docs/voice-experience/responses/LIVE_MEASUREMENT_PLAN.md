# Live measurement plan

Implemented November 6, 2026 on `v1.2`. Read alongside [Live Configuration Audit](LIVE_CONFIGURATION_AUDIT.md). Instrumentation observes the existing behavior; it does not fix or change delegation, speech, silence windows, context budgets, or shutdown.

## Collection

The API's existing bounded logger/exporter now accepts `voice.live.measurement`. It applies the same allowlisting, volume limits, release metadata, and sink-failure handling as existing diagnostics. No new logging service, database migration, model call, or production deployment is required. Events become available when the updated API is deployed.

The server-control path collects these measurements whenever it is negotiated (`ORIGEN_LIVE_SERVER_CONTROL=true` with the corresponding client protocol). `ORIGEN_RESEARCH_DELIVERY_V2` is fingerprinted; both delivery implementations are observed. Browser-local control continues to use existing voice timing/capture, but does not produce the new server-connection measurements. Do not assume absent server events mean absent activity.

The research worker independently emits one `research_attempt` record for each actual provider pass. Existing provider/database spans and browser turn timing remain available.

## Fields and interpretation

| Stage | Observation | Audit mapping |
| --- | --- | --- |
| `configuration` | Structural configuration fingerprint, language, routing policy; validation failure category when observed | LC-005, NC-004 |
| `backend_started` / `backend_finished` | Per-connection response index, monotonic model duration, token counts and failure category | LC-004, RS-001/002 |
| `tool_ready` / `tool_dispatched` | Complete function item to application dispatch interval | NC-008 |
| `research_delivery` | Supplied/acknowledged/deferred/expired/interrupted/overlap stages, reason, packets/bytes; local research index and revision where available | NC-006/009 |
| `context_selection` | Number of eligible profile fields available/included and total snapshot bytes | NC-007 |
| `voice_usage` | Latest cumulative provider voice seconds | LC-004 |
| `session_closed` | Final provider voice seconds, only if the native event is actually received | LC-003/004 |
| `control_closed` | Application control shutdown, independent of provider finalization | LC-003 |
| `research_attempt` | Pass duration, HTTP status, incomplete/refusal/provider/rate-limit/invalid-output categories and token details | RS-001/002 |

`measurementRun` is a random connection- or worker-job key, not a user/student/provider ID. `responseIndex`, `researchIndex`, and `turnIndex` are local sequence numbers; turn indices use the existing estimated boundaries, not semantic ground truth. Native IDs are held only in bounded in-memory maps. They are never emitted by this instrumentation.

`configurationHash` covers structural settings (models, tool schemas, language, routing policy, output limit, delivery-policy variant). It excludes instructions, student input, credentials, and private context. Existing log `release` identifies the deployment commit. This is not a hash of the entire prompt: a prompt-only change must be compared by release. Worker attempts have independent run keys and no configuration fingerprint; there is no cross-worker-to-call join yet.

The event catalog drops unknown attributes and accepts only bounded numeric values, fixed enums, and validated opaque hex keys. Operational measurement records contain no transcripts, audio, prompts, function arguments/results, names, source-page content, or raw provider error text. Any audio-based review must use the existing authorized private capture workflow, not operational logs or repository recordings.

## Generate a review report

Export the API's structured JSONL diagnostics using the existing approved logging workflow, then run locally:

```sh
node scripts/live-measurement-report.mjs /path/to/events.jsonl > /tmp/live-measurement-summary.json
```

The report groups by configuration fingerprint and stage, with sample counts, failure observations, and p50/p95/max for each available measurement. It ignores other events and does not echo arbitrary input fields. Malformed JSONL lines are counted. Use a bounded export window: the offline tool reads the file into memory.

Do not sum cumulative voice snapshots. Do not interpret event counts as unique session counts. Missing/dropped observations are unknown, not zero. Correlate by random run and sequence keys in the source export when inspecting a particular timeline. Provider and browser clocks are separate; only durations computed within one clock domain are comparable.

Existing `createVoiceTiming` observations distinguish first sound from a substantive-answer candidate. They do not prove usefulness or comprehension. The new dispatch interval ends when the application dispatches the tool batch, not when the downstream service begins work. Context omission counts do not identify which field was omitted. Configuration events record observed application/provider state, not guaranteed backend health. No finalization event is synthesized when shutdown drops the native event.

## Review cadence

1. Collect a fixed release/configuration window with enough English and Spanish calls for comparison; retain sample sizes and telemetry gaps.
2. Review output-limit/refusal/provider failure categories before increasing budgets or retrying work.
3. Inspect dispatch-delay samples and context inclusion ratios before changing scheduling or context selection.
4. Review expired/unconfirmed research deliveries against actual task outcomes and authorized audio. An overlap heuristic is not a semantic score.
5. Record results using the template in [reviews/README.md](reviews/README.md). Link finding IDs, release, configuration hash, sample sizes, summary metrics, and sanitized observations.
6. Mark audit findings resolved only after implementation and suitable behavioral verification. Do not store operational exports, user identifiers, transcripts, or recordings in the library.

## Remaining measurement work

- Semantic judgments of unnecessary delegation, repeated questions, and first useful answers require reviewed audio or a separately validated evaluation system.
- Exact microphone-to-playback alignment and hard-stop latency need client/media instrumentation; server-side transcript events alone cannot measure them.
- Worker-to-voice-call correlation and explicit prompt-template revision tracking are not implemented.
- Operational volume limits can drop events; inspect existing telemetry gap/drop reports before drawing conclusions from absent events.
