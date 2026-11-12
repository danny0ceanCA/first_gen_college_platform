# Catalog validity and table freshness

Local repair on `v1.3-decisions-integration`, November 12, 2026. Not deployed.

## Failure and repair

Call `d4c7936f-9694-445b-8b7b-747c3d40bd46` retrieved its catalog result in
296 ms; the worker finished in 406 ms. The result contained the total and
components that Origen spoke, but the table rejected the evidence because its
source timestamp was older than the ordinary five-minute web-result window.

Catalog projections now carry application-owned, record-specific validity:
batch, record, digest, source identity, review basis, retrieval time and expiry.
The table and research-reuse paths honor that validity while preserving source
metadata through citation merging. Different records cannot inherit one
another's expiry through source deduplication.

| Date | Meaning |
| --- | --- |
| Source checked | Original workbook-reported check date for test records; actual independent review date for approved records. |
| Reviewed/released | Stored catalog approval or test-release timestamp, distinguished by review basis. A test release is not a website recheck. |
| Retrieved | When this application read the record. This does not refresh the source check or expiry. |
| Valid until | Stored publication expiry. Expired or malformed provenance is rejected, including the exact expiry boundary. |

Test records remain partial and retain their caveats. Ordinary web evidence
still uses the existing five-minute policy. Existing call/task recency limits
remain in place. No amount, scope, voice prompt, intro, pacing or floor-control
behavior changed in this repair.

## Verification

- 34 catalog/validity tests passed, including isolated PostgreSQL integration.
- 177 research reuse, comparison, recovery, visual, delivery and context
  regression tests passed.
- Clocks advanced eight hours, one day and 29 days; exact expiry rejected.
- Real Berkeley/Davis test records produced both populated columns in English
  and Spanish the next day. The actual React table was also checked in the
  local browser in both languages, including totals and transportation.
- A later read preserved the original source date and expiry. Removing catalog
  provenance restored the ordinary stale-web rejection.

No paid voice call was run. A fresh microphone call is still needed to assess
spoken delivery. Archived diagnostics were not rewritten. Revocation in the
catalog view controls subsequent reads; this repair does not claim to retract
facts already supplied to an existing voice session.

## Guidance review

The retained complete unique-content review of the saved documentation remains
applicable; no new literal reread of repeated SDK schemas is claimed. Manifest
integrity covers all 45 Responses, 30 Decisions and 35 conversation-state
snapshots. The saved Responses reference and relevant current official
[Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
and [latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization)
were consulted against these paths: application-owned state and truthful task
status, concise verified facts, reuse without unnecessary requests, and the
distinction between context delivery and actual speech/playback. Documentation
is development reference only and is not injected into runtime context.
