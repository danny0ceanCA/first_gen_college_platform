# Phase 4: model evaluation and bounded research

Implemented in source October 6, 2026. No deployment, paid model requests, production conversation export, research enrollment or new database migration was performed. Human/model release validation is still pending.

## Versioned evaluation kit

- `evals/cases.v1.json`: 20 explicitly synthetic cases, ten in each language. Covers first-use orientation, simple explanations, language changes, English key terms, specialty continuity, ambiguous/student-changing scope, corrections to summaries, failed tools and changing policies. Each supplies the human-reviewed expectation and critical-case designation.
- `evals/rubric.v1.json`: correctness, source relevance, effective period, privacy, attribution, continuity, plain language and language consistency. Ratings are 0/1/2. Version the instrument when expectations or thresholds change; do not silently change a deployed evaluation's meaning.
- `evals/capture.template.v1.json`: empty, correctly versioned capture template for all twenty cases. It contains no invented model answers, ratings, timing or costs. Fill a copy from synthetic testing.
- `server/model-evaluation.mjs`: offline contracts against actual session/research configuration and client helpers; human-response review validation; comparable baseline/candidate reports.
- `evals/baseline.contracts.v1.json`: initial framework baseline with configuration/case/rubric hashes, case results and evaluator identity. It is **not a pre-change model-response benchmark**. Actual model responses evaluated: zero. Latency/cost: unknown. This baseline supports future configuration comparisons, not claims that this change improved learning or speech quality.

Commands from the repository root:

```powershell
npm run eval:contracts
node server/model-evaluation.mjs contracts > evals/candidate.contracts.json
npm run eval:compare -- evals/baseline.contracts.v1.json evals/candidate.contracts.json
npm run eval:review -- path/to/synthetic-capture.json
```

Contract failures and failed human technical gates exit nonzero. Compare requires the same evaluation kind, catalog/rubric hashes, sample size and evaluated case IDs. Store immutable release artifacts with the tested application/configuration revision. The runner uses no model API and cannot generate speech captures itself.

## Human capture and proposed gate

Use the case prompts in a **synthetic** voice session, recording the tested resolved model/configuration hash. Never substitute a real family's production conversation or summary. Source pages are untrusted evidence, not instructions; reviewers must open the actual supporting official page and check applicant type, campus, period and conditions. No real student data is required for any case.

A capture is a JSON object containing:

- `synthetic: true`, `catalogHash`, `rubricHash`, and an explicit `costBudgetUSD` for that run.
- `responses`: one record per case with `id`, actual `text`, `configurationHash`, `providerModel`, measured `firstAudioMs` (user speech end to first audible reply), `researchCalls`, `sources` and `toolTrace` arrays, actual provider `usage`, calculated `costUSD`, and dated `pricingAsOf`. Preserve source URLs/check dates/effective periods and tool inputs/outputs in the synthetic capture; distinguish unknown policy dates from retrieval dates. Review the capture before committing it; no credentials belong in artifacts.
- Each response's `reviews`: named `evaluatorId`, `type: "human"`, a 0/1/2 score for **every** rubric dimension, and optional explanatory notes. Automatic software checks cannot substitute for a human response review. Retain disagreements; don't silently average them away. Resolve them through documented human review and keep the original artifact.

Proposed rubric gates: mean at least 1.8/2; all critical-case dimensions meet 2/2; privacy and attribution meet 2/2 for every case; any zero fails. Proposed p95 first-audio latency is at most 8 seconds and paid research attempts at most eight per physical voice connection. The explicit run cost budget must be met. These values are proposals, not evidence a release owner adopted them. Reviewers should assess pauses/tool progress, pronunciation, uninterrupted language and real device behavior separately from text correctness.

Missing cases, reviews, timing, usage/pricing, source/tool evidence, research-call counts or budget block the technical gate. Disagreements block it too. `releaseReady` always stays false: a named release owner must independently adopt thresholds, review source evidence and costs, resolve failures/disagreements, verify device behavior, and approve the release. Submitted ratings/pricing are not independently verified provider receipts. Neither favorable scores nor service use prove academic learning or admission outcomes.

## Research improvements implemented

The existing per-connection cache continues to require cited results, isolate language/mode/institution/question, expire after five minutes and retain at most twelve entries. This is a brief reuse window within a conversation, not a long-lived official-policy database. Academic years and applicant context in different questions never merge. Cache hits are not proof that each factual claim is supported; the response evaluation must check that.

Research tools now accept optional `forceRefresh`. Explicit English/Spanish fresh-check requests also bypass the cache on the client. A forced check **invalidates** the prior cached entry before requesting research; if the new lookup fails, old cached evidence cannot silently reappear as the new check. The model still needs to identify the exact requested cycle and acknowledge unavailable evidence.

Paid upstream attempts are limited to eight per physical connection and two per identical normalized query, including failed attempts. Cache hits consume no additional attempt. On exhaustion, the person can keep talking: the tool reports the limit, directs the model not to retry or invent facts, and offers already applicable evidence or an official source/counselor. These client limits reduce accidental loops; they are not an account billing cap or server abuse control. Student-scope reconnections start a new physical connection and budget. Existing server rate limits and output-token limits remain independent.

No actual dollar saving or faster response is claimed. Measure cache hits, paid calls, usage and first-audio timing in matched synthetic baseline/candidate runs before making such claims. For future shared source caching, require scope/year keys, source-specific expiry, invalidation and evidence review; it is not introduced here.

## Validation and remaining work

Automated tests cover the bilingual case matrix, missing/duplicate/mismatched captures, human disagreements, critical failures, latency/cost overruns, incomparable baselines, fresh-check invalidation and lookup budgets. Existing voice tests continue to cover real client state transitions and account boundaries. Production build validation checks the integration.

The phase 4 framework and bounded-research changes are implemented. The **release acceptance gate is not yet complete**: actual synthetic model/speech captures, named human reviews, live official-source verification, measured provider costs and mobile-device timing are required. This task does not claim those observations occurred, or that production data may be used for research/model training. Phase 5 permissions remain separate.
