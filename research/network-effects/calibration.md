# Real extraction calibration

This harness tests the separate network effect extraction pipeline. It does not
open a voice session, load an account, read an environment file, or send anything
to an Origen live conversation. All 60 source records are fictional.

## What it tests

| Coverage | Examples |
| --- | --- |
| Languages | 25 English, 25 Spanish, 10 mixed-language sources |
| Broad college navigation | Understanding college, choosing a path, applications, costs, enrollment, family support, practical needs, finding help, uncertain observations |
| Who reported a fact | Students, parents, family members, coordinators, unknown speakers |
| Honest uncertainty | Intended vs. completed actions; pending, positive, unsuccessful, mixed, and unknown results |
| Difficult inputs | Explicit corrections, incomplete understanding, changed preferences, ordinary thanks, and instructions embedded in source text |
| Sequential history | An office appointment, a requested document, and orientation assistance progress across separate records |

Each example includes expected observations and a reviewer rubric. These are
author-labelled examples, **not independently adjudicated ground truth**.
Development and held-out partitions are explicit; complete scenarios and parallel
English/Spanish examples remain in one partition. Do not tune the extractor on
held-out results. If those results inform a change, create fresh untouched cases
for the next held-out test.

The model receives source text and its own earlier validated outputs from the
same fictional family/student. It never receives expected annotations, grading
rules, or an answer-key history. Invalid outputs are retained for review but
cannot become subsequent extraction context.

The original 60 examples have now been inspected and are regression cases, even
though their historical split labels are retained. `--dataset fresh` selects the
separate 30-case experiment; `--dataset fresh-2` selects a subsequent 20-case
experiment. Once either set informs a change, it is no longer untouched for that
change. Reports preserve their dataset/configuration hashes and previous results.

## Run after approving a spending cap

Provide the API key through the process environment as
`NETWORK_EFFECTS_OPENAI_API_KEY`; never put it in a command argument or report.
The runner deliberately does not fall back to the application's normal key.

```powershell
node research/network-effects/calibration-runner.mjs --run-id v12-initial --budget-id v12-approved-5 --cap-usd 5 --split all --repeats 1
```

This sends 60 sequential text requests using `gpt-6-luna`, no tools, explicit
`service_tier: default`, `reasoning.effort: none`, strict Structured Outputs,
`store: false`, and a 3,000-output-token maximum. Use `--split development` for
development work, `--split heldout` for a frozen evaluation, and `--repeats 2` or
`3` only when the authorized cap covers the extra calls. `--max-cases` supports a
small smoke test but is not a full evaluation.

The CLI produces an ignored local JSON report and a durable SQLite budget ledger
under `research/network-effects/.local/calibration/`. Use the **same budget ID**
for every run sharing an authorized spending cap. The cap cannot be increased
under an existing ID. A new ID is accounting for a separately authorized budget,
not permission to spend again.

Every request reserves a conservative upper bound before sending it. The estimate
uses the request's UTF-8 byte length plus token overhead and the full output limit
at the documented standard price. Missing usage, a timeout, a lost response, or
an interrupted process retains the reservation. Confirmed usage settles the
reservation, including failures with reported usage. Unsent cancellation releases
only that request's reservation. There are no automatic API retries.

Resuming the same run ID and unchanged configuration replays saved outputs into
local memory without calling the provider again. A reservation without a saved
result prevents a duplicate paid request. An abandoned run lock requires manual
inspection of its budget entry before removal; the runner does not guess that an
uncertain call was free. Prices are pinned with a date and source in
`calibration-budget.mjs`; verify them before a new experiment. Token estimates
are conservative accounting, not an invoice. Reconcile actual usage afterward.

## Read the report

`records` contains source text, candidate output, expected annotations, actual
context item IDs, provider response/model metadata, token usage, timing, cost
accounting, automated flags, and an empty human-review rubric. API secrets,
authorization headers, and raw provider error bodies are excluded.

`summary` shows overall, per-language, and per-partition numbers:

| Metric | Meaning |
| --- | --- |
| Valid output rate | The candidate met the schema, scoped-link, and exact evidence-quotation contracts |
| Annotation precision / recall | Agreement with the authored labels on kind, status, topic, speaker, source quotation, and unknown dates |
| Critical flags | Possible unsupported completion/positive results, wrong speakers, unsupported quotations, or invalid output contracts |
| Timing | Median and p95 of complete request-to-validation time, not live voice latency |
| Accounted cost | Confirmed token cost where available; full reservation otherwise |
| Pending human review | Cases not yet assessed by a reviewer who can evaluate meaning |
| Saved-state checks | Whether persisted corrections and result states match the authored scenario |
| Correction safeguards | Whether a correction leaves any earlier positive result trusted; a quarantined possible duplicate passes this safeguard but still needs semantic repair |

**A valid quote does not prove a correct interpretation.** The automated matcher
can miss paraphrase equivalence and alternate ways of splitting observations. It
does not establish that a resulting statement is semantically supported, that a
reported event independently occurred, that a parent speaks for their child, or
that a recommendation helped. These require review; the report's release gate
always remains `human_review_required`.

Review every critical flag plus a sample of apparently clean examples in each
language. For every reviewed example, assess:

1. Does the source support the statement's meaning and level of certainty?
2. Is the correct person's report retained without treating it as verification?
3. Are important barriers, uncertainty, or unsuccessful results missing?
4. Are sequential links and explicit corrections about the same concern/person?
5. Would a fluent English/Spanish reviewer accept this interpretation?

Compare frozen extractor/configuration versions on the same development cases,
then use a new held-out set when development decisions have consumed the old
one. These fixtures are a starting calibration set, not evidence of population
accuracy or proof that future network effect guidance will improve outcomes.

## Local regression checks

```powershell
node --test research/network-effects/extractor.test.mjs research/network-effects/calibration.test.mjs
```

These use mock provider responses only and cannot spend provider funds.

## OpenAI guidance used

- [Saved Responses reference](../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): strict structure still permits semantic mistakes; unrelated input needs explicit empty-output handling.
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): use task-specific cases, representative edge cases, and human review alongside automated checks.
- [GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna): configured model, supported reasoning setting, and dated standard text pricing.

This is a local Responses-based evaluation harness, not the deprecated hosted
Evals API. Any future move to actual student records needs an explicitly scoped
local experiment and reviewer access; it is not enabled by this CLI.

The v4 provider format uses one enum for legal classifications, such as
`action:intended`, and expands it deterministically into the existing `kind` and
`status` fields. Language is constrained to the canonical source tag. An event
instant must appear exactly in its own supporting quote; date-only and relative
timing remain in text rather than gaining invented precision. Invalid records
remain inspectable but are not saved as evidence.
