# Phase 3 — Student-controlled follow-up

Status: all six steps are implemented locally: [permission and data foundation](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_1.md), [binder controls](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_2.md), [selection and presentation contracts](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_3.md), [voice conversations and private updates](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_4.md), [separately approved coordinator updates](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_5.md), and [connected verification and release preparation](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_6.md). Step 6 passed 379 automated tests with zero skips and 81 browser checks, including 12 complete follow-up journeys. The feature remains default-off; deployed identity, real-provider/device and infrastructure checks remain separate from local implementation.

## Intended experience

A student can ask Origen to revisit a coordinator-related action in a later conversation. The student chooses whether to revisit it, whether to save a private update, and whether to share an exact update with their coordinator. These are three separate decisions.

Keep the existing voice-and-binder experience and coordinator workspace. Follow-up happens during a student-started conversation, not through an outbound call, email, SMS or push notification. A chosen date means the next eligible conversation on or after that local date; it is not a promise to contact the student at a particular time.

Start with accepted private actions linked to Phase 2 review-request responses. An unread response or an unaccepted suggestion is not an action to check on. Preserve student-initiated discussion and clarification for other responses. Legacy binder comments, review requests and general progress reports remain distinct record types with distinct permissions.

## Existing foundation to reuse

- Phase 2 response references, source guards, private deferral and accepted action links: `server/review-response-context.mjs`, `server/review-response-choices.mjs`, `src/reviewResponseConnection.mjs`, and migrations 100–103.
- Canonical private plans and their existing statuses: `server/plans.mjs` and `src/ActionPlan.tsx`. Do not create a second task-status store.
- Returning-conversation selection and suppression: `server/binder-next-step.mjs`, `server/adaptive-guidance.mjs`, and `server/conversation-continuity.mjs`. Extend their shared opening budget rather than adding another competing opening.
- Independently captured speech, playback verification and scoped writes: `src/ProfileVoice.tsx`, `src/voiceMemoryTools.mjs`, `server/live-memory.mjs`, and the existing Live/Realtime adapters.
- Explicit sharing, exact readbacks, idempotent delivery and withdrawal: the review-request handlers, voice consent controller, transactional outbox and existing coordinator request card.
- The expanded `review-responses:verify` runner and isolated local PostgreSQL environment.

The existing `Review later` choice does not grant follow-up permission. Neither a coordinator's suggested date, a private action due date, accepting an action nor having a coordinator connection grants that permission. Existing general progress/helpfulness reports feed operator/admin aggregates; new private follow-up reports must not silently enter those reports or inherit their definitions.

## Step 1 — Define ownership, permission and lifecycle

Establish a typed, owner-scoped follow-up contract referencing the student, accepted plan/step and exact source response version. Resolve identities server-side; never accept model-supplied ownership, eligibility or approval.

Keep separate facts for follow-up permission, actual presentation of a check-in, the current plan status, a student-approved private report and an approved coordinator disclosure. A closed check-in is not a completed task. Completion of an action is not proof that the problem was resolved or that the coordinator's advice caused success.

Use explicit follow-up states such as off, scheduled, paused and closed. Bind permission to the version of the action the student approved, record the selected local date/time zone, and make enrollment one check-in at a time. Existing preferences remain off unless the student explicitly opts in; do not backfill consent from Phase 2 data.

Define separately recorded/occurred dates and provenance for any private report. Initial reports are student-reported, never institution-verified. Keep reports minimal: what action the student says they took, an optional obstacle/result in their own words, and optional helpfulness only when they choose to record it. Missing, declined and unknown are distinct; none means failure.

Implement forward-only migrations, narrowly scoped commands, optimistic revisions, idempotency and export/deletion/restore behavior. Source edits, withdrawal or permission loss suspend source-linked offers; they do not rewrite accepted private actions. Resume only through a fresh student choice after revalidation. Deleting an action removes its enrollment and report links. Restore must not reactivate old consent or pending deliveries.

**Done when:** contract and database tests prove ownership, no inherited consent, version handling, isolation from coordinator/admin projections, and lifecycle cleanup. The capability is default-off from its first introduction.

## Step 2 — Add student controls in the existing binder

Add a small follow-up section to an accepted action, with **Check in next time**, **Choose a date**, **Pause**, and **Stop**. Explain that the check-in occurs when the student next talks with Origen. Allow the student to resume deliberately or stop all Phase 3 check-ins from one accessible preference.

Show the choice in the student's voice, for example: “I asked Origen to check in about this next week. This stays private.” Display confirmed saved state only after the server acknowledges it. Existing request history and plan controls remain in place; no chat view, captions or coordinator layout redesign is introduced.

Keep response deferral, task status and follow-up scheduling separate. A personal deadline is not changed when a check-in is moved. A completed, archived, deferred, deleted or materially edited action suppresses its pending offer; an edit must not silently transfer permission to different work. Stopping check-ins stays available when the feature is paused, and offline failures must not falsely appear saved.

**Done when:** English/Spanish controls work at desktop and narrow mobile widths, retries cannot duplicate enrollment, and no student choice produces a coordinator notification.

## Step 3 — Select one appropriate check-in

Build a bounded PostgreSQL lookup for explicitly opted-in actions that are due, still owned, unfinished, relevant and permitted. Use transparent rules: explicit student focus first; otherwise the eligible student-selected date and current topic determine selection. Ask for clarification instead of mixing different students, actions or coordinators.

Integrate with the existing adaptive opening selector: at most one proactive opening across all candidate types in a genuinely new returning conversation. The student's current question takes priority. Reconnection, guide handoff and provider changes within the same conversation do not reset the allowance.

Use server-side claims and presentation receipts to prevent duplicate offers across concurrent tabs/devices. Preparation is not proof of presentation; interrupted or inaudible output is not a heard question. Release/expire abandoned claims with bounded retry behavior, and do not repeatedly retry during the same conversation. A delivered one-time check-in is consumed even if the student chooses not to answer; another check-in requires a new student choice.

“Not now” suppresses further offers and pauses that item until the student reschedules it. Silence is not consent, failure or completion. Recheck permissions, action version and source availability before using a candidate, and invalidate prepared/active context when those facts change. Calendar decisions must respect the saved time zone and daylight-saving changes.

**Done when:** deterministic tests cover prioritization, dates, global opening limits, concurrent sessions, reconnects, stale sources and suppression without repeated prompting. PostgreSQL and existing services suffice; no new scheduler, Redis or vector database is needed.

## Step 4 — Support follow-up conversations and private updates

Connect both Live and Realtime to the same server-derived permission and candidate. Use one optional opening, for example: “You asked me to check in about contacting the insurance office. Would you like to pick that up?” If the student agrees, follow their answer naturally; do not turn the conversation into a required questionnaire.

Support spoken enrollment, rescheduling and cancellation using independently captured intent. Clarify ambiguous dates and read back the date and scope before saving enrollment. Honor an unambiguous stop immediately without a persuasion or reconfirmation loop.

Distinguish “I called the office,” “I am waiting for an answer,” “I changed my mind,” and “The waiver was approved.” Contacting the office can complete a contact action while leaving the insurance question unresolved. A saved summary, model inference, a coordinator reply or a vague “yes” cannot establish a structured result.

When the student wants to save an update, present the exact proposed wording, provenance and any plan-status change. Require explicit confirmation through binder review or the existing complete audible readback plus independently verified subsequent approval. Save the private report and any approved canonical plan change atomically and idempotently. Allow correction and deletion without reviving superseded reports in future context.

Ordinary conversation history continues to follow existing history/privacy settings. It does not automatically become a structured follow-up report or authorize sharing. Preserve attribution and use the existing official-source lookup path for current eligibility rules and deadlines.

**Done when:** both languages/providers handle full, partial, declined, interrupted and uncertain answers; update the binder only after confirmed saves; and send no private report to coordinators or general analytics.

## Step 5 — Offer a separately approved coordinator update

If the student wants the coordinator to know what happened, offer **Share an update**. Permit a clear spoken request too. Never treat follow-up permission, answering a question or saving a private report as sharing approval. A refusal must not trigger repeated offers.

Add an explicit student-update variant to the existing review-request contract, which currently distinguishes question, concern and review. Reuse its private draft, exact preview/readback, delivery receipts, source relationship and withdrawal/deletion controls. Do not build a second messaging system or expose a live view of private progress.

Preview the named recipient, exact student-approved update, optional selected notes and minimal earlier-response reference. The student can edit the draft; edits reset approval. This is a snapshot disclosure: subsequent private corrections are not silently sent to the coordinator. Let the student explicitly correct or withdraw an earlier shared update through the approved workflow.

Recheck source, recipient, institutional membership and sharing permission at approval, delivery and opening. If the original source or connection is unavailable, stop the linked send. Do not silently retarget it or replace the reference; the student can deliberately compose a new standalone request to a currently available coordinator.

Show the update in the existing coordinator request card as student-reported, with the existing response controls. Generic notifications must not contain private prose. “Delivered,” “opened,” “responded” and “student reports completion” remain distinct.

**Done when:** coordinators can receive and respond to the approved snapshot, while unshared progress, obstacles, declines and check-in settings remain private. Source edits, retries, concurrent edits and lost delivery responses cannot enlarge or duplicate the disclosure.

## Step 6 — Verify the experience and prepare release

Extend the Phase 2 verifier and CI with: accepted action → explicit check-in choice → later eligible conversation → optional answer → confirmed private update → separately approved coordinator update → coordinator response.

Test English/Spanish, Live/Realtime, desktop/mobile and narrow layouts. Include silent/declined answers, multiple devices, competing openings, muted/interrupted playback, time zones/DST, offline recovery, action edits/completion/archive/deletion, source changes, scope/permission changes, account switching, pause, correction, export, deletion and restore. Verify no private follow-up data reaches coordinator views, notifications, operator/admin reports or content-bearing logs without the intended authorization.

Use a dedicated backend capability, proposed as `ORIGEN_STUDENT_FOLLOW_UP=false`, with explicit startup dependency/readiness checks. The server remains authoritative. Pausing stops new offers and new enrollment/report creation while preserving saved history, privacy controls and the ability to cancel follow-ups. Existing approved disclosures retain their own delivery/withdrawal controls; a queue-wide hold uses the existing delivery switch.

Produce a source-bound, content-free verification report with no skipped automated cases. Record deployed identity, actual provider listening and physical-device checks separately; local synthetic results do not certify them. Document enablement, pause and compatible rollback without dropping migrations or reviving consent. Use the isolated local PostgreSQL environment and existing services.

**Done when:** the expanded verifier passes, earlier binder/coordinator journeys remain intact, and release instructions honestly identify any unperformed external checks.

## Example

Alex accepts “Ask the insurance office which proof of coverage they need.” Alex chooses a check-in next week. In the next eligible conversation, Origen offers to revisit that action once. Alex says, “I called, but they still need a letter from my employer.”

Origen helps with that immediate question. If Alex asks to record the update, it confirms the proposed private wording and whether Alex wants the contact action marked complete. The insurance result remains pending; no waiver approval is inferred. Alex can separately approve sharing “I contacted the office; they requested a letter from my employer” with Maria. Maria sees only that approved update and its permitted reference.

If Alex says “not now,” the item is paused. Maria receives nothing. If Alex never returns, the record stays unknown rather than becoming an unsuccessful outcome.

## Boundary with later recommendation work

Phase 3 adds a deterministic follow-up policy and a reliable account of what students choose to report. It does not train a cross-student recommendation model, score coordinators or claim that an intervention caused success. Later work can define consent and permitted uses, outcome verification, missing-data handling and effectiveness evaluation before learning across students or institutions. A private report is not automatic research, training or partner-export permission.

The next planned stage is [Phase 4 — Reliable outcome evidence](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_PLAN.md), with six implementation steps covering outcome definitions, exact evidence links, attributed coordinator observations, deterministic assessment, permitted quality evaluation and release verification.

All six implementation steps are complete locally with the capability still disabled by default. Use [step 6's release guide](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_STEP_6.md) and its source-bound verification report before deployment; complete the separately recorded external checks before enabling the capability.
