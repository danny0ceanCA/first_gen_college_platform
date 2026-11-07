# Research focus and completed outcomes

November 7, 2026. Local changes on `v1.2`, based on `6cf76b8`. No commit, push, deployment, production configuration change, or paid provider call.

## Review coverage

Before editing, the review team read the unique content of all 45 official snapshots in the manifest, using the previously authorized exact-duplicate schema deduplication. All 45 current file hashes match the manifest after newline normalization. Twelve method pages contain only content already represented in the parent API schemas; their contracts were included. The saved `OPENAI_RESPONSES_REFERENCE.md`, library README, configuration audit, and measurement plan were also reviewed. No document was unavailable, and no assigned content remains unread.

Relevant current official guidance was checked again:

- [Live delegation: accurate updates, retained task state, and complete interaction verification](https://developers.openai.com/api/docs/guides/live-delegation): distinguish task completion from speech, reuse valid results, and keep conversation independent of backend work.
- [Live conversations: context delivery and transcript timing](https://developers.openai.com/api/docs/guides/live-conversations): append acknowledgments describe context delivery, not playback. A transcript fragment is not a complete turn.
- [Live prompting: tool-call personality and reuse](https://developers.openai.com/api/docs/guides/live-prompting): answer the question asked, report supplied task state, and avoid repeated status messages.
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling): tool descriptions should make their purpose and use conditions explicit.

The standalone Responses and managed Live delegation contracts remain distinct. This change adds no model router, new provider calls, speech cancellation, forced response creation, or instruction append.

## Observed failure and changes

The reviewed production call ended around 9:14 AM Pacific on November 7. Its opening and ordinary conversation were preserved. The research failure pattern involved a pending campus question, a comparison aside naming an earlier campus, and an initial partial result followed by terminal recovery.

| Before | Local change | Intended benefit |
| --- | --- | --- |
| The last named campus could replace the outstanding question, even in a reflection. | Explicit requests and brief subject selections update focus; reflective mentions preserve it. An appended comparison clause does not replace the primary task. | Answer the question the caller is still waiting for. The same rule is tested on scholarship deadlines. |
| An initial pending gap could prompt an unrelated verified comparator answer. | Keep an unverified-only requested portion quiet while recovery runs. Give its terminal outcome one opportunity at the existing safe pause. | No substitute answer or premature final-failure announcement. Ordinary Live conversation remains available. |
| Requesting one announcement implicitly covered every finding in the report. | Track the exact requested finding separately from observed completed portions. Unspoken outcomes remain eligible; unchanged attempted announcements are not replayed. | Complete the requested outcome without repeating an earlier answer. |
| Long commentary fell back to a report reference with no precise finding target. | Use stable opaque references to complete acknowledged finding units; defer if a newly selected unit was never supplied. | Keep every year, scenario, and qualification while bounding each append to 480 UTF-8 bytes. |
| Earlier comparison reports were excluded from reuse. | Select individually attributed, cited, verified campus findings from comparison reports, with at most four campuses and eight findings. | Avoid repeating already supported research; check genuinely missing facts. |
| A broad comparison could override a narrower population or housing label in a finding. | Include the subject label in scope checks and preserve original source check times. | Conflicting or stale evidence cannot count as complete coverage. |
| Reading a retained report could be introduced as new research. | Tool descriptions and speech/backend policy distinguish local reads; receipts include `searchStarted:false` and actual `reportState`. | Answer from the finished report instead of claiming another check is running. |
| Comparisons sometimes invented differences in what amounts included. | Require source-supported comparison qualifications. | Avoid unsupported explanations such as inferring insurance differences solely from different totals. |

Existing account/session/student boundaries, official-source validation, research limits, intro timing, voice configuration, playback controls, and steady call indicator are preserved. Structured partial findings do not earn verified reuse coverage. The full retained report remains available through the existing detail-read tool.

The new operational deferral reasons distinguish `awaiting_requested_evidence` from `requested_evidence_not_supplied`. They carry no transcript or private subject text. Requested, acknowledged, observed, and playback evidence remain separate.

## Validation

- The new English/Spanish scenario suite covers comparison asides, genuine changed questions, short campus selections, incidental tuition mentions, initial partial results, terminal unresolved results, findings arriving mid-answer, requested versus observed portions, and genuine interruptions.
- The first 20 scenarios reproduced 12 failures on pristine HEAD; all 20 passed after the fixes. Two additional short-selection regressions also pass locally.
- Additional tests cover multi-campus reuse, conflicting populations/housing, original source timestamps, unknown citation mappings, multibyte finding names, bounded packets, and unsupplied evidence.
- Final broad research/control/selection run: **625 passed, zero failed, five database-dependent tests skipped** (630 total). Separate measurement/schema checks: **11 passed**. The final 22-scenario bilingual replay suite is included in the broad count.
- `npm run build -- --configLoader runner`, `npm run check:logging`, and `git diff --check` passed. The build retained existing bundle-size warnings.
- The separate prompt-budget suite still has the same 18 previously established failures and four passes. These failures predate this patch; this work does not rewrite the larger prompt architecture.

These are scripted bilingual replays and local integration tests, including local WebSocket control fixtures. They do not establish actual model phrasing, acoustic warmth, production research latency, or browser playback quality. No new production timing improvement or naturalness percentage is claimed. A real English/Spanish call is still needed to assess speech and confirm that completed outcomes are introduced naturally. An inaccessible official source may still yield an honest unverified result; this change does not fabricate a missing amount.
