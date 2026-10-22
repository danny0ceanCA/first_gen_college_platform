# Phase 9: validate the whole student-first experience

Local validation work, 2026-10-21. Baseline commit remains `d0fe03e80b6b106d4ff57f9ec005efc122ede891`; earlier phase changes remain uncommitted. No commit, push, production migration, deployment, external account creation or production setting change is part of this work. New student-first features remain disabled in the repository deployment defaults.

**The release gate remains open for complete live speech scenarios, audible latency and Daniel's English/Spanish recording review.** Actual paid text-to-audio probes are captured, with real usage and tool traces, under his aggregate $5 authorization. They do not test microphone recognition or every interactive scenario setup. Deterministic software checks and expected-behavior examples are not model-response evaluations. Current local counts, source fingerprint and evidence hashes are recorded in `output/student-first-phase9-2026-10-21/summary.json`. Preserve unsuccessful attempts alongside the final evidence.

## One continuous acceptance journey

`server/student-first-journey.test.mjs` connects the existing services under restricted PostgreSQL application and maintenance roles. Both English and Spanish cases:

1. Save and organize a conversation with a tentative nursing interest and an evening-work constraint. Reprocessing calls no second extraction and creates no action plan or sharing grant.
2. Ask the relevant optional work-days question, record its presentation/answer, correct the constraint to Tuesdays and Thursdays, and retry the correction without another write.
3. Negotiate a return conversation using the actual server context assembler. It includes the current correction and held-question state, excludes the old constraint and another student's sentinel, and carries continuity instructions.
4. Acknowledge a new cost-conversation checkpoint, finalize it, and recover its summary through the actual recovery processor with no open browser. A repeated finalize finds the completed result and raw checkpoint text is removed.
5. Organize that recovered cost question, explicitly preview/publish that single eligible entry, and compare the exact preview to coordinator-visible text. The corrected source is not silently recertified as shareable. Another coordinator cannot read it.
6. Request help, check generic notification shape, add attributed coordinator guidance attached to the derived entry, and save the student's edited action once despite a retry. No private action detail or acceptance-as-reply is returned to staff.
7. Send a separate student reply, revoke access, reject the old coordinator read, suppress now-invalid notices, and fence a late checkpoint after the recovery stop barrier.

The fixture provisions a synthetic accepted connection rather than repeating real sign-in/onboarding in every journey. Real Auth0, microphone recognition, model decisions and audio playback are not replaced by a claim of end-to-end production coverage. Existing individual-phase tests still cover interrupted readbacks, stale versions, uncertain acknowledgements, worker leases/restarts, provider failures, deletion, permissions, source lineage, preview races and rollback flags.

## Bugs found by real PostgreSQL execution

The Phase 7/8 suites had previously been blocked by the Windows bind denial. The newly authorized Phase 9 start succeeded at the same loopback port 55487. The existing test-role name was recovered through PostgreSQL's local administration mode while the cluster was stopped; roles and data were not changed. Testing uses only the dedicated disposable cluster and synthetic schemas. The earlier denial is historical evidence, not an unresolved bind error in this run.

| Fix | Observed failure | Resolution |
| --- | --- | --- |
| Migration 069, `binder_publication_source_lock` | Derived publication preview failed because `ORDER BY version` could mean a PL/pgSQL variable or a memory-table column. | Qualify the memory lock query's columns. Retain version/digest validation and source locks. |
| Migration 070, `current_publication_revalidation` | Retrying a prior publication could return success after its selected source was removed. | Recheck current source refs and digests before returning the publication receipt. A still-valid retry remains idempotent; removed evidence produces a conflict. |
| Migration 070 | A cancelled help request disappeared from lists, but its old notification could still return a destination because SQL NULL bypassed `IF NOT live`. | Make help liveness return false when `help_publication_id` is NULL. Notification opening now rejects the cancelled request. |
| Migration 071, `preserve_coordinator_lock_order` | Phase 7/8 function replacements had overwritten migration 061's account/preview lock ordering. Concurrency tests exposed help/read and suspension/publication conflicts. | Reapply the existing `NO KEY UPDATE` account locks and institution → connection → grant → preview order to the replaced functions, with exact prerequisite checks. Preserve the unchanged connection command and all source validation. |

All are forward migrations; existing migration files are preserved. Binder/feedback startup readiness requires migration 071, with the derived/follow-through prerequisites also checked. The fixes do not publish any source automatically or weaken an access denial. Before release, apply the complete ordered migration set through 071 in a separately approved rehearsal, then use the appropriate restricted runtime and maintenance grants. Flags alone do not repair an outdated function definition.

The focused regression run after the fixes passed **24 tests with no failures, skips or cancellations**, including the existing lock-contention tests, derived sharing, help/guidance/replies and both new bilingual journeys. Broader run results are recorded separately rather than being inferred from this subset.

## Recorded validation results

- Full PostgreSQL-backed server suite after migrations 069–071: **849 passed, zero failed/skipped/cancelled** (`server-final.log`). This precedes the two final voice-instruction changes.
- Final voice-related tests after those prompt changes: **57 passed, zero failed/skipped/cancelled** (`voice-post-prompt-focused.log`). Final operations suite: **35 passed, zero failed/skipped/cancelled** (`operations-post-prompt.log`). The broader post-prompt server rerun ended without a summary and its runner session became unavailable; `server-post-prompt.log` is incomplete and is **not** a passing full-suite result. A scoped read of the disposable cluster then showed no other connected test clients. Do not infer a final 849-test pass from that interrupted run.
- **46** successful synthetic browser journeys across English/Spanish and 1280/390/320 widths, including narrow keyboard checks. Twelve sharing/coordinator component scenarios mock their APIs; the others exercise local APIs/database where supported. The coordinator harness originally assumed Tab skipped an actual “Attach to” control; its corrected keyboard path passed all six cases in `coordinator-keyboard-final.log`. Earlier aggregate failure evidence is preserved. The 320px Spanish coordinator screenshot was visually inspected.
- Retrieval: **24/24 answerable hits**, including 12/12 per language, all four no-relevant cases and scope checks passed. Capacity: 150 controlled simultaneous review requests produced two admitted reads, 148 bounded retry responses and zero unexpected 503s; a subsequent read succeeded. Separate 60-user/10-concurrency/5-pool synthetic registration workload passed with 2,467 requests; its 13 ordinary review-page reads all succeeded. Artificial contention is not representative production throughput.
- TypeScript, native-loader production build, logging policy and whitespace checks passed. Client build checks precede the final server-only prompts; the final focused tests and actual follow-up probes cover those prompts. The existing Auth0 directive/bundle-size warnings remain. The offline model-contract report is software evidence, not real model quality.
- The local recording review page loads its audio metadata and downloads notes with no page errors or horizontal overflow at 390px. Its screenshot was visually inspected; this does not substitute for listening. It contains **24 probe cases and 35 actual audio clips**.

The final source fingerprint is unchanged during the final focused checks and matches the follow-up provider report. Earlier browser/capacity evidence predates the final voice prompts and is identified as such. The final source/configuration capture template remains empty pending complete interactive acceptance, real timing and named human ratings. Local preview port 5179 and disposable PostgreSQL port 55487 were confirmed no longer accepting connections after cleanup. No production execution occurred.

## Acceptance criteria and evidence boundaries

| Area | Required criterion | Evidence and limit |
| --- | --- | --- |
| Software correctness | All applicable server/operations tests pass with zero skipped PostgreSQL cases on the final source. | Full-suite TAP logs, schema/role fixtures and the final source fingerprint. Any earlier failed run remains in the evidence folder. |
| Ownership and privacy | Zero invented commitments, cross-student writes, unconfirmed corrections or exposure of private content in tested critical scenarios. | Deterministic contracts, real database integration, delayed-body/browser tests and current-grant checks. This is finite case coverage, not proof against all possible utterances. |
| Retrieval | Recall-at-five ≥ 0.90 overall and per language, with all no-relevant/boundary cases passing. The exact `es-renta` regression must pass. | Fresh PostgreSQL evaluation: all 24 answerable cases found evidence, four no-relevant cases passed, and no boundary failure. Stored-text redaction false positives remain documented in Phase 5. |
| Browser experience | English/Spanish at 1280, 390 and 320 pixels; no horizontal overflow or uncaught errors in the tested journeys. | Earlier phase harnesses rerun against the candidate; synthetic auth/media/providers, real APIs/database where the harness supports them. Sharing/coordinator component harnesses mock their API responses, so their results do not replace database authorization tests. |
| Keyboard/accessibility | Sharing review has a name and receives focus; Tab/Shift+Tab traverse review controls; Escape cancels without publishing. Coordinator guidance and student acceptance/save controls work with the tested keyboard path. | `ORIGEN_SMOKE_ACCESSIBILITY=true` in the sharing/follow-through harnesses. This is a narrow smoke check; screen-reader, contrast, zoom and a full WCAG audit remain separate. |
| Capacity | At most two expensive review reads per process; excess receives a retry response before starting more protected work, slots recover, and the bounded real-database workload has no unexpected 503s. | The 150-request controlled-overload report and registration stress report. Their actual sample sizes/latencies are recorded, not extrapolated to production. |
| Actual speech/model quality | All 16 critical synthetic voice cases meet every rubric dimension, including qualifiers, attribution, speech clarity and student action ownership; disagreements are resolved. | Actual recordings, returned tool trace and named human reviews are still required. Expected answers are never copied into a capture as model output. |
| Latency and cost | Proposed p95 first audible response ≤ 8 seconds; ≤ 8 research calls per connection; measured provider usage and dated prices fit an explicitly adopted budget. | Proposed limits inherit the existing evaluation rubric. Synthetic provider durations and unknown usage are not billable-cost or speech-latency measurements. Threshold/budget adoption and live evidence remain outstanding. |

## Live-provider capture and review

`evals/student-first.cases.v1.mjs` adds eight scenarios in both languages: tentative interests/useful questions, interrupted correction, return context/declined questions, recovery status, selected sharing, coordinator action ownership, permission loss and stale official policy with research failure. Each has setup instructions and observable expected behavior. These are synthetic scripts, not real student examples or captured responses.

`scripts/evaluate-student-first.mjs` reuses the existing `reviewResponses` evaluator. It adds a source fingerprint over the current repository, evaluation catalog and deployment defaults; explicit intended evaluation flags; recording/provider-receipt/timing references; and a named budget owner. It never loads production environment files, changes flags or makes paid calls.

```powershell
node scripts/evaluate-student-first.mjs template > output/student-first-phase9-2026-10-21/provider-capture-template.json
node scripts/evaluate-student-first.mjs review <completed-synthetic-capture.json>
```

Generate the template after the candidate is fixed. Its text, model, actual configuration hash, audio evidence, timing, usage, cost, pricing date and human review fields intentionally start empty. The intended flags in the template describe an isolated evaluation configuration; they do not assert that the running app has those flags enabled.

An operator must capture the actual synthetic run on that source/configuration, record the real model/configuration for each case and retain the relevant synthetic audio and receipts. A named bilingual reviewer must listen and inspect tool outcomes rather than score a prompt by reading its intended answer. Measure from a consistent user-turn completion point to first audible response, recording the method; include research and summary/extraction usage in the evaluation's total budget. Do not include real student content, tokens or credentials in capture artifacts. Resolve critical errors and reviewer disagreements before adoption.

The review refuses stale source/flag evidence and missing audio/configuration/provider references. Existing review logic checks complete case coverage, human scores, measured timing, usage/pricing, tool/source evidence and budget. Three validator tests exercise missing evidence, incorrect rollout, stale source, critical ownership/privacy scores and exceeded time/cost limits. Fabricated validator-test data is not written as release evidence. Evidence references and reviewer identity remain declarations until a release reviewer inspects their underlying records. A technical pass always retains `releaseReady:false`.

## Reproduction and local test setup

Use only a dedicated disposable loopback `DATABASE_TEST_URL`; never substitute the application's production `DATABASE_URL`. Database fixtures create/drop synthetic schemas and restricted roles. The cluster used here is the previously created `tmp/student-first-phase1-pg-20261021`, PostgreSQL 18.4 at `127.0.0.1:55487`, with existing test administrator `phase1_test`. No password is printed or stored in these instructions.

```powershell
$env:DATABASE_TEST_URL='postgresql://phase1_test@127.0.0.1:55487/postgres'
$env:ORIGEN_TEST_DATABASE_URL=$env:DATABASE_TEST_URL
$env:TELEMETRY_TEST_DATABASE_URL=$env:DATABASE_TEST_URL
node --test --test-concurrency=2 server/*.test.mjs
node --test --test-concurrency=1 ops/*.test.mjs ops/observability/*.test.mjs
node scripts/evaluate-history-retrieval.mjs --output <new-report.json>
node ops/coordinator-review-burst.mjs --disposable-database --output <new-report.json>
node ops/coordinator-registration-stress.mjs --disposable-database --users 60 --concurrency 10 --pool 5 --output <new-directory>
```

Browser checks use a separate local headless Chrome profile with synthetic identity, never the user's signed-in browser profile. `scripts/student-first-preview.config.mjs` starts a fixed synthetic Vite snapshot with `.env` loading and API proxy disabled, loopback port 5179, a bounded HTML entry scan and file watching disabled. Earlier preview attempts stopped responding while the temporary database/evidence trees were active; restarting with this isolated configuration restored HTTP responses. That observation does not prove a general Vite defect. Keep the failed browser logs as evidence of the harness interruption.

```powershell
node node_modules/vite/bin/vite.js --config scripts/student-first-preview.config.mjs --configLoader native
$env:ORIGEN_PREVIEW_URL='http://127.0.0.1:5179'
$env:ORIGEN_SMOKE_ACCESSIBILITY='true'
# Use the installed Playwright module/runtime and a separate Chrome executable.
# Run each scripts/<name>-smoke.cjs with a unique ORIGEN_SMOKE_OUTPUT path:
# binder-organization, binder-corrections, guided-conversation,
# conversation-continuity, conversation-recovery,
# conversation-recovery-privacy, derived-sharing, coordinator-follow-through.
```

Use a unique evidence directory and preserve the first result if a check fails. Stop only the preview and disposable PostgreSQL processes created for this work after verification. Windows process inspection previously denied in Phase 6 is not retried. Local Node is v24.15.0 while the repository deployment configuration specifies Node 22; exact deployed-runtime parity remains a release rehearsal item.

## Remaining release decisions

Daniel authorized a maximum aggregate $5 and will review English/Spanish recordings. Two synthetic live-provider runs captured 16 baseline probes and eight follow-up probes against `gpt-realtime-2.1`, voice `marin`. Their aggregate conservative full-uncached-price cost is **$2.071632** (not an independently reconciled invoice). The second report carries the first run's $1.32752; adding their totals would double count. Audio, actual transcripts, configuration, response IDs, usage and tool outcomes are retained under `live-provider-1` and `live-provider-2` in the evidence directory. Open `review.html` there for playback and downloadable listening notes. No further paid run is needed to inspect this evidence.

The first run used a 768-token output cap: both tentative-interest cases hit that cap. The follow-up used the app's 1500-token cap and all eight probes completed. Text input and provider PCM output do **not** establish microphone recognition, accent handling, browser playback latency or completion of the full interactive case setups. In particular, these short probes do not provision the accepted connection or named institution needed for all sharing/policy-failure acceptance assertions. Research/UI controls use explicit unavailable/fault adapters; local memory/question tools and scoped context use the real service and disposable database. The gallery never assigns human scores or represents these probes as full acceptance captures.

Actual probes found two prompt issues addressed locally: correction searches included long instructions/new replacement wording and missed a known fact; the model claimed sign-out without an app acknowledgement. `live-memory-tools.mjs` now requests concise saved-fact excerpts and avoids duplicate replacements after an empty search. `profile-voice.mjs` explicitly forbids claiming sign-out, revocation or sharing termination without app acknowledgement. The follow-up found both correction sources and neither permission-loss reply claimed a completed app action. Retrieval thresholds, access scope and consent checks were not loosened.

**Voice quality is not passing yet.** In the follow-up, conversational corrections still led to unnecessary durable-save solicitation; the Spanish attempted write was rejected by the existing `not_requested` guard and nothing was saved. The English correction requested confirmation without actually invoking a save tool. English return guidance again failed to use the known Tuesday/Thursday constraint, while Spanish used it. Some English replies began with “Hola.” The tentative-interest English reply also needs human review for tone/length and treatment of uncertainty. These observations are release blockers or review concerns, not evidence that the model is reliable because all responses completed. More prompt text alone has not established consistent behavior; inspect overlapping session instructions and capture realistic multi-turn corrections/return conversations before another targeted evaluation. Preserve the current server consent boundary and consider reducing competing instructions rather than weakening persistence checks.

Proposed thresholds do not constitute release approval. No consented student pilot activity has taken place. Daniel's listening review, complete interactive live scenarios, full accessibility review, real sign-in, microphone/actual audible latency, deployed Node 22 parity and a named operational owner remain Phase 9/10 evidence requirements. Operational packet preparation may proceed, but do not enable or deploy the new features on these results.

REVIEW-BURST-001 remains a historical unresolved root-cause investigation even if bounded local capacity checks pass. Keep the two-read per-process boundary for any proposed pilot; account for process count, retry guidance and real identity-provider latency before expansion. Do not present a forced-wait overload test as normal throughput. The product remains the simple student conversation and organized binder; this phase adds validation, regression fixes and evidence, not new dashboards or student-facing configuration.
