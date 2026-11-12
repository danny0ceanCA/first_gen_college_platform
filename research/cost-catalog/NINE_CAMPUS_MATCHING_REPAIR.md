# Nine-campus catalog matching repair

November 12, 2026 · v1.3-decisions-integration · isolated local data only.

## Changes

- Accept the shared California-resident/AB540 source category for resident
  budgets without asserting personal AB540 eligibility. Nonresident categories
  remain separate.
- Recognize source cohort labels (`2026 Cohort`, `2026-27 entering`, earlier
  ranges) and select the latest labelled benchmark when personal cohort is
  unknown. Keep explicit requested cohorts distinct from the budget year;
  unfamiliar labels still require clarification rather than arbitrary selection.
- Use an explicit source statement to map Santa Cruz commuter records to family
  housing. Do not apply that mapping universally.
- Preserve UCLA's commuter/remote category as a labelled benchmark, with family
  applicability unconfirmed. Its original category and caveat stay in the data
  delivered to Origen and in the table. Nothing establishes a personal choice.
- Display catalog budgets under their own published housing scope instead of
  hiding amounts when a requested rental plan differs from the generic source
  category. Label generic off-campus benchmarks explicitly; put scope notes
  below the table as well as in detailed qualifications.

No workbook amounts, source-check dates, record digests, approvals, expiry or
production data changed. No voice prompt, intro, pacing, floor-control or
Decisions behavior changed. No new model calls or wait gates were introduced.

## Verification

54 isolated PostgreSQL/catalog/server-table/frontend-row cases: all passed in
English and Spanish across nine campuses, with renting, family and unspecified
off-campus requests. Each returned typed component and published total is
checked against the corresponding displayed amount. These are source-qualified
test records, not a claim that every amount applies to a particular student.

| Campus | Complete numeric tables before | After |
| --- | ---: | ---: |
| Berkeley | 6/6 | 6/6 |
| Davis | 6/6 | 6/6 |
| Irvine | 4/6 | 6/6 |
| Merced | 4/6 | 6/6 |
| Riverside | 0/6 | 6/6 |
| San Diego | 0/6 | 6/6 |
| Santa Barbara | 0/6 | 6/6 |
| Santa Cruz | 0/6 | 6/6 |
| UCLA | 0/6 | 6/6, including qualified commuter benchmarks |

Measured local lookup/table preparation: 8–106 ms in the strict matrix run;
excludes voice negotiation, browser network transport and playback. Zero
external provider calls. Explicit older cohorts and unsupported requests were
also checked. Broad regressions: 626 passed, one opt-in test skipped. Final
post-presentation checks: 90 passed. TypeScript check passed. Actual React
browser checks confirmed Irvine and UCLA totals in both languages; a final
change subsequently added visible scope notes. No live-audio calls were run.

## Library alignment

The retained complete unique-content library review remains applicable. All 45
Responses, 30 Decisions and 35 conversation-state snapshots were checked against
their manifests with no content changes. The saved Responses reference and
relevant saved/current guidance were revisited against these paths; this is
not represented as a new literal reread of repeated SDK schemas.

Current official [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting)
and [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
support keeping procedures and structured state in the application, using
existing relevant results, clarifying meaningful missing facts, and returning
concise qualified information without inventing progress or outcomes. This
repair follows those principles without changing delegation/API contracts or
adding the library to runtime context. No saved documentation was unavailable.

No commit, push or deployment. The idle isolated local app and worker were
refreshed; a microphone call remains necessary for actual speech/visual timing.
