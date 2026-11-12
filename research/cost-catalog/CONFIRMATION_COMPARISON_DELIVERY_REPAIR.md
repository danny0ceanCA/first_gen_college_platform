# Housing confirmation, comparison rows and research delivery

November 12, 2026 · v1.3-decisions-integration · isolated local work.

## Changes following call 51ecfa24

- Two supplied rental/family budgets and an unanswered next-step question now
  produce one housing clarification at the existing safe speech opportunity.
  A question already heard is not scheduled again; explicit caller answers close
  it. This does not add a startup question or alter the intro.
- Explicit housing confirmation narrows the active table. Subsequent campus
  additions retain the selected scenario. The original options are archived in
  visual history, and an explicit request for a housing comparison can show the
  alternative again. No source record is deleted or new search needed.
- Mixed combined/separate housing categories use one aligned housing-and-food
  row. An application sum is permitted only from the same typed budget's known
  housing and food components, marked as a sum. Original breakdowns remain in
  the source details. Legacy free-form reports keep their existing behavior.
  No combined source figure is split or missing amount invented.
- A missing separate insurance amount is labelled instead of presented as a
  bare dash. Published totals and every stored amount remain unchanged.
- Spoken year ranges such as “2026 to 2027” match the equivalent saved
  “2026–27”. A correctly spoken estimate with the saved total can satisfy the
  headline even when “renting” also signals the housing aspect. Conflicting
  years, amounts, negation and scope still do not count as delivery.
- Research-only backend wording keeps accepted asynchronous receipts silent;
  live research wording treats explanations of existing budgets conversationally.
  No voice, pace, intro, floor-control timing or Decisions flag changes.

## Tests and limits

- 458 regression checks passed. A final focused policy/session/browser-table
  run passed 71 checks after the last research-wording change.
- All nine UC campuses remain covered by the 54-case English/Spanish catalog
  matrix, which checks typed line items and totals against displayed amounts.
- New bilingual replay tests verify confirmation removes the unused active
  scenario, history keeps both options, four campuses stay in the table, a
  requested housing alternative can return, combined rows reconcile, a housing
  clarification is scheduled once, and a completed native estimate is not
  followed by unsolicited commentary. Wrong-year/amount checks remain negative.
- Actual React browser checks confirmed narrowing from two to one Berkeley
  column, then growth to four campuses in both languages. Berkeley housing/food
  sums to $20,530; Davis $17,051; Merced $14,814; Irvine's published combined
  $22,541 is retained. These are local test catalog values, not a fresh source
  verification or personal quote. Totals stay on the bottom row.
- TypeScript check passed. No paid API calls or live-audio tests were run.
  Microphone testing is still needed to evaluate actual warmth, whether the
  model asks the clarification naturally, and spoken result timing. Offline
  scheduling/observation checks do not prove the listener heard an answer.

## Guidance review

The retained complete unique-content review covers the unchanged library.
Manifest integrity was checked again for all 45 Responses, 30 Decisions and 35
conversation-state snapshots. The saved Responses reference and relevant saved
Live prompting, delegation and session-delivery guidance were reread alongside
the implementation. This is not claimed as a new literal reread of repeated
generated SDK schemas. Current official
[Live prompting](https://developers.openai.com/api/docs/guides/live-prompting)
and [delegation](https://developers.openai.com/api/docs/guides/live-delegation)
were consulted: brief clarifications and reuse need no unnecessary delegation,
task state stays application-owned, concise findings support speech, and context
receipt and spoken delivery are distinct. No event contract or delegation mode
changed. No documentation was unavailable.

No commit, push, deployment, production writes, migration or source-date changes.
The idle isolated local app and worker were refreshed for testing.
