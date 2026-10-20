# Personalization phase 1: reliable voice and baseline

Implemented locally October 18, 2026. This phase fixes three reproduced voice failures and establishes a repeatable synthetic memory baseline. Production deployment and actual model/speech evaluation are separate from this source implementation.

## Reproductions and resulting behavior

| Failure before the change | Reproduction | Behavior after the change |
| --- | --- | --- |
| Diagnostics interrupted otherwise healthy calls | A real local gateway accepted 119 diagnostic events after one eligibility check, then rejected the next eligibility check with HTTP 429. A synthetic browser call reproduced interruption after 12 short turns: 113 diagnostics among 125 requests. | Diagnostics have their own account budget of 240 requests/minute; application requests retain 120/minute. Both limits apply before database work, including query-string variants. Diagnostic saturation cannot spend permission/save/research requests. |
| Autoplay recovery had no usable control | The app displayed “Tap Play,” but the shared voice bar hid its audio element and had no visible Play button. Expanding the bar did not expose it. | A visible “Play Origen audio” button works in compact and expanded layouts, supports keyboard activation, restores audible volume, and remains available after a failed retry. |
| A stalled lookup blocked further replies | After 90 simulated seconds and a new spoken question, no ordinary response was requested while the original research call remained pending. | Each lookup has a 45-second deadline covering token acquisition, fetch, and body parsing. Cancel search or an explicit spoken search-stop command cancels the previous search. Ordinary replies, clarification, language changes and empty/noisy transcripts leave it running. After completion, the latest question takes priority over the original request. |

Research cancellation invalidates queued lookups from the same old tool response. Every cancelled tool receives an outcome, and the reply gate releases once the new transcript/language update is ready. Late results cannot populate sources or cache entries. A token resolving after cancellation cannot start a late fetch. Ending the call also cancels pending research.

Progress audio has its own request identity. On research completion, timeout, or cancellation, unfinished progress audio is retired so it cannot block the next reply. Delayed progress events are ignored or cancelled without finishing a newer progress request. Existing server permission leases already propagate HTTP disconnection to provider requests; cancellation does not establish that a provider incurred no cost before stopping.

The 45-second deadline is an initial bounded recovery policy. Its suitability for actual provider latency must be measured during live evaluation. New speech supersedes the outstanding lookup, including additional context; the guide can issue a new lookup for the updated question.

## Synthetic personalization baseline

- Catalog: [`evals/personalization.cases.v1.mjs`](../../evals/personalization.cases.v1.mjs), with 20 invented cases, ten per language.
- Saved evidence: [`evals/personalization.baseline.v1.json`](../../evals/personalization.baseline.v1.json).
- Evaluator: [`server/personalization-evaluation.mjs`](../../server/personalization-evaluation.mjs), using the actual history repository, memory selector, and session prompt builder with isolated pg-mem fixtures.
- CLI: `npm run eval:personalization -- --output /tmp/personalization-candidate.json`. The default output is `output/personalization-evaluation.json`; it does not overwrite the versioned baseline. Compare matching case/catalog versions and preserve the original report.

Cases cover recent and older constraints, cross-topic recall, corrections, parent attribution, deletion, account/student/family boundaries, missing context, failed research, and cross-language continuity. Each records the supporting memories and expected behavior for a later live response review.

Required evidence was retrieved in **14 of 16 cases requiring a particular source**. The two misses are the English and Spanish versions of a relevant memory older than the latest 24 summaries. All 20 cases passed the tested scope/deletion boundaries. The saved baseline reproduced exactly on a second run.

This is summary-selection evidence. The evaluator does not exercise the full workspace/profile context pipeline, send questions to a model, or grade actual answers. Response quality, unnecessary repeat questions, first-audio delay, retrieval latency on production-scale storage, and provider cost are explicitly unmeasured. The runner exits nonzero for boundary failures while retaining known retrieval gaps in its report. A successful command is not a claim that all personalization expectations pass.

## Verification and reproduction

Use the isolated cloud test wrapper so production URLs, application credentials, and deployment flags cannot reach tests:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs npm test
npm run build
node /workspace/.local-postgres/bin/run-tests.cjs npm run eval:contracts
node /workspace/.local-postgres/bin/run-tests.cjs npm run eval:personalization -- --output /tmp/personalization-candidate.json
```

The wrapper and local PostgreSQL cluster were prepared during environment onboarding; their paths are specific to this cloud workspace. The browser checks require the local Vite development server. Both smoke scripts use synthetic authentication/API responses and mocked media/WebRTC. The voice reliability script additionally forwards diagnostic and eligibility requests to a real loopback API gateway backed by isolated fixtures.

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/voice-reliability-smoke.cjs
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/onboarding-recovery-smoke.cjs
```

Validation status:

- Full server suite: **541 passed, zero failed/skipped**.
- TypeScript/Vite production build: **passed**; existing bundle-size warnings remain.
- Existing offline model contracts: **20 passed**.
- Personalization baseline: **20 cases captured**, exact reproduction verified; two documented older-memory retrieval gaps.
- Voice browser checks: **25 passed**: six scenarios in each desktop/mobile and English/Spanish combination, plus an actual `apiFetch` authentication deadline/late-token check.
- Onboarding recovery browser checks: **6 passed**, covering draft recovery, save deadlines/retries, and a final spoken correction saved without reconnecting.
- Additional small-screen check: both recovery controls fit and remain actionable together at **320 × 568px in Spanish**; screenshot visually reviewed.
- Targeted research regression tests after the timeout-reason adjustment: **11 passed**. Queued tools preserve the timeout reason rather than describing an expiry as a user cancellation.

Regression coverage includes separate bounded account budgets; stalled authentication/fetch/body; explicit and spoken cancellation; ignored noise; obsolete results; queued searches; call termination; progress audio delayed before creation or after generation; and one follow-up response after tool completion. Browser checks cover 1280px and 390px layouts in both languages, including keyboard audio recovery and 28-turn calls with actual gateway permission polling.

No paid AI calls or production database changes are needed for these checks. Actual microphone/audio quality, Safari/iOS behavior, real-device timing, and current official-source answer quality remain for live evaluation. Phase 2 can build student memory and correction controls on this tested foundation; broader semantic retrieval remains Phase 3.
