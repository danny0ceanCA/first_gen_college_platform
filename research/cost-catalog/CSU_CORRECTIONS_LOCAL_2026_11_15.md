# CSU held-record corrections — local review

Prepared on `v1.3-decisions-integration`, November 15, 2026. No commit, push,
deployment, production connection, model call, or student-data access was made.

## Result

The original 819-scenario workbook and its SQLite import remain unchanged.
The candidate file is treated as proposed review data; its action strings are
never executed. A separate, hash-bound amendment creates a new local revision.

| Treatment of the original 236 held scenarios | Count |
| --- | ---: |
| Corrected and available in the isolated selection | 24 |
| Unknown annual units or included charges; still held | 125 |
| Calculated-estimate candidates without a published total; still held | 44 |
| Remaining arithmetic, source, program, cohort or insurance conflicts; still held | 43 |

The local selection grows from 583 to **607 CSU scenarios**. It preserves every
previous CSU record payload and all **491 UC scenarios**. The 12 San Marcos
tuition overrides already present in staging are supported at item level;
their conflicting published totals have not been overwritten or released.
The 44 derived estimates remain held because this scoped correction does not
introduce a calculated-total publication contract. Unknown amounts remain null.

## Supported corrections

- **14 Cal Poly SLO records:** concise population labels preserve the specific
  college group, residency and entering cohort. Canonical program/cohort values
  and scenario keys remain unchanged. Every included amount and corresponding
  published total was checked against the matching official table.
- **3 Pomona WUE records:** the food amounts match the separately identified
  food row in the resident table and reconcile with independently listed housing.
  Positive housing is retained; the commuter zero placeholder stays in source
  data. Eligibility and original labels remain explicit.
- **1 San Francisco State and 3 San José State records:** source footnotes put
  housing/food in one combined allowance. The source's included-cost/zero marker
  remains in raw evidence but does not create an overlapping canonical charge.
- **3 Humboldt credential records:** the PDF section identifies credential
  candidates. Fall and spring teaching-credential schedules for 6.1+ units each
  give required annual tuition/fees of $10,390, excluding optional SIRF ($4/year).
  Replacing the conflicting $10,930 fee line reconciles the PDF's three published
  totals ($28,774/$30,994/$32,156). The revised program and enrollment are explicit;
  this is not generic graduate tuition. The original PDF figure, original source
  date, flags and imported scope are retained in the immutable base revision.

The reviewed manifest records the exact input batch/workbook/candidate hashes,
per-record payload digests, expected original amounts, operations, bilingual
qualifications, and dated official-source evidence:
[csu-20261115.json](reviews/csu-20261115.json).

## Official source checks

- [Cal Poly undergraduate 2026–27](https://www.calpoly.edu/financial-aid/costs-and-affordability/undergraduate-costs-attendance-2026-2027)
- [Pomona prospective undergraduate costs](https://www.cpp.edu/financial-aid/undergraduate/prospective/cost.shtml)
- [San Francisco State cost of attendance](https://www.sfsu.edu/departments/financial-aid/cost-attendance)
- [San José State cost of attendance](https://www.sjsu.edu/faso/process/cost-of-attendance.php)
- [Humboldt 2027 COA PDF](https://www.humboldt.edu/sites/default/files/financial-aid/2026-11/2027-coa.pdf)
- [Humboldt fall 2026](https://www.humboldt.edu/student-financial-services/fall-term-2026)
- [Humboldt spring 2027](https://www.humboldt.edu/student-financial-services/spring-term-2027)
- [San Marcos COA](https://www.csusm.edu/finaid/costofattendance/index.html),
  [undergraduate schedule](https://www.csusm.edu/sfs/tuition/undergraduate.html),
  [graduate schedule](https://www.csusm.edu/sfs/tuition/graduate.html).

Direct download of SFSU returned 403 and SJSU had a TLS-chain failure; both were
successfully read with the web retrieval tool. No TLS verification was disabled.
Other held-candidate sources were inspected as supporting review, including
Fullerton's doctorate conflict and the continuing Solano insurance conflict;
their ambiguity is not treated as resolved. Download failures and raw public
source snapshots are retained in `.local/csu-corrections-20261115/`. This is not
an independent verification claim covering every figure in the entire workbook.

## Guidance and preservation

Used Daniel's previously approved CSU-review exception: reuse the documented
full library review, verify all 45 snapshots, then reread relevant guidance.
All 45 files are present and match manifest hashes after CRLF normalization.
The saved Responses reference, library index/audit/measurement plan and relevant
Live delegation, function calling, session, state, source and data guidance were
revisited. This was not a new literal reread of all generated API schemas.

Current [function calling](https://developers.openai.com/api/docs/guides/function-calling)
and [latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization)
support deterministic application code for known facts; no model pass was added.
[Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
keeps detailed source/provenance records in the backend and passes relevant facts
and material qualifications through the existing result path. Standalone Responses
and Live event contracts remain unchanged. The documentation is not runtime context.

No intro, prompt, model, voice, floor control, delivery schedule, Decisions flag,
binder behavior, table animation or table control was changed. This change only
adds reviewed catalog representation/provenance and isolated preparation/testing.

## Local validation

- Exact candidate identities/original-record preservation and all 236 original
  arithmetic recalculations were checked in the preceding review.
- Amendment preconditions reject stale payloads, another workbook, unknown
  operations, unsupported sources, positive-charge omission and unresolved sums.
- 48 corrected-budget projections (24 × English/Spanish) pass through canonical
  research findings and the white-table path with reconciled totals.
- A real, loopback-only PostgreSQL database, `origen_csu_corrections_20261115`,
  contains the original CSU baseline followed by the amended local release and
  preserved UC data. No live application environment files/URLs are loaded.
- All 24 amended payloads survive PostgreSQL round-trip; date-advanced projections
  work two days after review and reject a date beyond the December 12 expiry.
- 10 growing mixed UC/CSU table stages pass in English/Spanish, including column
  removal and restoration. Lookup-plus-table timings: 16–139 ms, median 24 ms.
  These are local data-path timings, not microphone-to-spoken-answer latency.
- A restricted research-worker reader can read the publication view but cannot
  read underlying drafts or update release records. Reapplication is idempotent.
- 133 automated checks passed across catalog, mapping, table retention, source
  validity, voice prompt structure, startup, worker and progress tests; 10 unrelated
  opt-in integration checks were skipped. The actual corrected PostgreSQL paths
  above were tested separately rather than counted as those skipped checks.
- TypeScript and the Vite application build passed.

No paid voice call was made. Spoken warmth, pacing and audible continuity still
need a microphone check; passing a catalog/table test does not establish those.

## Reproduce

```powershell
$env:COA_CSU_LOCAL_TEST='true'
node --test research/cost-catalog/csu-corrections.test.mjs
node scripts/prepare-csu-corrections.mjs research/cost-catalog/.local/csu-corrections-20261115
node research/cost-catalog/csu-corrections-local.mjs research/cost-catalog/.local/csu-corrections-20261115
```

These commands only prepare files and the hardcoded isolated database. They do
not activate the revision in the currently running microphone app or production.
Detailed selection/hold and rehearsal receipts are in the `.local` directory.
