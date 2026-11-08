# Controlled support delivery validation

Run: November 7, 2026, 8:32 PM Pacific (November 8, 04:32 UTC).

All six fictional cases passed through the real local session wrapper, worker thread, Decisions API, completed-observation message, generation gate, and fixed quiet-note sender. This test made **12 Decisions requests**, **zero voice calls**, and **zero research calls**. Accounted Decisions cost was **$0.0040618**, charged to the existing $1.50 support Decisions allocation.

| Language | Explicit request | Decisions classification | Request-to-note send | Correct fixed quiet note |
| --- | --- | ---: | ---: | --- |
| English | Help finding a starting point | 162 ms | 171 ms | Yes |
| English | A simpler explanation | 200 ms | 210 ms | Yes |
| English | One manageable next step | 374 ms | 381 ms | Yes |
| Spanish | Help finding a starting point | 157 ms | 164 ms | Yes |
| Spanish | A simpler explanation | 206 ms | 213 ms | Yes |
| Spanish | One manageable next step | 144 ms | 152 ms | Yes |

The six preceding intro-only observations selected `none`. After each explicit request, the matching support classification passed the existing probability, confidence, addressed-state, student, question, generation, freshness, and idle checks. The outbound message was exactly the relevant English or Spanish fixed template in `session.thinking.append`, with `delegation_id: null`. No generated classifier wording, research predicates, student records, or raw transcript text were forwarded as the support note.

The test then supplied a **simulated provider acknowledgment** and verified a separate `support_context_acknowledged` diagnostic with `playbackClaim: false`. It did not treat the acknowledgment as proof the caller heard anything.

## What this does and does not prove

This is a **controlled transcript replay**, not a natural voice conversation. It uses real classification and the actual worker-to-gate pipeline, but a fake voice provider, simulated transcript intervals, simulated browser-idle heartbeats, and simulated context acknowledgments. The harness deliberately withholds assistant replies until classification finishes. Its request-to-note times therefore show that the eligible pipeline works under controlled conditions; they do not establish how frequently a real voice response leaves that opportunity, whether an append reaches the live model before speech, or whether the conversation feels better.

The gate's separate offline tests cover stale results, overlap, speech already starting, research or delegation activity, student changes, intro selection receipts, duplicate cues, rate limits, and missing acknowledgments. Human microphone testing is still needed to judge warmth, pacing, usefulness, and any audible effect. Research remains observe-only in this integration.

## Reproduce and inspect

- Script: [validate-support.mjs](validate-support.mjs). Without arguments it prints its bounded preflight; `--execute` makes paid Decisions requests and requires remaining authorization and ledger capacity.
- Local detailed report: `research/decisions/.local/support-controlled-validation.json`.
- Local evidence logs: `research/decisions/.local/support-replay-*.jsonl`, keyed by the call IDs in the detailed report.
- Durable budget ledger: `research/decisions/.local/approved-support-decisions-budget.sqlite`.

No production data, live voice sessions, commits, pushes, or deployments were involved.
