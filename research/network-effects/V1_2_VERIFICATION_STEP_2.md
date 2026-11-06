# v1.2 — targeted AI evidence checks, step 2

Date: 2026-11-05. Isolated local implementation and fictional-data tests only.
No commit, push, deployment, production migration, or real account-data access.

## What changed

This adds a second AI pass to the separate network-effects extraction worker.
It does not join a voice call, listen to live audio, write a student brief, alter
the binder, or supply information to Origen. The student conversation never waits
for this work.

| Before | Now | Benefit for future guidance research |
| --- | --- | --- |
| One extraction could pass the schema checks while missing a barrier or misreading a result. | Selected candidates are compared with their original source and scoped prior evidence in a separate AI request. | Another opportunity to catch interpretation mistakes before recording evidence. |
| The accepted extraction did not show a second check's reasoning about specific evidence. | Save the original candidate, selection reasons, concise evidence-backed findings, final candidate, and each attempt. | Reviewers can inspect what changed and why. These are reported findings, not private model reasoning. |
| A failed extra check could tempt the application to use the first answer anyway. | Required checks must finish successfully before completion; errors, uncertainty, budget denial, or changed context hold the job. | Unchecked fallback evidence is not published by this path. |
| Retries and corrections could be hard to compare. | Persist separate audit attempts, bind them to source/context versions, and retain them across manual retry. | Better traceability without silently overwriting an earlier interpretation. |
| Admin showed jobs and evidence. | **Network Effect Architecture → Processing → View AI check** shows the source, before/after, findings, and timing/model metadata. | The check can be inspected without another model call or any change to the evidence. |

This is a fresh request to the **same `gpt-6-luna` model**, using a review-specific
prompt and `medium` reasoning. Primary extraction remains v6 with `low` reasoning.
It is not a second independently trained model, human verification, or proof that
an event actually happened. Shared model errors remain possible.

## Selection and storage

The reviewer is selected for corrections, reported progress, attempts, explicit
uncertainty without a barrier, prior pending outcomes, reporter-attribution
risks, competing outcomes, or likely source-coverage gaps. A stable 10% hash
sample covers other records. These are inspection signals, not evidence of an
error or a calibrated confidence score. The risk-focused test sets select almost
everything; they do not estimate the review rate for future real users.

The worker saves a pending audit before starting a required review. Its possible
results are kept, revised, needs review, or failed; unselected records receive a
skipped audit and no second paid request. Exact source quotations, valid statuses,
same-family/student relationships, and supported correction references are still
enforced in code. Moving an existing item key to a different concern is held for
review rather than silently accepted.

SQLite and the separate PostgreSQL repository implement the same audit contract.
Completion requires a current successful audit with the matching final extraction
and source/context fingerprint. Terminal audits cannot be silently replaced.
Deletion cascades to retained source-bearing audits. Internal lease tokens never
leave the repository through the Admin response. Existing legacy fixtures remain
supported; the dedicated ingestion script stamps new jobs with the verification
pipeline version.

Each model request reserves cost separately from the same durable budget. Unknown
usage retains its reservation; retries do not replenish the cap. Provider calls
use strict Structured Outputs, `store: false`, no tools, and no shared Responses
conversation state. `store: false` does not mean data stays on the local computer.

## Evaluation method

Eighteen new fictional challenge cases were split into nine development and nine
untouched holdout cases, each with English, Spanish and mixed-language sources.
Each split includes six deliberately flawed candidates and three clean controls.
The provider receives the source, candidate, scoped history and selection reasons;
it never receives expected labels or evaluation rubrics. Challenge cases explicitly
force the reviewer, even if normal selection would skip one.

The prompt was frozen before inspecting holdout results. Separately, twelve
previously inspected cases exercise actual primary extraction, normal review
selection, sequential history and saved projections. They are a known end-to-end
regression set, not another fresh accuracy sample. Full reports retain unsuccessful
experiments and human-review status remains pending.

Development exposed an adapter mismatch: canonical `kind`/`status` input looked
like a schema error to a reviewer asked to return compact `classification`
output. Input now uses the same compact format. Later iterations clarified
restraint, structured obstacles, mixed-language wording and stable concern
assignments. Clean controls still reveal occasional unnecessary additions;
schema validity and a completed review are not semantic accuracy.

## Results

| Final run | Saved / tested | Kept / revised / held | Review median | Whole job median |
| --- | ---: | ---: | ---: | ---: |
| Development challenges | 9 / 9 | 2 / 7 / 0 | 5.83 s | 5.84 s |
| Untouched holdout challenges | 7 / 9 | 1 / 6 / 2 | 6.01 s | 6.02 s |
| Actual extraction + review + storage | 12 / 12 | 8 / 4 / 0 | 4.91 s | 8.16 s |

Challenge timings start with an existing candidate. End-to-end timings include
primary extraction. These are small, uncontrolled background-job measurements,
not voice latency or a guarantee of future performance. Review p95 was 11.63 s
on the holdout; full end-to-end job p95 was 14.77 s. No new voice calls were run.

AI-assisted inspection found:

- Development: all six planted substantive defects were repaired, including
  structured knowledge barriers. Two of three clean controls stayed identical.
  The other clean control unnecessarily acquired an inferred submission action
  and unsupported gendered wording, although its receipt/approval distinction
  remained intact. This is a real overcorrection concern.
- Holdout: five of six planted defects received their core repair. One of those
  still lacked a structured barrier. The sixth failed contract validation and
  was not saved. A separate missing-target correction was cautiously held for
  review. Of three clean controls, one stayed identical, one lost a debatable
  generic barrier while preserving meaning, and the missing-target case was held.
  No invented successful outcome or reference was observed in saved outputs.
- End-to-end: all three actual-model pending-to-attended sequences preserved
  history and linked to the later narrow result. All three failed attempts
  retained failure/barrier evidence; all three partial-understanding cases stayed
  unresolved. The four revisions were small wording/gender/barrier edits, not newly
  recovered core outcomes. Ordinary waiting and unsupported gendered wording
  remain inconsistently handled across languages. Historical waiting barriers
  may remain in accumulated lists after completion, and equivalent descriptions
  may duplicate an obstacle; future analytics must distinguish these from
  distinct current barriers.

The holdout's strict verdict agreement was **6/9**, not a claim of 67% accuracy.
The original verdicts and labels remain unchanged. AI-assisted review is not
human adjudication; all report release gates remain `human_review_required`.
The final development, holdout and pipeline reports have identical prompt and
implementation hashes. No tuning followed inspection of the holdout.

## Checks, cost and isolation

- **225 automated tests passed**, covering SQLite and actual local PostgreSQL
  behavior, leases, retries, stale context, source deletion, budget exhaustion,
  refusal/invalid output, required-review completion gates, permissions and Admin
  replay. TypeScript/Vite production build passed; the existing large-chunk
  warning remains. The first build attempt hit a Windows sandbox access error;
  the authorized local build outside that sandbox succeeded.
- Browser-verified **Processing → View AI check** against saved fictional API
  results: original Spanish source, initial wrong interpretation, corrected
  question, issue quotes, timing/model/token metadata and AI-not-human labels.
  Viewing the check ran no provider request.
- **78 provider calls** across all experiments in this step: estimated
  **$0.034071**. Shared approved $5 ledger: **$0.200561 accounted**, **$4.799439
  remaining**. One earlier uncertain request retains its full reservation. These
  are token-based estimates, not an invoice; the final settled ledger governs.
- Compared SHA-256 hashes for **1,043 tracked app/server/config files** with this
  step's starting state. Only `server/staff-access.mjs` changed, to map the new
  read-only `network-verification` action to the existing Admin network-effects
  permission. The new isolated Admin files and network-effects implementation
  are outside that tracked baseline. **No live voice or feeding-path file changed.**
- No production environment variables, migrations, records, worker settings,
  commits, pushes or deployments were changed.

Reports under `.local/calibration/`: `v12-verifier-development`, development
iterations `-r2` through `-r4`, `v12-verifier-final-development`,
`v12-verifier-heldout`, and `v12-verifier-pipeline`. Final runs have separate
AI-assisted `.audit.json` reviews. Earlier failed experiments remain available.

## Boundaries and next decision

The implementation makes errors inspectable and fails closed on required-check
failures. It does **not** establish that automatic AI revisions are production
ready. Human adjudication and comparison with a stronger or independently
configured reviewer should precede reliance on automatic revisions. Keep a fresh
holdout for any future tuning; do not relabel these cases as unseen.

The existing pending-only counter still does not count every mixed state. This
step does not change analytical eligibility rules, create live guidance, infer
causation from outcomes, or demonstrate a network effect from real users.

## Guidance applied

Read the saved [Responses reference](../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md)
and current relevant OpenAI guidance before implementing the new adapter:

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): a valid schema can still contain mistakes; validate evidence and handle refusals/incomplete output.
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): test actual tasks and edge cases, retain held-out examples, and calibrate model judgments with human assessment.
- [Model selection](https://developers.openai.com/api/docs/guides/model-selection): evaluate quality, latency and cost on the application's tasks. This same-model pass is a baseline, not proof it is the best judge.
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): verified configuration and token-pricing basis used by the shared test ledger.

## Inspect locally

The fictional Admin preview can replay a completed verification report with no
provider calls and an in-memory database:

```powershell
node research/network-effects/admin-preview.mjs --port 8795 --report research/network-effects/.local/calibration/v12-verifier-heldout.json --replay-report
```

The preview bypasses neither production authentication nor the production app: it
is a separate loopback-only test entry point with fictional data and no voice
connection. Its import timestamps reflect replay time; original model timings,
context hashes and reports are retained. Restarting discards preview changes.

Implementation: `verifier.mjs`, `verification-contracts.mjs`,
`verified-extraction.mjs`, the isolated stores and worker, and the Admin inspector.
Verification reports and AI-assisted audits remain under ignored `.local/calibration/`.
