# Nursing research catalog

## Production availability

The user authorized all 1,016 nursing references for Origen's production live
answers on November 16, 2026. Migration 129 adds a separate, immutable
`production_releases` selection and restricted `production_budgets`,
`production_items` and `production_decisions` views. Source records remain
pending, unverified and automatically live-ineligible. Explicit caveated
availability is a separate publication decision, not independent source approval.

The research worker composes this lookup with the established UC/CSU provider.
It matches institution/program/year/residency/housing/period scope or asks for
clarification; an unrelated ordinary campus lookup retains its existing path.
Every record is addressable by its NUR reference. Explicit refresh requests
retain the existing research path. All nursing findings remain `partial` and
cite the retained source, with its actual source date. Unknown amounts, rates,
ranges, one-sided bounds and conflicts are retained without invented totals.
Large source records stay in the detailed report. Monetary claims whose
qualifications cannot fit a concise unit are withheld from that unit rather
than dropping their qualifications; focused component questions can return the
scoped component instead. No voice prompt, scheduler, floor control or Live API
event contract changes are required, and lookup adds no model call.

The pinned operator is `scripts/publish-nursing-catalog.mjs` (`inspect`,
`publish`, `verify` plus the full batch ID). It verifies the confirmed Render
workspace, worker, database, repository and external TLS target. Credentials
remain in memory. The explicit release expires December 17, 2026 UTC and does
not refresh source-verification dates. Source bytes remain in ignored local
snapshots. Only the nursing migration is applied; the pre-existing unrelated
migration 121 checksum mismatch is neither overwritten nor replayed.

All 45 Responses manifest snapshots were verified. The user explicitly
authorized reusing the documented prior full review with focused rereading;
Live delegation/prompting, result bounds and current official guidance were
compared with the existing worker and brief contracts. No library content is
injected into model context. The production lookup uses the existing durable
research/result delivery mechanism and changes no Decisions behavior.

## Original pending storage layer

The V24.1 nursing workbook is stored in `nursing_catalog` inside the same
isolated PostgreSQL database as UC/CSU: `127.0.0.1:55480/origen_coa_catalog_local`.
This remains pending research storage. The subsequently authorized production
selection described above is separate from this source state. UC/CSU catalog
tables and release selections are not changed.

Nursing has non-additive schedules and legitimately unknown component sums.
The existing UC/CSU tables cannot represent those without changing their
contract. A separate schema preserves them without replacing missing sums with
zero or converting rates/program costs into annual COA.

## Import

```powershell
python research/nursing-catalog/export_workbook.py --archive 'C:/path/to/Origen_Nursing_Codex_Handoff_V24_1.zip'
node research/nursing-catalog/postgres.mjs import-local <full-batch-id>
```

The exporter validates archive integrity and the complete hash manifest, retains
the ZIP and workbook byte-for-byte under ignored `.local/sources/`, cross-checks
the range and decision companions, and creates a deterministic immutable batch.
Source archive, workbook, adapter, mapping and exporter fingerprints retain
provenance. Repeated imports verify identity and contents instead of appending
duplicates. Imports are transactional and verify their full PostgreSQL round trip
before commit. The operator accepts only its fixed local database identity and
never reads production connection settings.

## Stored records

- 1,016 budgets and 6,493 cost items, with raw cells, formula text, cached values,
  original source labels, qualifications, IDs and source rows retained separately
  from normalization candidates.
- All 75 caveated decisions, retaining both workbook and companion representations,
  their exact budget/item links, unresolved facts, source references and caveats.
- All 39 supporting sheets and all four companion JSON files, plus the archive
  manifest. The two core sheets are retained in the budget/item records.
- Typed nullable monetary columns for scalar amounts, lower/upper bounds,
  compatible-period amounts, published totals, component sums and differences.
  Ranges, one-sided bounds and unpriced values remain distinct and nonadditive.
- Raw academic-year labels, normalized display labels and qualified canonical
  single-year keys. The 330 Unicode en-dash labels are valid original text.
  Historical, qualified and multi-year labels are not assigned a guessed year.

SQL constraints require pending/unverified/live-ineligible state. Records are
immutable; corrections require a new source batch. PUBLIC and the existing live
catalog reader roles have no access to the nursing schema. This is deliberately
independent of existing UC/CSU release views.

There are still 57 source/scope conflicts and 15 unpriced included items across
11 scenarios. The adapter also conservatively withholds incompatible periods,
unresolved roles and category candidates. These are retained review needs, not
facts resolved by import success. No source prices were newly verified.

## Validation

```powershell
python -m unittest discover -s research/nursing-catalog/vendor/staging_v24/nursing_schema_review/adapter -p 'test*.py' -v
$env:ORIGEN_NURSING_LOCAL_TEST='true'
$env:ORIGEN_NURSING_BATCH='<full-batch-id>'
node --test research/nursing-catalog/postgres.test.mjs
```

The 58 supplied adapter tests and four repository integration tests cover bounds,
unknown versus zero, references, source formulas, period guards, pending gates,
idempotency, immutable records, actual PostgreSQL constraints, rollback and the
complete supplied-workbook round trip. The database tests roll back their data.
Before and after the real import, all existing UC/CSU rows, approvals, releases
and test-view membership are compared to confirm they are unchanged.

The V24.1 adapter and its tests live under `vendor/staging_v24/` with their
original directory relationships. Local compatibility changes specify UTF-8
when reading JSON and read the workbook from its already-hashed byte snapshot.
The original archive remains preserved for comparison. The vendor README
describes the original standalone SQLite prototype; the commands above own
repository PostgreSQL usage.

No package documentation is supplied to a model. The original import was
storage-only; production availability was separately authorized as recorded
above. Source review and category/scope holds remain unresolved.
