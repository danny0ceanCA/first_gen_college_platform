# v1.2 — preserve correct evidence and capture explicit obstacles

Local changes only, following the [step 2 evidence-check implementation](V1_2_VERIFICATION_STEP_2.md).
No live voice settings, prompts, briefs, binder feeds, conversation history feeds,
research delivery, production records or services were changed.

## Fixes

| Earlier behavior | Revised behavior | Why it helps |
| --- | --- | --- |
| The reviewer returned a complete replacement and could rewrite correct evidence. | It returns bounded field edits and explicitly justified additions. Code copies the original and applies only those edits. | Unchanged records, wording and metadata stay exact. |
| Wording-only changes could still pass as factual repairs. | A v3 code guard converts a statement/quote-only revision into a review hold. It does not overwrite the candidate. | Prevents automatic prose-only overediting, at the cost of holding some otherwise usable sources. |
| Receipt could turn into an inferred student submission; correct observations could be regrouped. | Explicit instructions distinguish reported events from inferred prerequisites; keys, concern assignments and other stable metadata cannot be regenerated. New/changed statements use exact source wording. | Reduces invented actions and attribution drift. Semantic judgment still needs testing. |
| Confusion could remain in prose while `barrier` stayed empty. | A separate obstacle inventory identifies exact source spans and affected records. Code adds missing spans to structured barriers. | Explicit difficulties become available for later analysis. |
| Existing waiting or generic-question barriers were inconsistently deleted or reworded. | Supported existing barriers are preserved. New obstacles append; replacement/deletion is rejected. | Consistent preservation across languages. A genuinely unsupported barrier requires a review hold. |
| A rejected repair only showed a generic failure. | Saved diagnostics include an allowlisted validation stage and contract code. | Admin can distinguish an evidence, reference or repair-format problem without recording private reasoning. |

The provider has no field edit for barrier, key, concern, topic, language or event
time. Each other edit must point to a compatible evidence issue. Additions must
use the same exact excerpt for their issue quote, item quote and statement.
Missing obstacle wording is copied by code rather than paraphrased by the model.
The durable audit validator repeats preservation checks before storage. The v3
prose-only guard is structural: it does not prove that every change bundled with
a classification, attribution, relationship, obstacle or new observation is necessary.

The review version is now `network-effects-verification-v3`. All three verification
versions require an audit; older v1/v2 audits remain readable under their original
rules. A newer job cannot downgrade to earlier safeguards, and an attempt cannot
switch versions halfway through. New code can review older queued jobs using
current safeguards. Historical evidence is not rewritten or re-extracted automatically.

Obstacle-bearing candidates are selected for review even when their quotes cover
the full source: one recorded obstacle does not establish complete coverage.
The primary extractor remains unchanged. The reviewer still uses a separate
`gpt-6-luna` Responses request with medium reasoning, not an independently trained
second model. A valid schema or an AI keep/revise verdict cannot prove accuracy.

## Evaluation

The first two development runs exposed overly broad statement repairs and an
invalid patch. Those unsuccessful attempts remain in the reports. A general
failed-result example clarified that a correctly recorded attempt should remain
untouched while its explicitly reported unsuccessful result is added separately.

The prior 18 cases are now known regressions. Eighteen new fictional cases were
authored independently and kept out of prompt tuning: nine exact no-op controls
and nine obstacle/attribution defects, balanced across English, Spanish and mixed
language. Expected labels and rubric text are never sent to the provider.

That first frozen run preserved all nine clean controls and recovered all nine
planted obstacles. Its semantic audit still found an omitted secondary fact; it
was not perfect semantic accuracy. The real primary-extraction pipeline then
exposed an inferred obstacle from a past discussion. Later regression runs exposed
unnecessary paraphrase edits and an omitted unsuccessful result despite recording
its obstacle. Every attempt and audit is retained. These findings led to the v3
code guard and general rules distinguishing discussion, incidental unknowns,
reported difficulties, and failed results after earlier successes.

After freezing v3, another agent authored 12 new cases (six clean controls, six
defects; four per language). These were not read by the implementation agent or
used for prompt tuning before the test. The final run also repeats the earlier
18 cases as **known regressions** and the 12-case real extraction-to-storage path.
The seeded-candidate tests isolate review behavior; the pipeline test actually
calls both primary extraction and verification before saving to isolated storage.

| Final test | Result | What it establishes |
| --- | --- | --- |
| 18 previously inspected cases | 9/9 correct controls exactly preserved; five defects repaired and four withheld | Better restraint, with reduced automatic coverage for ambiguous classifications/attribution. Three withheld responses initially had a hold-format error; see below. |
| 12 newly authored cases | 6/6 correct controls exactly preserved; 6/6 omissions repaired; 6/6 obstacles recorded; 3/3 distinct failed outcomes added | The final prompt and repair rules generalized to these unseen fictional examples. Existing observations remained unchanged. |
| 12 actual primary + reviewer + storage cases | 12/12 saved as exact keeps; six required concrete obstacle cases preserved; three prior-result links correct | End-to-end compatibility. Those obstacles were already present in the primary, so this run demonstrates preservation, not omission recovery. |

The fresh set covers omitted evidence and clean controls, not the contradictory
classifications withheld in the known set. This is **not** a claim of 100% accuracy.
The actual pipeline still retains unsupported Spanish gender wording in four
primary outputs. Historical scheduling barriers and equivalent obstacle strings
also require temporal/concern-aware analysis before future aggregate use. These
semantic and analysis limitations remain documented in the per-run audits.

All final paid reports use the same frozen v3 prompt. Median verification time on
the new cases was **4.49 seconds**; the actual two-call pipeline took **7.36 seconds**
end to end, including **3.51 seconds** for review. These are conventional medians;
the runner's saved summary fields use the upper middle observation for an even
sample. Timings describe background extraction, not live voice latency.

Reports and independent AI audits are under `.local/calibration/`:

- `v12-restraint-v3-known.json` and `.audit.json`
- `v12-restraint-v3-fresh.json` and `.audit.json`
- `v12-restraint-v3-pipeline.json` and `.audit.json`

Total shared-budget accounting is **$0.302226 used/reserved**, leaving
**$4.697774 of the approved $5**. This task added **$0.101665** to the ledger's
starting balance. Two uncertain earlier calls retain their full reservations;
these are metered estimates with conservative reservations, not an invoice.
No real student data was used.

Three known-case responses selected `needs_review` but also supplied obstacle
proposals, which the original strict decision parser rejected. The final parser
now retains validated, source-backed issues and discards every proposed edit,
addition and obstacle when the decision is a hold. It never applies that work.
Malformed outer contracts, absent issues and unsupported evidence still fail.

The three captured responses were replayed through the real verifier with mocked
transport: all became proper review holds, with no final extraction and unchanged
initial evidence. `v12-restraint-v3-known-hold-replay.json` records this separately.
Original paid reports and budget ledger hashes were preserved. This was an offline
parser verification, **not** a fresh model test or three automatic repairs.

Successful checks remain eligible for **isolated** analysis. The reports' pending
human-review label is a quality-review status, not an automatic publication gate
in the store. Failed or uncertain required checks are held. No record from this
workspace is supplied to the live model.

## Verification and boundaries

Final validation: **258/258 regression tests passed**, covering the isolated
extractor/reviewer, SQLite and PostgreSQL-compatible persistence, correction
history, audit versions, Admin permissions and fail-closed review holds. TypeScript
and the local production build passed. The build retains the existing large-chunk
warning; no bundle splitting changes were made for this task.

Admin's saved evaluation view now understands verification reports separately
from ordinary extraction reports. It shows correct saved/held/kept/revised totals,
source text, before-and-after observations, audit findings and review status. Exact
preservation is labeled as a restraint check, not an accuracy score. Browser checks
confirmed both Evaluations and Processing render saved v2 evidence correctly;
version labels are data-driven and v1/v2 remain readable after v3.

No migrations were run against a service database. SQLite and PGlite regression
tests use isolated test data. No production access, commit, push or deployment was
performed. The student app was not restarted. A before/after SHA-256 comparison of
1,043 tracked application/configuration files found zero changes during this work.

The first fresh v2 run was interrupted by a long host pause that expired a job
lease. Its report and uncertain cost reservation were retained; it was repeated
without prompt tuning. The test runner now records interrupted/stale-lease attempts
instead of crashing before its accounting is saved. Production lease rules were
not relaxed. Windows sandbox build/test filesystem failures were also retained;
the authorized local reruns completed outside that restriction.

## OpenAI guidance applied

Read the saved [Responses reference](../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md)
and current relevant guidance. The changes apply these principles to this isolated
adapter; they are not changes to Live delegation:

- [Structured Outputs: handling mistakes](https://developers.openai.com/api/docs/guides/structured-outputs): schema compliance does not guarantee correctness; separate simpler checks and validate their outputs.
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): use focused comparisons/classification, edge cases and held-out evaluation instead of relying on open-ended model judgment.
- [Prompt engineering: examples](https://developers.openai.com/api/docs/guides/prompt-engineering): demonstrate the intended boundary with varied examples. The failed-result example is illustrative, not a fixture to copy.

Raw public structured review answers are retained only in the fictional calibration
reports to diagnose invalid patches. Production-style audits retain concise findings
and sanitized metadata; private reasoning, credentials and response headers are not
captured. All paid tests use the existing durable `v12-approved-5` budget ledger.
