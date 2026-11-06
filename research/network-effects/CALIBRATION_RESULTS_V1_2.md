# v1.2 real extraction calibration

## Result

The real extraction path works and is inexpensive on these short fictional examples. It is **not ready to produce trusted automatic outcome statistics**. Two unchanged passes exposed semantic and lifecycle problems that mock-provider tests could not measure. Nothing from these tests was sent to the live voice model.

| Test group | Requests across two passes | Accepted by current validation | Median extraction time | 95th percentile |
| --- | ---: | ---: | ---: | ---: |
| English | 50 | 48/50 | 1.74 s | 2.56 s |
| Spanish | 50 | 48/50 | 1.69 s | 2.67 s |
| Mixed language | 20 | 20/20 | 1.73 s | 2.28 s |
| **Total** | **120** | **116/120** | **1.69 s** | **2.57 s** |

Acceptance means the candidate passed the current structure, source-quote and link checks. It does **not** mean its interpretation was correct. Some incorrect dates and classifications passed those checks.

The two runs used the same frozen prompt, model configuration and 60-case dataset. The second run repeated the scenarios to check variability; no prompt or fixture tuning occurred between runs. These are 60 unique examples, not 120 independent examples. There were 29 development and 31 held-out examples per pass. Sequential scenarios used only earlier validated model output as context; expected labels were never provided to the model.

Provider-confirmed model: `gpt-6-luna`. Standard tier, reasoning `none`, strict Structured Outputs, `store:false`, no tools, maximum 3,000 output tokens per call. No automatic API retries occurred. The maximum observed request-to-validation duration was 2.96 seconds. These timings measure offline text extraction, **not voice response time**.

## Spending

The approved cap was **$5**, tracked under the single persistent budget `v12-approved-5`.

- Reported usage: 96,867 input tokens and 15,172 output tokens across 120 calls.
- Conservative per-call rounded standard-token estimate: **$0.017329**, approximately **two cents**.
- Budget ledger remaining: **$4.982671**; no unresolved call reservations.

This is a usage-based estimate, not an invoice. It uses the documented standard input/output rates, without a cached-input discount; reconcile final billing separately. The [model pricing page](https://developers.openai.com/api/docs/models/gpt-6-luna) was checked for this run. All source data was fictional. Only the existing API key was read locally; account data and database settings were not loaded.

## What needs fixing before trusting the evidence automatically

| Finding | Evidence from the runs | Why it matters |
| --- | --- | --- |
| **A rejected correction leaves an old result current.** | English `en-25` failed in both runs: the model described an unconfirmed appointment but tried to correct an earlier outcome using an understanding item. Replay showed the earlier positive outcome remained current. | Later analysis could count an appointment as confirmed after the student explicitly retracted that claim. This is the highest-priority lifecycle issue. |
| **Saving time becomes an invented event date.** | 13 candidate observations across 10 case executions copied the source's saved timestamp into `occurredAt`; 12 of those observations were in accepted candidates. The words did not establish those event times. | Dates would appear more precise than the evidence supports and could distort sequences and time-to-outcome calculations. |
| **Language identifiers are inconsistent.** | Both runs emitted `Spanish` and `English` in mixed-language cases 09/10: eight accepted observations across four case executions. | Those labels pass the current shape check but do not match the canonical language tags used by filtering and comparison. |
| **Not acting can be mistaken for an attempt.** | The repeat labeled “not submitted yet” as `action:attempted` in English `en-03` and Spanish `es-03`. No attempt was reported. | Future algorithms could confuse intention with action. |
| **Partial progress is not structured consistently.** | English `en-15` classified unaffordable rent as reported understanding in both runs. Spanish `es-11` and `es-15` varied between representations of unresolved housing/childcare and partial progress. | The prose can be faithful while the structured outcome overstates progress or loses the obstacle. |
| **Some output failures lose useful observations.** | The repeat's `es-02` produced no retained candidate after an extraction failure. `es-22` used an invalid local item key and was rejected. | These need visible failure/recovery handling; they should not silently count as “nothing happened.” |

Additional review notes include missing structured barriers and one Spanish response that translated its statement/barrier into English and added an unsupported “younger” descriptor for a brother. The source quotations remained inspectable. These are recorded separately from scorer disagreements.

The Spanish document-correction chain worked in both runs: `es-25` correctly changed the earlier positive result to pending. Ordinary thanks and the test instruction embedded in source text produced empty extractions. No invented completed action, invented positive outcome, or wrong reporter role was observed in the available candidates during the AI-assisted review; that is a bounded observation about this dataset, not a general guarantee.

## How to interpret the automated scores

The aggregate label-agreement precision was 60.0% and recall 64.3%. Those are **not semantic accuracy rates**. The scorer compares authored categories and quotations; a supported alternative split can fail that comparison. For example, a source reporting successful bus guidance and unresolved childcare can reasonably contain two observations rather than one mixed-result item.

There were 11 automated critical flags. Some were false alarms caused by incomplete or ambiguous reference labels; some real problems, including unsupported dates, were not classified as critical by the scorer. We inspected all 120 case executions with separate English and Spanish/mixed AI-assisted audits. Human semantic review remains pending, and the report retains `human_review_required` rather than treating that audit as human verification.

The guidance is to combine task-specific metrics with semantic review, because [Structured Outputs can still contain mistakes](https://developers.openai.com/api/docs/guides/structured-outputs), and [evaluation guidance recommends calibrating automated checks against human judgment](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

## Recommended next work

1. Protect outcome state when a newer correction fails processing. Make the unresolved correction visible and exclude the disputed result from trusted analysis until resolved.
2. Tighten metadata and evidence rules: source-supported event dates, canonical language tags, valid local IDs, and a clear distinction between intention, attempt and completion.
3. Improve partial-progress/barrier representation and the evaluation rubric. Preserve acceptable alternate extractions while testing the resulting stored state. Add new untouched held-out scenarios after these findings inform changes.

All of this belongs in the separate evidence pipeline. It does not require changes to the live model, brief, binder, prompts or research delivery.

## Inspect the results

The local Admin results preview is <http://127.0.0.1:8793/#admin>. Open **Network Effect Architecture → Evaluations**. It displays the combined real-model report, timing, cost, language comparisons and source/expected/candidate details. The Evidence tab still contains the labelled 15-source prepared demonstration; it is separate from the real-model evaluation records.

Ignored local artifacts:

- `.local/calibration/v12-initial.json` — first 60 requests.
- `.local/calibration/v12-repeat.json` — unchanged repeat.
- `.local/calibration/v12-two-pass.json` — combined display report, with source-run hashes and no changed raw outputs.
- `.local/calibration/v12-initial-english-audit.json` and `v12-repeat-english-audit.json` — English semantic notes and replay proof.
- `.local/calibration/v12-initial-es-mixed-audit.json` and `v12-repeat-es-mixed-audit.json` — Spanish and mixed-language semantic notes.
- `.local/calibration/budgets.sqlite` — persistent reservation/usage accounting.

The original two reports remain unchanged. No live session was started; no production records were read or changed. This testing turn did not alter the extractor, validation rules, fixtures or scoring. Work remains on `v1.2`, with no commit, push or deployment.
