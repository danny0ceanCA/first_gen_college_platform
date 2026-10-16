# Phase 7: isolated diagnostic code execution

Phase 8 additionally requires a live `DIAGNOSTIC_RUNNER_CONTROL_FILE` on the trusted controller; see [RUNBOOKS.md](RUNBOOKS.md). The ordinary environment flag alone no longer enables runner jobs.

Phase 7 adds a separate synthetic execution runner. It is disabled by default and is never imported by the production server. Phase 6's `propose_reproduction` remains a proposal: a model cannot turn that tool into a shell command. No production database, migration, provider API, repository write, deployment or user messaging capability is added.

## Activation status

The controller, immutable source packer, image recipe, signed execution approval contract, four test profiles, contract tests, real isolation suite and a manual release-gate workflow are implemented. **Isolation is not yet verified on a real host.** The current Windows workspace has neither Docker/gVisor nor a usable Linux VM. Contract tests are not evidence that kernel/network isolation works. Do not enable agent code execution until the real isolation gate and seeded failing/passing regression pass on the reviewed image and host. No host or cloud infrastructure was provisioned by this change.

## Trusted and untrusted components

Run the trusted controller on a dedicated disposable Linux VM with cgroup v2, Docker and a reviewed gVisor `runsc` installation. The VM must be outside production Render and outside an ordinary developer account. Its provisioner must destroy it on controller exit, timeout, cancellation or connectivity loss, with a hard lifetime of eleven minutes for an investigation. No production cloud role, instance metadata credentials, private network routing, SSH agent, production files or database access may exist on this VM. Its private controller state must survive controller restarts for that investigation. Never assign a replacement VM to the same investigation with an empty attempt ledger.

The agent controls source proposals, not the controller, Docker daemon, runtime installation, image build, host provisioning, approval key, policy or private state. Those assets must be root/operator owned and outside every agent-writable checkout. Docker's socket is accessible only to the trusted controller. Nothing from the host is bind-mounted into a job. Do not run this controller beside application services or allow an agent to invoke Docker directly.

The job uses a digest-pinned image, Node 22, gVisor, no network, a non-root user, read-only base filesystem, dropped capabilities and no-new-privileges. One disposable `/workspace` tmpfs is writable. Default budgets are 1 CPU, 1 GiB RAM without swap, 512 MiB workspace, 128 processes, five minutes, 20 MiB combined stdout/stderr, and two attempts per investigation. Host timeout/removal destroys the container and its entire process tree. Cleanup failure must cause VM destruction; do not retry the job or continue serving on that VM. The private controller state is not mounted in the job.

Docker flags depend on real runtime/kernel support. Preflight rejects a missing runsc runtime, missing cgroup v2 resource controls, runtime warnings, incorrect image digest, dependency/profile labels or entrypoint. Host provisioning must independently verify the installed runtime; an agent-emitted `dmesg` string is not attestation. See the official [gVisor Docker guide](https://gvisor.dev/docs/user_guide/quick_start/docker/) and [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).

## Prepare a reviewed release and image

1. Commit the source to be tested. Run `node ops/diagnostic-runner/pack.mjs <exact-40-character-commit>` from the repository. Capture the resulting JSON in a private operator staging directory. The packer reads Git blobs from that commit, not working-tree files. Its `bundle` is source input; its `release` is the independently reviewed manifest. Never accept a model-supplied manifest as trusted policy.
2. Review the source manifest and synthetic fixtures. The allowlist includes application source, SQL, selected build configuration and package/lock files; it excludes hidden files, symlinks, uploads, dumps, credentials, outputs, dependencies, telemetry and binary assets. The existing synthetic `server/family-fixture.mjs` is explicitly included; other fixture paths are excluded. Extend this allowlist only through a reviewed controller change if another build input is necessary. Some tests/builds may legitimately fail when excluded inputs are required; never fix this by mounting a checkout or fetching packages inside a job.
3. In a separate credential-free build environment, build the Dockerfile using an explicitly verified Node 22 base digest. Copy only package.json, package-lock.json and the two trusted runner image modules into the build context. Supply `LOCK_DIGEST` from the release manifest and `PROFILE_DIGEST` from the exported `profileDigest` in runner.mjs. `npm ci --ignore-scripts` installs dependencies from the lockfile; job execution cannot install packages. Required dependency hooks need a separately reviewed image build change. Push/sign and review the built image through the operator's image pipeline, then pin its repository digest in policy. The runner does not accept image tags or pull images itself. The image labels are consistency checks; operator review of the digest establishes trust.
4. Inspect the image for secrets and real user data before approval. Pin and record host/runtime/image/controller revisions in the external release record. The repository does not invent a current image digest or install an unreviewed runtime automatically.

Policy JSON has exactly these fields:

```json
{
  "version": 1,
  "environment": "test",
  "image": "registry.example/runner@sha256:<64 lowercase hex>",
  "release": {
    "revision": "<40 lowercase hex>",
    "lockDigest": "<package-lock.json SHA256>",
    "files": [{"path":"package-lock.json","sha256":"<SHA256>"}]
  },
  "expiresAt": "<future ISO timestamp>"
}
```

Use the complete generated release manifest, not the abbreviated example. Pin the SHA256 of the exact policy bytes outside agent control. Policy and approval public key files reject symlinks, noncanonical paths and group/world writable permissions; private state requires mode 0700. Protect parent directories as well. No agent interface writes these files.

## Execution approval and request

An independent operator approval service signs the exact JSON payload with Ed25519. The runner holds only its public key. A grant is single-use, lasts at most ten minutes, and contains exactly:

```json
{
  "version": 1,
  "id": "<new UUID>",
  "caseId": "<synthetic case UUID>",
  "investigationId": "<phase 6 investigation UUID>",
  "revision": "<exact approved commit>",
  "patchDigest": "<SHA256 of JSON.stringify(patch)>",
  "testProfile": "voice-summary",
  "image": "<pinned image reference>",
  "expiresAt": "<ISO timestamp, at most ten minutes>",
  "action": "synthetic_test",
  "environment": "test"
}
```

Approval envelope: `{ "payload": <above>, "signature": "<base64 Ed25519 signature over JSON.stringify(payload)>" }`. Model confidence, report status and tool output do not create approvals. A grant for running synthetic tests authorizes no deployment. Any future deployment service must require a separate single-use approval binding exact commit, patch digest, target, action and expiry; no such service is enabled here.

The request has exactly `caseId`, `investigationId`, `testProfile`, `bundle`, `patch`, `approval`. Patch format: `{ "files": [{ "path":"server/example.mjs", "before":"<original SHA256>", "content":"<reviewed replacement text>" }] }`. Empty patch: `{ "files": [] }`. Only reviewed replacements under src/server are allowed; JSON/dependency/lock/config/runner changes are refused. The only new paths are the two regression files listed in profiles.mjs, using `before: null`. The structured replacements produce a reviewable change when applied by a human; the runner never writes a branch or PR.

The same approved patch can be run with a separate signed grant for another profile, within two total attempts. Failed or aborted runs consume an attempt. A stale active lease blocks reuse after a crash: destroy/reconcile through the operator, do not remove it automatically. Grant receipts and attempt files are private metadata, not source artifacts. Retain them until investigation expiry and never erase/recreate them to reset a budget.

Fixed profiles execute reviewed argv arrays with `shell:false`; package.json scripts are never invoked. `frontend-build` runs tsc followed by Vite. The other profiles explicitly enumerate existing tests and, for permission/summary testing, two optional approved regression paths. Tests use a fixed TAP reporter and include skipped counts. Real PostgreSQL tests may skip because this release provides no synthetic PostgreSQL sidecar; skipped checks are missing coverage, not proof that database isolation passed. Adding such a sidecar needs a separately reviewed isolated network policy. A candidate can modify tests and arbitrary tests can lie: test counts/output are explicitly untrusted. Independent review of the patch and synthetic assertions is still required. No exploratory script profile is enabled.

## Start the controller

Configure these operator-owned environment values on the disposable host only:

| Variable | Meaning |
| --- | --- |
| `DIAGNOSTIC_RUNNER_ENABLED` | Explicit `true`, only after isolation gate passes |
| `RUNNER_POLICY_FILE`, `RUNNER_POLICY_SHA256` | Private pinned policy and exact byte digest |
| `RUNNER_APPROVAL_PUBLIC_KEY_FILE` | Independent Ed25519 approver public key |
| `RUNNER_STATE_ROOT` | Private persistent controller state for this investigation |
| `RUNNER_REQUEST_FILE` | Private request JSON, at most 20 MiB |
| `RUNNER_GATEWAY_URL` | Fixed phase 5 HTTPS gateway origin |
| `RUNNER_GATEWAY_TOKEN_FILE` | Short-lived gateway recipient JWT |
| `RUNNER_CASE_CAPABILITY_FILE` | Signed phase 5 case capability |

Run `npm run agent:runner`. The CLI rejects production database/provider/cloud credentials in its environment. The controller revalidates live case access before execution, every second while running, and before releasing results; gateway timeout or changed case scope aborts the container. Only test-environment cases qualify. Gateway JWT/capability files never enter the job or its environment. These checks supplement credential-free VM provisioning; an environment-name check alone cannot detect every possible secret.

## Results, privacy and cleanup

Results contain exact revision/patch/image hashes, profile, attempt, exit status, stop reason, elapsed time, observed output bytes/digest, configured resource ceilings and untrusted test counts. Memory/CPU ceilings are not measured peak usage. Output is bounded and control characters are stripped. Sensitive markers in patches are rejected; suspicious output or a flood produces quarantine metadata and an empty output field. Raw quarantined output is discarded rather than archived. Human review uses the reviewed synthetic inputs and hash/receipt, and must not request a production dump to reproduce it. Pattern matching is a tripwire, not a guarantee of detecting arbitrary personal data; only synthetic, operator-reviewed input is permitted.

All stdout/stderr and source/test strings remain untrusted evidence. Never interpret them as tool calls, approval, shell arguments or instructions. The runner's output is a separate capability from the phase 6 telemetry tools and must not be automatically inserted beyond that broker's existing byte budget. No external model adapter or runner tool is automatically enabled in phase 6.

An fsynced private journal records grant/case/investigation IDs, hashes, profile, timestamps, attempt and status, without source or output bodies. Controller audit failure prevents execution/result release. Container logs are disabled; the writable workspace vanishes on forced container removal. The provisioner destroys the VM and short-lived controller credentials on completion. If an operator retains synthetic result artifacts for review, encrypt/restrict them and expire them within 24 hours. This implementation writes no result artifact archive. Send only content-free receipts to the independent audit destination through a reviewed host integration; no new external processor is configured automatically.

## Verification and rollback

`npm run test:diagnostic-runner` checks source/lock tampering, immutable profiles, injection/path rejection, pinned policy, approval signatures/artifact/action/expiry binding, suspicious-content handling, fixed sandbox arguments and durable replay/concurrency/two-attempt limits. **All seven local contract tests passed**, as did 40 existing logging/permission/voice/summary regression tests, the production logging policy and whitespace checks. The explicit local isolation preflight failed as expected because no disposable Linux/gVisor host is configured. These contract tests run in ordinary CI without executing untrusted payloads.

The manual `Diagnostic sandbox release gate` workflow requires an **ephemeral, one-job self-hosted VM**, the `ephemeral-diagnostic-sandbox` label and the protected `diagnostic-sandbox-review` environment. Configure required reviewers and a VM provisioner that enforces destruction regardless of job outcome before registering this runner. Do not attach the label to a developer computer, production host or persistent shared CI runner. Checkout credentials are not persisted; only the reviewed source bundle crosses into the sandbox. No secrets or output artifacts are uploaded.

On that VM, set `RUNNER_DISPOSABLE_VM=true`, `RUNNER_TEST_IMAGE=<reviewed digest>` and `RUNNER_TEST_LOCK_SHA256=<reviewed lock digest>`, then run `npm run test:diagnostic-isolation`. The suite fails, rather than silently skipping, without real preflight. It runs actual metadata/private/public network and DNS probes, filesystem/symlink/socket/credential probes and subprocesses; process, memory, disk, timeout and output exhaustion; untrusted prompt/sensitive markers; and a seeded synthetic regression that fails before correction and passes after. It takes at least five minutes because the real timeout is exercised. Only trusted tests launch these payloads, and only within gVisor. Passing assertions based solely on flags/mocks is insufficient.

Rollback: disable `DIAGNOSTIC_RUNNER_ENABLED`, revoke pending execution grants and phase 5 case capabilities, destroy active VMs/containers and remove short-lived credentials. Preserve content-free audit receipts and phase 6 diagnoses. No application rollback or database migration is needed. Production use remains disabled pending real isolation evidence and separate production data/model-processing approval.
