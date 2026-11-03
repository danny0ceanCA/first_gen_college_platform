# Phase 5, step 6 — Connected verification and release preparation

This step adds the complete recommendation journey to the existing local release verifier, a closed aggregate evidence contract and the deployment/pause guide below. It uses disposable PostgreSQL schemas, synthetic accounts and simulated provider/audio events. It does not migrate production, publish real templates, grant production capabilities, call hosted voice providers or enable either recommendation flag.

## Reproduce the local verification

With a dedicated loopback `DATABASE_TEST_URL`, installed dependencies and Playwright Chromium:

```sh
npm run recommendations:verify -- --disposable-database --output /tmp/origen-recommendations-release-<new-id>
```

In this configured cloud workspace, the existing isolated wrapper excludes injected application/provider credentials:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium npm run recommendations:verify -- --disposable-database --output /tmp/origen-recommendations-release-<new-id>
```

The verifier itself also strips application secrets, provider switches and injected Node/Vite configuration, rejects remote database URLs, disables dotenv loading and owns an ephemeral loopback preview. It never overwrites an evidence directory. Each fixture owns its disposable schema and restricted runtime role. All browser groups share two workers, with the longer connected journeys started first; the added coverage does not increase browser concurrency. A local database is sufficient; an additional paid database is unnecessary.

`recommendation-verification.json` is the Phase 5 acceptance artifact. It embeds the earlier Phase 1–4 verification, records the same exact source fingerprint and time window, requires the full Node/PostgreSQL/Playwright/Chromium versions, zero skipped/failed/cancelled/todo tests, exact browser counts, fixed policy/reference versions and explicit external checks. `verification.json` retains the previous outcome-evidence format for existing readers. The process fails if either contract fails. Logs and screenshots contain synthetic test content; aggregate acceptance artifacts exclude student content and identities.

CI runs this same `recommendations:verify` command and uploads `recommendations-release-evidence`, including both acceptance artifacts, logs and screenshots. Its Node 22/PostgreSQL 18/Playwright environment is distinct from the locally recorded toolchain. A local pass does not certify that remote CI has run.

## Connected journey and coverage

The new `--recommendation-evidence` mode extends the existing outcome journey, using actual binder and coordinator components, both ProfileVoice transports, scoped handlers and real local PostgreSQL. Each of 12 combinations (English/Spanish × 1280/390/320 pixels × Live/Realtime) checks:

1. Independently author and publish a bilingual reusable template under scoped operator grants. Resolve an eligible general question without creating evaluation receipts before permission.
2. Opt into prospective recommendation evaluation through the binder's exact preview and initially unchecked approval. Earlier selection activity remains excluded.
3. Open the student's own coordinator response, review the guarded suggestion and explicitly accept its exact attributed wording. Save one canonical action with both exact source relationships; observe display separately from acceptance.
4. Choose a check-in, consume its audible opening once, and save a private report only after a separate complete readback and approval. An ordinary conversational answer saves nothing.
5. Request and approve an outcome with the disclosed recommendation relationship. Reject a transcript-only readback. Resolve only the exact typed link; the single-account organization report remains suppressed.
6. Separately approve a coordinator disclosure and record an attributed coordinator observation through the existing workspace. Private and shared evidence remain separate even when wording matches.
7. Correct the private report while outcome creation is paused. Its old outcome stops contributing to recommendation evaluation; the separately approved shared snapshot remains intact.
8. Withdraw recommendation evaluation while collection is paused. Delete receipts without changing the accepted action or interrupting ordinary guidance. A subsequent source change invalidates guarded voice context while preserving the student's action.

This journey combines a template eligibility check with acceptance of an exact private coordinator-response recommendation. These are deliberately distinct sources: general template actions do not acquire a coordinator relationship or become eligible for coordinator follow-up by implication. The separate acceptance suite tests actual general-template acceptance through binder, Live and Realtime.

Required Phase 5 browser groups are library authoring (3), binder/voice acceptance (18), evaluation permission (6), and the connected journey (12): **39 journeys**, in addition to **111 Phase 1–4 journeys**. Matrix validators reject omitted or duplicate combinations, missing stages and weakened approval/source checks.

The combined server/client/operations suites cover wrong account/student/organization, scoped grants, conflicting or missing context, unavailable research, expired/revoked sources, deferred/completed work, prompt-injection boundaries, canonical save retries, independent speech approval, partial/muted/interrupted playback, extra openings, role/connection changes, deletion and privacy restore. Focused browser groups exercise offline/lost-save recovery and concurrent library edits. Synthetic playback validates application decisions, not real acoustics or provider behavior.

## Integration corrections

The connected journey exposed a real acceptance/follow-up mismatch: recommendation actions used the generic title “My next step,” while spoken follow-up resolves the actual saved action title. Asking to update the recommended action by its wording could therefore require clarification despite an exact action match. Acceptance now uses a bounded verbatim prefix as the action title and preserves the full accepted wording. English and Spanish regression tests demonstrate that the spoken action resolves correctly and still cannot save a report without its own readback and approval.

Older browser fixtures also exposed a malformed-response weakness in the optional evaluation control: it could schedule a React state update using missing organization data and take down the binder. The control now validates the current-permission response before updating state. All six permission browser journeys first inject a malformed successful response, verify that the recommendation interface stays available, and then recover on a fresh load. Existing fixtures now return the explicit disabled capability contracts, and the shared real-database fixture routes the recommendation handler. The older mobile request journey now waits for either the topic navigation or loaded updates before choosing its navigation path, avoiding a false failure while notifications are loading.

## Frozen policy and acceptance budgets

The active reviewed rule policy remains `evidence-informed-v1`; library/recommendation/evaluation contracts are version 1 and outcome acceptance negotiates `recommendation-provenance-v1`. Migrations are required through 120. There are no online learned weights or automatic promotion.

The verifier requires 32 synthetic policy cases, 6 comparisons with the existing binder ranker, and the independent comparison's 32 development / 16 held-out cases. Students and timestamps are separated at `2026-11-03T00:00:00Z`; each partition is evaluated at its own case time. Reference inputs, expected behavior and budgets are frozen under SHA-256 `bcedc20720df937043bddb1900ba23dc083ad7855b3e2566be6faed0be283bd2`. Changing the reference requires an explicit versioned review and corresponding verifier/test update.

For both partitions, baseline and candidate must have zero inappropriate actions, source errors, decision disagreements, repetition errors and missing bilingual content, with pure-policy p95 at most 100 ms. These thresholds are checked before interpreting the result. The release command replays the baseline as its candidate, so equivalence is expected and is **not evidence of improvement**. A future reviewed candidate module can be compared separately using `scripts/compare-recommendation-policies.mjs`; its digest and distinct policy version must accompany the review. It cannot replace the baseline-only release record or promote itself.

Selection bounds remain 50 templates, 50 duplicate actions, 8 explicitly selected episodes, 100 evidence rows, a 120 KB snapshot, at most two snapshot reads, a 3-second database statement timeout and a 4-second complete selection budget. Policy-only latency excludes database, network and provider time. A failed or incomplete lookup produces unavailable/clarification behavior, not a fabricated recommendation or failed-student label.

## Deployment dependencies and grants

For a separately authorized release:

1. Keep `ORIGEN_RECOMMENDATIONS=false` and `ORIGEN_RECOMMENDATION_EVALUATION=false`. Apply migrations **114–120 in order** with `MIGRATION_DATABASE_URL`; refresh existing runtime and maintenance roles with `npm run db:grant-runtime` and `npm run db:grant-maintenance`. Run `db:check-runtime`, `db:check-maintenance`, production configuration and coordinator readiness using the intended separated identities.
2. Confirm new raw tables and owner/restore helpers remain denied to runtime. Runtime receives scoped commands only; maintenance receives bounded purge functions. No new long-lived infrastructure service is required.
3. Record the deployed revision/source fingerprint and complete the external checks below. Existing review-request/delivery, response-context, personalization and follow-up prerequisites retain their independent requirements. Recommendation creation additionally requires `ORIGEN_STUDENT_FOLLOW_UP=true`; recommendation evaluation requires `ORIGEN_OUTCOME_EVIDENCE=true`. Flags alone never grant student or reviewer authority.
4. An operator may grant explicitly approved library authors/publishers with `scripts/provision-recommendation-library.mjs <subject> <author,publisher|author|publisher> <process-list> <ISO-expiry|revoke>`. Grants are process scoped and expire within 90 days. Review bilingual meaning, claims, source dates and exclusions before publishing. Coordinator reply access alone cannot publish reusable advice. Never copy private case wording into the shared library.
5. If evaluation is separately approved, use `scripts/provision-recommendation-evaluation.mjs <organization-UUID> <reviewer-coordinator-UUID> <ISO-expiry|revoke>` with the owner migration identity. The reviewer capability expires within 90 days and is independent of `service_quality`. Each eligible adult student must still separately opt in for that organization. No backfill is allowed.

Institution-specific recommendations remain withheld: this implementation has no trusted campus/term applicability producer. The initial usable sources are general reviewed questions and the student's exact permitted source revisits. Do not enable institutional requirements by relabeling a saved campus name as verified applicability.

## Pause, rollback and recovery

| Operator action | Expected behavior |
| --- | --- |
| Set `ORIGEN_RECOMMENDATIONS=false` | Stop new selection/acceptance and fail stale recommendation context checks. Keep accepted canonical plans, history and ordinary guidance available. |
| Set `ORIGEN_RECOMMENDATION_EVALUATION=false` | Stop new collection/permission and reporting. Existing owners can inspect and withdraw permission; withdrawal deletes contributions. Guidance does not require evaluation. |
| Revoke a template or its publication capability | Exclude it from fresh selection and reject stale pending acceptance. Accepted student wording survives with historical/unavailable provenance. |
| Revoke an evaluation reviewer | Deny further organization reports without altering students' guidance or coordinator support. |
| Correct or withdraw a private report/outcome | Exclude its stale outcome contribution. Do not rewrite a separately approved coordinator snapshot. |

When pausing a prerequisite, disable its dependent capabilities in the same deployment: pausing outcome evidence also requires recommendation evaluation off; pausing student follow-up also requires recommendation creation off. Startup validates these dependencies.

Rollback means deploy a compatible application with new work paused, retaining migrations, canonical actions, deletion fences and restore hooks. The initial baseline has no prior evidence-informed policy version; its fallback is ordinary guidance with recommendations disabled. Future promoted policies must identify a compatible previous version and rerun the frozen comparison and release verifier before promotion or rollback. Do not drop tables, revive old permissions or deploy a binary that bypasses current privacy contracts.

After a database restore, keep traffic disabled while replaying separately preserved deletion evidence and revision fences through `ops/privacy-recovery.mjs`. The existing hooks unpublish recommendation templates, expire library capabilities, clear pending recommendation approvals/outcome relationships, delete evaluation receipts/previews and withdraw student/reviewer permissions. Preserve the non-personal organization/day report budget. Rerun schema/grant/isolation readiness and synthetic deletion/restore checks before reopening traffic. A restored backup is not permission to collect again.

Unaccepted recommendation previews expire after five minutes, permission previews after ten minutes, and recommendation evaluation permission/receipts after at most 90 days. Expired/invalid contributions are excluded immediately. The hourly maintenance worker inspects up to 1,000 receipts per batch and removes invalid/expired entries; physical deletion can lag with a backlog. Monitor maintenance health and backlog separately from student outcomes. Fixed previous-UTC-month reports allow one successful report per organization/day, require ten distinct accounts in each cell and complement, and suppress insufficient groups. These protections do not establish statistical power or causal effects.

## External release work

The artifact explicitly records these checks as **not performed**:

- Deployed authentication, student scope, staff verification, current membership and revocation.
- Physical Live/Realtime listening and audibility: mute, interruptions, headphones, device locking/backgrounding and reconnects in both languages.
- Institutional review of processes and outcome definitions; actual source claims, applicability, review dates and publication authority.
- Deployment migration/grant isolation, maintenance operation and privacy-restore rehearsal.
- Recommendation-evaluation purpose notice, adult eligibility and reviewer authorization.
- Physical-device accessibility, keyboard/screen-reader operation and bilingual meaning review.

Local results establish application contract behavior. They do not establish improved student outcomes, real-provider speech accuracy, institutional truth or production readiness by themselves.

## Recorded local result

The [saved verification report](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_6_VERIFICATION.json) passed on **November 3, 2026**, on `codex/evidence-informed-recommendations`. The complete command ran from `2026-11-02T23:41:08.721Z` to `2026-11-03T00:06:48.027Z`. The source fingerprint stayed unchanged throughout and was independently checked again before saving the artifact.

- **627 automated tests passed:** 611 server/client tests and 16 operations tests; zero failures, skips, cancellations or todos.
- **150 browser journeys passed across 19 groups:** 39 Phase 5 journeys plus all 111 Phase 1–4 journeys. This includes English/Spanish, Live/Realtime, 1280/390/320-pixel coverage, malformed optional-capability recovery, approval boundaries and source/permission invalidation.
- **26 outcome-definition cases, 32 recommendation-policy cases and 6 legacy comparisons passed.** The separate baseline replay matched all 32 development and 16 held-out cases with zero errors under the frozen budgets; policy-only p95 remained below 3.35 ms in all four runs. This is baseline equivalence, not an improvement claim.
- Type checking, the environment-excluded production bundle and logging policy passed. The build retains the existing non-blocking large-bundle advisory.

Actual local toolchain: Node `v24.19.0`, PostgreSQL `17.11 (Debian 17.11-0+deb13u1)`, Playwright `1.57.0` and Chromium `154.0.8037.57`. Remote CI, deployed identities, hosted providers and physical devices were not exercised.

Source fingerprint: `22f40c3b346155aadcbf790c9e914011f6b80aa0f21b4062af674f0d88a8cea4`.

Raw synthetic logs, screenshots and per-group results remain in `/tmp/phase5-step6-release-verified`; only the content-free aggregate is saved in the repository. Earlier partial runs are not release evidence. Both recommendation defaults remain off, and no production migration, grant, publication, deployment or policy promotion was performed. The external checks listed above remain release work.
