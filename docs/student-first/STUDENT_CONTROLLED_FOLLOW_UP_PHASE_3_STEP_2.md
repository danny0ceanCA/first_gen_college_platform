# Student-controlled follow-up — Phase 3, step 2

The existing student binder now has controls for an accepted private action linked to a coordinator response. The capability remains behind `ORIGEN_STUDENT_FOLLOW_UP=false`; this implementation does not enable production or make automatic check-ins available. Selection of a check-in and voice delivery are steps 3–4.

## Student experience

An accepted action has a small follow-up section in the binder's existing handwriting style. English and Spanish controls offer **Check in next time**, **Choose a date**, **Pause**, **Resume next time**, and **Stop**. The saved note describes the student's choice in the first person and says it stays private.

Choosing a time prepares a preview rather than enrolling immediately. The preview shows the current action title, wording, private notes, unchanged personal target date, selected local date and time zone, and permission for one check-in. **Confirm my check-in** sends the exact preview and explicit approval. A selected date means a later conversation started by the student on or after that date, not an outbound reminder or promised appointment.

The date picker uses the selected time zone's current calendar date. Next-conversation enrollment uses the browser's current time zone; a dated choice allows an explicit IANA time zone. Both are disclosed before confirmation and revalidated by the server. Scheduling never changes the plan's deadline or progress.

The account's **My check-ins with Origen** preference includes **Stop all my check-ins**, including paused items and pending approvals across plans and students owned by that account. It retains private actions, notes and reports. This cancellation remains available while new enrollment is disabled. The UI displays the stop receipt only after the server acknowledges it and a fresh snapshot confirms no remaining check-ins.

Completed, deferred, archived, materially edited or unavailable actions cannot acquire new consent. Current consent pauses under step 1's lifecycle rules. Undoing an edit or reopening an action does not resume consent; a fresh preview and approval are required. Coordinator controls and request history keep their existing layout.

## Requests, retries and privacy

`StudentFollowUpProvider` loads one overview for the current student's binder instead of fetching every row separately. It refreshes on return, connectivity changes and a ten-second interval while visible. The overview contains identifiers, states, revisions, schedules and eligibility; it does not return coordinator prose, private report content or approval digests.

The browser stores no follow-up settings, previews or pending operations in persistent storage. Privacy leases, scoped provider remounts and request epochs discard stale responses. Conversation deletion refreshes the controls; an ended account session clears them and blocks further requests. Losing connectivity or visibility clears a pending preview. Navigation guards protect an in-flight operation or unfinished review.

All mutations wait for server acknowledgement. A lost response offers a retry using the same operation ID, or a fresh read of saved state. It does not silently submit a new approval. Replayed confirmations or cancellations observe the current state. Changes to action versions, source access, permission or an expiring preview require fresh review. Resume uses the same explicit approval flow as initial enrollment.

No follow-up choice creates a coordinator disclosure or notification. Plan controls, response deferral and check-in timing remain separate. Private reports and presentation evidence remain reserved for later steps; this UI does not create either.

## Backend and release

Forward-only migration `105_student_follow_up_controls.sql` adds a restricted account-scoped overview/cancellation command and content-free cancellation receipts. The runtime receives execution only; raw table access remains denied. Cancellation shares the account lock used by step 1's approval commands, clears pending previews and turns existing consent off atomically. An old stop-all retry cannot stop a newer enrollment. Receipts cascade on student/account deletion and confer no permission after restore; existing recovery leaves enrollments off or paused.

Startup requires migrations **104 and 105** and both command grants when enabled. Coordinator readiness probes the same requirements with deployment flags off. Apply the new migration with the migration identity and refresh runtime grants before a compatible deployment. Leave `ORIGEN_STUDENT_FOLLOW_UP=false` through the remaining Phase 3 implementation and release checks. No extra database, scheduler, Redis instance or paid service is needed.

The release verifier now includes the six new binder journeys and rejects incomplete language/viewport evidence. The existing coordinator-response and legacy follow-through browser fixtures recognize the default-off capability. The legacy fixture also follows the existing restored-divider navigation and verifies the guidance and explicit reply directly, replacing its outdated list-navigation and summary-counter assumptions.

## Validation

Validation used the existing isolated local PostgreSQL helper, disposable schemas and synthetic identities. The affected regression run passed **101 tests**, with zero failures, skips, cancellations or TODOs. This includes all 20 foundation/control tests plus plans, response choices/context/clarifications, account lifecycle, sharing isolation, recovery, configuration, readiness and release-evidence validation.

**18 browser journeys passed**: six new follow-up journeys, six existing response-to-action journeys and six legacy coordinator follow-through journeys. Each suite covers English and Spanish at widths of 1280, 390 and 320 pixels. New checks cover exact preview/approval, no optimistic success or duplicate clicks, pause/resume, dated choices without deadline changes, lost-response retries, offline recovery, action completion/reopening, feature-off cancellation, source changes, conversation deletion and logout. Desktop and mobile screenshots were also inspected.

TypeScript, production logging checks and the isolated production build passed. The build retains its large-bundle warning. Logs are `/tmp/origen-followup-step2-regression.log`, `/tmp/origen-followup-step2-browser-final.log`, `/tmp/origen-followup-step2-choice-browser.log`, `/tmp/origen-followup-step2-legacy-browser.log` and the corresponding `types-final`, `logging` and `build` logs. Browser screenshots and structured results are in `/tmp/origen-followup-step2-browser` and `/tmp/origen-followup-step2-choice-regression`; legacy screenshots are in `/tmp/origen-followup-step2-legacy-regression`.

No production migration, deployment, feature enablement or provider call was performed. Browser viewport checks do not certify physical-device behavior. The earlier Phase 2 and Phase 3 step 1 reports describe their earlier source snapshots.

Next: step 3 selects at most one appropriate, explicitly authorized check-in during a returning conversation.
