# Cross-topic research — local implementation review

Date: 2026-11-11
Branch: `v1.3-decisions-integration`
Status: local changes for review; no commit, push, deployment, migration, or production changes.

## One process across topics

The research worker now uses a shared source-backed record for non-budget research. A new topic does not require a separate conversational script. Records can contain dates, amounts, numbers, published rules, requirements, ordered steps, links, or other facts. The topic vocabulary includes a general `other` category. The existing official-source policies and tool permissions still apply.

| Information | What travels with it | Why it matters |
| --- | --- | --- |
| Date | Actual application cycle, term, population, cutoff and verified time zone | An old deadline cannot become a current one through reuse. An unknown time zone remains unknown. |
| Amount or count | Currency or unit, exact/range/maximum/minimum, conditions | A maximum scholarship is not a guaranteed award; annual and term amounts stay distinct. |
| Rule or requirement | Population, program, location, enrollment or delivery restrictions, source | A public eligibility rule does not become an individual eligibility determination. |
| Process | Ordered steps, prerequisites and source conditions | Missing steps remain visible; a described submission is not reported as completed. |
| Other fact or link | Source, scope and limitations | General research can use the same pipeline without a budget-specific parser. |

Each record lists the facts requested and the facts actually verified. Missing facts remain partial or unverified. Voice, the retained report and white table derive their facts from that validated record. Legacy results and structured budgets remain readable.

The table expands typed facts into rows, retains comparison columns, and exposes source links. It does not parse a paragraph into an invented amount or date. A missing requested field stays visible as unknown.

## Reuse and Decisions

The server selects only authorized records for the existing account, call and student. Clear requests can reuse fresh, compatible public facts without a new source lookup. A changed cycle, program, population, enrollment, format or new qualifier prevents silent reuse. Ambiguous competing deadlines do not select themselves. Original source-check times and citations survive reuse.

The existing Decisions comparison path can select a clearly identified changed item for non-budget research. Only that item goes to source research; unchanged entries retain their evidence. The new checks use mocked Decisions responses. They establish routing and preservation behavior, not real classifier accuracy or a quality advantage over rules.

An added college inherits the requested scope and fact types, not the previous college's deadline or source-expiration date. Each returned record carries its own source facts and conditions.

## Recovery and conversation

Useful initial findings are published before optional, bounded recovery. Recovery receives the missing requested facts and known evidence. It does not need to repeat already verified facts. Compatible results fill missing fields; a different cycle or incompatible scope cannot replace the original record. Recovery is not called successful while requested facts remain unavailable.

This increment leaves the intro, voice choice, speaking pace, floor control, and reply-recovery policy unchanged. Ordinary follow-ups retain their existing conversational route. There is no new model call to rewrite research for speech and no new worker service.

Large records remain in the backend and table. Live receives the concise answer and its qualifications. If a short answer omitted a fact needed by the current focus, a bounded quiet update carries that fact with its condition and source. Existing acknowledgement and natural-pause delivery controls remain in force. These changes do not guarantee a measured live latency improvement.

## OpenAI guidance reviewed

The previously reviewed Responses library remains available: all 45 manifest pages match their saved hashes after normalizing checkout line endings. The saved Responses reference, Decisions reference and conversation-state guidance were consulted, with relevant sections checked again against this implementation.

Current official guidance checked:

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema conformance still permits factual mistakes; application validation remains necessary. Required nullable fields and strict object contracts are used.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): application-owned state, concise complete results, large records retained in the backend, distinct quiet context and spoken updates, and the 500-token append contract. Existing transport conservatively bounds each packet to 480 UTF-8 bytes.
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search): actual hosted citation annotations establish the returned references; source provenance is retained and displayed as clickable links.

No documentation library is injected into runtime model context. Standalone Responses request schemas remain separate from Live event contracts.

## Local verification

- 46 new controlled cases cover English and Spanish: admissions, scholarships, financial-aid rules, housing policy, programs, support offices, enrollment, careers, process steps and generic facts.
- Tests cover shared voice/table values; maximum-award caveats; missing deadlines; invalid dates, citations and ranges; unknown cutoff zones; scope changes; stale evidence; partial fact reuse; adding a college; Decisions-directed comparison changes; compatible and incompatible recovery; and useful initial publication before recovery.
- 333 related research, comparison, delivery and visual-state cases passed, including all 46 new cases. Together with the separate control suites below, 486 automated checks passed.
- Separate control, worker, job and research suites: 153 passed, 11 skipped because the required integration database configuration was absent. No failures.
- TypeScript build checks passed. Browser checks passed for 20 English/Spanish table states at 1280px and 897px, including both columns, source links and viewport bounds. See `output/playwright/research-desk/cross-topic-browser-results.json` and screenshots in the same directory.
- The local app uses the existing isolated database copy, with production writes disabled. Decisions reply recovery remains off. No paid model or live-audio validation was performed in this increment.

## What still needs a real call

Real provider extraction accuracy, classifier choices, actual speech/playback and perceived pauses require live validation. Useful next trials include comparing deadlines, adding a scholarship or program, changing applicant type or term, and asking a follow-up while partial findings arrive. Check the actual cited source, spoken qualification and table together. Offline success is not proof that the caller heard the result or that every official source can be retrieved.
