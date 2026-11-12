# Comparison retention and mandatory-fee answers — local v1.3

November 12, 2026. Based on call `856fe51f-78de-425a-afcd-e69d4bbe6d74`.

## What changed

The application now tracks the current call's cost-table lineage independently of its latest research job and spoken focus. A new campus request such as “Actually, let's look at Merced” extends that desk even without a comparison-addition phrase. Fee-only follow-ups also preserve its columns. The state resets when the selected student scope changes. Existing explicit housing-comparison behavior retains precedence.

This only retains visuals: it does not schedule old answers, copy prior-campus evidence into the latest voice result, perform extra lookups, or alter the intro, voice, pacing, floor control or animation.

The question parser now treats an excluded living-cost clause as an answer boundary. It does not interpret “excluding estimated housing, food and other living expenses” as a request for housing alongside tuition. A new positive instruction after “but” / “pero” is still recognized.

The isolated catalog's fee-only path now returns one sourced tuition-and-fees component without reopening rent-versus-family choices. It carries the component's own qualification as well as the original record qualification. For Irvine, this preserves the published COA grouping's insurance/fee-composition caveat. The $20,289 grouping is not presented as a verified personal bill or as a separate mandatory-fees-only subtotal.

## Local verification

- Actual isolated PostgreSQL → controller → visual reducer → cost-row replay in English and Spanish: Berkeley, Davis, a Merced focus change, Irvine, then required fees. All four campus columns and their totals remain; the fee finding is tuition-only with its caveat and no housing question. Five requested jobs, no recovery job or paid provider call.
- Catalog/table regression suite: 80 passed, including all nine campuses and prior housing-confirmation cases.
- Intro/conversation/delivery/session regression suite: 386 passed.
- Full controller run: 100 of 101 passed initially. One existing logging test failed on a raw number-substring check, then both language variants passed on rerun. Its assertion was tightened to check a standalone protected amount and complete answer text, avoiding arbitrary digit matches within identifiers/timestamps; both socket cases were rerun after that adjustment.
- TypeScript build and whitespace checks passed.

Evidence files are retained under ignored `.local/856f-*.txt`. No paid voice or real microphone validation was performed. These tests establish routing, payload content and table state, not proof of the model's actual spoken wording or perceived naturalness.

## Guidance review

Used the retained approved full unique-content review of all 45 Responses manifest snapshots. Checked all 45 again: none missing or changed. This was not a new literal reread of the generated schemas. Revisited the saved reference and relevant saved/current official guidance against the implementation:

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): application-owned task state, retaining backend records, delivering complete relevant facts with caveats, and distinguishing quiet context from speech.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#personality-during-tool-calls): answer the question actually asked, avoid repeated status/padding, and save unrequested comparisons for follow-up.

No source financial values or review dates changed. No flags, production services or production data changed. Nothing committed, pushed or deployed.
