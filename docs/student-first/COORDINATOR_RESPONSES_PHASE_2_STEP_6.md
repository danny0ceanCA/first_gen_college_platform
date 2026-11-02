# Connected coordinator responses — Phase 2, step 6

Step 6 extends the existing release verifier and CI with connected coordinator responses. The feature remains paused by `ORIGEN_REVIEW_RESPONSE_CONTEXT=false`; this implementation does not deploy, migrate a production database or enable production features.

## Repeatable release verification

```sh
npm run review-responses:verify -- --disposable-database --output /tmp/origen-response-verification
```

Use a new output directory and an explicit `DATABASE_TEST_URL` pointing to a dedicated disposable PostgreSQL instance on loopback. The database login needs permission to create temporary schemas and roles. Install the locked dependencies and Playwright Chromium before running. The existing `review-requests:verify` command now runs the same expanded verifier.

This cloud environment already has a free local PostgreSQL instance and a wrapper that excludes application credentials:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env \
  ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium \
  npm run review-responses:verify -- \
  --disposable-database --output /tmp/origen-response-verification
```

The verifier removes inherited application URLs, provider keys, Auth0 configuration, feature flags and Node injection options. Its Vite preview and build disable configuration-file and dotenv loading. Tests use disposable schemas and synthetic identities, provider negotiation, microphone samples, transcripts and playback events. No paid provider calls or additional database service are required.

`verification.json` is content-free and records a source fingerprint, exact test counts, browser matrix counts, build/logging results, source stability and checks not performed. The report uses kind `review-response-local-verification`, schema version 2. It is not the separate coordinator readiness command's older `coordinator-local-verification` artifact. Skipped, cancelled, TODO, empty or incomplete suites cannot pass. Browser evidence must include each required combination exactly once. CI retains the same job identifier and uploads evidence on failure as well as success.

## What is exercised

The connected browser suite uses actual PostgreSQL, scoped request handlers, the binder, ProfileVoice, both provider adapters and the existing coordinator workspace. Eight journeys cover English/Spanish × desktop/mobile × Live/Realtime:

1. Open a delivered coordinator response and choose **Talk about this**. Verify the exact response and application-owned attribution/uncertainty instructions reach the voice configuration and recall tool.
2. Ask to save a private next step. Verify nothing is saved before the complete audible readback and the subsequent explicit approval. Verify the intentional conversation reconnect loads the updated memory.
3. Confirm that private discussion and action acceptance leave the coordinator's record unchanged.
4. Separately ask the coordinator a clarification. Verify the complete readback includes the earlier approved question and reference, and only a subsequent explicit approval queues delivery. No private action or conversation is included.
5. Open that request in the existing coordinator workspace, share a response and verify it appears in the student’s binder.
6. Edit the original source during the call. Verify the call closes, dependent coordinator access is removed, and the student's accepted private action survives without a stale source link.

The verifier also retains the 31 Phase 1 browser checks and adds 12 private-choice/follow-up component journeys, including 320px screens. Those component journeys use synthetic HTTP responses; the connected suite uses real local database boundaries. Existing backend/client suites cover ambiguous matching and recipients, response edits between preview and approval, expired or revoked permissions, interrupted/muted readback, network failure, retries, deferral, account changes, exports, deletion and restore. Readiness now explicitly rehearses missing response-context/choice grants and migration 103, including while deployment flags are off.

These checks establish application context delivery, consent enforcement and privacy boundaries. They do not establish whether a real model explains advice accurately, whether real speech is intelligible, or whether students understand it. No student outcome or recommendation algorithm is inferred from saving an action.

## Deployment, pause and recovery

1. Run the verifier against the intended source and retain its report. Keep the Phase 2 capability off while completing deployment checks.
2. Apply migrations through `103_review_response_followups.sql` using the separate migration credential, then refresh the restricted runtime grants. Do not expose the migration credential to the API or add another database service.
3. Run `npm run coordinator:readiness -- database --output <new-report.json>` with the intended runtime/maintenance configuration. Check migration checksums, separate database roles, scoped function grants and all feature dependencies. This is a read-only check; local fixture success does not prove the deployed configuration.
4. Verify actual sign-in, student/coordinator ownership and staff verification with designated test accounts. Check the existing maintenance worker's delivery and removal behavior.
5. Before enablement, rehearse Live and Realtime in English and Spanish on desktop and physical mobile devices. Listen for coordinator attribution, preserved uncertainty, separation of advice from official facts, interruption handling, inaudible playback, private action consent, separately approved sharing and source changes during a call. Include backgrounding, connectivity loss and account switching. Record provider, device, language, build and results without storing private conversation content.
6. Enable the existing coordinator/request prerequisites only under the deployment's approved configuration. Enable `ORIGEN_REVIEW_RESPONSE_CONTEXT=true` after the checks above. Voice explanation also requires eligible personalization retrieval; linked sharing requires request delivery, and spoken approval requires request voice. Do not force unrelated capabilities on merely to pass a check.

To pause response assistance, set `ORIGEN_REVIEW_RESPONSE_CONTEXT=false` and restart/reload the affected deployment's configuration. New AI retrieval, response-linked choices and linked clarification preparation stop. A loaded response guard invalidates on its next successful server check; an unreachable check ends the affected call. Binder history, private accepted action wording, withdrawal and deletion remain available. This does not erase context already sent to a provider.

The Phase 2 switch is not a queue-wide delivery stop: already approved valid requests still follow Phase 1 delivery policy. To hold coordinator request delivery as well, set `ORIGEN_REVIEW_REQUEST_DELIVERY=false`; to suspend new request approvals and voice preparation use the existing Phase 1 request/voice switches. History and privacy controls remain accessible while paused.

Prefer the compatible application with flags paused over an old binary that cannot read the new schema. Do not drop migrations, remove accepted actions or restore an older database merely to disable the feature. If an actual restore is required, follow the existing privacy recovery procedure: replay current deletion evidence, detach response references and linked requests, revoke restored shared access and clear pending voice consent before serving traffic. Rerun readiness and release verification before reenabling.

## Verification evidence

The complete verifier passed on November 1, 2026: **239 selected server/client tests, 8 operational tests and 51 browser checks**, with no failures, skips, cancellations or TODO tests. TypeScript, the isolated production build and logging-policy checks passed. The existing bundle-size warning remains. The source fingerprint stayed unchanged throughout the run. Desktop and Spanish mobile screenshots were inspected, and `git diff --check` passed.

The [saved verification report](COORDINATOR_RESPONSES_PHASE_2_STEP_6_VERIFICATION.json) records the fingerprint and exact counts. Detailed local evidence is in `/tmp/origen-response-step6-verification-2`. Local verification used Node 24.19, PostgreSQL 17 and Chromium 154 with Playwright 1.57; CI is configured for Node 22, PostgreSQL 18 and Playwright's installed Chromium.

Deployed authentication, production worker/database configuration, real-provider listening and physical-device audio checks remain external release checks. GitHub CI configuration is included; the remote workflow has not been run from this workspace. No production migration, deployment, feature enablement, commit, push or pull request was performed.
