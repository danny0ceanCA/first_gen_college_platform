# Structured review requests — Phase 1, step 2

Implemented November 1, 2026, building on [step 1](REVIEW_REQUESTS_STEP_1.md). This step supplies the shared backend preview, explicit approval, and submission workflow. It does not enable a student button, voice tool, or coordinator request screen yet.

## Behavior

A student prepares a private question for an accepted coordinator connection. Preview returns the exact question wording, coordinator and organization names, student display name, and every selected saved note version. The student chooses either the original question or the proposed clarification; the unselected wording is not copied into the publication. A standalone question can have no notes. Notes must still meet step 1's student-owned manual-note restrictions.

The preview expires after 10 minutes. Its digest binds the complete selection, request version, recipient and permission revisions, a random preview ID, and the displayed expiry times. Request-specific access lasts at most 30 days from preview creation. These durations are explicit initial policy choices, not inferred from institutional deadlines. Creating another preview supersedes the previous one.

Submission requires the current preview ID and digest, request version 1, and `confirmed: true`. The database rechecks the whole selection under locks; it rejects changed, missing, stale or ineligible sources rather than dropping entries or substituting new text. Changing recipients, permissions, student display name or wording requires a new valid preview/request as appropriate. A proposed clarification or a generic spoken “yes” is not an approval receipt.

Submission commits three things together: the approved snapshot, the request's submitted state, and a metadata-only notification intent. An outbox failure rolls all three back. Concurrent retries return the original receipt without creating another publication or notice, extending access, or restoring withdrawn access. Separate questions have separate publications and never replace the existing shared binder snapshot.

## API and state

`POST /api/review-requests` uses the existing authenticated, account-isolated gateway, JSON input limits and `Cache-Control: no-store`. Bodies cannot select an account or supply trusted recipient content. The HTTP creation path derives `origin: notebook`; future voice integration needs its own current-turn and completed-readback proof.

| Action | Input after `action` and `studentId` | Result |
| --- | --- | --- |
| `create` | Step 1 question, connection, retry key and selected source references | Private draft, version 1 |
| `get` | `id` | Private record and any submission receipt |
| `preview` | `id`, `version`, `wording: original` or `clarification` | Expiring exact selection, ID and digest |
| `submit` | `id`, `version`, `previewId`, `digest`, `confirmed: true` | Submitted record, version 2, receipt |
| `cancel` | `id`, `version` | Cancelled unsubmitted draft, version 2 |
| `withdraw` | `id`, `version` | Withdrawn submission, version 3; shared copy erased |
| `remove` | `id`, `version` | Private record and copies erased; content-free deletion receipt retained |

Version conflicts or a changed preview return 409; inaccessible private records return 404; permission failures return 403; paused creation/preview/submission return 503. Invalid input returns 400. For a lost submission response, retry the exact original submission or read the request before deciding what to show.

The receipt includes publication ID, approved preview ID and digest, chosen wording, submission time, expiry, current access state, and notification queue state. `submitted` means stored approval and notification intent; it never means delivered, read, reviewed, acted upon, or resolved. Current permission expiry can make access unavailable before the cleanup worker erases the copy. The historical request state remains submitted unless the student withdraws it.

## Withdrawal, privacy and recovery

Source changes/deletion, coordinator or organization changes, access revocation, and expiry invalidate previews and erase approved shared text. Existing stop-all-sharing also withdraws request-specific access. Runtime and maintenance roles cannot read the new tables directly; only the scoped command is callable by the application. Internal helpers have pinned search paths and no PUBLIC execute grants. Parents, other students and coordinators cannot use the student command to read or approve private drafts.

The owner can still read, cancel, withdraw, remove or export records when rollout is disabled or sharing eligibility has ended. Account export includes the historical approval receipt. Account/student deletion cascades through requests, previews, publications, source references and deletion receipts.

Recovery clears every preview and approved copy before restored traffic resumes, including historical recipients who are no longer active. The separately preserved deletion manifest now includes content-free review-request deletion receipts; replay removes requests deleted after the backup and blocks their delayed creation retries. Legacy manifests remain readable, but cannot supply deletion evidence they never captured. Operators still need the current separately preserved manifest and the existing stopped-traffic recovery procedure.

## Rollout boundary

`ORIGEN_REVIEW_REQUESTS` defaults to false and is explicitly false in `render.yaml`. Creation, preview and submission require it plus the existing coordinator account, linking and binder-sharing flags. Enabled startup requires migration `096_review_request_submission.sql` and execute permission on the scoped command. Apply migrations and refresh restricted runtime grants through the existing operator process; the API never migrates on startup. Existing coordinator maintenance handles expiry with its restricted credential.

**Review-request notifications are deliberately held pending until step 5 provides the coordinator destination.** Existing binder notifications continue delivering normally. No new coordinator read endpoint is exposed in this step. `publication.access: active` describes the approved, currently valid snapshot; it does not mean a coordinator can open it in today's UI. Keep the feature off for production until the integrated flow is ready.

Step 3 connects notebook controls and request status; step 4 adds spoken requests and explicit readback approval; step 5 connects the existing coordinator interface and enables delivery. Step 6 verifies the complete user journey. Coordinator replies, student follow-up, optional outcome sharing and recommendation learning remain later work. The coordinator layout is unchanged.

## Verification

The real-PostgreSQL request suites cover 32 tests including step 1. They exercise exact wording, standalone Spanish questions, source/version changes, permission and recipient changes, isolation, expired and superseded approvals, duplicate concurrent submissions, cancellation races, injected notification failure with rollback, withdrawal with rollout off, maintenance expiry, restore replay, export, deletion and gateway authentication. All ran with synthetic identities and a disposable local database; no production database or model provider was used.

The broader selected regression run covered 128 tests: 127 passed initially; one existing coordinator notification fixture reused a cached synthetic identity while changing its verification status. The fixture now uses distinct synthetic tokens for distinct provider identities, matching the existing binder-view test. Its coordinator lifecycle suite passed all 15 tests on the focused rerun, leaving all 128 selected tests verified across the combined run and corrected suite rerun, with none skipped. TypeScript/Vite build and the production logging policy check passed. Existing Auth0 module-directive and bundle-size build warnings remain. The local environment uses Node 24 and PostgreSQL 17; CI uses Node 22 and PostgreSQL 18.

Migration 096 has been exercised only in disposable schemas. No production migration, deployment, external notification, commit, push or pull request was performed for this step.
