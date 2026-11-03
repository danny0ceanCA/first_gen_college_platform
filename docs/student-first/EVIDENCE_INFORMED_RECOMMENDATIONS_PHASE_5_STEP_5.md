# Phase 5, step 5 — Separately permitted recommendation evaluation

Implemented locally on November 2, 2026, on `codex/evidence-informed-recommendations`. This adds prospective evaluation permission, structured recommendation receipts, a protected organization report and an offline policy comparison. It does not change the active recommendation policy or enable production collection. Both recommendation flags remain false by default.

## Student permission and experience

The existing My next steps area now includes a collapsed **Optional recommendation evaluation** control. English and Spanish notices explain the fields, audience, organization, duration, withdrawal and limits. An eligible adult student chooses one currently connected organization, reviews a server-generated preview, checks an initially unchecked box and confirms. The permission is `recommendation_evaluation`, contract version 1, valid for at most 90 days. It is independent of `service_quality`, action acceptance, check-in enrollment, coordinator sharing and outcome recording.

The server uses the existing adult eligibility record (`18plus` and `adult`), student account role, owned student, current organization connection/revision and verified active organization. This reuses the application's eligibility workflow; it does not add an external identity or age-verification service. Parents cannot contribute on a student's behalf. A role change or invalidated connection removes eligibility. Restoring the account role does not revive a revoked connection or its permission.

Permission applies only to future recommendation selections. It does not backfill old actions, earlier displays, teaching-access logs or conversations. One organization is selected for each permission generation; granting a new generation clears prior contributions. A private coordinator-response source must belong to that organization. Revisiting an already accepted action creates no new evaluation acceptance path.

Declining or withdrawing leaves personal guidance and coordinator support available. Withdrawal deletes this student's evaluation receipts and pending permission preview. Load/withdraw controls remain available when evaluation is paused. Lost confirmation responses are resolved by checking current permission rather than automatically sending another confirmation. No evaluation request or opt-out notification is sent to a coordinator, and no coordinator workspace layout changes.

## What is recorded

Migration `119_recommendation_evaluation.sql` adds distinct permissions, short-lived permission previews, prospective receipts, reviewer capabilities and a non-personal report budget. All raw tables have RLS and deny application/PUBLIC access. Runtime receives only scoped commands; operator-only grant/restore helpers and the maintenance purge remain separate.

Each receipt stores the permission generation, organization, policy and exact source revision, selection status, considered/eligible candidate counts, language, delivery channel, selection latency and observed event times. It contains no conversation, action prose, student-reported prerequisite answers, names or contact details. Selection attempts are the report unit; repeated source selections are identified without counting them as additional people.

| Event | Recorded meaning |
| --- | --- |
| Considered | A completed server selection returned its bounded candidate counts/status under current permission. Requests that fail before creating a receipt are outside this denominator. |
| Displayed | The binder observed the current suggestion intersecting its visible page. This client observation does not establish reading or comprehension. |
| Played | The existing voice approval path observed the exact complete audible readback. Partial/muted/interrupted playback does not qualify. This does not prove understanding. |
| Accepted | The canonical action and exact recommendation reference committed successfully. Display/playback never substitutes for acceptance. |
| Reported attempt | An independently approved, version-bound report attached through the explicit outcome relationship reports attempted/completed action. It remains student-reported. |
| Supported reported outcome | The existing assessment supports an occurred claim for the episode's own definition. Receiving a decision, submitting a document and gaining approval remain different criteria, not one common success measure. |

Display, playback and acceptance are recorded separately and idempotently. Evaluation recording runs inside a savepoint in the existing delivery transaction; an evaluation write failure does not prevent ordinary guidance or save approval. It may leave an unobserved event, which must not be reconstructed as a failure. Explicitly unavailable selection results remain distinct from no applicable action.

The existing recommendation selector still uses reviewed rules. This step adds no cross-student ranking weights, sensitive features, coordinator rankings, automatic training, experimentation or live policy promotion.

## Exact outcome evidence and freshness

The report resolves the step 4 typed accepted-recommendation → canonical action → approved outcome relationship on the server. It requires the exact permission generation, current source revision, unchanged accepted action hash, exact episode version and current underlying report/definition fingerprint. The outcome and its approved relationship must have been recorded after acceptance. Older unlinked outcomes cannot enter by matching text, dates or coordinator identity.

One current outcome episode is allowed per accepted action in an outcome metric. If two or more current linked episodes exist, the receipt is marked ambiguous and excluded from outcome counts. The current schema prevents multiple recommendation relationships on one canonical action. Retries do not create additional receipts or episodes. Pending, unknown, declined-outcome and adverse categories remain distinct; no return or missing telemetry means not observed, never failure. Coordinator observations are not imported into private outcome evidence.

A source withdrawal or action correction excludes the affected receipt. An outcome correction, withdrawal, expired validity or changed report version removes the old outcome contribution. These checks occur on demand and again before returning a report, without a retained report cache. The underlying student's independently accepted action and separately approved coordinator disclosures keep their existing lifecycle.

Current Phase 4 outcome recording still applies only to independently eligible accepted coordinator-response actions. Accepting a general reviewed template does not automatically enroll follow-up or create outcome eligibility. Accordingly, missing template outcomes are not evidence that those recommendations failed.

## Protected organization report

Migration `120_recommendation_evaluation_report.sql` provides an on-demand report at POST `/api/recommendation-evaluation-report`. A request contains only `action: "report"`, `purpose: "recommendation_evaluation"`, `contractVersion: 1` and an `organizationId`. There are no student, demographic, date-range, campus, template or arbitrary grouping filters.

The HTTP boundary requires current staff access, fresh authentication/MFA under the repository's existing staff rules, verified email, active organization membership and a separate organization-scoped recommendation reviewer capability. Ordinary coordinator, outcome-review and service-quality capabilities do not grant this access. Raw structured rows and stable keys stay inside the server; the response contains protected aggregate counts and limitations only.

Reports cover selection receipts created in the previous completed UTC calendar month, using currently permitted evidence at query time. Later independently approved outcomes may contribute to that fixed selection cohort while permission remains valid. Selection counts, independent participant counts and episode-based observations are distinguished. Receipts retain their actual observation states rather than being assigned a success score.

Every released cell and its complement require at least **ten distinct accounts**. Repeated selections from one account cannot satisfy the threshold. Counts/rates and denominators are suppressed together when a cell fails. This threshold provides neither statistical power nor a differential-privacy guarantee. The report allows at most one successful request per organization per UTC day across all reviewers, including suppressed reports. The budget retains only organization/day, not report results or participant data. A withdrawal during report generation invalidates the entire result before that budget is consumed.

At most 1,000 receipt rows are aggregated; an overflow returns incomplete/suppressed results instead of ranking a truncated population. Each exact outcome reads at most 101 evidence references to detect the existing 100-reference limit; two current episodes are enough to identify ambiguity. SQL statements have a five-second timeout. No fixed aggregate includes private wording or row identifiers.

The report measures candidate coverage, selection/clarification/unavailability, observed presentation, acceptance, repeated source selection, reported attempts, available outcomes and a four-second selection-latency band. It explicitly leaves comprehension, unrecorded requests, all eligible students, evaluation declines, institutional verification, live inappropriate-action rates and causal effectiveness unmeasured. These are descriptive counts of volunteers and returned reports, not estimated probabilities that an intervention will work.

## Offline comparison and controlled improvement

`scripts/compare-recommendation-policies.mjs` compares a candidate to `evidence-informed-v1` on **32 development cases and 16 separate held-out reference cases**. Synthetic student IDs are disjoint, development timestamps precede held-out timestamps, and each case is evaluated at its own timestamp. The case/budget digest, repository source fingerprint and optional candidate-module digest bind the artifact to its inputs. A source change during the run invalidates the comparison.

These are frozen engineering reference cases, not a statistical study or a real student holdout. Budgets require zero inappropriate actions, decision/source errors, repetition errors or missing bilingual content; pure-policy p95 latency must be at most 100 ms. This latency excludes database, network and provider work. Bilingual content presence is automated; bilingual meaning and responsive layout need the separate content/browser checks. The default candidate replays the baseline and demonstrates equivalence, not improvement. Tests deliberately reject always-recommend and always-abstain policies without changing the budgets.

Run locally with the isolated test runner:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node scripts/compare-recommendation-policies.mjs /tmp/recommendation-comparison.json
node /workspace/.local-postgres/bin/run-tests.cjs node scripts/recommendation-quality-report.mjs /tmp/recommendation-quality.json
```

The second command writes a JSON/Markdown example using 40 invented participants. It reads no student records. The comparison can optionally receive an explicitly supplied, reviewed local module exporting `decideRecommendation` and `policyVersion`; use a candidate committed within the reviewed repository so its dependencies are covered by the source fingerprint. Nothing in a student request or model response chooses that module.

The improvement workflow is deliberate:

1. An authorized reviewer examines the fixed report and records a hypothesis, its denominators, missingness and limitations. Small or unavailable data cannot support changing weights.
2. Propose independently authored library wording or a versioned rule in a normal review branch. Do not copy private cases into general templates or reports. Record the old/new version, rationale, reference-set digest and expected behavioral difference.
3. Run baseline/candidate development and held-out comparisons with the fixed budgets. Review bilingual meaning, source claims, appropriate abstentions and connected browser behavior. Any future permitted real-case evaluation must also keep students disjoint and development times earlier than held-out times; this implementation provides no private-case export for that use.
4. A human reviews the proposal and remaining external checks. Publish the separately reviewed template or release a distinct policy version through the existing release workflow, with the previous compatible version identified for rollback.

Reports and comparison artifacts cannot publish a template, modify production flags or update algorithm weights. Observational associations do not establish causation or outcomes for actions never taken.

## Lifecycle and operation

Own-account export includes that account's permissions and receipts only. Account/student deletion cascades evaluation records; deletion of an accepted recommendation cascades its associated receipt. Withdrawal deletes contributions immediately. Permission/receipt expiry excludes them immediately; the existing hourly maintenance job inspects up to 1,000 oldest receipts per run and deletes invalid/expired entries, plus expired permission previews. Physical deletion can lag with a backlog or unhealthy job, and source-invalid receipts can remain until reached by cleanup. They are excluded from reports throughout that delay.

Privacy restore deletes evaluation receipts and previews, withdraws permissions and revokes reviewer capabilities. It does not revive a previously withdrawn contribution. The non-personal organization/day budget is preserved. Source changes and private opt-out do not create coordinator notifications or badges.

Before a future authorized release, apply migrations through 120 and refresh runtime and maintenance grants. `ORIGEN_RECOMMENDATION_EVALUATION` requires `ORIGEN_OUTCOME_EVIDENCE`; its readiness checks the new schema, scoped functions, denied raw tables and denied owner/maintenance helpers. It remains independently pausable from recommendations and `ORIGEN_OUTCOME_EVALUATION`. Provision an explicitly authorized reviewer using the owner-only `scripts/provision-recommendation-evaluation.mjs`; its grant expires within 90 days and can be revoked. No grant was provisioned in production by this work.

Retain compatible migrations and deletion/restore fences during rollback. Keep `ORIGEN_RECOMMENDATIONS=false` and `ORIGEN_RECOMMENDATION_EVALUATION=false` until release approval. A new purpose or materially different notice requires a new contract and approval, not silent reuse of version 1.

## Validation

All checks used local PostgreSQL, synthetic accounts and environment-excluded test processes. The affected regression run executed 157 tests with zero skips: 156 passed and one new fixture incorrectly expected a revoked organization connection to return after a parent/student role change. The fixture now verifies that the connection stays revoked and uses a separate current connection for revision invalidation. All 17 focused evaluation tests passed after correction; the final quality/reference rerun also checks the completed metric definitions and temporal split.

The six new browser journeys passed at 1280, 390 and 320 pixels in English and Spanish. They exercise real controls, handlers and PostgreSQL: explicit opt-in, lost-response recovery, prospective display observation and withdrawal while paused, with unchanged plans/check-ins. The existing 18 recommendation-acceptance journeys also passed across binder, Live and Realtime, showing acceptance still works with evaluation off. Voice transport/audio is synthetic. The narrow Spanish permission screen was visually inspected with no horizontal overflow.

TypeScript, logging policy, the environment-excluded Vite build and diff/syntax checks passed; the build retains its existing large-chunk advisory. The comparison passes 32 development and 16 held-out cases with no automatic promotion. The release verifier includes the new tests, comparison and six-journey matrix. The full combined release verifier, deployed authentication, real providers and physical-device checks remain step 6/external release work.

Evidence: `/tmp/phase5-step5-regressions.log`, `/tmp/phase5-step5-final-focused.log`, `/tmp/origen-recommendation-evaluation-browser/results.json`, `/tmp/phase5-step5-acceptance-browser.log`, `/tmp/phase5-step5-comparison.json`, `/tmp/phase5-step5-quality.json`, `/tmp/phase5-step5-quality.md`, `/tmp/phase5-step5-types.log`, `/tmp/phase5-step5-build.log` and `/tmp/phase5-step5-logging.log`.

No production migration, data collection, deployment, provider call or policy promotion was performed. Next is step 6: verify the combined journey and prepare the release.
