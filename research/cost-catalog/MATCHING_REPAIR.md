# Campus, rental wording and benchmark recovery repair

Local work on v1.3, November 12, 2026. No commit, push, deployment or production
change. Regression request: call `0cea1eba-824a-4830-93f2-7dd1dbc9ebc0`.

## Changes

- Exact campus aliases recognize full English/Spanish University of California
  names, punctuation, at/en forms, short campus names and established acronyms.
  Unknown institutions are not fuzzy-matched to a UC. The same helper serves the
  catalog lookup and comparison state.
- Rental scope recognizes the saved wording "off campus in a rental" and Spanish
  equivalents. Negated rental plans, living with relatives and an unspecified
  off-campus plan do not establish renting. No student profile is written.
- Recovery no longer repeats an annual tuition lookup solely because personal
  cohort applicability remains uncertain when a published benchmark is permitted,
  a complete same-campus budget supports that exact amount/year/currency, and the
  tuition record contains no other expected facts. The partial status and caveat
  remain intact. Conflicting amounts, inaccessible evidence, an actual-cohort
  verification request and other missing facts still require recovery.

The intro, speaking prompt, pace, binder navigation, voice floor control and
research-announcement mechanism were not edited.

## Evidence

The original call missed the local catalog before querying PostgreSQL, then spent
29.657 seconds on its initial Responses/web pass. The saved request and its
Spanish equivalent now run through the worker with a real local catalog query,
with provider requests forbidden by the test.

| Replay | Worker/database time in final run | Provider calls | Recovery calls |
| --- | ---: | ---: | ---: |
| Exact saved English wording | 369 ms | 0 | 0 |
| Spanish equivalent | 184 ms | 0 | 0 |

Both return the $49,692 budget and the $1,238 transportation component, preserving
the cohort caveat. Timings exclude queue polling, Live generation, audio playback
and browser paint; they do not establish perceived spoken response time.

83 matching, PostgreSQL/catalog, updated-workbook, recovery and housing tests
passed. Another 114 worker, table/context, delivery and local-launch regressions
passed. These were offline/provider-mocked tests, not new paid voice calls.

The isolated app was refreshed at http://127.0.0.1:5173/#app with the worker ready,
catalog enabled, Decisions reply recovery off and production writes false.

## Library review

Retained the earlier approved full unique-content review of unchanged library
snapshots. Rechecked all 45 Responses, 30 Decisions and 35 conversation-state
manifest entries; no content changes or missing pages were found. This is not a
claim of a fresh literal full reread. Revisited the saved Responses reference,
relevant contracts and current official guidance while examining and fixing code:

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation):
  reuse valid results, avoid redundant tool calls and keep facts with caveats.
  Backend completion and actual spoken playback are separate outcomes.
- [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization):
  avoid unnecessary model requests where direct application lookup suffices.

No library text is injected into runtime context. No Decisions behavior changed.
