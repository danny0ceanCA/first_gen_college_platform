# Isolated published-cost staging

## CSU workbook staging (November 12, 2026)

`import_csu_workbook.py` imports the supplied CSU v1 workbook into a separate
`.local/csu-coa-staging.sqlite`, preserving the original source snapshot and
leaving the UC import contract unchanged. The batch is also stored in the
dedicated local PostgreSQL catalog as pending data. It has no test release or
production approvals and is not supplied to Origen's live lookup.

The CSU adapter retains Budgets A:AC and Cost items A:AB, including annual units,
unit assumptions, source periods, location notes, per-unit rates and quantities.
It also retains all six supporting sheets as inert workbook evidence in the
batch report. Review notes are linked to their budget IDs and remain source
claims requiring review. Workbook prose and formulas are never executed as
instructions. No default annual unit load is invented for conditional fees.

Campus domains were checked against the
[official CSU directory](https://www.calstate.edu/attend/campuses).
The [Cal Poly cost page](https://www.calpoly.edu/financial-aid/costs-and-affordability/undergraduate-costs-attendance-2026-2027)
supports keeping Solano's location budgets separate. These checks do not
independently verify every amount or workbook source claim.

Source SHA-256: `510fccfb400b5a8666ff485ad8dd8bdaedf62b31608af1a23e6757123271fdb4`.
Batch: `cf0fe03601395617ac6a73981dd338058ba9244b51a2825ce7b14fa508d3d84a`.
Importer: `csu-coa-workbook-staging-v1.0`.

| Result | Count |
| --- | ---: |
| Budget scenarios | 819 |
| Cost items | 6,351 |
| Campus/location labels | 23 |
| Reconciled arithmetically | 608 |
| Published-total/component discrepancies | 36 |
| Missing included amounts | 125 |
| Components without a published total | 50 |
| Invalid budgets/items | 0 |
| Flagged for source/scope/data review | 798 |
| Approved for live use | 0 |

Reconciled amounts can still have source or applicability caveats. Missing
included amounts can reflect unknown annual quantities for published unit
rates. The 798-record review export is under `.local/reports/<batch-id>/`.
The original workbook is preserved byte-for-byte under `.local/sources/`.

```powershell
python research/cost-catalog/import_csu_workbook.py --workbook 'C:/path/to/Origen_CSU_Cost_of_Attendance_2026-27_v1.xlsx'
python research/cost-catalog/import_csu_workbook.py --workbook 'C:/path/to/Origen_CSU_Cost_of_Attendance_2026-27_v1.xlsx' --write
node research/cost-catalog/postgres.mjs import-local <batch-id> csu-coa-staging.sqlite
python research/cost-catalog/export_flagged.py --batch-id <batch-id> --database-name csu-coa-staging.sqlite
```

Validation: 28 Python tests passed with the supplied CSU workbook (one separate
UC-file integration test skipped); both Node staging/actual-PostgreSQL tests
passed. Every CSU budget/item payload and the complete supporting-sheet evidence
matched after round trip. Repeat import was idempotent. The active UC test view
retained its 491 records and original batch. No live conversation, research
provider, context delivery, runtime flag, deployment or production data changed.

## UC workbook history

The [updated-workbook local test release](UPDATED_WORKBOOK_TESTING.md) describes
the v2.1 import, source checks, caveated test view and isolated voice adapter.

The subsequent [PostgreSQL/provider preparation](POSTGRES_PREPARATION.md) adds
dedicated local PostgreSQL storage, source-review gates and a default-off
comparison/research adapter. It is not activated in the live application.

Branch `v1.3-decisions-integration`. This importer reads the supplied UC workbook
into its own local SQLite file. It does not connect to the application's
Postgres database, load environment credentials, call OpenAI, fetch source URLs,
change runtime flags, or register any application route/tool. The live model,
student brief, research workers, table and everything supplying them are untouched.

## Run

Use Python 3 with its standard library. No packages are installed.

```powershell
python research/cost-catalog/import_workbook.py --workbook 'C:/path/to/Origen_UC_Cost_of_Attendance_2026-27.xlsx'
python research/cost-catalog/import_workbook.py --workbook 'C:/path/to/Origen_UC_Cost_of_Attendance_2026-27.xlsx' --write
```

The default is a dry run. `--write` creates only
`research/cost-catalog/.local/uc-coa-staging.sqlite`, a hash-addressed source
snapshot, and a batch report in that same ignored directory. A custom
`--database-name` must be a plain `.sqlite` filename; remote URLs and directory
paths are rejected. Existing non-staging databases are rejected.

The source workbook is read once, hashed and preserved without modification.
Importer version and workbook SHA-256 determine batch identity. Repeating that
pair does not add rows; a changed workbook or importer version creates a separate
batch. The initial v1 classification run and final v1.1 run are both retained
locally. Query a specific `batch_id` when counting or comparing records.

## Explicit workbook v2 mapping

- Read `Budgets` row 5, columns A:Y and `Cost items` row 5, columns A:W.
  Original A:P/A:J fields and appended structured columns are mapped explicitly.
  Unrecognized column order fails before an import.
- Join cost items by Budget ID. Preserve Cost item ID and source row numbers.
  Duplicate IDs/scenarios and orphaned items are quarantined, not silently merged.
- Scenario identity includes campus, year, level, program, cohort, residency,
  fee residency, geographic applicability, housing, enrollment, period,
  currency, coverage months, summer treatment and dependent children.
- Preserve original source labels, qualifiers, URLs, checked dates and raw
  amounts in JSON. Do not infer citizenship, transfer cohorts or generic commuter
  housing. Generic off-campus scope remains unspecified rather than becoming rent.
- Recompute period amounts from original amount and explicit factor using decimal
  arithmetic. Do not execute Excel formulas or trust cached calculated amounts.
  A source override needs its verification URL, location/date, checked date and
  resolution; the original value is retained, and the override is flagged.
- Add only included components. Do not add subtotals, excluded rows or additional
  charges to the published total. Preserve published totals separately from
  derived sums and differences. Unknowns remain NULL, distinct from explicit zero.
- Source URLs receive syntax/domain checks only. Their content has not been
  independently verified by this importer. Source text is data, never instructions.

## Review separation

All records have `review_state='pending'`, `source_verified=0`. SQLite constraints
reject promotion through this schema. There is no live retrieval/approval path.

| Bucket | Meaning |
| --- | --- |
| reconciled | Included components reconcile to the supplied published total within one cent |
| derived | Included components are numeric but there is no published total |
| discrepancy | Component sum differs from the supplied published total |
| incomplete | An included component amount is missing |
| invalid | Structural/source/ID/number validation needs resolution |

Two views keep review work separate:

- `reconciled_review_queue`: reconciled records without additional importer flags.
- `flagged_review_queue`: non-reconciled records, unresolved housing scope, explicit
  source overrides, unrecognized categories or other flagged metadata.

Flags overlap. An arithmetically reconciled record can still need review. Raw
records and every cost item remain available. Neither view signifies approval.

```sql
SELECT bucket, count(*) FROM budget_records WHERE batch_id = :batch_id GROUP BY bucket;
SELECT budget_key, bucket, issues_json FROM flagged_review_queue WHERE batch_id = :batch_id;
SELECT budget_key, published_cents, components_cents, difference_cents
FROM reconciled_review_queue WHERE batch_id = :batch_id;
```

## Supplied workbook result

Final importer: `coa-workbook-staging-v1.1`.

Source SHA-256: `c895318ac9a88d8e0530d62916b106dd5a7e63dedbc43763b986d672195b8902`.

Batch: `7ea7c8a958e457a8e8819fab9cd7309c0bb9b7430eda6141018a2193171f17c7`.

| Result | Count |
| --- | ---: |
| Budget scenarios | 488 |
| Cost items | 5,254 |
| Reconciled | 396 |
| Derived only | 45 |
| Discrepant published totals | 36 |
| Incomplete | 11 |
| Invalid items | 0 |
| Reconciled without additional flags | 318 |
| Flagged review queue | 170 |
| Live-eligible records | 0 |

The 170 flagged scenarios include the 92 non-reconciled records and 78
arithmetically reconciled records with review issues. Housing-scope ambiguity
and explicit source overrides can overlap other flags.

## Tests and limits

Export the flagged queue without modifying the staging database:

```powershell
python research/cost-catalog/export_flagged.py --batch-id 7ea7c8a958e457a8e8819fab9cd7309c0bb9b7430eda6141018a2193171f17c7
```

This writes `flagged-scenarios.csv`, `flagged-detail.json` and a Markdown summary
under `.local/reports/<batch-id>/`. The CSV has one row per flagged scenario,
including reasons, totals, differences and official/verification source links.
JSON preserves all associated cost items. Exports and the source workbook stay
local and ignored by Git. The export never promotes or changes a record.

```powershell
$env:COA_TEST_WORKBOOK='C:/path/to/Origen_UC_Cost_of_Attendance_2026-27.xlsx'
python -m unittest discover -s research/cost-catalog -p 'test_*.py' -v
```

22 tests passed, including read-only flagged exports, CSV text safety, the complete supplied-file import, repeat import,
immutable source hash, separate scenarios, blank vs zero, period conversion,
subtotals/additional fees, overrides, duplicate/orphan quarantine, unsafe URLs,
raw-input formula rejection, versioned batches, foreign-key integrity, atomic
rollback and rejection of non-staging targets. Test databases are disposable.

This is a staging foundation, not a Postgres migration, source-approval workflow
or live lookup feature. Website accuracy, all scenario coverage and semantic
applicability still require review. A future integration needs its own approved
mapping into application storage, matching rules and delivery tests.

## Library review

The saved Responses reference, applicable structured-output/function-calling
guidance, and conversation-state separation were consulted before implementation.
All 110 saved snapshots, including the 45 Responses pages, match their manifests.
The retained, user-approved complete unique-content review remains applicable;
this was not a new literal reread of repeated generated SDK schemas. Exact
availability/integrity checks are in `.local/library-review.json`.

[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
informs the distinction between valid structure and correct facts. This importer
uses deterministic checks without a model call.
[Function calling](https://developers.openai.com/api/docs/guides/function-calling)
and [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
keep application-owned records and validation distinct from tool execution and
voice context. Accordingly, no staging record is supplied to either model.
