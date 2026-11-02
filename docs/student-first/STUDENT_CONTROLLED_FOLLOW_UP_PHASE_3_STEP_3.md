# Student-controlled follow-up — Phase 3, step 3

The server now selects one eligible check-in and reserves a shared opening allowance for the conversation. Migration 106 and the playback-evidence contract are implemented locally. `ORIGEN_STUDENT_FOLLOW_UP` remains default-off. The current voice adapters do **not** yet advertise `student-follow-up-v1`; step 4 must wire the verified playback controller, spoken enrollment and private updates before release. No production configuration or data was changed.

## Selection rules

Only explicit, current `scheduled` consent for an owned, unfinished accepted action is eligible. The selector rechecks the exact action hash, student, source response, sharing/AI permission and original validity ceiling. It ignores personal deadlines and coordinator dates when determining whether a check-in is due. The saved time zone and PostgreSQL's IANA rules determine the local date, including daylight-saving transitions.

The order is an explicitly selected action first; otherwise a match to the current topic, then the earliest student-selected local date. A next-conversation choice uses the local consent date for ordering. A selected action that is ineligible does not redirect the check-in to another action. Equally relevant actions with the same date produce `clarification_required`; the opening invites the student to identify what they want to revisit without blending actions or coordinator guidance.

At most 33 consent rows are examined before source projection. A truncated set without enough evidence to establish a unique choice suppresses the offer instead of scanning indefinitely or guessing. This is a bounded PostgreSQL operation with a transaction deadline, not a background scheduler.

Current user questions, registered live turns, onboarding, unconfirmed scope, same-conversation continuation, guide updates, workspace refreshes and disabled adaptive openings suppress proactive selection. Explicit binder focus takes precedence. Parent/family scopes cannot obtain a student follow-up candidate.

## One opening across the conversation

`origen_conversation_openings` records one allowance per authenticated account and conversation ID. The existing voice session header supplies that ID. Provider changes, reconnects, guide changes and student-scope changes do not reset it. Selection happens after fresh context loads, never during voice prewarming. Client-supplied opening decisions are discarded.

The same allowance governs accepted generic actions, unresolved questions, optional coordinator advice and student-controlled check-ins. The server decision overrides the existing adaptive selector; a null decision cannot fall back to another candidate. Source-linked accepted actions are excluded from generic reminders even while Phase 3 is disabled, so off, paused or future-dated check-ins cannot return through the older ranking path. Their private wording remains available when the student deliberately discusses the action.

A check-in claim lasts two minutes. A unique index prevents two devices from claiming the same enrollment revision. A released or expired claim frees the action for a later conversation, while the original conversation stays spent. After three abandoned attempts, consent pauses with `attempt_limit`; the binder explains that Origen could not complete the check-in and lets the student choose again. A fresh explicit approval is required to reset the allowance.

## Playback and decline contracts

Preparation does not count as a presentation or consume consent. The server returns a short, localized optional question bound to the selected action and claim. It stores a presentation hash, not a transcript. The application must verify the current claim immediately before speaking and invalidate prepared context on failed verification, current speech, interruption, stale scope or lost access.

`followUpOpeningPlayback` uses the existing `voicePresentation` mechanism: matching response creation, complete matching spoken text, successful response completion, started and drained audio, and the application's current audibility check. A generated transcript, muted audio, interrupted output, forced flush or silence cannot record hearing. This controller is application-owned and is not a model tool.

The authenticated evidence endpoint supports only `verify`, `present`, `release` and `defer`. It exposes no selector, ownership override, source override, outcome writer or arbitrary state setter. Verification and presentation recheck current enrollment, source, permission, action version, memory session and claim expiry. Presentation is idempotent: it adds one `application_playback` receipt and closes the one-time enrollment. It does not mark the action complete, infer an answer or save a private report.

For step 4 integration, feed both providers' normalized events into the controller and await `settled()` before registering the next independent student turn. This preserves ordering between completed playback evidence and the following utterance on a slow connection. Reverify before delivery and when context may have changed; on failure, stop using the prepared opening. The current adapters do not yet perform this wiring, so provider/device audibility is not certified by this step.

An exact, independently captured “not now” or its supported Spanish equivalent can pause the selected enrollment. The server matches the immediately following live-memory turn's sequence, identity and transcript hash; model-written text is insufficient. This works before or after acknowledged presentation. A delayed decline cannot pause newer consent. Silence, uncertainty, or another question produces no structured result.

## Isolation and lifecycle

The runtime receives execution of the scoped command and no raw table or restore-helper privileges. The account lock serializes selection, enrollment, cancellation and evidence writes. Source/plan locks make presentation checks consistent with concurrent changes. The new table contains identifiers, hashes, timestamps and states rather than coordinator prose, private reports or conversation transcripts.

Student deletion removes the identifying student/action links while retaining a spent, content-free conversation allowance; account deletion removes the ledger. Restore suppresses all restored allowances and clears presentation hashes. Existing recovery pauses/restores consent conservatively and removes old presentation receipts. It cannot revive an old approval or opening.

Apply migrations through `106_student_follow_up_selection.sql` and refresh runtime grants before a compatible deployment. Startup and readiness require migrations 104–106 and all three scoped commands when checking this capability. Keep the capability off until steps 4–6 and release checks are complete. No new paid service, Redis instance, vector store or database is required.

## Validation

Tests use isolated local PostgreSQL, disposable schemas, synthetic identities and synthetic provider responses. They cover bounded selection, explicit focus, topic/date precedence, ambiguous candidates, local-date boundaries, shared conversation limits, competing devices, abandoned claims, retry caps, source/role/permission changes, exact presentation, decline ordering, stale retries, recovery, deletion, raw-table denial and preparation versus presentation. Real profile negotiation verifies the shared budget across Realtime and Live while discarding forged opening decisions.

The broader affected suite passed **193 tests**, with zero failures, skips, cancellations or TODOs. After final evidence-validation and failed-playback refinements, the overlapping opening/prompt/playback suite passed **43 tests**, also without failures or skips. **Six binder browser journeys** passed in English and Spanish at widths of 1280, 390 and 320 pixels. TypeScript, production logging checks and the isolated production build passed; the build retains its large-bundle warning.

Logs are `/tmp/origen-followup-step3-regression-final.log`, `/tmp/origen-followup-step3-opening-final.log`, `/tmp/origen-followup-step3-browser.log`, `/tmp/origen-followup-step3-types-final.log`, `/tmp/origen-followup-step3-logging.log` and `/tmp/origen-followup-step3-build.log`. Browser results/screenshots are in `/tmp/origen-followup-step3-browser`. The release verifier includes the new selector and playback suites for subsequent checks.

Earlier Phase 2 and Phase 3 reports describe their earlier source snapshots. No external provider listening or physical-device checks were performed.

Next: step 4 connects the application controller to both voice adapters and implements separately confirmed private updates.
