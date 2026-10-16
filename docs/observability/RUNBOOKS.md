# Private diagnostics operating runbooks

Use a synthetic identity and a fresh operation for every exercise. Never obtain a user's binder, transcript, audio, email, credentials, raw request/response, SQL values or provider error text to run these procedures. Technical observations establish stages and uncertainty; they do not establish what a person heard or why they left. WebRTC audio is not a server recording.

## First response

1. Check the independent monitor and current collection/access switches. Record only incident UUID, service, environment, exact release, error family, aggregate sample counts and missing evidence. Confirm clocks and coverage before comparing periods.
2. For a real support case, follow phase 5's owner/student-bound consent, live eligibility, expiry, revocation and audit workflow. Use only the approved case gateway. A monitor incident ID is not a support capability and cannot resolve a user.
3. Distinguish server-observed outcomes from browser reports. A missing observation is unknown. Do not call a diagnosis a fix until a relevant recovery test passes.
4. Reproduce with the synthetic contract rehearsal, relevant existing component tests, and isolated PostgreSQL where specified. Run candidate code only in the phase 7 sandbox after its real isolation gate passes.
5. Propose any rollback through the human release workflow. Neither alerts, a model report, nor passing tests authorize deployment. Preserve audit, expiry, permission supervision and pending erasure during rollback.

## Incident exercises

Every row inherits the prohibited-data rule above. `ops:diagnostic-rehearsal` exercises the event/diagnosis contract; it is not a full browser/network failure injector. The recovery column gives the additional system check required before closing an incident. Keep synthetic fixtures separate from production and destroy them afterward.

| Scenario / injected fault | Expected evidence and diagnosis criterion | Recovery test | Cleanup |
| --- | --- | --- | --- |
| Login/eligibility: synthetic invalid auth and withdrawn permission | 401/authentication code versus 403/permission code; do not report an Auth0 failure from an eligibility denial | Fresh permitted request succeeds; withdrawn/minor access still fails; run guardian permission and staff-access tests | Remove synthetic identity and tokens |
| Silent voice startup: successful negotiation without playback receipt | Server `voice.negotiate` completion establishes negotiation only. Playback remains unknown without a client observation | Synthetic browser receives audio/playback observation; record it as client-reported, not server proof of hearing | Close synthetic call, release microphone |
| Abrupt interruption: browser reports connection loss | Client failure/cancellation and server/provider terminal outcomes remain separate; cannot infer a verbatim cutoff | Reconnect a fresh synthetic call; run voice continuity, turns and connection tests | Close both calls and clear temporary client context |
| Research timeout: provider stub throws TimeoutError | Provider failure at request/body stage, safe timeout code, no raw provider message | Stub responds successfully; permission withdrawal during body read still blocks use | Remove stub and pending attempt |
| Summary generated but not saved: synthetic store rejects | Generation completed plus server save failed establishes storage-stage failure. Generation alone or missing receipt is unknown | Retry against synthetic store; verify one saved summary, correct student and no duplicate/stale save | Delete synthetic summary/operation |
| Wrong binder scope: foreign student's memory offered | Scope check rejects foreign memory; no private content enters diagnostics | Correct student context works; cross-account/student tests remain denied | Remove both synthetic binders and operation refs |
| Permission hangup retry: transport fails termination | Failed hangup plus nonzero supervisor backlog; prioritize oldest retry above 30 s or three consecutive failures per instance | Withdraw permission while work is pending, retry termination, verify backlog zero and no late content released | Terminate synthetic provider call and remove retry row |
| Pool exhaustion: synthetic SQLSTATE 53300 | Database capacity code/acquire-stage timing, waiting pool count; no SQL text/values | Release held synthetic connections; request succeeds under the restricted runtime role | Close test connections, drop synthetic database |
| Deletion propagation: independent ledger unavailable | Health degraded; protected queries fail closed, outbox work remains pending rather than acknowledged | Restore synthetic ledger, replay, verify no removed references in reads/late ingest and outbox acknowledgement | Erase test references and drop fixtures |
| Expired backup restore: old data/control state restored | Restore barrier blocks queries before ledger replay; expired rows remain hidden independently of cleanup | Replay independent erasure history, verify restored deleted rows remain absent; run retention/restore suite | Drop restored synthetic database/backup |
| Log outage: bounded sink throws or stalls | Coverage gap/drop counters; unrelated application response succeeds; audit-required support access still fails closed if audit is down | Fresh sink accepts a safe record; bounded queue and shutdown still hold | Close writer/exporter; discard synthetic queue |

Run the contracts with `npm run ops:diagnostic-rehearsal`. It reports time to evidence, diagnosis accuracy on constructed fixtures, explicit unknowns, negative controls, bytes and external-call cost. Zero external-call cost means no provider requests were made, not that production operation is free. Real database checks use `TELEMETRY_TEST_DATABASE_URL` pointing only to a disposable synthetic cluster, then `npm run test:observability`, `npm run test:support`, and `npm run test:diagnostic-agent`. Never substitute production `DATABASE_URL`. Phase 7's `test:diagnostic-isolation` must run on its separate disposable Linux/gVisor VM.

## Initial alerts and coverage

All alerts are **shadow only**. `telemetry:monitor` is a one-shot command for an independent once-per-minute scheduler. It has no notification transport or automatic authority to change switches. Route only its incident UUIDs and aggregate facts into a reviewed external monitor; do not attach raw logs. No messaging integration is enabled by this implementation.

| Family | Initial trigger | Response |
| --- | --- | --- |
| api-errors | More than 5% observed 5xx, at least 20 requests in 5 min, or three consecutive synthetic failures | Inspect exact release/provider/database. Expected cancellations are excluded. Show counts and coverage |
| summary-persistence | Three server-confirmed save failures in 10 min | Check storage/save stage; missing client receipts are insufficient |
| permission-termination | Oldest pending retry above 30 s or three consecutive supervisor failures per instance | Priority operator review; preserve permission checks |
| telemetry-pipeline | Canary absent 5 min, independent health unavailable, or drops above 1% over a full 5 min window | Mark coverage degraded and investigate through independent health |
| expiry-deletion | Last successful cleanup older than 2 h or deletion work older than 1 h | Restrict affected investigations, repair cleanup, replay and verify |
| privacy-boundary | Any synthetic content/secret canary escapes or prohibited sandbox access succeeds | Operator immediately disables affected export/agent/runner path, destroys sandbox if needed, investigates and reruns failed boundary test |
| release-regression | Different exact revisions, at least 100 requests per population, current rate above 5%, increase above 2 percentage points and three estimated standard errors | Review a rollback; does not deploy one |

These are starting heuristics, not an SLA, statistical guarantee or measured production baseline. Error percentages from central event rows cover **exported mapped observations only**, not every application request; the SQL collector labels them `best_effort`. They must not be treated as complete traffic measurements. The release-regression rule refuses best-effort populations. Missing/expired/deleted events reduce coverage; an absence is not zero failures.

The SQL monitor exposes no event IDs, account/student references, attributes objects or free-form text. It groups at most 32 recent service/release populations and counts only server-observed events. It has fixed query timeouts. Deduplication is by environment/service/release/family; an active incident keeps its UUID until resolution, then a recurrence opens another. Active metadata ages out after 90 days. Private state is bounded; keep its parent directory mode 0700 and outside agent access. The `.next` file deliberately blocks concurrent runs/crash ambiguity; reconcile it through an operator before restarting, rather than deleting a live process's state.

State records once-per-minute shadow observations. A gap over two minutes resets the continuous seven-day review period. `shadowReviewDue` becomes true only after seven days and at least 10,080 observations. That flag does **not** enable paging. Review alert counts, repeated incidents, sample sizes, false positives, unknowns, cost and missing probes, then approve a separate routing configuration with a named contact. Retain only bounded safe output under an approved infrastructure-log expiry; do not archive user content for this review.

## Provision the independent monitor

Apply additive telemetry migration `002_monitor.sql` using the existing separate owner migration identity (`node ops/observability/manage.mjs migrate`). Grant a new restricted LOGIN with `TELEMETRY_PURPOSE=monitor`, `TELEMETRY_ROLE=<operator-created-role>`, `TELEMETRY_ENVIRONMENT=<environment>` and `node ops/observability/manage.mjs grant`. Do not reuse the ingest, raw-query, erasure, retention, gateway or application role. Run the monitor outside the pipeline it checks.

Configure `TELEMETRY_MONITOR_DATABASE_URL`, `LEDGER_READER_DATABASE_URL`, `APPLICATION_ERASURE_HEALTH_DATABASE_URL`, `TELEMETRY_ENVIRONMENT` and `OBSERVABILITY_MONITOR_STATE_FILE`. The three logins expose only aggregate telemetry/health, ledger generation and application outbox health respectively. Verified database TLS is required outside explicit localhost synthetic tests. Exit 1 indicates monitor/configuration failure or unhealthy independent pipeline/expiry status, even if an incident was already deduplicated. Always monitor scheduler heartbeat as well; a stopped monitor cannot report its own absence.

Optional `OBSERVABILITY_MONITOR_PROBE_FILE` supplies an operator-owned, non-agent-writable snapshot (maximum 4 KiB, age at most 90 seconds):

```json
{
  "version": 1,
  "at": "<current ISO timestamp>",
  "syntheticFailures": 0,
  "privacyEscapes": 0,
  "dropWindow": {"durationMs":300000,"accepted":990,"dropped":10},
  "baseline": {"release":"<prior exact commit>","requests":1000,"errors":1}
}
```

`syntheticFailures` is the independently measured consecutive failure count, capped at three. `privacyEscapes` is 0 or 1 from an actual privacy/sandbox canary, never a model claim. Use `null` for drop/baseline when unavailable. The file must be produced by a reviewed independent probe/metrics integration with population and exact-release evidence; writing zeros is not proof probes ran. Missing integrations are reported in `unconfiguredSignals`. This change supplies the contract, not provider-specific health checks or a fabricated production baseline.

## Independent kill switches

Agent reads require both `DIAGNOSTIC_AGENT_ENABLED=true` and a valid operator-owned `DIAGNOSTIC_AGENT_CONTROL_FILE`. Runner jobs separately require both `DIAGNOSTIC_RUNNER_ENABLED=true` and `DIAGNOSTIC_RUNNER_CONTROL_FILE`. Place files outside agent checkout/state/workspace paths with protected parent directories and no symlinks. This phase makes these files mandatory in the broker, machine gateway and runner CLIs; older launch configurations without them now deny access.

An enabled file contains exactly `{"version":1,"enabled":true,"expiresAt":"<ISO timestamp no more than 15 minutes away>"}`. Renew it through an operator heartbeat only while the capability is approved. Missing, malformed, stale, writable-by-others or disabled files deny access. To kill a capability, atomically replace its file with the same schema and `enabled:false`, or remove it; then stop the service and revoke its capabilities. The broker checks before/after access and at most every 15 s while idle; the runner checks every second while executing; machine gateway responses are withheld after switch changes. Revocation remains available. Killing the agent does not stop the runner's separate control, so disable both when both are affected.

These switches do not disable erasure, expiry, audits or the baseline logger. Keep those services running. Deletion/retention failures restrict investigation independently of these flags.

Expanded successful dependency spans require `OBSERVABILITY_DETAILED_SPANS=true`, `OBSERVABILITY_DETAIL_STARTED_AT` and `OBSERVABILITY_DETAIL_EXPIRES_AT`, with a future expiry no more than one hour after start. Sampling automatically returns to baseline on expiry; unbounded or missing times disable it. The finite content-free schema and existing volume budgets remain unchanged. No UI, agent or incident severity can enable transcript/body/header capture.

## Monthly and change-triggered operations

The project owner must assign and record a named primary and backup before activation; proposed roles and outstanding deployment evidence are in [OPERATIONS_RECORD.md](OPERATIONS_RECORD.md). Monthly, the assigned operator reviews staff/service membership and expired capabilities, proves expiry with an old synthetic record, checks a planted forbidden marker at each actual sink, reviews tool/profile/image policy, records event bytes/ingest costs and agent budget, and runs one incident exercise. Record date, exact revision, owner, pass/fail/unknown, evidence link and next action. A model must not sign off its own authority.

After permission, role, retention, processor or data-flow changes, rerun account/student scope, erasure/restore and real sandbox boundaries before reopening affected capabilities. Reconcile English/Spanish privacy wording, provider register, actual backup/log retention and operations record with deployment. Roll back only the failing optional capability, retain deletion controls and repeat the failed exercise before reopening it.
