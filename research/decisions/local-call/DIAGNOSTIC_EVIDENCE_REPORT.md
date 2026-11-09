# Decisions evidence report

This offline report separates what the classifier observed, what the application allowed, what the provider received, and what the conversation demonstrably did. It does not call OpenAI, connect to a database, change configuration, or send anything to the live model.

```powershell
node scripts/decisions-diagnostic-report.mjs events.json --output decisions-report.json
node scripts/decisions-diagnostic-report.mjs events.jsonl --reviews reviewed-cases.json --output decisions-reviewed.json
```

The input is an explicitly exported array of durable `origen_decisions_events` rows (`id`, `session_id`, `run_id`, `sequence`, `stage`, `data`) or local lifecycle events (`type`, `callId`, `workerRunId`, and metadata). JSONL is also supported. Inputs are limited to 32 MiB each; the report accepts at most 100,000 events and 10,000 reviewed cases. Output files must be new paths so a prior report is preserved.

## What the report measures

| Evidence | What it establishes | What it cannot establish |
| --- | --- | --- |
| Typed classification answers and probabilities | Each question's actual returned classification; confusion or preferences remain visible even when legacy `supportNeed` is `none` | Whether the classification is accurate or helpful |
| Trigger, request moment, freshness mismatch, and revalidation records | Why a check ran, was deferred, or was no longer eligible | Whether withholding was the best product decision |
| Stage timing | Observed application queue, classification/transport, and delivery timing with sample counts | Private model reasoning time or an unobserved latency stage |
| Exact context acknowledgment | The provider estimated that the matching append reached context | Whether Origen used it or the caller heard it |
| Reviewed transcript adaptation | A reviewer found the requested change in a scoped answer | Natural voice delivery, comprehension, or causal benefit |
| Reviewed need addressed | A reviewer found that the answer addressed the caller's need | That the caller understood it |
| Transcript flow / audible flow | Separately reviewed repetition, abrupt pivots, unnecessary speech, or no issue observed | A universal naturalness score; transcript review cannot establish audio quality |
| Matched client playback | The application's playback evidence covers the reviewed answer | Comprehension or improved outcomes |
| Explicit caller clarity | The caller reported understanding or continued confusion, or provided a substantive paraphrase | Objective comprehension or that Decisions caused the change |

Summaries retain English, Spanish, mixed-language, and unknown categories. Older logs may lack a classification path or distribution; the report preserves that limitation instead of filling it in. Repeated export rows and repeated summaries of one operation are deduplicated. Durable rows use their record ID or durable sequence; local rows use `workerSequence` scoped to their call and worker run. An inner lifecycle `sequence` is never treated as a global local-event identity. Conflicting duplicate rows, uncorrelated classifications, and gaps *between observed durable rows* are visible. A filtered export can produce apparent gaps; there is no claim that a gap proves lost data.

## Reviewed outcome cases

Each case follows `measureSupportOutcome` in `outcome-evaluation.mjs`: a cue with exact call/student/language/connection scope, native source event IDs, session-relative timestamps, transcript rows, optional provider acknowledgments, optional client playback, and explicitly reviewed evaluations. The evaluation window covers at most three following application-grouped caller contributions. These groupings are not provider-completed semantic turns.

Supported review dimensions are `assistant_adaptation`, `need_addressed`, `caller_clarity`, and `conversational_flow`. A flow review states `basis: "transcript_review"` or `basis: "audio_review"`; audio review additionally requires a recording reference. Reviews must have `method: "human_review"`, `reviewed: true`, a reviewer ID, an exact matching row and source-event set, and an actual quote in that row. Model-generated grades are not promoted to human review. The CLI does not accept fictional fixture labels as real reviews.

The test fixtures exercise evidence accounting in both languages. Their authored labels are explicitly synthetic, and their fake recordings/playback do not demonstrate real audio performance. Reports omit transcript text and reviewer quotes; source exports should still be handled as private diagnostic material.

## Guidance used

- [Decisions guide](https://developers.openai.com/api/docs/guides/decisions): retain independently typed answers and probability distributions; evaluate classifications against task-specific evidence.
- [Decisions in Live](https://developers.openai.com/api/docs/guides/decisions-voice): preserve transcript provenance and distinguish application decisions from provider-triggered classifications.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations): transcript fragments are not completed turns; append acknowledgment does not confirm speech or playback.
- [Delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation): backend completion and spoken delivery are independent outcomes.
- [Voice agent evaluation](https://developers.openai.com/cookbook/examples/audio/voice_agent_evaluation): measure the complete interaction, task success, latency, and speech separately on representative scenarios.

The reviewed current official guides matched the saved library snapshots during this change. No documentation is added to runtime model context.
