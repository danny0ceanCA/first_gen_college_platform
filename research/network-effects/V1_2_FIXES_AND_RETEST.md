# v1.2 correction fixes and real extraction retest

Date: 2026-11-05. Branch: `v1.2`. Changes remain uncommitted and local.

## What changed

| Problem before | Behavior now | Why it matters |
| --- | --- | --- |
| A rejected correction could leave an earlier positive outcome trusted. | Unprocessed or failed sources put affected earlier records on a scoped review hold. Successful processing clears that source's hold. | Failure cannot silently become a success count. |
| The model could split one success into two concerns and correct only one copy. | Other positive outcomes from that same source/version/reporter are held for possible duplication. Their original evidence remains visible. | A remaining copy cannot quietly contaminate future outcome comparisons. |
| Deleting unread evidence before importing older records bypassed the hold. | A content-free account/student/reporter/time marker protects later backfills. Reviews cannot erase evidence gaps. | Imports, retries, and deletion preserve uncertainty. |
| Saved timestamps and language names could pass as event metadata. | The save timestamp is absent from the AI input. Languages use the source's canonical tag. Event instants require exact supporting quotation; less precise dates stay in text. | Timing and language comparisons do not rely on invented precision. |
| Intent, attempts, understanding, and partial results were inconsistently classified. | Clearer bilingual instructions and a compact enum enforce legal classifications. Mixed progress retains its unresolved obstacle. Compound questions remain pending. | Analysis can distinguish a plan from an attempt and partial progress from full success. |
| Review status and saved-state failures were difficult to inspect. | Current needs-review decisions exclude records from analysis. Admin displays evidence holds, saved-state checks and correction safeguards. | Reviewers can see why a record is unusable and inspect its source. |

`analysisEligible` is an evidence-integrity signal, not permission to publish,
inject into Origen, infer causation, or bypass human review. Pending, unknown,
unsuccessful, and supported mixed outcomes remain useful evidence when integrity
checks permit. A correction-coverage hold is deliberately conservative: it can
temporarily hold a legitimate separate outcome from a compound source. A direct
correction or newer independent result can resolve it; a review click cannot.

## Final real-model results

The provider model was `gpt-6-luna`, text-only Responses, no tools or voice,
`store: false`, standard tier, reasoning `none`. All cases were fictional.

| Measurement | Earlier two-pass baseline | Final repeated cases | Final new cases |
| --- | ---: | ---: | ---: |
| Requests | 120 | 120 | 20 |
| Contract-valid outputs | 116/120 | 120/120 | 19/20 |
| Complete extraction median | 1.69 s | 1.73 s | 2.04 s |
| Complete extraction p95 | 2.57 s | 2.95 s | 2.36 s |
| Unsupported event dates saved | 12 observations | 0 | 0 |
| Noncanonical language names saved | 8 observations | 0 | 0 |

These are small, uncontrolled extraction measurements, **not voice latency or
semantic-accuracy percentages**. The original 60 cases were reused twice for
regression, not treated as an untouched holdout. Twenty independently authored
cases were withheld from prompt development until the final frozen v4 run.
The storage safeguard was then strengthened after those cases exposed the
duplicate-outcome leak; it was verified by local replay, not a new provider call.

Final validation covered 140 outputs: 139 met the contract. The one rejected
English output assigned a real event timestamp but omitted it from its supporting
quote. It remains inspectable and was not saved as evidence. A Spanish precise
timestamp case passed. No unsupported date was accepted.

Both repeated English appointment corrections and both Spanish document
corrections superseded the earlier positive results. The new-case duplicate
acceptance exposed two positive episodes; the final replay leaves the intended
episode pending and the extra companion unknown, needs-review, and excluded.
All **8/8 correction safety checks** pass after replay; **0 checked cases retain
a trusted stale success**. This does not mean every model observation is correct.
Two stricter completeness checks still flag that companion because it needs
semantic repair, even though the backend now prevents its use as a success.

## Remaining limits

AI-assisted reviewers inspected all 140 final outputs; human adjudication is
still pending. They found occasional missing structured barriers or failure
outcomes, incomplete history links, inconsistent category choices, and a pending
orientation result that remained after an attendance report. Some prose is more
accurate than the selected category. These records should remain in the review
workspace until representative human evaluation establishes release criteria.

The richer schema used in an intermediate run increased malformed/incomplete
outputs. The final v4 provider schema selects one legal `kind:status` value and
decodes it into the unchanged storage contract, avoiding six repeated object
definitions. Intermediate failures and their costs remain in the original
reports; they were not discarded or relabelled as successful final tests.

## Budget and verification

- Same authorized budget ledger: `v12-approved-5`, cap **$5**.
- This fix/retest work: **350 provider attempts**, including intermediate runs;
  conservatively accounted **$0.092616**.
- Entire budget including the earlier 120 attempts: **$0.109945** accounted;
  **$4.890055 remains**.
- One earlier HTTP 400 request has no confirmed token usage. Its full reservation
  stays charged against the cap. Other costs use reported tokens and pinned
  standard prices; these are estimates rather than an invoice.
- **151 automated tests passed**, including actual local PostgreSQL/PGlite,
  SQLite, correction recovery, deletion/backfill, role permissions, Admin,
  worker/budget handling, source evidence and metadata. The application build
  passed; its existing large-bundle advisory remains.
- Replayed actual fictional outputs into fresh PostgreSQL and verified Admin
  shows the possible duplicate as unknown/excluded and the corrected result as
  pending. Evaluations preserve candidates, original checks and final replay.

## Inspect locally

The isolated actual-Admin preview is at <http://127.0.0.1:8794/#admin>.
It contains 80 fictional source records from the latest pass of each final case.
Use Evidence, Review, Processing and Evaluations. This is not a production admin
connection and cannot run paid models from the UI.

Ignored detailed artifacts are under `.local/calibration/`:

- `v12-compact-regression.json` and `v12-compact-fresh.json`: immutable provider runs.
- `v12-corrected-replay.json`: combined final report with original and replayed
  saved-state checks, implementation hashes and source-run provenance.
- `v12-compact-english-audit.json`, `v12-compact-es-mixed-audit.json`,
  `v12-compact-fresh-audit.json`: AI-assisted semantic reviews.
- `budgets.sqlite`: durable shared spending ledger.

Older prototype PostgreSQL projections should be explicitly rebuilt or recreated
before use. This task used fresh in-memory databases; no production migration or
settings change was performed. The new `processing_gaps` table belongs only to
the separate network-effects schema and retains no source text.

## Guidance and architectural boundary

Reviewed the saved [Responses reference](../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md)
and relevant official content: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
for supported schema constraints and semantic-error limits,
[prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)
for explicit classification examples, and
[evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
for task-specific cases, fresh evaluations and human review alongside metrics.

The live model, voice prompts, student brief, binder, memory, research delivery,
student app and all existing live inputs remain untouched. No commit, push,
deployment, production import, or production connection was made.
