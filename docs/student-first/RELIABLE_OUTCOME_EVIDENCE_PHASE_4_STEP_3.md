# Phase 4, step 3 — Attributed coordinator observations

Implemented locally on November 2, 2026. Authorized coordinators can preview and publish a scoped observation inside the existing request detail card. Students see the attributed observation in their binder request history and can record a private disagreement or separately approve sharing it. `ORIGEN_OUTCOME_EVIDENCE` remains **false by default**. No production configuration, hosted database or paid provider was changed.

## Experience and authority

The evidence section is separate from the existing guidance response and reviewed receipt. The coordinator selects the exact outcome definition/version, claim, institution/term/process and a verbatim excerpt from the approved question or included note. Known scope must occur in that selected approved source. Missing scope or an unknown claim can only accompany “cannot establish.” Private reports, action notes and unapproved notebook entries are never used to fill these fields.

The coordinator states what they observed, whether it supports or contradicts the specified claim or cannot establish it, the evidence basis, observation date, optional event date and time zone. A declared record check requires a minimal record type and optional date; the structured reference accepts no URLs, documents or account identifiers. A student account is explicitly dependent on the student's statement. Other bases require a yes/no/unknown declaration of that dependence; “no” does not confer independently verified status.

A separate exact preview names the student and coordinator and shows the proposed observation before publication. The saved card identifies the author/organization, revision, scope, dates, declared basis and whether the coordinator also authored the linked advice. All observations remain **coordinator assertions, not authenticated institutional results**. Institutional verification, independent evidence and evaluation authorization are not inferred from staff access or a declared record check.

Existing reply permission does not grant outcome-review authority. The operator must provision a time-limited capability for a particular organization, active coordinator, outcome definition/version and allowed evidence bases. The API also requires current staff verification, verified recipient identity, active membership, approved publication access and the existing delivery gates. A capability does not grant access to university accounts or other systems.

## Student control and revisions

The student can read the observation, record a disagreement privately by default, edit it or remove it. Sharing requires choosing the named coordinator, reviewing the exact wording and explicitly approving that separate disclosure. Neither receipt nor silence means agreement. Coordinator reads, badges, counts and exports do not reveal a private disagreement or later private report edits.

Observations and disagreements have separate revisions. A disagreement refers to the observation revision the student actually reviewed. If the coordinator corrects the observation, the existing disagreement remains labeled as concerning the earlier revision; approval of the new revision is unknown. Corrections replace current observation prose rather than accumulating an unlimited prose archive. Removing a disagreement scrubs its prose and preserves only a version marker, preventing old approvals or deletes from affecting a later disagreement. Withdrawing an observation scrubs its payload and disagreements.

These operations do not overwrite the student's report, complete an action, enroll a check-in or share private follow-up information. Pausing outcome evidence stops new publications and shared disagreements while preserving student history, private disagreement management and coordinator withdrawal where the original request is still accessible. Lost write responses require checking the saved record; the UI does not automatically repeat the publication.

## Storage, privacy and recovery

Migration `111_coordinator_outcome_observations.sql` adds operator-provisioned capabilities, attributed observations, student disagreements and short-lived exact previews. Normal runtime and maintenance roles cannot read or modify these raw tables or execute internal helpers. Two scoped commands enforce account/recipient access. Startup readiness requires all three outcome migrations, scoped execution and denied raw/helper access.

Previews bind the exact approved publication hash, capability revision, observation/disagreement revisions, declared author relationship and expiry. Final approval rechecks these under the existing request/account locks. Duplicate approvals are idempotent; competing corrections, stale approvals, revoked/regranted capabilities, membership loss and expired sources fail closed. Publication/capability/evidence changes scrub pending copied text. A request has at most ten observation records and an actor at most thirty pending previews.

Student exports include their own observations and private disagreements. Coordinator exports include only observations they authored under currently accessible requests and explicitly shared disagreements. Request/student/account deletion cascades; closing an author identity erases attributed observations across student accounts. Observation changes invalidate student context revisions without adding observation prose to model prompts in this step.

Privacy manifests contain exact observation/disagreement version fences and no prose. Restore clears previews and revokes review capabilities. Superseded observations are removed; if a disagreement cannot be restored at its exact permitted revision, its associated observation is suppressed too, avoiding a misleading undisputed result or reuse of an older revision. Surviving observations become historical when their original access or capability is no longer current. Retention of version markers follows the owning request's lifecycle.

## Local verification

The new database and HTTP tests cover scoped authority, fresh staff verification, approved-source selection, unsupported verification fields, no private-record access, exact preview/approval, duplicates, competing corrections, private versus shared disagreements, monotonic revisions after removal, withdrawal, export, erasure, restore fences and readiness failures.

`scripts/outcome-observation-smoke.cjs` runs the actual coordinator request card and student binder request components against scoped HTTP handlers and disposable PostgreSQL. Six English/Spanish journeys at 1280, 390 and 320 pixels check exact previews, edit invalidation, lost-response recovery without repeat writes, private and separately shared disagreement, prior-revision labeling, offline clearing and paused withdrawal. Screenshots/results are under `/tmp/origen-outcome-step3-browser`. Authentication is synthetic; these are not physical-device or deployed-provider checks.

Completed local checks:

| Check group | Result |
| --- | --- |
| New observation, disagreement, HTTP and recovery cases | 23 passed, zero skipped |
| Affected outcome, sharing, lifecycle, permissions and operations regressions | 131 passed, zero skipped |
| New observation browser journeys | 6 passed |
| Existing coordinator delivery and private-outcome browser journeys | 12 passed |
| TypeScript, isolated Vite build, logging policy and patch whitespace | Passed |

The build retained the repository's existing large-chunk advisory. The integrated release verifier includes this suite and the six new browser journeys. Its complete Phase 6 gate was not rerun for this implementation step and remains required before rollout.

## Rollout

Keep the feature off until the compatible schema/backend/web release and outstanding identity/device/infrastructure checks are complete. Apply migrations through **111**, refresh runtime grants, run coordinator readiness and the complete release verifier, then provision only the intended coordinator scopes through the operator credential:

```sh
node scripts/provision-outcome-review.mjs <organization-uuid> <coordinator-profile-uuid> document_submitted student_account,direct_observation,declared_record_review <ISO-expiry>
```

The script requires `MIGRATION_DATABASE_URL`; the application credential cannot grant capabilities. Expiry must be in the future and no more than 366 days away. Use `revoke` instead of the expiry to revoke a scope. Provisioning alone does not enable recording. `ORIGEN_OUTCOME_EVIDENCE`, student follow-up and existing coordinator/request delivery gates must also permit it. No production grants were provisioned during implementation.

Step 4 will implement deterministic evidence assessment and truthful AI context. This step publishes attributed human observations; it does not reconcile them automatically, classify institutional verification, rank coordinators or train a recommendation model. No additional hosted database, Redis service, notifications or caption/chat interface was added.
