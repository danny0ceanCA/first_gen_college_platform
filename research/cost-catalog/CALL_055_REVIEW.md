# Call 055b4a39 review

Reviewed local saved call `055b4a39-7cd8-447f-9219-97e855b772da`, November 12, 2026.
Read-only assessment; no runtime changes or paid validation.

Evidence: 677 private capture events, 274 research trace events, two research
job snapshots in the isolated application database. Local exports are ignored
under `.local/call-055-*.jsonl`.

| Measure | Berkeley | Davis |
| --- | --- | --- |
| Catalog lookup | Deferred, 3 ms | Deferred, 1 ms |
| Initial web attempt | 28.402 s | 37.616 s |
| Recovery attempt | 18.885 s | 20.889 s |
| Total worker duration | 47.511 s | 58.601 s |
| Initial evidence published (UTC) | 15:52:25.316 | 15:54:16.737 |
| First result-answer audio-buffer start (UTC) | 15:52:26.692 | 15:54:18.580 |
| Final outcome | Partial benchmark, total and components available | Tuition available; attendance total unverified |

Audio-buffer events are provider observations, not proof of every sample heard.
Transcript completion timestamps include the duration of the spoken answer and
must not be interpreted as all silence.

## Findings

1. Neither request used the catalog. Both requested generic “living off campus.”
   The local adapter deliberately rejects unspecified off-campus housing rather
   than choose renting versus living with family. Its early return records only
   “deferred,” without the reason. The preceding catalog-expiry repair therefore
   did not address the path this call used. No rental clarification was asked.
2. Berkeley's “about 44,000” answer began before the new research returned and
   conflicts with the later $49,692 benchmark. It is not supported by the saved
   result from this request. The later answer was not an explicit correction.
3. Davis completed technically but did not satisfy the requested attendance
   total. Its result explicitly reports a retrieval/completeness limitation,
   not absence of a published cost table. It supplied $18,077.13 tuition/fees.
4. Initial findings reached the spoken-answer path roughly 1.4 s and 1.8 s after
   publication. The longer wait was primarily before findings existed on this
   web path; recovery also produced further status/context updates.
5. “That check has ended with no later results coming” appears after Berkeley
   and after Davis. Internal continuation/status wording in liveResearchContext,
   researchDelivery and backgroundResearch is being verbalized. Davis's tuition
   answer then repeats following a final commentary request.
6. Replaying final snapshots through the actual server table builder produces
   Berkeley's itemized total and, for the later job, Davis tuition with an empty
   Davis total and retained Berkeley figures. It does not prove those tables
   were displayed in the live browser at the same time.
7. ProfileVoice handles `origen.visual.research` before `capture(e)` and returns.
   There are no table receipt/render timestamps in this call's capture. Exact
   table display delay cannot be measured from the existing evidence. Silent
   presentation exceptions also lack diagnostic visibility.
8. The Davis request retained Berkeley evidence but still listed both campuses
   for lookup (lookupCount=2, reusedCount=1). Retention did not fully narrow the
   research task to Davis.

## Next repair

- Preserve known rental scope; otherwise clarify once without abandoning the
  catalog. A clearly labelled benchmark can remain distinct from a personal
  confirmed scenario.
- Use one source-backed result version for spoken figures and table rows.
  Publish the itemized table as soon as usable evidence arrives, independently
  of waiting for optional recovery or the end of speech.
- Keep task completion metadata quiet and announce only new useful facts.
  Recognize the tuition answer already delivered when recovery changes no fact.
- Log catalog-defer reasons and table build/emission/receipt/render milestones,
  report version and presentation outcome, keeping playback evidence separate.

No code, flags, deployments or production data changed during this review.
