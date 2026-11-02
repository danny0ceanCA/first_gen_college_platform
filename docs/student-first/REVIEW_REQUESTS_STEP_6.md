# Structured review requests — Phase 1, step 6

Step 6 provides a repeatable release verification command and CI job for the complete structured-request workflow. It extends the read-only database readiness check to the request, voice-consent and coordinator-delivery capabilities. It does not enable production flags or certify a deployed identity provider or physical audio device.

## Local verification result

The full verifier passed on November 1, 2026: **160 selected server/client tests, 7 operational tests and 31 browser journeys**, with no failures, skips, cancellations or TODO tests. TypeScript, logging policy and the isolated production bundle build passed; existing bundle-size warnings remain. The source fingerprint was unchanged throughout the run. Desktop and mobile receipt screenshots were inspected, and `git diff --check` passed.

The [saved verification report](REVIEW_REQUESTS_STEP_6_VERIFICATION.json) contains the exact fingerprint and per-suite counts. Detailed local evidence is in `/tmp/origen-review-step6-verification-1`. This run used Node 24.19, local PostgreSQL 17 and system Chromium 154 with Playwright 1.57. CI is configured for Node 22, PostgreSQL 18 and Playwright's installed Chromium; the GitHub job has not been run from this workspace. No production migration, deployment, commit, push or pull request was performed.

## Run the release check

Install the locked dependencies with `npm ci`, then install the test browser with `npx playwright install --with-deps chromium`. Supply `DATABASE_TEST_URL` for a dedicated disposable PostgreSQL cluster on loopback. The test login must be able to create temporary schemas and roles; do not use the application database.

```sh
npm run review-requests:verify -- --disposable-database --output /tmp/origen-review-verification
```

Use a new output directory for each run. In this cloud environment, the existing local PostgreSQL wrapper supplies the isolated database and strips application credentials:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env \
  ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium \
  npm run review-requests:verify -- \
  --disposable-database --output /tmp/origen-review-verification
```

The runner inherits only essential execution settings and an explicitly selected browser, then injects the disposable database URL into test-only variables. It excludes application database URLs, AI keys, Auth0 configuration and production feature flags. Its own Vite preview and bundle build disable dotenv and application API middleware. Browser fixtures intercept application requests and block external traffic.

The command runs request and adjacent lifecycle/voice tests, evidence-checker tests, logging policy, TypeScript, an isolated production bundle build, and four browser suites. It starts and stops its own local preview. It writes a source fingerprint, per-suite logs, screenshots and `verification.json`. The fingerprint includes migrations, runtime code, dependencies, deployment defaults and CI configuration. An incomplete, failed, skipped, cancelled or empty test run, missing browser journey, or source change during verification cannot pass. The report explicitly separates local success from unperformed deployed checks.

## Complete workflow coverage

The new browser matrix has 12 journeys: English and Spanish, desktop and mobile, using notebook approval, Realtime voice and Live voice. Each starts in the actual student binder, approves an exact selection, delivers it through the real HTTP/PostgreSQL path, opens it in the existing coordinator workspace, records review and a structured response, reloads the student's binder, opens the response notification, withdraws the request and deletes it. Deletion must also remove the stored coordinator response.

Both voice journeys use the real `ProfileVoice` integration, authorization/session API, client consent bridge and provider adapter. Provider negotiation, transcript events, microphone samples and playback are synthetic. The Live case exercises continuous transcription, delegated tools and the playback-idle boundary. This verifies application handling, not real speech recognition, audibility or human comprehension.

The other browser suites retain approval/retry/expiry/privacy cases, lost response recovery and concurrent editing, and the existing coordinator navigation, draft guards, mobile menus and denied-access behavior. Database tests verify rollout dependency rejection, missing migration/command access, held response notifications, resumed delivery, owner withdrawal while all request flags are off, and response deletion with the student.

CI runs the same command using PostgreSQL 18, Node 22 and the pinned Playwright browser. It uploads the evidence even when verification fails. The job contains no application/provider credentials.

## Deployment verification and enablement

1. Complete the local verifier for the intended source. Keep its report and logs with the release record. The three request flags remain false in `render.yaml`.
2. Apply migrations through `099_review_request_delivery.sql` with the existing separate migration credential, and refresh restricted runtime grants. Keep migration credentials out of the running API. Use the existing runtime and maintenance database roles; no additional paid database or service is needed.
3. Run `npm run coordinator:readiness -- database --output <new-report.json>` with the intended deployment's runtime and maintenance configuration. This is read-only. It now checks all three request capabilities even while their flags are off, along with migration checksums, role isolation and existing coordinator capabilities.
4. Validate deployed sign-in and staff verification with synthetic student/coordinator accounts. Run an approved question from notebook and voice through coordinator response on desktop and a physical mobile device, in English and Spanish. Check both selected voice providers, interruption during readback, declined approval, inaudible/blocked playback and a changed selected note. Record what actually ran; synthetic browser evidence does not satisfy these device/provider checks.
5. Enable `ORIGEN_REVIEW_REQUESTS` and `ORIGEN_REVIEW_REQUEST_DELIVERY` only when the deployment and coordinator viewing prerequisites are ready. Enable `ORIGEN_REVIEW_REQUEST_VOICE` after the actual voice path has been checked. Existing valid approvals waiting in the queue can then be delivered; changed, revoked or expired approvals fail the fresh access check.
6. Verify one in-app delivery using the existing maintenance worker and confirm that the student's receipt distinguishes delivery, opening, review and response. None records a successful student outcome.

Production enablement was not performed by this implementation. The local command cannot establish deployed Auth0 behavior, real-device audio behavior or the deployed worker/database configuration. Those remain explicit release checks, not a reason to buy another test database.

## Pause and recovery

For a request-specific incident, set `ORIGEN_REVIEW_REQUEST_DELIVERY=false`, `ORIGEN_REVIEW_REQUEST_VOICE=false` and `ORIGEN_REVIEW_REQUESTS=false` in the affected deployment. Staff request reads/responses and new approvals stop; student history, withdrawal and deletion remain available. Queued delivery stays held. Response withdrawal remains authorized through its scoped command for the original active coordinator.

Do not roll back migrations or restore an older database to disable the feature. Use the existing privacy restore procedure when an actual restore is needed: replay current deletion evidence, scrub outdated/withdrawn response content, revoke restored request access and clear pending voice consent before serving traffic. The existing automated restore tests are included in the release verifier.

Phase 1 supplies structured consent, delivery, coordinator response and truthful receipts. Automatic follow-up conversations, student action/outcome collection, consent to share those outcomes, and a recommendation algorithm remain later phases.
