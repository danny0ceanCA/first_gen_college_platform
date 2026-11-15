# Calculated totals and partial estimates — isolated v1.3

Prepared November 15, 2026, on `v1.3-decisions-integration`. Nothing was pushed
or deployed. No production database, student account or paid model was accessed.

## Result

| Representation in the isolated catalog | CSU scenarios |
| --- | ---: |
| Previously selected published/corrected budgets, unchanged | 607 |
| Calculated estimates from listed same-scenario components | 44 |
| Partial estimates showing known costs and every unresolved included charge | 125 |
| Disputed scenarios still held | 43 |

The isolated selection contains **776 CSU scenarios** and retains all **491 UC
scenarios**. The original source workbook, SQLite import, published-total fields,
source dates, flags and prior selected record payloads remain intact. A new
immutable batch carries the application-owned estimate representation.

These are workbook-reported source figures with explicit limitations, not a new
independent financial verification of all 169 scenarios. The San Diego 2026-on
cohort override was checked against the current official
[Bursar schedule](https://bursar.sdsu.edu/tuition): $1,554 per fall/spring term,
$3,108 for those two terms. Its original COA allowance remains preserved; the
resulting aggregate is labeled calculated. Fullerton's six competing doctorate
rates, San Marcos's conflicting totals, and the other disputed cases remain held.

## Data and presentation contracts

- `published_cents` and the canonical budget's `total` stay **null** for the new
  estimates. A separate validated `catalogEstimate` holds the basis and amount.
  Calculated means a complete component sum for the stated source scenario;
  partial means a sum of known included components, excluding all unresolved
  charges. Neither is silently promoted into a university-published total.
- Unknown annual unit counts remain unknown. Published per-unit rates retain
  their semester/quarter basis. Missing mandatory fees remain unknown. There is
  no default annual load, balancing item, invented housing split or zero for an
  unavailable charge.
- If one tuition charge is unknown, the known base tuition/fees stay numeric.
  That row is labeled “Known portion” / “Parte conocida.” The missing supplement
  remains named in the partial estimate, with its rate and unit when supplied.
- The new annotation is application-owned and absent from the hosted Responses
  output schema. The parser rejects an external/model response claiming this
  representation without the associated catalog-source provenance. Citations
  and immutable record digests remain bound to each finding, including mixed
  comparisons with ordinary web findings.
- Existing published-budget completeness checks keep their original meaning.
  Calculated estimates have a separate mathematical-completeness observation;
  partial estimates never claim full coverage of a complete COA request.
- The white table uses one planning-summary row at the bottom. Each new summary
  cell says “Calculated estimate” / “Estimación calculada” or “Partial estimate”
  / “Estimación parcial.” Partial cells visibly name the excluded charge(s).
  Longer source conditions stay under “What’s included?” / “¿Qué incluye?”
- The existing spoken formatter leads with “Calculated estimate” or “Known costs
  so far,” then source scope and the material qualification. It no longer says
  “Total unverified” when an authorized known subtotal is available. This adds
  no model request, forced acknowledgment, filler, new pause or delivery event.
- Explicit WUE requests select WUE source records and retain the eligibility
  qualification. They cannot silently select the California-resident default.
- A qualified catalog off-campus benchmark remains visible in the table even
  when the caller asks about renting; the source housing category and personal
  applicability caveat remain explicit. Four additional partial SFSU/SJSU family
  budgets use the previously reviewed combined-living footnote mapping. Their
  original zero/included-cost markers remain in raw evidence.

## Activation boundary

`allowEstimates` defaults to false in the CSU selection builder. Only the new
local preparation/rehearsal explicitly selects the estimate records. Production
flags, current production releases and the running microphone application's
catalog connection were not changed. No database migration is required: the
new annotation is stored in the existing immutable JSON payload.

The intro, model/voice configuration, speech style, research scheduler, Decisions
flags, binder behavior, animation, table placement, drag, minimize/history and
column removal/restoration remain unchanged.

## Library alignment

Used Daniel's previously approved CSU-library review approach: reuse the
documented full review, verify all 45 saved files against the manifest after
line-ending normalization, and reread applicable guidance. All files were
available. This was not a new literal reread of every repeated API schema.

The saved Responses reference, relevant Live delegation, function calling,
structured-output, session/state and data-handling sections were reviewed
against the existing code. Current official pages were opened as well:

- [Function calling](https://developers.openai.com/api/docs/guides/function-calling):
  use deterministic application code for known arithmetic and prevent invalid
  states. No model is asked to sum the catalog or invent missing amounts.
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
  validate the representation explicitly; keep the external strict schema
  unchanged and application metadata separate.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation):
  pass concise factual findings and material conditions through the existing
  delivery path; retain full structured evidence in the backend. Live and
  standalone Responses event contracts are not interchanged.

The documentation library is not injected into runtime context.

## Validation and limits

- 338 actual-record English/Spanish projections (169 × 2) preserve exact sums,
  source scope, missing charges and null published-total fields through the
  parser, concise spoken-result formatter and white-table generator.
- Actual loopback PostgreSQL database `origen_csu_estimates_20261115`: 1,267
  selected rows (776 CSU + 491 UC), with every prior 1,098 payload digest
  unchanged. All 43 disputed IDs are inaccessible through the runtime view.
- All 338 projections also pass after advancing the clock two days; expiry
  beyond December 12 rejects the catalog record.
- Six real local read-only-provider → research-worker → white-table checks:
  English/Spanish nonresident calculated Sonoma ($50,194), nonresident partial
  SFSU ($27,736 known costs, excluding nonresident tuition), and WUE calculated
  Sonoma ($31,608; eligibility unconfirmed). Each uses zero provider requests,
  zero recovery attempts and the same qualified amount for voice and table.
  Lookup/worker/table processing took 15–27 ms (median 17 ms) locally. These are
  not microphone-to-playback timings.
- Ten growing published UC/CSU comparison stages still pass, including remove
  and restore controls. A restricted runtime reader cannot read draft tables.
  Reapplying the exact snapshot is idempotent.
- The actual React table was inspected in the local browser in English and
  Spanish, with published, calculated and partial figures side by side.
  Estimate labels, excluded-charge text, numeric alignment, column removal and
  restoration were observed. No voice connection was opened.
- 155 automated regression checks passed; four unrelated opt-in integration
  checks were skipped. The actual corrected/estimate PostgreSQL paths above
  were exercised separately. The TypeScript/Vite build passed. Results are in
  `.local/csu-estimates-20261115/`. Tests cover malformed annotations, totals
  disguised as source totals, wrong arithmetic, invented provenance, lost
  qualifications, source freshness, prior tables and voice-prompt preservation.

No live-audio or new microphone conversation was performed. These tests establish
data/formatting/UI behavior and preservation of the existing delivery mechanism;
they do not establish audible warmth, pacing or provider speech latency.

## Reproduce

```powershell
$env:COA_CSU_LOCAL_TEST='true'
node --test server/catalog-estimate.test.mjs research/cost-catalog/csu-estimates.test.mjs
node scripts/prepare-csu-estimates.mjs research/cost-catalog/.local/csu-estimates-20261115
node research/cost-catalog/csu-estimates-local.mjs research/cost-catalog/.local/csu-estimates-20261115
```

The hardcoded PostgreSQL operator accepts no remote/application URL and does not
load application credentials. Review selection:
[csu-estimates-20261115.json](reviews/csu-estimates-20261115.json).
