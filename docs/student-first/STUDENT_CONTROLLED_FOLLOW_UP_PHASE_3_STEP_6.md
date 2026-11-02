# Phase 3, step 6 — Connected verification and release preparation

This step completes local verification and release tooling for student-controlled follow-up. Production rollout is separate. The backend capability remains default-off, and no production migration, provider call, deployment, remote CI run or feature enablement is performed by the verifier.

## Connected release check

Run the complete verifier from the repository root against a disposable loopback PostgreSQL database:

```sh
npm run student-follow-up:verify -- --disposable-database --output /tmp/origen-follow-up-release-<new-id>
```

In this cloud workspace, the existing isolated runner supplies the local database and excludes application credentials:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium npm run student-follow-up:verify -- --disposable-database --output /tmp/origen-follow-up-release-<new-id>
```

The output directory must be new. The verifier rejects non-loopback test databases and strips application, provider, Vite and injected Node configuration from child processes. Tests create disposable schemas and restricted roles. The Vite test server binds to loopback, ignores dotenv files and stops when verification finishes. No new database service, Redis, vector database or scheduler is required.

`review-responses:verify` and `review-requests:verify` remain aliases of the expanded verifier. CI runs the same command on Node 22, PostgreSQL 18 and installed Playwright Chromium, uploads the evidence directory, and allows 30 minutes for the expanded coverage. Local execution records its actual toolchain in the report; it does not certify the remote CI run.

The new `student-follow-up-release-smoke.cjs` uses the actual binder, ProfileVoice, Live/Realtime adapters, coordinator workspace, scoped handlers and PostgreSQL. Authentication, microphone, provider events and output samples are synthetic. An accepted response-linked action is established through the scoped plan repository with explicit synthetic approval. Each journey then exercises:

1. The student chooses and confirms one check-in in the binder.
2. A new focused conversation selects the eligible check-in, and the actual playback controller records complete presentation.
3. An ordinary answer does not save a report or notify a coordinator.
4. An explicit private-save request, exact readback and immediately following approval create the private report. The reported contact can be complete while the reported issue remains pending; task progress changes only if separately selected.
5. Reconnection retains the conversation's spent opening allowance. The student separately requests sharing selected wording with the original coordinator.
6. A complete sharing readback and new approval create one update snapshot. Private helpfulness, plan notes and unselected report facts stay out of the coordinator view.
7. The coordinator receives and responds through the existing workspace. The student sees the response in the binder.
8. Reopening the original response binds current advice; an edit to that source invalidates the active response context and shared update while preserving the accepted private action.

All eight stages must pass in order for Live and Realtime, English and Spanish, at 1280, 390 and 320 pixel widths: 12 complete journeys. The evidence validator rejects missing stages, duplicate combinations, missing narrow layouts, incorrect isolation declarations and false success flags.

Older connected request/response browser fixtures now provide synthetic nonzero output samples followed by silence. An idle silent stream is insufficient under the current Live playback checks. Production audio checks remain intact; this fixture change makes the test model audio delivery explicitly. It is not proof of physical audibility or student attention.

The connected response fixture also routes follow-up requests through the real scoped handlers, including their disabled-state contracts. Its previous generic mock omitted the private-report collection and caused a render failure when saving an action mounted the new controls.

## Coverage and privacy boundaries

| Requirement | Automated coverage |
| --- | --- |
| Separate permission to follow up, save privately and share | Foundation/conversation/shared-update database suites; new connected browser journey |
| Silent, declined or unrelated answers | Opening and private-report suites; no automatic report or outcome inference |
| Competing openings, multiple devices, reconnects and guide changes | Conversation-opening selection/claim tests and browser reconnect assertion |
| Muted, interrupted, partial, forced or unverified playback | Opening, follow-up, review-request and Live playback/controller suites |
| Local date, date-line and daylight-saving changes | Saved-zone selection tests and bilingual tomorrow requests around spring/fall transitions |
| Offline and uncertain saves, edits and correction | Existing private-update and shared-update browser journeys; idempotency and concurrent correction tests |
| Action edits, completion, archive, deletion and source changes | Foundation, opening, conversation, linked-request and connected browser tests |
| Ownership, role, membership, permission and account changes | Scoped database tests, account lifecycle, browser privacy controls and startup/readiness checks |
| Pause, cancellation, export, deletion and restore | Follow-up controls, account lifecycle, privacy recovery, grants and operational suites |
| No disclosure to coordinators, notifications or operator aggregation without approval | Restricted-table and projection tests, snapshot/queue checks, progress-report assertions and production logging policy |
| Existing binder/coordinator workflows | All earlier review-request, delivery, navigation, connected-response, clarification, private-update and check-in browser checks |

The verification report uses kind `student-follow-up-local-verification`, schema version 1. It contains counts, booleans, source fingerprint, timestamps, toolchain versions and external-check names, with no conversation, update wording, student/account identifiers or credentials. The earlier Phase 1/2 report formats describe their historical runs; all three current command aliases emit the expanded Phase 3 report. This is separate from the coordinator readiness command's older pilot assessment artifact. Detailed logs and screenshots use synthetic fixtures only. Reported action, reported outcome, unknown/declined answers, delivery and coordinator response remain distinct facts. No causal-success metric, coordinator ranking or cross-student training is introduced.

## Deployment sequence

1. Run the expanded verifier against the exact source intended for release. Retain the content-free report and its source fingerprint. Any subsequent executable source, migration, dependency or CI change requires renewed evidence for that source.
2. Keep `ORIGEN_STUDENT_FOLLOW_UP=false`. Apply migrations through `108_student_shared_updates.sql` using the separate migration credential, then refresh restricted runtime/maintenance grants. The API must never receive migration-owner credentials. No additional hosted database is needed.
3. Run the existing read-only `npm run coordinator:readiness -- database --output <new-report.json>` against the intended deployment configuration. Require all migration checksums, separate runtime/maintenance roles, scoped grants and flag dependencies. Follow-up readiness requires migrations 104–108 and the four existing scoped commands; local fixture success does not verify a deployed database.
4. Verify sign-in and student ownership with designated student accounts, and accepted connections, institution membership, staff verification and coordinator access with designated staff accounts. Confirm the existing maintenance worker delivers approved snapshots once and removes withdrawn/inaccessible items.
5. Complete the external listening/device matrix below and record the result for this build. Resolve failures before enabling.
6. Enable the capability only through the deployment's approved configuration. Required prerequisites include existing coordinator sharing and review-request access, response context and an eligible personalization retrieval cohort. Voice private writes also require live writes. Coordinator update sharing additionally requires delivery; spoken sharing requires review-request voice. Do not enable unrelated capabilities to satisfy a checklist.

## Pause, cancellation and rollback

Set `ORIGEN_STUDENT_FOLLOW_UP=false` to stop new enrollment, follow-up selection, private report preparation/confirmation and student-update preparation/approval. Saved history, private report deletion, request withdrawal/deletion and check-in stop controls remain available. Active follow-up verification fails closed on the next check; unavailable freshness checks do not authorize continuing with stale content. Disabling a feature cannot retract information already sent to a provider or already seen by a person.

Existing approved coordinator disclosures retain their own access and delivery policy. To hold request delivery across the queue, use `ORIGEN_REVIEW_REQUEST_DELIVERY=false`. To remove a published copy, use request withdrawal or the existing sharing/connection revocation controls. A queue hold is not retroactive revocation. Cancelling a check-in does not undo a separately approved shared update.

For rollback, keep the compatible application running with flags paused. Do not drop migrations, clear private actions/reports, or restore an old database merely to disable the feature. An older binary that cannot read the schema is not a compatible rollback. For a genuine restore, use the established privacy recovery process: replay current deletion evidence and report-version fences, revoke restored sharing, detach response references, stop restored check-ins, discard opening claims/private proposals/voice consent, and rerun readiness before serving traffic. Restore must not revive consent or resurrect deleted/corrected reports.

## External checks required before production enablement

These checks are separate from local automated evidence:

- **Deployed identity and access:** actual authentication, student scope, membership, staff verification, disconnect/revocation and account switching.
- **Provider listening:** both Live and Realtime in English/Spanish. Listen for exact check-in and consent disclosures, preserved uncertainty, the distinction between a private save and sharing, no repeated offer after “not now,” and no claim that a pending outcome is resolved.
- **Physical desktop/mobile audio:** test actual sound output, headphones, muted volume, interrupted playback, backgrounding/locking, reconnects and connectivity loss. Record provider, device/browser, language, build and pass/fail without retaining private speech.
- **Deployed infrastructure:** runtime/maintenance role separation, migrations/grants, maintenance delivery, pause/queue hold and privacy recovery rehearsal.

Synthetic model events verify application enforcement. They do not measure model quality, physical-device audibility, student comprehension or institutional outcomes. Local completion does not approve or enable production rollout.

## Verification evidence

The [saved verification report](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_6_VERIFICATION.json) passed on November 2, 2026 at 01:44:44 UTC:

- **370 server/client tests and 9 operational tests passed**, with zero failures, skips, cancellations or TODO cases.
- **81 browser checks passed** across 11 suites, including all 12 complete Phase 3 journeys, the 8 connected Phase 2 journeys and earlier request, notebook, delivery, navigation, choice, clarification, check-in, private-update and sharing checks.
- TypeScript, the isolated production build and logging policy checks passed. The build retains the existing large-bundle size advisory.
- The executable source fingerprint was unchanged throughout the run and matched the working tree when the report was saved: `e917456fb9804a98f3e32d35b2c4f5c6d2d7c0b202a2371a8c70f34626a60762`.
- Local toolchain: Node 24.19.0, PostgreSQL 17.11, Playwright 1.57.0 and Chromium 154.0.8037.57. CI is configured separately for Node 22 and PostgreSQL 18; remote CI was not run here.

The final local evidence directory is `/tmp/origen-followup-step6-verification-2`; it contains synthetic logs, screenshots and per-suite records. The earlier failing run remains separate: its obsolete connected-response fixture was repaired as described above, then the complete verifier was rerun against the final source. Earlier Phase 1/2 and Phase 3 step reports describe their earlier source snapshots.

Production configuration and data were not changed. The external identity, provider/device and deployment checks listed above remain unperformed; the passing local report does not enable the feature or certify those checks.
