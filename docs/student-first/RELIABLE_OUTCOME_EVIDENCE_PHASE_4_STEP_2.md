# Phase 4, step 2 — Student-approved outcome recording

Implemented locally on November 2, 2026. Students can connect an existing private update to a specific outcome in the binder or through an explicitly requested voice flow. `ORIGEN_OUTCOME_EVIDENCE` remains **false by default**. No production configuration, database or paid service was changed.

## Student experience

A compact **What happened / Qué pasó** section appears inside each private update when enabled. The student chooses the specific result, what they know, institution, academic term, process/application and observation period. An unknown date remains unknown. The student can correct the canonical update's wording or event date, review the complete proposed change, and separately approve the private save.

Submission, acceptance, receipt of a decision and approval remain distinct. Receiving a denial is a decision, not an approval. Pending, unknown, not occurred and changed goals are preserved; declined/unknown responses do not acquire invented facts. Saving an outcome does not change task progress, enroll/reschedule a check-in, share a request or authorize evaluation/training.

Existing generic updates remain usable without classifying them. Saved outcomes can be corrected or removed. Removing an outcome removes its evidence links while preserving the original updates and separately approved shared copies. History and erasure remain available while new recording is paused.

## Record and approval boundaries

Migration `110_student_outcome_recording.sql` extends the existing Phase 3 proposal/approval command with an `outcome` kind. It does not create a second consent engine. The public input contains a selected definition/version, institution/term/process, observation dates/time zone, exact report ID/version and claim/decision. Optional correction and replacement references are closed contracts; callers cannot supply verification, helpfulness, action status, evaluation authority or sharing permission.

The server resolves the current accepted action, source response, permission and report. The proposal binds their exact versions and derived snapshots. The final approval rechecks these records while holding the existing account/source locks. The committed evidence points to the canonical report version; history reads its wording through that exact-version join. There is no independently editable evidence prose store. Temporary readback text is scrubbed on completion and when the canonical report is corrected/deleted.

Canonical wording/date corrections and evidence replacement commit atomically. The original report creation time remains intact; an approved later event date is checked against the last update time and the actual current date. A correction invalidates other links derived from the old report. Renewal of an existing episode requires fresh approval, increments its version, rebinds action/source permission and removes prior evidence links, as disclosed in the preview. Source expiry cannot silently renew an earlier approval.

Approval receipts are idempotent. A retry cannot resurrect a deleted or superseded record. Stale report, action, source, permission or restoration state rejects the proposal. Outcome changes also invalidate provider context, including deletion through an episode cascade. Runtime roles still cannot read/write raw outcome tables or execute internal helpers. All evidence stays student-reported, private, unassessed, not institution-verified and excluded from evaluation.

## Voice

The compatible client negotiates `student-outcome-v1`; the server derives availability from the existing student follow-up, personalization/write and role rules plus the outcome flag. Client-supplied capability booleans are discarded.

`list_student_outcome_reports` returns bounded, owner-scoped report and existing outcome references for the independently requested accepted action. `prepare_student_outcome_evidence` prepares the exact selection. Corrections use returned evidence IDs/versions rather than invented references. Ambiguous reports, missing scope and larger histories require clarification or binder review.

Both Live and Realtime reuse independent transcript registration, complete audible readback receipts, the playback-registration barrier and the immediately subsequent explicit save approval. Ordinary answers, generated transcripts, partial playback and a vague yes are insufficient. English and Spanish use the same database rules. An uncertain save directs the student to saved history and is never automatically retried. A confirmed outcome save refreshes the voice session context.

## Separate coordinator disclosure

The outcome card opens the existing **Share an update** composer with only the selected statement, event date/time zone, institution/term/process and request for evidence review. The existing preview names the recipient and binds approval to the exact selected wording, notes and response/publication version. Private report/evidence IDs, helpfulness, unrelated updates and private plan context are not attached.

The shared selection is editable disclosure text in the existing `student-update` request contract. It is **not** a live private-record join or an automatic structured coordinator assessment. If the selected wording exceeds the existing 2,000-character question limit, the UI directs the student to select wording in the regular sharing composer rather than truncating it silently. Voice sharing uses the existing separate coordinator-request approval flow.

An older shared copy retains its approved wording after private correction. A new result or different scope requires a fresh approved disclosure. Step 3 must capture the coordinator's explicit claim, observation and basis against the approved publication; it must not infer a private relationship or relabel an older publication from matching text.

## Verification and rollout

Local checks use disposable PostgreSQL schemas/roles and synthetic identities. The new database/voice tests cover exact version binding, separate save/share, canonical corrections, unknown dates, denial versus approval, idempotency, ownership, endpoint separation, stale approvals, restoration, paused flags, deleted evidence and both provider adapters in both languages.

The new `scripts/outcome-evidence-smoke.cjs` runs actual React controls and scoped HTTP handlers against disposable PostgreSQL. Six journeys cover English/Spanish at 1280, 390 and 320 pixels, private approval, named-recipient sharing, lost-response recovery without repeat writes, private correction versus approved publication, offline clearing, paused erasure and privacy teardown. Existing private-update and shared-update browser suites remain regression checks. TypeScript, isolated Vite build and logging checks are also required.

Completed results for this step:

| Check group | Result |
| --- | --- |
| Outcome recording, foundation and voice-controller tests | 57 passed, zero skipped |
| Affected voice, private/shared update and release regressions | 93 passed, zero skipped (includes overlapping controller coverage) |
| New outcome browser journeys with real local database | 6 passed |
| Existing private-update and shared-update browser journeys | 12 passed |
| Final TypeScript, isolated Vite build, logging policy and patch whitespace | Passed |

Browser screenshots/results were written under `/tmp/origen-outcome-step2-browser`, `/tmp/origen-followup-step4-browser` and `/tmp/origen-followup-step5-browser`. The production build retained the repository's existing large-chunk advisory.

The integrated release verifier now includes the outcome tests and six browser journeys, but its complete Phase 6 gate was not rerun for this implementation step. Real-provider listening, physical-device behavior and deployed authentication/infrastructure checks remain outstanding.

Before enabling, apply migrations through **110**, refresh runtime grants and run coordinator readiness plus the complete local verifier. Keep the compatible backend and schema when pausing the feature. Steps 3–6 (coordinator observations, reconciliation, guidance use and integrated verification) remain planned. This step adds no Redis dependency, additional hosted database or outbound reminder service.
