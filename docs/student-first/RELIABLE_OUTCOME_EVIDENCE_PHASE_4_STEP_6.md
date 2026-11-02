# Phase 4, step 6 — Connected verification and release preparation

This step completes the local release tooling for reliable outcome evidence. Production enablement remains separate. The verifier uses disposable local PostgreSQL, synthetic identities and simulated provider/audio events. It does not deploy, call a hosted voice provider, change production grants or enable either feature flag. No paid database or additional service is required.

## Run the complete verifier

From the repository root, supply a dedicated loopback `DATABASE_TEST_URL` and a new output directory:

```sh
npm run outcome-evidence:verify -- --disposable-database --output /tmp/origen-outcome-release-<new-id>
```

This cloud workspace already has an isolated runner that excludes application credentials:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium npm run outcome-evidence:verify -- --disposable-database --output /tmp/origen-outcome-release-<new-id>
```

The previous request, response and follow-up verifier commands remain aliases of the expanded verifier. CI runs the same command with Node 22, PostgreSQL 18 and Playwright Chromium, with a 45-minute job budget and uploaded artifacts. Local results record their actual toolchain and do not certify a remote CI run.

The runner rejects remote test databases, strips application/provider/Vite/injected Node settings, and creates disposable schemas and restricted database roles. Its Vite server uses an ephemeral loopback port, ignores dotenv files and stops on completion. Logs and screenshots contain synthetic fixture content; `verification.json` contains only source hashes, versions, counts, completeness flags and named external checks. The output directory is never reused. Browser suites run with two bounded workers; each owns its disposable records and browser contexts.

## One connected evidence journey

The existing Phase 3 browser journey has an outcome-evidence mode, reusing the actual binder, ProfileVoice, Live/Realtime adapters, coordinator workspace and scoped HTTP/PostgreSQL handlers. It checks all twelve ordered stages in English and Spanish at 1280, 390 and 320 pixels, for both transports:

1. Accept a coordinator-linked action without changing its progress implicitly.
2. Hear a private-update readback and explicitly approve the report.
3. Request a specific outcome using an exact report version. A transcript-only outcome readback followed by “yes” must not save it.
4. Hear the complete outcome readback and approve the private outcome. An unknown event date stays unknown.
5. Separately request and approve the exact selected disclosure, including institution, term and process, for coordinator review.
6. Publish a coordinator-declared record check through the existing coordinator form. The reviewer also authored the advice; that relationship remains explicit.
7. Show the attributed observation in the student's request and the private assessment in the action card. Matching wording does not join private and shared evidence.
8. Open the exact source response in voice and verify its current, guarded assessment. A broader search that matches multiple responses asks for clarification rather than combining advice.
9. Decline evaluation without losing the ongoing conversation or coordinator support. No evaluation permission is inferred from saving, sharing or requesting evidence review.
10. Pause evidence/evaluation creation and correct the canonical private update. The previous private evidence link is invalidated; the separately approved coordinator snapshot is preserved.
11. Resume with fresh source context.
12. Change the original source response and confirm that active voice context becomes unavailable while the accepted action remains.

The matrix validator rejects duplicate combinations, missing stages, omitted narrow layouts or a falsely successful partial run. All earlier Phase 1–3 browser and contract suites remain mandatory. Focused outcome/evaluation browser suites separately cover interrupted saves, offline recovery, disagreement visibility, exact revisions and flag-off withdrawal.

## Definition and lifecycle coverage

`server/fixtures/outcome-release-cases.mjs` contains 26 hand-authored engineering reference cases with explicit expected states, supported-claim counts and reason codes. `review-outcome-definitions.mjs` compares them with the deterministic rules and emits a content-free disagreement list. A mismatch fails the release report; it is not silently relabeled to match the implementation.

The cases distinguish ordinary reports, no answer, explicit declines, unknown/pending results, changed goals, same-event contradictions, later events, unknown timing, different terms/time zones, dependent or duplicate sources, stale/expired evidence, changed definitions, incomplete lookups, advice-author observations, student disagreements, unsuitable record types and a denied decision. Institution-verified truth, causal effect, independence and evaluation authority are never inferred from these cases. Institutional review is explicitly **not performed** by this engineering exercise.

Database/client suites also cover wrong owners/students, stale versions, concurrent corrections, source/role/account changes, permission expiry, muted/interrupted/failed playback, notifications, lookup limits, evaluation exclusion, withdrawal during aggregation, account export, deletion and privacy restore. Release-specific tests verify both feature flags off, compatible pause/resume, private correction while outcome creation is paused, and all scoped readiness checks with rollout flags disabled.

## Release dependencies

Apply migrations through `113_outcome_evaluation_permissions.sql` using the migration identity, then refresh both role profiles with `npm run db:grant-runtime` and `npm run db:grant-maintenance`. Run the existing database/readiness tooling with distinct runtime and maintenance identities. Checks include migration checksums, scoped commands, helper/raw-table denial, existing review/follow-up prerequisites and both outcome capabilities, even when rollout flags are off.

Deploy compatible backend and web code with `ORIGEN_OUTCOME_EVIDENCE=false` and `ORIGEN_OUTCOME_EVALUATION=false`. Existing coordinator request/delivery, response-context, follow-up and personalization gates retain their own requirements. Evidence review requires the separately scoped outcome-review capability; service-quality reporting requires a different reviewer capability and an exact student opt-in. Neither an enabled flag nor an ordinary coordinator role grants either permission.

Before enabling production, record checks against the intended deployed revision and source fingerprint. Enable ordinary outcome recording/assessment only after its identity, device/provider and institutional-process checks are complete. Evaluation remains separately off until its purpose notice, eligible adult opt-in and reviewer authorization have been reviewed. No previous saved/shared record is opted in during rollout.

## Pause and compatible rollback

| Control | Result |
| --- | --- |
| `ORIGEN_OUTCOME_EVIDENCE=false` | Stops new structured outcome proposals/confirmations and new coordinator observations; omits outcome assessments from new voice context and invalidates guarded old context on verification. Permitted history remains readable. |
| Existing private-update correction/removal | Remains available under its own follow-up controls. A canonical correction invalidates linked private outcome evidence. Re-recording structured evidence waits until evidence creation resumes. |
| Existing observation/disagreement withdrawal or removal | Remains available through the authorized scoped controls while new outcome creation is paused. |
| `ORIGEN_OUTCOME_EVALUATION=false` | Stops new evaluation approvals and reports. Owners can inspect and withdraw existing evaluation permissions. |
| Existing request/disclosure controls | Continue to govern already approved shared copies. Pausing evidence or evaluation does not retract a publication. Use explicit withdrawal/revocation when needed. |

Keep the compatible schema and privacy guards during rollback. A supported rollback is a compatible application with new work paused; dropping tables, restoring old approval rows or running an incompatible old binary is not a feature-disable mechanism. Already disclosed information cannot be recalled from a person or provider by changing a flag.

For a database restore, keep traffic disabled. Replay current, separately preserved deletion evidence and revision fences through the existing privacy-recovery process before serving any restored records. Its outcome hooks invalidate evidence/observations and revoke **all** restored evaluation permissions and reviewer capabilities. They clear outstanding previews; legacy manifests cannot revive approval. Rerun migration/grant/isolation readiness and verify erased/corrected synthetic records stay unavailable before reopening traffic. Backup export itself is read-only.

## Operational monitoring

Use the existing bounded endpoint/status/duration telemetry for outcome recording, observation, evaluation and voice-context operations. Watch rising unavailable/conflict/timeout responses, repeated permission/source invalidations, lookup overflows and delayed deletion/restore processing. These identify reliability problems, not student success rates. Review aggregate quality output only through separately authorized reporting; small groups remain suppressed.

Do not put report wording, conversations, identifiers, selected quotations, assessment source bundles or consent payloads into logs or notifications. A failed source check should end or refresh the stale context. An uncertain save should direct the student to check current binder state, without automatically retrying a write. Keep the release source fingerprint alongside deployment/version metadata when investigating failures.

## External checks remain separate

The local report explicitly leaves these checks unperformed:

- Actual deployed authentication, student scope, staff verification, membership and revocation.
- Physical desktop/mobile listening for Live and Realtime in both languages: real audio output, headphones, mute, interruption, backgrounding/locking and reconnects.
- Institutional review of the initial definitions and the actual financial-aid/insurance processes they describe. A declared record check is not authenticated institutional evidence.
- Deployment runtime/maintenance separation, migration configuration and a privacy-recovery rehearsal in the deployment environment.
- Review of the evaluation purpose/notice and authorization of service-quality reviewers. Ordinary guidance and guardian permission are not evaluation consent.

Synthetic provider events establish application enforcement. They do not establish provider accuracy, physical audibility, comprehension, institutional truth or effectiveness. A passing local report does not enable production.

## Verification evidence

The [saved verification report](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_6_VERIFICATION.json) passed on November 2, 2026. The complete command ran from `2026-11-02T05:32:41.746Z` to `2026-11-02T05:51:50.308Z` against disposable local PostgreSQL. The source fingerprint stayed unchanged throughout the run and was checked again before saving the report.

- **499 automated tests passed:** 486 server/client tests and 13 operational tests, with zero failures, skips, cancellations or todos.
- **111 browser journeys passed across 15 suites**, including all twelve connected outcome combinations in English/Spanish, Live/Realtime and 1280/390/320-pixel layouts.
- **26 engineering reference cases matched**, with zero disagreements. Institutional review remains unperformed.
- Type checking, the production bundle and logging-policy checks passed. The build also reported a non-blocking advisory about large bundles.

Actual local toolchain: Node `v24.19.0`, PostgreSQL `17.11 (Debian 17.11-0+deb13u1)`, Playwright `1.57.0` and Chromium `154.0.8037.57`. This differs from the configured CI toolchain; no remote CI run is claimed.

Source fingerprint: `15cec32682bc7efec385d47f2ed1b0b2091184a197e53acc7563e3f0d30926cf`.

Raw synthetic logs, screenshots and per-suite results are in `/tmp/origen-outcome-phase4-release-1`. Only the content-free aggregate report is saved in the repository. Earlier step reports remain evidence for their earlier source snapshots. Both production flags remain default-off; the five external checks listed above are not certified by this local result.

The regression run also corrected a test fixture's daylight-saving assumption: a previous local calendar date must not be represented as exactly 24 hours earlier on a 25-hour day. Application scheduling behavior was unchanged.
