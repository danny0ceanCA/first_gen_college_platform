# Student-controlled follow-up — Phase 3, step 1

The permission and data foundation is implemented locally. `ORIGEN_STUDENT_FOLLOW_UP` defaults to **false**. This step adds the scoped backend contract; binder controls, returning-conversation selection, spoken enrollment/reporting and coordinator updates remain steps 2–5. No automatic check-in, notification, model tool or report writer is enabled by this implementation.

## Permission contract

A follow-up identifies an existing accepted private action through its plan and step IDs. The server resolves the owning account, student and exact source response version from the existing Phase 2 link. Client/model input cannot supply the owner, source text, eligibility, sharing authority or a completion result.

Existing actions, personal due dates, coordinator dates and **Review later** choices remain unenrolled. Reading a follow-up returns `off` with revision zero until the student makes a choice; the migration does not backfill permissions.

`POST /api/student-follow-up` exposes these authenticated, owner-scoped operations:

| Operation | Behavior |
| --- | --- |
| `load` | Return the selected action's enrollment metadata and private report/presentation records. Does not record discussion, completion or receipt. |
| `prepare` | Validate current plan version and enrollment revision; return an expiring preview of the exact action, response identity, local date/time zone and permission for one future check-in. Creates no enrollment. |
| `confirm` | Require the exact preview ID/digest and explicit approval, then revalidate the action and source within the transaction. Enroll once. |
| `pause` / `stop` | Suspend the selected item or turn it off, invalidate pending previews and preserve private history. Available while the feature is paused or AI permission has ended. |
| `delete-report` | Remove an owned private report using its version. Available while paused. |

The preview includes the action's own title, wording, private notes and due date so later controls can disclose precisely what the student is authorizing. It does not include coordinator response prose or a conversation. The schedule is separate from the action's due date and includes an IANA time zone. A chosen date means a future eligible student-started conversation, not an outbound message or a promised appointment.

The confirmation contract is for an explicit binder approval. No voice tool can use this endpoint as proof of spoken consent. Step 4 must add the independent speech and completed-playback verification before supporting spoken enrollment.

Optimistic revisions and operation receipts prevent concurrent or repeated approvals from duplicating enrollment. Replaying a previously successful approval after a stop returns the current stopped state; it cannot reactivate it. An edited action, changed source, consumed/expired preview, different digest or conflicting operation ID requires fresh review. Past local dates and invalid calendar dates/time zones are rejected. A new preview has a fresh digest.

## Storage, isolation and lifecycle

Migration `104_student_follow_up_foundation.sql` adds five restricted tables:

- Enrollment state and the accepted action/source version, content hash, consent time, schedule and access-validity ceiling.
- Short-lived exact-approval previews.
- Idempotency receipts containing hashes and identifiers rather than student prose.
- A separate presentation-evidence store, reserved for step 3's application-verified playback receipts.
- Private student report records, reserved for step 4's explicitly approved report writer.

The runtime receives only execution of the scoped command. It receives no raw table privileges, helper access or restore capability. Row-level security is enabled and PUBLIC access is revoked. Requests derive their account from the authenticated scope; other accounts, students and coordinator actors cannot read the student's records. The endpoint retains the application's authentication, origin, request-size and rate controls. It is exempt from the general AI-permission gate so its own permission checks can preserve cancellation and privacy operations.

An enrollment hash binds the selected action and its relevant plan context. Unrelated sibling edits preserve consent. Changes to the selected action's wording, notes, dates, status or plan context pause it; undoing an edit does not automatically resume it. Deferred triggers inspect the final transaction state because the existing plan editor replaces its step rows during a save. Removing an action or plan removes its related follow-up records, including private reports. Other independent actions survive.

Response edits, withdrawal/deletion, shared-access invalidation, student role changes and permission changes invalidate pending previews and pause scheduled enrollment. Current source/scope checks also run on reads and approval, including time-based expiry. Consent retains its original access-validity ceiling so a later extension cannot silently revive an expired enrollment. Student/account deletion cascades all related private records.

No command changes canonical plan status, creates a coordinator publication, sends an outbox notification or records a presentation. `closed` is a follow-up state reserved for later lifecycle handling; it does not mean the action succeeded. Existing plan status remains the single task-status source.

## Private report definitions and recovery

The report contract separates what the student says they did from what happened afterward. For example, `reported_action=completed` and `reported_outcome=pending` can represent “I contacted the office and am waiting.” A report does not itself update the plan. Optional detail and helpfulness, the separately recorded/occurred dates, time zone and definition version retain their own meaning.

Provenance is constrained to `student_reported`; institution-verified claims cannot be stored through this definition. Declined and unknown responses carry no inferred action, result or explanatory prose. Missing reports remain missing. This step exposes no report-writing or presentation-writing API. Tests seed these reserved tables with synthetic rows through the fixture owner solely to verify isolation, constraints, export, deletion and restore.

Private reports do not enter `origen_progress_reports`, existing admin/operator helpfulness aggregates or coordinator views. Account export includes owned enrollments, private reports and available presentation metadata, but excludes preview digests and receipt hashes. No private report grants research, training or sharing permission.

Privacy recovery now includes content-free report ID/version fences. Restore removes stale, deleted or subsequently corrected report versions rather than reinstating their old wording. Older manifests without report fences conservatively remove these reports. Restore clears pending previews, operation receipts and playback receipts, increments enrollment revisions, and leaves stopped items off and other items paused. Existing Phase 2 recovery also detaches source links and revokes restored shared access. Fresh authorization is required before future enrollment can become active.

## Configuration and validation

The backend capability requires response context configuration and the student's effective personalization retrieval policy. Configuration rejects an enabled Phase 3 switch without its Phase 2 prerequisite. Startup checks require migration 104 and the restricted command grant when enabled. The read-only coordinator readiness command probes the new capability even when deployment flags are off.

Before a future compatible deployment, apply migration 104 with the separate migration credential and refresh runtime grants. Keep `ORIGEN_STUDENT_FOLLOW_UP=false` until the remaining implementation and release checks are complete. Existing histories, cancellation and deletion stay available while paused. This adds no paid service, outbound notification channel, scheduler or new database instance.

Validation used the existing isolated local PostgreSQL environment, disposable schemas and synthetic identities. The affected regression run passed **95 tests with zero failures, skips, cancellations or TODOs**. It covers plans, response context/choices/clarifications, sharing isolation, account lifecycle, privacy recovery, configuration and readiness, as well as the new foundation. After the final consent-constraint refinements, the focused foundation suite passed **all 18 tests**, also without failures or skips; these cases overlap the regression suite. TypeScript, production logging checks and the isolated production build passed. The build reports the existing large-bundle warning.

The foundation suite tests exact consent and idempotency, competing approvals, preview changes/expiry, no inherited consent from deferral/dates, selected versus sibling edits, source/permission loss, raw-table/helper denial, report provenance and missingness, privacy export, report deletion, stale restore, student/account deletion, startup grants, pausing during approval and a concurrent coordinator edit.

Detailed logs are `/tmp/origen-followup-step1-regression-final.log` and `/tmp/origen-followup-step1-foundation-final.log`. TypeScript, build and logging results are saved separately under `/tmp/origen-followup-step1-*.log`. No production migration, deployment or feature enablement was performed. Browser and real-provider/device checks are not claimed for this backend-only step. The earlier Phase 2 release report remains evidence for its earlier source snapshot.

Step 2 is the next task: connect these contracts to the small student controls in the existing binder.
