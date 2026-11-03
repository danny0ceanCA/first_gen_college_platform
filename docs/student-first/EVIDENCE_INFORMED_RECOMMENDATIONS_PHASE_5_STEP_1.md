# Phase 5, step 1 — Recommendation contracts and authority

Implemented locally on November 2, 2026. This step defines the shared contracts and adds an internal, scoped source resolver. It creates no recommendation history, acceptance records, publication grants or evaluation permissions. Recommendation selection, reusable action publication and user-facing controls remain later implementation steps.

## Contracts

`src/recommendationContract.mjs` and its TypeScript declarations define contract version 1 and reserve policy version `evidence-informed-v1` for the subsequent algorithm. Validators reject extra fields, unsupported kinds, malformed identifiers/versions and fabricated approval or scoring fields. Validation checks a proposal's shape; it does not establish authorization or factual accuracy.

| Contract | Meaning |
| --- | --- |
| Source | An exact `accepted-action` plan/step/version, a `review-response` request/version/organization, or a `reviewed-template` teaching/revision reference. These remain distinct origins. |
| Scope | Separate campus, academic term and coordinator organization. Campus/term can explicitly be unknown. A confirmed campus uses a stable identifier, not a free-form school name. A client-supplied confirmed value is never authority. |
| Candidate | Bilingual action and explanation, goal/process enums, bounded prerequisite/exclusion enums, applicability scope, supporting policy references and an explicit review/expiry interval. |
| Decision | `recommended`, `clarification_required`, `no_applicable_candidate` or `unavailable`, with versioned policy, constrained reason and exact source revision where applicable. Unavailable evidence cannot carry a selected candidate or success score. |
| Action link | A proposal to associate an exact recommendation source/revision with a canonical plan step/version. It contains no approval, sharing permission, reported outcome or evaluation authority. |

The initial domain covers understanding requirements, preparing/submitting documents and checking decisions, for office contact, aid documents and insurance waivers. Step 2 will supply reviewed reusable content; step 3 will enforce eligibility and ranking. Merely having a well-formed candidate with an unknown campus does not satisfy a campus-confirmation prerequisite.

Structural limits are 50 candidates, eight supporting policy references and twelve conditions per list, with a three-second database statement budget. These are bounds for subsequent selection, not an implemented candidate search. Sensitive attributes, family disclosures, inferred vulnerability and coordinator popularity are excluded from ranking-feature fields. Free-text action/explanation validation is not a semantic privacy review; reviewed publication remains necessary before reusable content can be used.

## Permission matrix

| Operation | Required authority | Available in step 1 |
| --- | --- | --- |
| Resolve own source | Current authenticated account/student permission, own source and exact version; current response organization and connection when applicable | Internal read-only resolver |
| Recommend an action | Current permitted context plus the later eligibility/selection policy | No |
| Publish a reusable template | Separate reviewed-library publication authority and applicable content | No; ordinary teaching references are not automatically action templates |
| Accept a recommendation | Exact preview and explicit binder or independently verified audible approval, followed by a current-source recheck | No |
| Schedule a follow-up or share an update | Existing separate student-controlled workflows | Existing functionality; no new permission is inferred |
| Evaluate recommendations | New purpose `recommendation_evaluation`, exact source opt-in and separately scoped reviewer capability | No |

The static authority projection explicitly returns `canRecommend`, `canAccept`, `canPublish` and `canEvaluate` as false. Neither a student update, coordinator response nor `service_quality` permission changes those values. Candidate/decision/action-link validators are not write endpoints.

## Database and source resolution

Migration `114_recommendation_contract.sql` adds only `origen_recommendation_source_command(jsonb)`. It introduces no tables and backfills no records. PUBLIC and maintenance execution remain denied; the runtime grant script adds only this scoped function. Its security-definer search path is fixed to the migration schema and `pg_temp`.

The sole supported command is `resolve-source`, contract version 1, purpose `personal_guidance`, with a student ID and typed source. SQL repeats the strict shape checks, including rejecting `confirmed`, `approved`, account overrides, alternate purposes and unsupported operations. The command resolves the real account from existing request scope and checks current student eligibility; analytics/operator scope is denied.

Accepted-action references must match the student's current canonical plan, step and plan version. They describe the student's independently accepted work, even if the original coordinator response later becomes unavailable. This does not recertify the old advice, establish an outcome or make a completed/deferred action eligible for a new suggestion; step 3 handles those state restrictions.

Coordinator-response references must additionally match the request's actual organization. Resolution reuses the current response-context guard in question mode, preserving connection, role, publication, permission and version checks. A historical or withdrawn response cannot become a current recommendation source. Reviewed-template references remain unavailable until step 2 adds reviewed action metadata and publication controls.

The result contains only the typed source, a source revision, student scope and the false authority projection. It excludes plan notes, response prose, private reports and outcome data. Coordinator organization is returned separately; campus and term remain unknown because this foundation has no authoritative campus/term resolver. Unavailable references return a uniform result without exposing newer versions or other students' records.

`server/recommendation-contract.mjs` wraps this command with existing account/permission guards and a bounded transaction. It is an internal repository, not an HTTP route or a model tool. Reads create no recommendation-specific events and do not mark a response opened, alter an action, request follow-up or notify a coordinator.

## Flags and readiness

Both deployment defaults are false:

```text
ORIGEN_RECOMMENDATIONS=false
ORIGEN_RECOMMENDATION_EVALUATION=false
```

The recommendation foundation requires the existing student-follow-up and response-context dependency chain, including its personalization controls. Enabling this flag alone still creates no recommendations: no selection or user-facing caller has been introduced. Recommendation evaluation is explicitly rejected by configuration/startup checks until its separate permission workflow exists in step 5. The earlier outcome-evaluation flag does not enable it.

Startup checks migration 114 and runtime execution privileges when recommendations are enabled, and reject PUBLIC execution. Database readiness also checks the foundation with rollout flags off, alongside existing migration checksums and runtime/maintenance isolation. Refresh runtime grants after migrating; no additional maintenance grants are required. No deployment flags, production grants or production database were changed during implementation.

## Lifecycle and retention

Unaccepted candidates and source-resolution metadata are transient; the foundation retains zero recommendation decisions or evaluation receipts. Every future use must resolve current permissions and exact sources again. A source revision is a comparison token, never a consent token. It cannot be submitted to a currently nonexistent acceptance endpoint to revive an approval.

Future accepted-source links must use the existing canonical action lifecycle, without duplicate private prose, and appear in owner export. A changed/withdrawn source invalidates its recommendation context while preserving independently accepted work. A private correction must invalidate private derivatives without silently rewriting a separately approved coordinator snapshot.

This step adds no personal storage requiring extra export, deletion or restore hooks. Existing source deletion/closure makes new resolution unavailable; the existing response restore generation changes response revision tokens. Future persistent acceptance/evaluation migrations must add their own export, erasure, withdrawal and restore fencing before writers are enabled. Evaluation retention and approval cannot be inherited from the service-quality dataset.

## Verification

Synthetic fixtures reuse the real restricted PostgreSQL roles, student actions and coordinator response workflow. Tests cover bilingual contract validation, unsupported/sensitive fields, wrong owner/student/organization, stale versions, source loss, independent-action preservation, rejected approval/writer/evaluation commands, source-generation changes after restore, deletion, feature-off reads, PUBLIC/maintenance denial and missing runtime grants. The existing release verifier now includes this suite.

Validation: **77 automated tests passed**, including ten new foundation tests and the affected configuration, readiness, privacy/account lifecycle, teaching-library, coordinator-response, follow-up and outcome-release regressions. There were zero failures, skips, cancellations or todos. TypeScript, the production build and logging-policy checks passed. The build reported its non-blocking large-bundle advisory.

The regression command used the isolated cloud PostgreSQL runner:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-reporter=tap --test-concurrency=2 server/recommendation-contract.test.mjs server/binder-sharing-policy.test.mjs server/production-config.test.mjs server/outcome-release.test.mjs server/review-response-context.test.mjs server/student-follow-up.test.mjs server/teaching-library.test.mjs server/account-lifecycle.test.mjs ops/coordinator-readiness.test.mjs
```

Synthetic test output is in `/tmp/phase5-step1-final.log`; the credential-excluded build output is in `/tmp/phase5-step1-build.log`. UI/browser acceptance, real-provider voice behavior and production rollout are outside this foundation step. Earlier full-release reports remain evidence for their earlier source snapshots; this focused run does not replace Phase 5 step 6's future combined verification.

Next: [step 2 of the Phase 5 plan](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_PLAN.md#step-2--extend-the-reviewed-teaching-library-with-reusable-actions), extending the existing reviewed teaching library with reusable action metadata and publication controls.
