# Phase 6 Read only diagnostic agent

Phase 8 adds mandatory live operator control files to the broker and machine gateway launch configuration; see [RUNBOOKS.md](RUNBOOKS.md). An old environment flag alone no longer enables agent access. Erasure, audit and expiry remain independent.

Phase 6 adds a case-bound diagnostic tool broker, an independent append-only access audit and short structured reports. It can diagnose synthetic incidents through a fixed JSON-RPC interface without production SQL, shell, environment access or application data credentials. Production model processing remains disabled because the provider, project, retention and processing agreement have not been approved.

## Implemented boundaries

The broker loads one signed phase 5 capability at launch. The model never receives that capability or its gateway JWT, cannot select another case and cannot supply a role or approval flag. Every tool invocation receives input validation, a durable audit intent, live gateway authorization, bounded execution, output validation and a completion audit before release. Audit failure returns a safe unavailable result; ordinary application requests do not depend on this audit database.

The broker accepts only a SHA-256-pinned synthetic policy whose file and reviewed release assets are outside the agent workspace. The policy explicitly lists allowed synthetic case IDs and releases. Production/staging policies, extra approval fields, expired policies and arbitrary source roots are rejected in this release. Source paths must appear in the reviewed manifest, resolve inside its bundle, remain outside the agent workspace, have no symlinks/junctions and match their recorded hashes on every read. Hidden files, `.env`, `.git`, credentials, output, temporary files, uploads, dependencies and private fixtures are excluded. Source/runbook text is bounded to 16 KiB and marked as untrusted evidence.

Gateway evidence must have a valid Ed25519 manifest, expected audience/environment/capability, unexpired lifetime, matching packet hash and approved source-revision links. Events are revalidated against the phase 1 finite vocabulary; unknown fields, free-form errors and overwritten envelope fields are rejected even when packaging signatures are valid. Requests must already have appeared in authorized evidence. A model cannot use a random request ID to discover another account.

Retrieved text, comments, logs, runbooks and model proposals cannot change authorization. No URL found in evidence is fetched. The only outbound broker data request is to its operator-configured HTTPS gateway, with redirects rejected and bounded response size/time. Source is read from reviewed release files, not Git/network commands or a live developer checkout.

## Tools

| Tool | Accepted arguments | Result |
| --- | --- | --- |
| `get_incident` | Empty object | Approved case/window, operations, known releases, gaps and expiry |
| `get_timeline` | Authorized `operationId`, optional previously issued `cursor` | At most 200 validated events, sampling/gaps and next cursor |
| `get_request` | Previously observed `requestId` | Sanitized request/dependency outcomes within the case |
| `get_metrics` | `metricSet`: `api`, `provider`, `database` or `job` | Approved hourly aggregates with fixed grouping and service-environment population |
| `get_release` | `revision` already referenced by case evidence | Reviewed commit, dependency-lock digest, schema/config identifiers |
| `get_runbook` | Reviewed runbook `name` | Bounded pinned text with provenance |
| `read_source` | Referenced `revision`, approved relative `path` | Bounded pinned code excerpt with provenance |
| `propose_reproduction` | Finite `scenario` and `testProfile` | Synthetic runner proposal; execution is not authorized |

Reproduction scenarios are `summary-save-failure`, `research-timeout`, `voice-interruption`, `permission-withdrawal`, `pool-exhaustion` and `unknown`. Test profiles are `logging-contracts`, `permission-isolation`, `voice-summary` and `frontend-build`. These names do not execute scripts. Phase 7 supplies the separate sandbox boundary.

Phase 5 now exposes `/v1/validate` for live authorization and optional typed queries on `/v1/evidence`. Timeline cursors are signed by the gateway and bind the capability, case scope, operation, expiry and PostgreSQL receipt/event position. Pagination preserves microsecond ordering. The broker accepts only cursors it received during this run and permits each once. Tool output is checked against the requested operation, request or metric family as well as the overall case.

Startup verifies a signed one-event incident sample rather than fetching an entire timeline twice. Its scope and coverage remain explicit; the agent requests the relevant operation timeline when it needs details. Returned evidence envelopes are charged once, while other tool outputs are charged by their serialized size.

## Budgets and lifecycle

An independent database lease permits one investigation at a time, including across broker processes sharing that environment's audit store. Its maximum lifetime is ten minutes. There are no automatic extra agents, retries or budget increases.

The broker permits at most 30 tool attempts and ten minutes, bounded further by capability expiry. The total returned telemetry budget is 128 KiB. Collection stops early to reserve 20 KiB for up to two short report deliveries and protocol framing; internal fetched evidence is also charged, conservatively. Report bodies are at most 8 KiB. Oversized initial evidence produces an insufficient-evidence partial report without giving that packet to a model. Reaching a limit ends collection and produces a partial report while authorization remains valid. If authorization has expired or been withdrawn, results become unavailable instead.

Active authorization is polled every 15 seconds and rechecked before and after each tool and report release. A stalled previous poll aborts the run rather than trusting a stale result. Revocation, policy expiry, kill-switch changes and audit/source outages abort the model signal, clear retained context and invalidate stored reports. Readers/model adapters that ignore abort do not release a late result. An unsettled model adapter also blocks a second adapter call in the same process. Already delivered data cannot be recalled.

The broker retains only bounded event summaries, request/release references and cursor state during a run; the optional agent driver retains a bounded evidence context and wipes it on completion or abort. It does not retain prompts, chain-of-thought, transcripts, cross-case memory or vector-store entries. A trusted provider adapter must honor cancellation and bound its own response decoding; model-provided code cannot be used as an adapter.

## Reports and audit

Reports contain a suspected failure, observed event references, competing explanations, missing evidence, a synthetic reproduction, proposed patch areas, test profiles and uncertainty. The broker derives observed fact labels, provenance, outcomes, safe codes and release revisions from validated events. Models cannot invent these facts or add free-form prose. Status is `diagnosis` or `partial`; `fixed` is invalid.

Only reviewed source paths actually read in that run may become proposed patch areas. The short report is stored independently with the case/run IDs and expires no later than the capability. Retrieval rechecks live authorization and is limited to two deliveries per run, including the initial submission response. Closing the broker removes its report; a crash leaves an inaccessible report for expiry cleanup, at most 15 minutes plus the retention sweep interval.

The independent audit stores call IDs, case/run IDs, allowed tool names, decision codes, counts and random artifact references. It stores no arguments, prompts, outputs, source text or reasoning. A completion must match a prior allowed intent. The audit LOGIN can only append through a fixed routine; it cannot read, update, delete, truncate or expire records. A different report LOGIN has fixed report/lease routines and no audit access. A third retention LOGIN runs only the bounded expiry routine. Audit records expire after 90 days; this does not change conversation retention.

## Local use

Run these commands from the repository root:

```powershell
npm run agent:synthetic
npm run test:diagnostic-agent
```

The demo uses a scripted synthetic agent against seeded generation/save outcomes and reviewed synthetic code. It produces a storage-failure hypothesis with event references and uncertainty. It makes no provider calls and is not an evaluation of an external model's reasoning quality. Unit tests use temporary synthetic bundles; PostgreSQL tests additionally require `TELEMETRY_TEST_DATABASE_URL` and create separate disposable databases/roles.

The broker's chosen transport is newline-delimited JSON-RPC 2.0 over standard input/output. It is a fixed private protocol, not a shell bridge or a claim of full MCP compatibility. Each message is at most 16 KiB; the buffer is bounded to 32 KiB and the connection accepts at most 100 messages. Requests use integer IDs and exactly `jsonrpc`, `id`, `method`, `params`.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_incident","arguments":{}}}
```

`tools/list` supplies the eight input schemas. `tools/call` invokes one tool. `diagnosis/submit` accepts exactly `report` in `params`; `diagnosis/report` accepts an empty object. Neither method accepts a case, capability, report ID, actor, approval or storage path. Authorization is bound by the trusted launcher.

## Provisioning a synthetic broker service

1. Keep real-user processing and deployment off. Finish the applicable phase 4/5 controls before connecting a gateway. This release accepts only explicitly listed synthetic cases in `test` or `development`.
2. Create a separate diagnostic audit/report PostgreSQL database per environment, independently owned and outside application/event-store credentials. With `AGENT_AUDIT_MIGRATION_DATABASE_URL`, run `npm run agent:audit -- migrate`. Applied migration checksums cannot change.
3. Create fresh restricted LOGINs with no ownership, elevated attributes or memberships. For each, set `AGENT_DATABASE_ROLE` and `AGENT_DATABASE_PURPOSE` to `audit`, `reports` or `retention`, then run `npm run agent:audit -- grant` using the migration owner. Do not share this owner credential with a broker, model or retention process.
4. Start `npm run agent:retention` with only `AGENT_RETENTION_DATABASE_URL` and required TLS configuration. It verifies the retention role and sweeps every minute. Keep it running when agent access is disabled. Monitor its process independently; a telemetry outage must not silently disable retention.
5. Use the phase 5 workflow to open a synthetic case and issue an investigation capability to the intended principal. Machine recipients must be registered in the gateway. Obtain its dedicated-audience gateway JWT through the trusted operator/client flow. Mount the JWT and capability as private temporary files, not as model context or JSON-RPC arguments.
6. Prepare a read-only reviewed release bundle outside the agent workspace. Its `policy.json` uses the schema below. Review source/runbooks for secrets and real user content before recording hashes. Pin its SHA-256 digest in the trusted launcher, outside model control. Do not derive a new digest automatically from an agent-edited file at startup.
7. Launch `npm run agent:broker` with the configuration table below. Connect only a trusted local synthetic agent/client. `runAgent()` is a model-neutral bounded driver for a reviewed host adapter; no external provider adapter is enabled by this phase.
8. Confirm audit-before-access, completion-before-output, report expiry, permission withdrawal, a gateway outage and budget stopping in the target synthetic environment. Production processing needs a separate provider/project/purpose/retention agreement review, a pinned production policy implementation and explicit enablement; an `approved: true` argument or environment shortcut cannot unlock it.

| Broker variable | Meaning |
| --- | --- |
| `DIAGNOSTIC_AGENT_ENABLED=true` | Explicit broker switch; checked on each access/poll |
| `AGENT_AUDIT_DATABASE_URL` | Append-only audit LOGIN |
| `AGENT_REPORT_DATABASE_URL` | Different report LOGIN on the same independent database |
| `AGENT_POLICY_FILE`, `AGENT_POLICY_SHA256` | Operator-pinned reviewed manifest and digest |
| `AGENT_WORKSPACE` | Agent workspace that cannot contain policy/source assets |
| `AGENT_GATEWAY_URL` | Fixed HTTPS origin, no credentials, paths, query or fragment |
| `AGENT_GATEWAY_TOKEN_FILE` | Private dedicated-audience JWT file |
| `AGENT_CAPABILITY_FILE` | Private signed case capability file |
| `SUPPORT_VERIFY_KEY_FILE` | Trusted gateway verification key |
| `DIAGNOSTICS_AUDIENCE` | Expected dedicated gateway audience |
| `TELEMETRY_SSL_CA` | Optional trusted database CA |

The broker refuses ordinary application/migration/provider secrets and gateway application/query/control database URLs. Its audit and report logins must differ. Database TLS is verified; the explicit localhost synthetic-test exception from phase 4 remains available to test harnesses.

## Reviewed policy format

The launcher pins the digest of the complete JSON file. Relative `file` locations refer to reviewed assets beside that file. `path` is the normalized repository path exposed by `read_source`. Revisions and lock/file digests must be actual hashes of the reviewed release; the placeholders below are explanatory and do not form an accepted policy.

```json
{
  "version": 1,
  "mode": "synthetic",
  "environment": "test",
  "caseIds": ["<synthetic case UUID>"],
  "sourceRoot": "https://github.com/owner/repository",
  "releases": [{
    "revision": "<40 or 64 character commit>",
    "lockDigest": "<64 character dependency lock digest>",
    "schemaId": "reviewed-schema-1",
    "configId": "reviewed-config-1",
    "files": [{"path":"server/example.mjs","file":"code/server/example.mjs","sha256":"<64 character file digest>"}]
  }],
  "runbooks": [{"name":"summary-save","file":"books/summary.md","sha256":"<64 character file digest>"}],
  "expiresAt": "<future ISO timestamp>"
}
```

## Recovery and rollback

Disable `DIAGNOSTIC_AGENT_ENABLED`, stop the broker and revoke the agent client/capabilities through the phase 5 workflow. Stop active model requests through the adapter's abort signal, remove temporary JWT/capability files and retain the independent audit/expiry services. Manual scoped support remains available. No runner, code execution, production shell, automatic PR, deployment or message to users is enabled here.

Apply phase 5's restore barrier and reset before reopening access after an application/event-store restore. Discard agent reports and leases after restoring the diagnostic store; they never authorize access. If the independent ledger/signing material is restored, reconcile deletion history and rotate keys as required by phase 5. Require fresh cases/capabilities and regenerate reports. A restored report is not evidence of current authorization.

## Verification

The phase 6 suite covers the seeded diagnosis, all fixed tools, foreign references, permission/capability withdrawal, audit failure before execution and before output, lease concurrency, call/time/cumulative-byte budgets, pending model/evidence cancellation, context erasure, source tampering, symlinks/junctions, policy location, report constraints and prompt injection in event fields/comments. Real PostgreSQL tests verify independent role restrictions, report erasure and 205 events across signed pagination without duplication. Existing support tests cover account/student boundaries, expiry and restore behavior. CI runs the new suite in its PostgreSQL job.

Local verification: **13 phase 6 tests passed** with real disposable PostgreSQL where applicable; **11 support tests passed**; the full server suite passed **518 tests with zero failures and one existing skip**. The logging policy and whitespace checks passed. Synthetic databases, release bundles and temporary logs are removed after verification.

Production use, external model quality/cost evaluation and provider processing approval remain deployment gates. The existing recovery-test failure documented in phase 1 remains outside this phase.
