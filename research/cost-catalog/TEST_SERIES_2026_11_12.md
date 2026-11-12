# Broader local COA test series

Read-only runtime assessment on v1.3, November 12, 2026. No paid provider calls,
real voice calls, production access, commits, pushes or deployments.

## Results

- Regression suite: 570 passed, one opt-in test skipped, zero failed (112 s).
- TypeScript build check passed.
- Independent integration matrix: 54 cases, nine UC campuses, English/Spanish,
  renting, family and unspecified off-campus housing. Uses actual isolated
  PostgreSQL data, catalog provider, server table builder and frontend cost-row
  parser. No API research fallback is executed in this matrix.
- Complete-table acceptance: 20 passed, 34 unmet. Catalog lookups took 5–82 ms
  including local table preparation, excluding audio and network delivery.

| Campus | Complete tables / 6 | Catalog misses | Catalog hit, total not displayed |
| --- | ---: | ---: | ---: |
| Berkeley | 6 | 0 | 0 |
| Davis | 6 | 0 | 0 |
| Irvine | 4 | 0 | 2 |
| Merced | 4 | 0 | 2 |
| Riverside | 0 | 6 | 0 |
| San Diego | 0 | 6 | 0 |
| Santa Barbara | 0 | 6 | 0 |
| Santa Cruz | 0 | 6 | 0 |
| UCLA | 0 | 4 | 2 |

## Diagnosed gaps

1. Riverside's residency label is `California resident / AB540 eligible`.
   Exact matching against `California resident` filters out existing records.
   The catalog miss does not establish absent published data.
2. San Diego and Santa Barbara use cohort labels such as `2026 Cohort`;
   Santa Cruz uses `2026-27 entering`. The adapter only recognizes the exact
   `YYYY-YY` key format for selecting a latest-cohort benchmark. It consequently
   returns ambiguity instead of selecting a labelled benchmark or clarifying.
3. Irvine, Merced and UCLA rental lookups return a published total, but the
   source housing is classified as generic `off_campus`. The single-column
   renderer's compatibility rule rejects it under the requested `renting`
   scenario. This leaves the total undisplayed despite the database hit.
4. UCLA family records are classified `commuter_unspecified`; the adapter does
   not equate that with living with family. This requires source-aware mapping
   or an honest scenario qualification, not blindly relabelling commuters.

The complete-table matrix is intentionally stricter than existing regression
tests: it checks the final visible numeric rows, not just a successful catalog
lookup or a valid typed result. Passing the regression suite does not establish
all-campus readiness. No application code was changed during this series.

Raw local evidence: `.local/test-series-final.txt`,
`.local/test-series-matrix.json`, `.local/test-series-matrix-summary.json`,
`.local/test-series-typecheck.txt` (ignored test artifacts).

Next repair should normalize source residency/cohort labels, preserve the
distinction between a published off-campus benchmark and a confirmed personal
rental plan, and align single-column display with that qualified benchmark.
Actual live speech/table synchronization still requires a microphone test.
