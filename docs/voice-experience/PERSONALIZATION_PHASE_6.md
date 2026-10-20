# Personalization Phase 6 — release controls and evaluation

## Production activation — October 19, 2026

The product owner explicitly requested system-wide activation for all authenticated
accounts, rather than the originally proposed synthetic-account cohort. The five
backend personalization settings were saved on the existing Origen API service;
the deployment and final verification are recorded in
[the activation record](PERSONALIZATION_ACTIVATION_2026-10-19.json). The local
`render.yaml` now matches those enabled settings. Coordinator accounts, linking,
feedback and binder sharing remain disabled; unrelated environment settings and
credentials were preserved.

Production preflight verified migrations 044–047, all three history search indexes,
memory-table permissions and active row-level isolation for the restricted runtime
role. The isolated PostgreSQL personalization suite passed 67 tests with zero
failures or skips. The checks did not read conversation content or modify production
user records. No historical-memory backfill was initiated.

This is a configuration activation, not evidence that the live listening, physical
device, quality, cost or latency evaluation below has been completed. Those results
remain unmeasured. Start a new voice call after the deployment to receive the new
context and memory tools. A permanent rollback should set the backend master mode
to `off`, redeploy, and update the Blueprint to match; retain all database tables and
saved records. The operator script is `scripts/activate-personalization-render.mjs`;
its `inspect` and `verify` modes are read-only, while `apply` saves the five settings
and redeploys the exact currently live code revision.

## Original Phase 6 implementation and evaluation record

Status, October 18, 2026: implementation and local verification are complete. Live model/speech evaluation and production rollout remain pending. No paid provider calls or production database writes were made. This phase does not complete the plan's live release criteria by substituting mocked browser events for speech.

## Server controls

All settings below belong to the **API backend**, without a `VITE_` prefix. Request bodies cannot set flags or cohort membership. The cohort uses exact authenticated Auth0 subjects, not email addresses or student IDs.

| Variable | Default | Behavior |
| --- | --- | --- |
| `ORIGEN_PERSONALIZATION_MODE` | `off` | `cohort` enables only subjects in the allowlist; `on` enables all authenticated accounts. Unknown values stay off. |
| `ORIGEN_PERSONALIZATION_SUBJECTS` | empty | Comma-separated internal synthetic account subjects. An empty cohort enables nobody. |
| `ORIGEN_PERSONALIZATION_RETRIEVAL` | enabled within cohort | `false` disables historical search in initial/updated context and the live recall tool. |
| `ORIGEN_PERSONALIZATION_LIVE_WRITES` | enabled within cohort | `false` removes save tools and rejects writes/presentations from existing sessions, including receipt replay. |
| `ORIGEN_PERSONALIZATION_ADAPTIVE` | enabled within cohort | `false` removes adaptive preference/opening instructions. |
| `ORIGEN_PERSONALIZATION_EXTRACTION` | `false` | Requires the exact value `true` and cohort eligibility before optional summary-to-memory model calls. |

The master switch also omits the new student brief. The existing owned profile, binder workspace, and recent summaries remain available. Correction/deletion suppression and scoped revision checks stay active even when personalization is off: removed facts cannot return through fallback summaries. Explicit binder edits, removal, export, and saved actions remain usable.

Live capabilities are checked on every operation and again before write commit. A policy token accompanies confirmed voice context and the existing revision poll. Updated web clients end the stale provider connection when policy changes, discarding its pending summary/recovery. Polling normally occurs every five seconds; a pending save, request deadline, or background-tab throttling can delay client shutdown. Requests arriving at a backend with disabled writes are rejected immediately. Deploy the same settings to every API instance, retire old instances, and explicitly end any older clients that lack policy polling. Disabling a feature cannot retract context already delivered to a provider.

Extraction is request-driven and deduplicated in process; there is no embedding worker or durable embedding backlog. Disabled sync requests return the current binder data without an AI call. An in-flight provider result is discarded after disable, with a second check before proposal commit. Already-started provider work can still incur charges. Existing summaries and pending proposals remain available for explicit later processing; no backfill runs automatically on deployment.

## Adopted evaluation criteria

`evals/personalization.release.v1.mjs` retains the original 20 synthetic memory scenarios and adds eight bilingual cases for failed saves, persisted actions across calls, deferred openings, and spoken corrections. Each arm has 14 English and 14 Spanish cases. The archived Phase 1 selection baseline remains unchanged. The new live baseline is the **same build and inputs with personalization off**; it is not an archived recording of Phase 1.

The new rubric inherits the original guidance rubric's dimensions and thresholds, adding memory relevance, correction handling, unnecessary repeated questions, action persistence, and conversational flow. These are engineering release criteria adopted in this implementation; they are not observed performance or a spending authorization.

| Criterion | Required result |
| --- | --- |
| Mean human score | At least 1.8/2 |
| Critical isolation, attribution, correction, deletion, and false-save cases | Every dimension 2/2; none unrun |
| Unnecessary repeated questions | Zero in the candidate cases; necessary clarification is scored separately |
| First audible response | p95 at most 8,000 ms from end of user speech |
| Added retrieval wall time | p95 at most 1,000 ms, including acquisition/fallback |
| Research calls | At most eight per evaluated connection, retaining the existing evaluation threshold |
| Historical evidence recall | At least 90% in top five; all isolation/deletion boundaries pass |
| Mean cost | At most $0.50 per completed synthetic session, including failed/cancelled attempts and retries |
| Run budget | Explicit dated authorization before the first paid attempt; one shared budget across both arms |
| Evidence | Real WebRTC outputs, human listening review, provider usage and dated pricing, persistence checks, matched model/device/input/build |

The eight-research-call criterion is an evaluation gate; it does not change the existing product research policy. The $0.50 criterion is a target, not an estimate. Current model prices, availability, and actual usage have not been verified. The first matched sample contains **56 scenario runs**. Multi-call cases, reconnections, and retries require additional connections; count actual completed sessions separately. A small approved pilot may leave the full sample incomplete and must report the unrun cases.

## Collect and review live evidence

Generate fresh files without overwriting a prior capture:

```sh
npm run eval:personalization:release -- prepare output/personalization-live-RUN_ID
```

This writes the exact catalog, rubric, source hashes, and empty baseline/candidate capture files. It makes no provider calls. Use synthetic accounts and records in the isolated database, and the existing app voice path. Keep profile/summary fixtures, current user utterances, provider model, device, and test order matched; reset records between arms. Record the same trial-input hash in both responses. Include desktop Chromium, Android Chrome, and iOS Safari listening checks; local Chromium viewport emulation does not verify physical devices. Native mobile remains separate.

Before any paid attempt, enter the user's approved amount, authorization identity, and timestamp in both captures' identical `budget` objects; set `costBudgetUSD` to that same amount. Verify model access and current official pricing. Estimate the next bounded session from its planned duration/token allowance, including research, summary generation, extraction if enabled, and a retry reserve. Do not begin if its conservative allowance exceeds the remaining approved budget. Stop if usage cannot be reconciled. The evaluator is an after-the-run evidence gate, **not a provider spending limiter**; it does not enforce a live hard cap or initiate sessions.

For every attempt, including failures and cancellations, append:

- `id`, `caseId`, `status` (`completed`, `failed`, or `cancelled`), `startedAt`, `transport: "webrtc-live"`, a concrete `device` identifier, and `completedSessions` (an integer count of completed logical calls in the scenario attempt, zero if none). A successful durable-action scenario contains two completed calls. The cost average uses actual completed sessions, not scenario count; retries and failed attempts remain in its numerator.
- `providerCallsComplete: true` only after accounting for every provider operation. Each `meters` entry needs `providerModel`, unique `providerRequestId`, official `pricingURL`, `pricingAsOf`, a flat `usage` object, and corresponding `usdPerMillion` rates. Use disjoint billed categories for input/output text, cached tokens, audio, and tool charges; do not count aggregate and component tokens twice. Fixed per-call charges can use a calls meter and its per-million equivalent. Unknown usage stays missing, never zero.

For a multi-call scenario, preserve the full tool/timing trace and use the largest observed first-audio/retrieval delay and the largest per-connection research count for the case-level gate. Keep provider meters for all calls. For each completed scenario response, append the existing evaluation fields (`id`, actual synthetic `text`, `configurationHash`, actual `providerModel`, `sources`, `toolTrace`, `researchCalls`, `firstAudioMs`, `usage`, `pricingAsOf`, `reviews`) plus:

- `attemptId`, matching `device`, and `trialInputHash` of the fixed scenario/seed/utterances.
- `retrievalMs`, including failures/fallback, and `unnecessaryRepeatedQuestions` classified against supplied context.
- `costUSD`: all metered attempts for that case, including failures before success.
- `listenedToAudio: true` only after a named human listens. Each human review uses `type: "human"`, `evaluatorId`, and all rubric dimensions scored 0–2. Scripted answers and AI-generated ratings do not substitute for listening reviews.
- For durable-action cases, `persistenceEvidence`: `saved`, `duplicateCount`, `secondSessionVerified`, and, when saved, `recordId`, `version`, and `status`. Inspect the database/binder after the second call. A baseline with saving disabled records the observed absence; the candidate must retain exactly one not-started action.

```sh
npm run eval:personalization:release -- review output/personalization-live-RUN_ID/candidate.json
npm run eval:personalization:release -- compare output/personalization-live-RUN_ID/baseline.json output/personalization-live-RUN_ID/candidate.json
```

Missing cases, usage, listening reviews, pre-run budget authorization, or unmatched inputs block the gate. Baseline quality misses are reported, while candidate critical failures block release. Paired cost sums both arms, including failed attempts, and duplicate provider receipts are rejected. Human disagreements require resolution. Even a passing technical report keeps `releaseReady: false`; the existing release process still requires an operator decision and device/operational evidence. Capture metadata and receipts need human verification; self-reported fields cannot prove a real provider call by themselves.

## Deployment and rollback procedure

Use the existing [Render release procedure](../../RENDER_SETUP.md) with a reviewed PR and exact build revision. `render.yaml` now explicitly defaults the backend to personalization off and extraction off; it does not deploy anything from this workspace.

1. Keep the flags off. Back up the existing database and apply immutable migrations 044–047 with the migration-owner role through the existing migration process. Reapply/check runtime grants, run production configuration checks, and verify API readiness. Production schema/version and provider availability must be observed at release time, not inferred from this local rehearsal.
2. Deploy the compatible backend, then the web build. Verify owned binder/profile/summary behavior with two synthetic accounts. Do not enable extraction or a backfill as part of this step.
3. Set backend mode to `cohort` and explicitly allowlist only the internal synthetic accounts. Retrieval, live writes, and adaptive instructions can be independently disabled. Keep extraction off for the first pilot unless its measured cost is included in the approved budget. Confirm an unlisted account receives fallback context and no live memory tools.
4. Run the matched live sample and physical-device checks, inspect source attribution and false-save behavior, and retain named review and cost/latency evidence. Run the rollback below. Record the deployed revision, migrations, cohort configuration, evidence paths, reviewer, and decision in the release record. Expansion to real accounts is a later explicit configuration change after these gates pass.
5. Roll back by setting mode to `off` (or independently disabling retrieval/writes), applying the setting across all instances, and ending existing calls. Verify updated clients close through policy polling, new calls use fallback, tool requests fail, and binder data remains accessible. Do not drop tables, clear saved records, run a reverse migration, or reinterpret deferred actions as complete.

The real PostgreSQL rehearsal starts at migration 043, exercises new-code fallback before migration, applies 044–047 twice, verifies a frozen pre-personalization plan implementation can still load/update old-format plans, and exercises new application/deferred actions. The old validator rejects editing these new enum values. **Keep the current compatible backend during feature rollback**; a blanket binary rollback to the older plan implementation is not supported once these values exist. No extra paid database is needed for this rehearsal.

## Local evidence and remaining work

The full isolated server run passed 596 tests with zero failures/skips. Subsequent focused checks cover the final evidence-gate refinements and fallback suppression assertion. The live-memory browser suite passed six journeys at widths 1280, 390, and 320 in English/Spanish, including active-call policy disable and preservation of stored records. The full browser regression set passed 43 scenarios (six live-memory, six adaptive, six binder-memory, and 25 reliability scenarios). The final focused run passed 15 tests, including the refined evaluation gates, fallback suppression, and operational readiness. Results and source hashes are recorded in [the offline evidence](../../evals/personalization.phase6.offline.json).

The held-out keyword suite found the expected evidence in 24/24 answerable cases (12 per language); all four no-match cases and all boundaries passed. Local retrieval p50 was 3.46 ms and p95 4.40 ms. The matched original source-selection comparison improved from 14/16 to 16/16 answerable cases with 20/20 boundary checks. These timings measure local synthetic PostgreSQL, not speech or production latency. Embedding calls remain zero because vector retrieval has not been implemented.

Build, logging checks, existing prompt contracts, and release/readiness checks passed. The existing large-bundle warning remains. An initial server run exposed an extra response field on the legacy preview contract; that was corrected before the passing full run. That initial run also hit a temporary database connection termination in the support fixture; the full run passed when database suites ran without competing jobs. Updated browser fixtures explicitly share the same server policy as their voice handler.

The generated live report is deliberately blocked: **0/56 live responses reviewed**, no observed live latency/cost, no authorized run budget yet, no physical Safari/Android listening evidence, and no production deployment. The current environment has an OpenAI variable present, but its network policy lacks `api.openai.com`; credential/provider readiness remains unverified. A network-only environment draft adding that domain was saved. Review and save it in environment settings, then publish the environment before rechecking access. No secrets or database settings were changed.

Phase 6 remains open for the approved paid pilot, full matched live evaluation, physical-device listening, and the concrete production release decision. Passing automated checks is evidence for the tested contracts, not a guarantee of model behavior.
