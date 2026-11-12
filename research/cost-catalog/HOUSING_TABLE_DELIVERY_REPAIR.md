# Database-first COA and housing comparisons

Local changes on `v1.3-decisions-integration`, November 12, 2026.
No commit, push, deployment or production database change.

## Behavior

| Before | Now |
| --- | --- |
| Generic off-campus wording bypassed the catalog. | A known rental/family plan survives generic tool wording. An unknown off-campus arrangement returns separately labelled rental and family benchmarks from the database. |
| A missing personal housing detail triggered web research. | Existing valid scenarios can support a caveated answer and one clarification, without guessing a personal choice or issuing a web request. |
| Housing alternatives could collapse to the same campus/year finding. | Application-owned catalog scenario identities survive normalization and appear as distinct columns. |
| A table could wait for the caller's speech to finish. | Relevant completed data can open the table during an ongoing turn, independently of the spoken-answer scheduler. |
| Adding a scenario could replace the comparison. | Explicit housing alternatives carry table lineage; existing campuses and scenarios remain alongside the addition. |
| A total-plus-tuition request risked a tuition-only projection. | A COA request retains its full typed budget and components even when tuition is also requested. |
| Internal completion prose could become speech. | Completion is quiet structured state; result prompts request useful facts without task-status announcements. The existing intro and floor-control behavior stay intact. |
| No browser table milestone existed. | Private diagnostics record receipt and DOM commitment, job/report timestamp, columns, visible rows, populated cells and local receipt-to-commit time. These are not playback or comprehension evidence. |

Catalog source dates and expiry are unchanged on reads. Test evidence remains
partial with its source and applicability caveats. No financial figures or
workbook values were changed. Unsupported or expired records can still require
research; this is not a claim that every personal scenario is verified.

## Tests

- Broad regression run: 502 passed. Subsequent focused runs cover the final
  catalog parser, controller, task-status wording, metadata and UI changes.
- Final focused delivery/catalog run: 278 passed.
- Worker, catalog routing, trace and delegation-policy run: 88 passed; one
  opt-in database test skipped. The separate catalog PostgreSQL tests did run.
- New English/Spanish controller checks confirm a known rental plan survives
  generic backend wording.
- New isolated PostgreSQL-to-worker-to-table tests prove generic off-campus
  requests avoid all provider/search calls, retain full components, and grow
  Berkeley/Davis rental/family comparisons to four populated total columns.
  The local test sequence took approximately 0.17–0.24 seconds in its first
  measured run; this excludes voice negotiation and audio playback.
- Browser checks used the actual React component in both languages, adding
  Davis and its family scenario while preserving Berkeley. The corrected DOM
  diagnostic showed eight displayed cost rows and 16 populated cells for the
  initial two-column table, committed 12 ms after local receipt in that preview.
  That is a UI preview measurement, not a live-call latency guarantee.
- TypeScript build check passed. No paid voice calls were run.

## OpenAI guidance and review limits

The retained full unique-content library review remains the basis for all 45
Responses pages and related Decisions/conversation-state references. All 110
manifest files were checked unchanged (normalizing checkout line endings).
This is not claimed as a new literal reread of repeated generated SDK schemas.
The saved Responses reference and relevant saved contracts were revisited
alongside the implementation.

Current official [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting)
and [delegation](https://developers.openai.com/api/docs/guides/live-delegation)
were consulted: clarify missing inputs without unnecessary backend work, avoid
guessing while results are pending, keep large structured records in the
application, distinguish silent context from spoken updates, and evaluate
speech separately from context delivery. The current function-calling page
fetch failed during this review; its saved snapshot was available. No API
event contract or delegation mode changed.

The local app and worker were refreshed against the isolated account copy.
Decisions reply recovery stays off. A fresh microphone call is needed to
validate actual wording, turn-taking and speech/table timing together.
