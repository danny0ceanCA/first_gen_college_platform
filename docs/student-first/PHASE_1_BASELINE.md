# Student-first Phase 1 baseline

Date: 2026-10-21. Repository: `C:\Users\danie\Documents\ChatGPT\Project Elo-Em`.
Baseline commit: `d0fe03e80b6b106d4ff57f9ec005efc122ede891` (Retry selected account removal commands after aborted transactions).

Purpose: make subsequent implementation incremental and reviewable. Phase 1 establishes evidence; it does not implement the new organization experience. The [numbered plan](IMPLEMENTATION_PLAN.md) distinguishes this sequence from earlier projects with similarly numbered phases.

## Latest commit and repository state

The initial worktree was clean. No applicable AGENTS.md was found in the inspected ancestor/root and relevant source, server, documentation, scripts, evaluation and operations directories. Application source remains at the baseline commit. Phase 1 changes are documentation/evidence and two existing browser-test helpers: `scripts/student-memory-smoke.cjs` now supplies explicit empty coordinator API responses, and `scripts/live-memory-smoke.cjs` waits for active routes before disposing its browser request context.

The latest commit hardens selected coordinator removal operations. `server/aborted-command-retry.mjs` bounds retries for PostgreSQL deadlock/serialization aborts; `server/account-isolation.mjs` exposes retry on the transaction-owning facade. `server/binder-sharing.mjs` and `server/coordinator-access.mjs` opt in selected removal commands. `server/migrations/061_coordinator_removal_locking.sql` changes account row locks to NO KEY UPDATE and aligns publication lock ordering. This is a reliability fix, not implementation of the new student-first phases. Preserve it.

The main stack is React/TypeScript/Vite, Node server modules, PostgreSQL and Auth0. Existing Expo/mobile code is outside this Phase 1 verification. Older README and historical completion records are not current deployment evidence.

## What exists, and what it does not establish

Paths below are relative to the repository root. “Implemented” means inspectable code, not proof of a feature enabled in production.

| Capability | Existing implementation and evidence | Remaining work or limitation |
| --- | --- | --- |
| Conversation summaries | `src/ProfileVoice.tsx`, `src/summarySaveQueue.mjs`, `server/conversation-summary.mjs`, `server/summary-style.mjs`, `server/summary-quality.mjs`: authenticated, scoped, idempotent summary persistence; bounded inputs; narrative instructions preserve uncertainty/corrections. | A narrative is not a unified structured binder contract. Quality review metadata does not automatically repair unsupported content. |
| Topic organization | `server/topic-notes.mjs`, `src/TopicNotebook.tsx`, `src/binderKeyPoints.mjs`: suggested note/explanation/question items from saved summaries, source quote checks, generation receipts, manual editing and existing topic sections. | Notes and student memory are separate extraction paths. Exact normalized deduplication does not reconcile semantic conflicts. Phase 2 needs shared organization rules, not a replacement notebook. |
| Student memory | `server/student-memory.mjs`, `src/StudentMemory.tsx`, migration 044: proposed goals/constraints/preferences/questions, explicit confirmation, versions and source suppression on corrections/removal. | Proposed content is not automatically a confirmed fact or decision. Natural conversation classification and conflict handling need extension. |
| Live recall and writes | `server/live-memory.mjs`, `server/live-memory-tools.mjs`, `server/live-memory-intent.mjs`, `src/voiceMemoryTools.mjs`, migration 046: scoped recall, explicit save requests, receipt-based duplicate handling, correction/version checks and context refresh. | Existing English/Spanish write intent is narrow. A browser transcript hash is not independent audio attestation. Broad natural-language corrections need careful grounding. |
| Continuity | `server/voice-workspace.mjs`, `server/history-retrieval.mjs`, `src/memoryContext.mjs`, migration 045: bounded scoped context, bilingual keyword retrieval, deleted-source filtering. | Retrieval selects evidence; it does not prove response correctness. No unified open-question resolution state or complete policy-validity model. |
| Adaptive guidance | `server/adaptive-guidance.mjs`, migration 047: confirmed preferences, bounded optional return opening, deferral and current-question precedence. | Not yet a systematic context-gap/question-selection policy for the new workflow. |
| Background binder work | `server/binder-jobs.mjs`, `server/voice-preparation.mjs`, migrations 048–049: prepared context and durable jobs after summary persistence, bounded retries, permission/lease fencing and explicit retry support. | Present in code; `render.yaml` defaults both features off. Durability begins after summary commit, not at every spoken turn. |
| Interruptions and recovery | `src/summarySaveQueue.mjs`, `src/browserPrivacy.mjs`, `src/ProfileVoice.tsx`: in-memory pending work, cancellation and privacy lifecycle. | Closing before a summary is acknowledged can lose pending work. Do not promise recoverable raw transcripts; current code intentionally purges persistent transcript recovery. |
| Action plans | `server/plans.mjs`, `src/ActionPlan.tsx`: versioned steps, student-reported progress, existing accepted-guidance path. | Do not infer commitments or completion from discussion. Reuse existing plans in later phases. |
| Official-source guidance | `server/finance-research.mjs`, `server/admissions-research.mjs`, `server/research-quality.mjs`, `server/guidance-history.mjs`. | Source eligibility and freshness need attention: the finance source parser does not currently include CSAC among the accepted official patterns; guidance effective period is not a complete validity model. No live-source or real-provider evaluation in Phase 1. |
| Coordinator sharing | `server/binder-sharing.mjs`, `server/binder-sharing-policy.mjs`, `src/BinderSharing.tsx`, migrations 050–060: connection/grant checks, short-lived previews, explicit snapshots, revocation, attributed guidance and student-controlled eligibility. | Existing publication eligibility centers on manual notes; family-derived material is excluded. Editing a generated note does not automatically make it eligible. Phase 7 must explicitly design safe derived-item sharing. |
| Coordinator operations | `src/CoordinatorBinders.tsx`, `server/coordinator-access.mjs`, `server/institutions.mjs`, notification modules: verified staff access, MFA-dependent operations, onboarding, guidance and in-app follow-up. | There is an existing intermittent high-concurrency organization-review failure; see issue register below. A paid coordinator business model remains unvalidated. |

## Configuration versus production observation

`render.yaml` enables the six coordinator feature switches, personalization mode `on`, retrieval, live writes, adaptive guidance and extraction. It sets `ORIGEN_BINDER_JOBS=false` and `ORIGEN_VOICE_PREPARATION=false`. These are repository defaults; actual current environment values were not retrieved. Historical activation records in `docs/voice-experience/` are historical evidence only.

Read-only Render inspection used the user-confirmed **My Workspace** (`tea-ctn17nbv2p9s73ffqo5g`):

- API `Origen Edu`, service `srv-db02or0u01pc738ktekg`: latest deploy `dep-dbcfkl6q1p3s73avfpc0`, status `live`, commit `d0fe03e80b6b106d4ff57f9ec005efc122ede891`, finished 2026-10-21 17:46:43Z.
- Frontend `first_gen_college_platform`, service `srv-db02o8ou01pc738krjb0`: latest deploy `dep-dbcfkl6q1p3s73avfpug`, status `live`, same commit, finished 17:46:30Z.
- Database `Origen_Edu_Database`, `dpg-db0806hsrm7s73efcupg-a`: available, PostgreSQL 18. A read-only `origen_schema_migrations` query returned migrations 044–060 and **no 061**. This establishes a ledger mismatch with the local repository. It does not prove the runtime executes the new lock behavior or identify why the ledger differs. Do not assume a “live” deployment implies every migration ran.

Only service/deployment/schema metadata was inspected. No student rows, private production logs or environment secrets were read; no production changes were made. Reconcile migration 061 through the established release procedure before claiming that the complete concurrency fix is active. This does not prevent Phase 2 local implementation.

## Fresh local verification

Evidence directory: [`output/student-first-phase1-2026-10-21`](../../output/student-first-phase1-2026-10-21/).
Runtime: Node v24.15.0; fresh local PostgreSQL 18.4 cluster listening only on `127.0.0.1:55487`, synthetic accounts, restricted application roles where supported by the fixtures. Render configuration specifies Node 22, so this is not exact production-runtime parity.

| Check | Result | Evidence |
| --- | --- | --- |
| Full server tests on disposable PostgreSQL | **751 passed, zero failed/skipped/cancelled** | `server.log`, `verification.json` |
| Operations/observability tests | **35 passed, zero failed/skipped/cancelled** | `operations.log`, `verification.json` |
| Logging policy | Passed | `logging.log` |
| TypeScript project build check | Passed | `typecheck.log` |
| Vite production build | Initial sandbox attempt failed to resolve config because parent-directory access was denied; identical build rerun outside the sandbox passed. Existing large-chunk warning remains. | `build.log`, `build-retry.log` |
| Software/model contracts | **20/20 passed**; model behavior is not measured by this check. | `model-contracts.json` |
| Historical retrieval | 28 cases; expected evidence in top five for 23/24 answerable cases: English 12/12, Spanish 11/12. All four no-relevant-source cases and all isolation boundaries passed. Matched older continuity catalog: 16/16 required sources reached the prompt (historical baseline 14/16). | `history-retrieval.json` |
| Infrastructure browser journeys | **6/6 passed**: English/Spanish at widths 1280, 390 and 320; prepared context, reconnect during pending save, background retry while the page is closed, and exactly one saved binder point after reopening. | `browser-infrastructure-final.log` |
| Live-memory browser journeys | **6/6 passed** at the same languages/widths: recall, failed save, duplicate delivery, corrections/context refresh, accepted next step, spoken confirmation, interruption, late-result suppression, remote deletion and active-call policy rollback. | `browser-live-memory-verified.log` |

The original `verification.json` retains `passed:false` and `build:false` because it describes the first run. Do not rewrite it to hide the environmental failure. `build-retry.log` is the separate successful rerun. Retrieval p95 was 22.22 ms for sequential local synthetic queries, not a production latency target. The retrieval script's embedded limitation text says PostgreSQL 17; the actual executable used here was 18.4.

Browser verification results and final disposition are recorded in the accompanying evidence summary. The browser is a separate headless local Chrome instance, using synthetic authentication, microphone/WebRTC and provider responses. These tests do not verify real sign-in, real speech quality or live paid model calls. Initial browser attempts exposed stale generic responses for coordinator notifications and guidance, causing the synthetic UI to crash, and then a route-disposal race after a completed live-memory journey. The helper fixes preserve the behavioral assertions; they do not suppress application errors or alter application code. Initial failing logs are retained. The broader source fingerprint includes test scripts and therefore changes with these helper fixes; the original full-suite report remains evidence for the baseline source, not a newly signed-off production release.

## Issue register and phase gates

| ID | Evidence and implication | Required disposition |
| --- | --- | --- |
| P1-SCHEMA-061 | Fresh production migration query has no 061, although both services report the new commit live. | Release follow-up before relying on complete coordinator concurrency fix; no production migration in this phase. |
| REVIEW-BURST-001 | Historical `output/coordinator-comprehensive-2026-10-21/summary.json`: 150 concurrent organization-review requests produced 36 and 30 unexpected 503s in two runs with a five-connection pool; bounded concurrency passed and subsequent burst runs passed. Pool pressure is a hypothesis, not proven root cause. | Preserve as unresolved. Investigate query/transaction pressure and bound pilot workload before coordinator rollout. Do not rerun 29,198 requests just to establish this baseline. |
| P1-RETRIEVAL-ES | `es-renta`, one of twelve answerable Spanish cases, missed top-five evidence in the fresh run. | Retain this exact case as a Phase 5 regression; passing aggregate target does not erase this miss. |
| P1-DURABILITY | Pre-summary-acknowledgement work is in browser memory; durable jobs are later in the flow and off in repository deployment defaults. | Phase 6 recovery work; accurately describe save status in all earlier phases. |
| P1-LIVE-EVIDENCE | Actual environment flags, provider speech quality, real sign-in, cost and production latency remain unverified. | Phase 9 evaluation and Phase 10 readiness; do not describe local synthetic tests as production acceptance. |

## Reproduction

Use a fresh disposable local PostgreSQL cluster, not the application database. Set `DATABASE_TEST_URL` to its loopback URL. The verification harness additionally wires its other test-database variables to that same URL and refuses non-loopback targets:

```powershell
node scripts/verify-coordinator-release.mjs --disposable-database --output output/<new-evidence-directory>
node server/model-evaluation.mjs contracts
node scripts/evaluate-history-retrieval.mjs --output output/<new-evidence-directory>/history-retrieval.json
```

The browser preview used an ignored temporary Vite config with `envDir:false`, synthetic Auth0 identifiers, an empty API URL and no API proxy/middleware. Browser scripts intercept application/provider endpoints or route them to their synthetic local API. Use the installed Playwright module via `ORIGEN_BROWSER_MODULE_ROOT`, the installed Chrome via `ORIGEN_BROWSER_EXECUTABLE`, and the loopback preview via `ORIGEN_PREVIEW_URL`. Never run these fixtures against production.

The temporary database, preview and browser processes belong only to this verification task. Stop them at completion. No commit, push, production migration, deployment or settings changes are part of Phase 1.

## Completion decision

Phase 1 baseline work is complete. All selected local checks passed after the documented build-environment retry and browser-helper repairs; remaining issues are explicit above. Phase 2 can proceed locally from this recorded state. This is not production release certification and does not establish that the proposed student experience has already been implemented.
