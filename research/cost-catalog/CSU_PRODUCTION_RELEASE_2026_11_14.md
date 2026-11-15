# CSU production catalog and comparisons

Prepared November 14, 2026 (America/Los_Angeles) on v1.3. In call
`d7ed849f-1225-4ced-a539-b3ded3166f3f`, Sacramento State fell through the
UC-only matcher and used about 20.5 seconds of queued web research despite
the separate CSU workbook already being staged locally.

## Changes

- Shared exact identities cover all 23 CSU campus/location labels, full names,
  acronyms, Cal State names and Spanish names. Ambiguous `Cal Poly` and unrelated
  colleges do not match. Longest named mentions keep UC campuses distinct from
  San Francisco State, San Diego State and Cal State LA.
- Equivalent general-undergraduate source labels and residency labels are
  supported. Enrollment assumptions and generic off-campus benchmark caveats
  remain explicit. Specific programs and part-time requests do not inherit a
  different published scenario.
- Migration 128 activates the newest valid release per campus, so publishing
  CSU no longer hides UC. A newer release does not revive omitted scenarios
  from that campus's older workbook. Reader grants remain limited to the view.
- Readiness checks one published row instead of counting the catalog. Scoped
  planner statistics were refreshed after import. An initial production check
  timed out; repeated verification passed after this adjustment. Timeout limits
  were not raised.
- Existing table lineage and controls are reused. Sacramento's combined
  housing-and-food allowance aligns with labeled housing-plus-food sums for
  other campuses. No Sacramento split is invented.

The voice model, intro, speech style, floor control, delivery scheduler,
Decisions flags and table animations were not changed. Unrelated App and
DiscussionBoard edits were excluded.

## Publication and provenance

Workbook SHA-256: `510fccfb400b5a8666ff485ad8dd8bdaedf62b31608af1a23e6757123271fdb4`.
Batch: `cf0fe03601395617ac6a73981dd338058ba9244b51a2825ce7b14fa508d3d84a`.

583 records and 4,556 items were selected from 819 scenarios; 236 remain held
for unresolved arithmetic, missing totals/components, source overrides or
unsupported structured projections. Original dates, flags, amounts and source
text were not rewritten. These are caveated publications, not independent
source-review approvals. Workbook-reported November 12 dates stay November 12;
publication does not claim every website was rechecked. This release expires
December 12, 2026 UTC.

The current [Sacramento Bursar source](https://www.csus.edu/administration-business-affairs/bursar/tuition-living-costs.html)
was checked for tuition/mandatory fees and living categories. The
[official CSU directory](https://www.calstate.edu/attend/campuses) supports campus
identity. The earlier call's PDF URL returned 404 during review; the workbook's
Bursar URL remains usable. All 491 existing UC records and their ordered digest
checksum remained unchanged. Publication is idempotent.

## Guidance review

Daniel explicitly approved reuse of the documented full review, verification
of all 45 manifest files, and a focused reread. All 45 exist and match hashes
after line-ending normalization. This is not a new full-schema reread. The
saved Responses reference, index, audit, measurement plan, conversation-state
index and Decisions reference were consulted. No library enters model context.

Relevant saved sections and current official guidance were compared with the
lookup, publication and table implementation:

- [Function calling](https://developers.openai.com/api/docs/guides/function-calling):
  handle known facts deterministically in code rather than adding a model pass.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation):
  preserve application task state, concise factual context, and the distinction
  between silent context and spoken updates. Event contracts remain unchanged.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting)
  and [Live sessions](https://developers.openai.com/api/docs/guides/live-conversations):
  preserve natural delivery; context receipt is not proof of audible delivery.
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search):
  retain official source links and claim associations in table details.
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
  and [data controls](https://developers.openai.com/api/docs/guides/your-data):
  catalog/comparison state stays application-owned public reference data; this
  adds no API conversation storage or new student-data transmission.

## Tests and limits

- 181 automated checks passed: matching, publication selection, research reuse,
  task identities, source validity, table retention and intro/style preservation.
- Actual isolated PostgreSQL: 46 campus/language checks, with 40 ready generic
  resident rental matches. East Bay's resident rental amount is held; Cal Poly
  SLO and Solano require program scope. Their identities still match correctly.
- Ten growing-comparison stages passed in both isolated and production reads:
  Berkeley → Davis → Sacramento → Long Beach → San José State. Totals, tuition,
  qualifications and remove/restore controls survived.
- The actual React white table was inspected locally in English and Spanish.
  Removing Davis left other columns intact. The tested panel stayed inside a
  1280×720 viewport; wide tables scroll internally.
- Restricted-worker production checks passed. After adjustment the ten
  lookup-plus-table stages took 66–297 ms; Sacramento took 67 ms in English
  and 71 ms in Spanish in that run.
- Production build passed. No paid model call, account-data update or new
  microphone trial was made. These lookup timings are not end-to-end spoken
  latency. A production microphone call remains the final listening check.

Snapshot, held-record list, rehearsal and production receipts are retained in
`.local/csu-release-20261114/` (git-ignored); browser screenshots are under
`output/playwright/csu-release-*.png`.
