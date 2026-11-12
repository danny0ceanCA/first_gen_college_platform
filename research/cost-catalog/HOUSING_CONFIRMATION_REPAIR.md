# Housing confirmation repair — v1.3 local

November 12, 2026. Based on call `edeb8e80-593a-4b1d-b89e-920a11cef05f`.

## Findings and change

Riverside returned an off-campus benchmark plus a family scenario, with a rent-or-family next-step question. The delivery path only recognized a literal renting budget paired with family, so it missed that question. Its component discrepancy also made the strict complete-breakdown predicate unsuitable for determining whether existing qualified figures could be reused after a personal housing confirmation.

The repair distinguishes personal choice from source verification:

- A sourced off-campus benchmark paired with a family budget can prompt the same one-time housing question as a rental budget.
- The controller remembers a clear housing choice during the selected student's call, including short English/Spanish answers. Garbled text, hypothetical questions, uncertainty and negative rental statements do not establish a choice.
- Existing qualified published totals can be reused without claiming their components reconcile. Original statuses, source categories and caveats remain unchanged.
- The active table removes the unused scenario. Subsequent campus requests retain the confirmed choice. The speech evidence also omits the unused housing alternative while the complete retained source report remains intact.
- A small student-scoped quiet context packet records the caller's choice for the ongoing call. It requests no speech and makes no profile write. Only enumerated choices are accepted by this internal event; it is not a provider tool or consent event.
- Leading courtesy/filler words in a clear new-campus request no longer prevent recognition of that addition. The lookup can target the new campus while retaining earlier comparison columns, rather than redundantly checking the previous campus.
- Choosing an already available housing scenario does not start another lookup or generate a checking announcement. Native free speech still requires microphone validation.

The exact saved results replay narrowed Riverside from two findings to one, and the Berkeley/Riverside comparison from four findings to two. Their qualifications and original source records were unchanged. Riverside remains a qualified $44,329 published benchmark with the existing $85 discrepancy; this repair does not validate or alter the financial records.

## Guidance review

Used the retained approved full unique-content review of the 45-page Responses library; all 45 snapshots were checked again and remain unchanged. No pages were missing. This was not a new literal reread of the generated schema repetitions. Revisited the saved reference and relevant saved/current Live delegation, prompting and context-delivery guidance while comparing it with the implementation.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): application-owned task state follows the caller's correction, retained evidence keeps its qualifications, and thinking appends supply quiet facts without requesting speech. Managed Responses and client delegation contracts remain distinct.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting): focused clarifications, direct useful answers, no repeated progress or padding the wait. The existing intro, pace, listening and interruption policies remain unchanged.

## Local verification

- English/Spanish delivery and voice-policy regression suite: 377 passed.
- Full controller suite: 101 passed; the newly added quiet-confirmation controller cases were subsequently rerun and both passed.
- Database/table suite: 77 passed, including all nine campuses and four Riverside → Berkeley → Davis confirmation paths (both languages, rental/family).
- Housing wording checks: 6 passed. Quiet packet validation test passed; channel regression suite passed separately.
- TypeScript build passed. No paid model or microphone call was made.

Evidence is retained in ignored `.local/edeb-housing-*.txt` files. No production data was changed. Nothing was committed, pushed or deployed.
