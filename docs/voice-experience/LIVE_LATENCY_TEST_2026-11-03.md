# Live latency validation — November 3, 2026

## Scope and budget

Two actual GPT-Live-1 browser/WebRTC calls exercised the current development code in English and Spanish. They used fictional parent and student records in an isolated PostgreSQL schema, with synthetic spoken input. No production records were modified. The two earlier user sessions were inspected read-only for comparison.

- Approved campaign cap: **$2.00**.
- Conservative reservations across all attempts: **$1.70**.
- Reported Live and delegated-backend usage estimate: **$0.121855**.
- Six generated TTS clips, 297 characters: approximately **$0.004455**.
- Total estimated API cost: **$0.126310**, approximately **$0.13**. This is a list-rate estimate, not a billing invoice.
- Both calls returned final usage. No additional paid attempts were made. An initial fixture-validation failure occurred before any paid requests.

Each call had duration, backend-response, output-token and tool-payload limits. The fixture HTTP server/browser were closed and its database was stopped after testing. The user's ordinary local app was left running.

## Findings

| Check | Earlier diagnostics | English test | Spanish test |
| --- | --- | --- | --- |
| Student selection | First session repeatedly asked for the name after six 10-second request cancellations | Aiden selected; no repeated-name loop | Aiden selected; no repeated-name loop |
| Initial context request, including provider negotiation | Second session: 19.53 s | 1.22 s | 0.39 s |
| Selected-student context HTTP request | Second session: 16.96 s | 0.54 s | 0.31 s |
| Complete selected-student guide update | Second session: approximately 22.94 s | 2.95 s | 3.33 s |
| Phase 4 policy | Absent in first session; active in second | `bounded-follow-up-v1` observed | `bounded-follow-up-v1` observed |
| Simplification follow-up | Earlier slow recap also triggered a specialist/context reload | No delegated backend call | No delegated backend call |
| History correctness | Earlier session eventually recalled history | Correct fictional campus/major; preserved uncertainty | Correct fictional campus/major/current college; preserved uncertainty and attribution |

These are **not controlled before/after speedup measurements**. The new calls used a local synthetic database; earlier calls reached production data over the workstation's database connection. The selected-student updates performed fresh context reads, so these results do not establish successful reuse of the selected-student preparation handle.

## Useful answers, not acknowledgments

The English recap began approximately **0.70 seconds** after the final input transcript chunk. It said UC Santa Cruz and environmental studies were under consideration, not a confirmed decision.

The Spanish call first acknowledged the request, then began its substantive recap approximately **6.96 seconds** after the final input transcript chunk. It correctly recalled Sierra College, environmental studies and UC Santa Cruz as an option, while distinguishing unconfirmed counselor/transfer completion from established facts. Its history tool returned the intended fictional summary.

These delays use input/output transcript timestamps as a proxy; they are not precise microphone-to-speaker audio latency. Generated audio was received and recorded in both calls. Automated `answered_candidate` timing can count an acknowledgment; the comparison above uses manually checked transcript content instead.

## Remaining limitations

- Spanish history recall still has a noticeable wait before the useful answer. The two calls do not demonstrate consistently fast history recall.
- Reproduce the selected-student preparation miss and measure the same production-backed path before claiming the original 17-second database delay is resolved.
- One Spanish name turn contained additional spurious input-transcript words despite the synthetic clip containing only the name. Selection still succeeded; this warrants a separate reproducibility check.
- The harness deliberately closed provider sessions after the completed steps. This produced final `connection_lost` diagnostics; those terminal events are induced by the harness and are not evidence of a mid-conversation failure.
- This campaign did not test profile saving, binder-note writes, onboarding or production deployment, and does not certify those workflows.

## Evidence

- Earlier failed-selection session: `3308d6a5-78df-44e5-8722-e1a25251662c`.
- Earlier slow-selection/recap session: `3ecae382-4cb1-42f5-9764-8f1eae22a33c`.
- English synthetic diagnostic session: `6c56ae8e-7e26-45ad-a3e4-c311bea74f5c`.
- Spanish synthetic diagnostic session: `9535fd7a-181e-4251-a4bc-03f9e34fe784`.
- Local test artifacts: `tmp/latency-live-cap2/summary.json`, `report.json`, `budget.json`, `en-output.webm`, and `es-output.webm`. These contain fictional test material; the harness and artifacts remain local.

No commit, push or deployment was performed.
