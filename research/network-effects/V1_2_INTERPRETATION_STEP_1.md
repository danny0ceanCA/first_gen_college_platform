# v1.2 — interpretation improvements, step 1

Date: 2026-11-05. Local, isolated work only; no commit, push, deployment, or production connection.

## Scope and behavior

This step improves the separate network-effects extractor, not Origen's voice.
It adds no second-model verifier, automatic production ingestion, or live context injection.

| Before | Change | Benefit for future analysis |
| --- | --- | --- |
| An obstacle could appear in prose but have an empty or misleading barrier field. | Extract explicit difficulties, including uncertainty about how or where to ask for help; preserve negations and conditions. | Makes practical and knowledge barriers available for review across topics and languages. |
| A failed phone call could be recorded as an attempt without its unsuccessful result. | Record the attempt and explicitly reported failed result as related observations. | Failed and pending experiences remain visible alongside successes. |
| Related observations could lack links to earlier questions, guidance or actions. | Supply scoped prior quotes, barriers and relationships; request an explicit link when supported. | Makes the suggestion-to-action-to-result history easier to inspect without inventing causation. |
| A pending orientation could remain pending after the person reported attending it. | Record the directly supported, narrowly worded result and link it to the earlier wait. | Updates that milestone while retaining its history; attendance does not imply admission or enrollment. |

The canonical evidence schema and projection rules are unchanged. Ordinary progress
uses `linksTo` with `corrects: null`. Only actual retractions use `corrects`.
Completed actions never mechanically create successful outcomes. Different
students, reporters and concerns retain their boundaries, and unresolved broader
goals stay pending or mixed.

Prior-record context now includes exact quotations, barriers, links, corrections,
and provisional episode states. It excludes account identifiers and save timestamps.
`sourceRecordOrder` is deterministic saving order for prior records, not event
chronology. Historical evidence still requires interpretation; ordering does not
establish causation or make backfilled evidence newer than current evidence.

## Evaluation method

The final extractor is versioned as `network-effects-extraction-v6`. The prompt was
frozen before inspecting the 24 new holdout cases. The existing 60 cases are known
regressions; they are not a fresh accuracy sample. The new cases cover English,
Spanish and mixed language, with sequential context built from the extractor's
own valid earlier outputs, never the expected labels.

Dedicated interpretation checks accept documented classification alternatives,
check barriers and relationships, and inspect saved pending-to-result progression.
Exact annotation agreement remains a separate screening metric. Neither a valid
schema nor a passing rubric establishes semantic truth or real-world accuracy.

Real tests use fictional text only, `gpt-6-luna` through Responses, no tools,
`store: false`, standard tier, and the existing `v12-approved-5`
budget ledger. Failed requests remain in reports and uncertain usage retains its
reservation. Human adjudication is still required before release.

The first v5 experiment kept reasoning at `none`. It improved several observations
but still missed the original attendance outcome and rejected four of the 24 new
cases. With the same prompt and prior context, `low` reasoning produced 24/24
valid outputs and all three supported event closures. Five strict rubric misses
were independently reviewed as alternative representations: partial questions
instead of uncertain understanding, or mixed progress instead of pending alone.
The original scores are retained, not rewritten to make the run pass.

The separate extractor and network-effects worker now share `low` as their
default. This is one background model call, not an added verifier. Output limits,
budget reservation, rejection behavior, and correction safeguards remain in
place. Content-free diagnostics distinguish response parsing, output parsing and
contract validation, and record reasoning-token counts when available. They never
capture private reasoning.

After configuration selection, 12 more independently authored cases were held
back until the final configuration was frozen. The final 60-case regression and
12-case holdout were then run. Changes in reasoning configuration cannot resume
an existing run under its old configuration hash.

## Results and remaining limits

| Measurement | Earlier v4 regression | Final v6 regression | Final untouched holdout |
| --- | ---: | ---: | ---: |
| Requests | 120 (60 cases twice) | 60 | 12 |
| Contract-valid outputs | 120/120 | 60/60 | 12/12 |
| Complete extraction median | 1.73 s | 2.22 s | 3.75 s |
| Complete extraction p95 | 2.95 s | 4.08 s | 4.46 s |
| Saved-state checks | Prior report predates added progression checks | 4/4 | 15/15 |

These are background extraction timings from small, uncontrolled runs, not voice
latency. The final two runs overlapped briefly, so their timings are descriptive,
not a controlled estimate of the cost of reasoning. The separate same-case
24-case comparison took a median 2.65 s with `none` and 3.52 s with `low`.

The original mixed-language orientation sequence now records that the requested
orientation happened, links to the earlier pending observation, and retains that
historical pending record with no correction. English and Spanish correction
sequences both supersede earlier positives with pending results. All three new
holdout attendance sequences preserve their historical evidence and update only
the reported milestone.

The final holdout passes 56/57 explicit interpretation checks. One pending-event
source recorded the request as attempted rather than completed; the pending
result and later attendance were retained. AI-assisted reviewers also found selective
coverage in the known regression cases: one parent/daughter uncertainty was
omitted, admission was not always a separate result, and night work sometimes
remained in prose without appearing in the barrier field. Some Spanish wording
also uses a gendered student description not established by the source. The system is more
useful for evidence review, but these findings do not establish complete or
production-grade extraction accuracy. Human adjudication remains pending.

Receipt of a request may be a supported positive sub-result while the actual goal
remains pending. Review the concern and its evidence together; do not count every
positive observation as student success. Mixed concerns retain unresolved parts,
but the existing pending-only counter does not count every mixed state.

## Verification and spending

- **172 automated tests passed**, including the actual local PostgreSQL/PGlite
  projection, SQLite, correction/deletion safety, permissions, worker budgets,
  exact evidence contracts, relationships, and supported progression.
- **180 provider calls** across the initial, comparison, and final experiments:
  estimated **$0.056545** for this step. All unsuccessful experiments are retained.
- Shared $5 ledger total: **$0.166490** accounted, **$4.833510 remaining**. One
  earlier request still retains its full reservation because usage is unknown.
  Prices are token-based estimates, not an invoice. Reports created during
  overlapping runs contain point-in-time budget snapshots; the settled ledger
  is the final total.
- Compared SHA-256 hashes for **1,043 tracked app/server/configuration files**
  against the beginning of this task: **zero changed**. Changes in this task are
  confined to the isolated network-effects implementation, tests, and documents.

Local reports are under `.local/calibration/`: `v12-interpretation-regression`,
`v12-interpretation-holdout`, `v12-interpretation-low-check`,
`v12-interpretation-final-regression`, and `v12-interpretation-final-holdout`
(`.json` and corresponding audit files). Audit files explicitly identify
AI-assisted review and do not mark human review complete.

## Guidance applied

Read the saved [Responses reference](../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md)
and reviewed the relevant official guidance:

- [Structured Outputs — handling mistakes](https://developers.openai.com/api/docs/guides/structured-outputs): format correctness does not guarantee semantic correctness; improve instructions and examples, and allow empty output for irrelevant evidence.
- [Prompt engineering — examples and relevant context](https://developers.openai.com/api/docs/guides/prompt-engineering): clarify task boundaries with varied examples and supply the relevant prior evidence.
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): evaluate the actual task, retain new holdouts, inspect failures, and combine metrics with judgment.
- [GPT-6 Luna configuration](https://developers.openai.com/api/docs/models/gpt-6-luna): verified supported reasoning levels and standard token pricing before testing `low`.

The existing [correction safeguards](V1_2_FIXES_AND_RETEST.md) remain in force.
No student brief, binder, voice prompt, conversation history feed, research
delivery, or live-model setting is changed by this step.
