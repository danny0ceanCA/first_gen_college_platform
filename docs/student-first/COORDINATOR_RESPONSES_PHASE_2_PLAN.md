# Phase 2 — Connected coordinator responses

Status: November 1, 2026. Steps 1–6 are implemented locally; see [step 1](COORDINATOR_RESPONSES_PHASE_2_STEP_1.md), [step 2](COORDINATOR_RESPONSES_PHASE_2_STEP_2.md), [step 3](COORDINATOR_RESPONSES_PHASE_2_STEP_3.md), [step 4](COORDINATOR_RESPONSES_PHASE_2_STEP_4.md), [step 5](COORDINATOR_RESPONSES_PHASE_2_STEP_5.md) and [step 6](COORDINATOR_RESPONSES_PHASE_2_STEP_6.md). The expanded local verifier passed 247 automated tests and 51 browser checks without failures or skips. Local validation covers real database boundaries, browser controls and synthetic voice transport; provider listening checks remain part of release verification. Production enablement is separate.

## Goal and current foundation

Connect the response already attached to a student's review request to their next conversation with Origen. The student can understand the advice, choose a private next action, or explicitly ask the coordinator a related question. Keep the existing coordinator layout and the student's voice-and-binder experience.

Phase 1 already supplies the approved question and selected notes, versioned coordinator response, optional suggested action/resource/date, in-app delivery, binder receipt, withdrawal/deletion and export/restore handling. Do not rebuild those features or create a second response store.

The existing older guidance path in `server/coordinator-voice-context.mjs` selects relevant binder comments and distinguishes private progress from coordinator-visible replies. `src/CoordinatorGuidance.tsx` and the private plan controls already support student acceptance of suggestions. Those comments and Phase 1 review-request responses are different record types. Reuse their interaction and authorization patterns without treating their IDs, permissions or receipts as interchangeable.

Phase 2 completes connected response handling. Proactive questions about what the student actually did, structured outcome collection, consent to share outcomes, and learning which interventions work belong to subsequent phases.

## Implementation steps

### Step 1 — Define the response connection and lifecycle contract

Extend the existing request/response foundation with typed references for conversation focus, private student choices and any explicitly related follow-up request. A reference identifies the request and exact response version, not a copied response body. Preserve author, organization, date, original question and current response state as distinct facts.

Define separate facts for delivery, opening, discussion and explicit action acceptance. None implies understanding, agreement, completion or resolution. Reading response context for the model must not mark a student as having heard, read or accepted it.

Specify behavior for edits, response withdrawal, student request withdrawal, connection loss, permission changes, deletion and restore. A retained student receipt after request withdrawal is historical private material; it does not restore coordinator access. Allow explicit discussion of an available historical receipt only within the student's currently authorized AI scope, with accurate attribution and no proactive reminder. A withdrawn response body is unavailable.

Done when: schema/API contracts and lifecycle tests distinguish current advice, retained history and unavailable content; no new capability is enabled by client/model flags.

### Step 2 — Retrieve the right response safely

Add a bounded, student-owned response lookup for explicit binder focus and relevant spoken questions. Start with deterministic topic/request matching, newest applicable versions and clarification when multiple responses fit. Return at most one full response for a conversational turn, along with its source/version and approved question context. Exclude unrelated notes, family material, staff-only information and other students' requests.

Reuse the existing voice context, request isolation and retrieval deadlines. Recheck version and availability before returning content or writing a linked action. On source changes during a call, invalidate stale context and refresh or restart the affected context using the existing voice-session controls. Do not claim provider-held context was erased merely because a database row changed.

Done when: explicit focus retrieves exactly the selected response, an unrelated question receives no response context, ambiguous requests are clarified, and stale/withdrawn/cross-account data is rejected. PostgreSQL is sufficient; Redis and vectors are unnecessary for this bounded lookup.

### Step 3 — Connect responses to Live and Realtime conversations

Teach both voice paths to explain a retrieved response with attribution: “Maria suggested checking the waiver requirements. Would you like to go through them?” Preserve qualifications, deadlines and uncertainty. Clearly distinguish the coordinator's statement from Origen's explanation and any independently checked institutional information.

Treat response text and linked resources as reference material, never executable instructions. A coordinator's advice alone does not establish financial aid or insurance eligibility. Questions about current rules should use the existing source-checking path and disclose uncertainty when verification is unavailable.

Support student-initiated discussion first. A relevant proactive offer must use the existing adaptive opening rules, at most once per conversation, and respect a decline, deferment or topic change. A suggested follow-up date is a relevance hint; it does not authorize reminders or outcome questioning.

Done when: English and Spanish conversations accurately explain one current response across both providers, honor interruptions and corrections, and avoid inventing receipt, action or success claims. No captions or chat interface are added.

### Step 4 — Connect the binder to private student choices

Add small controls within the existing response section: **Talk about this**, **Review later** and, when an action exists, **Add to my next steps**. Talk about this passes a versioned focus reference into the voice path. Explicit deferral suppresses proactive offers until the student revisits it or a student-selected review time becomes relevant; it creates no external reminder by itself.

Reuse private plan creation with an editable preview and explicit acceptance. Store the accepted wording and source response version. Model explanation, opening a response, or a vague acknowledgment must not create an action. Voice acceptance must use independently captured student intent and an application-verified confirmation; a model argument cannot supply consent.

Coordinator edits cannot silently rewrite a student's accepted plan. Preserve independently accepted private actions when the source becomes unavailable, remove cached response quotations and source access, and indicate that the source is no longer available. Student/account deletion still removes the student's data. These semantics must be covered by deletion/export/restore tests.

Done when: students can move from a response to a focused conversation or an explicitly accepted private action; the coordinator receives no private discussion, deferral or progress data.

### Step 5 — Support an explicitly connected clarification request

When the student wants more help from the coordinator, let them prepare a new review request linked to the original request and response version. For example: “Ask Maria which proof of coverage I need.” Reuse Phase 1's private draft, exact preview/readback, explicit approval, durable delivery and withdrawal controls.

The new approval must show exactly which question, notes and minimal prior-response context will be shared, and with whom. Never automatically attach the whole conversation or thread. Revalidate the original response version and current recipient connection at approval and delivery; an intervening edit or withdrawal requires a new preview when it changes the approved context.

Show the relationship inside the existing coordinator request card and student binder history. Avoid a new messaging layout or unlimited nested conversation display. Existing request limits and bounded pagination continue to apply.

Done when: a follow-up is attached to the correct question and response version, only the approved content reaches the current selected coordinator, and retries or source changes cannot duplicate or silently change the disclosure.

### Step 6 — Verify the connected experience and prepare release

Extend Phase 1's release verifier and CI with the complete journey: coordinator response → student asks Origen → attributed explanation → explicit private action or approved clarification → coordinator response update. Cover English/Spanish, desktop/mobile and Live/Realtime.

Include ambiguous recipients, stale/withdrawn responses during a call, changes between preview and approval, permission/role changes, unavailable network, interrupted consent, duplicate operations, deferred offers, account switching and deletion/restore of linked records. Keep logs content-free. Validate that private student activity never becomes visible to coordinators without a separate approved sharing action.

Use a dedicated default-off Phase 2 capability with startup dependency checks and a pause control. Pausing AI response assistance must preserve existing binder history and privacy controls. Record local synthetic results separately from deployed authentication and physical-device voice checks. Keep production enablement separate from implementation.

Done when: the expanded verifier passes without skips, the existing coordinator/binder experience passes regression checks, and the deployment/rollback procedure records any remaining external checks honestly.

## Example after Phase 2

Maria responds to Alex's insurance question: “Compare your employer coverage with the campus waiver requirements, then ask the insurance office which proof they accept.” Alex opens the response and selects Talk about this. Origen attributes Maria's suggestion, explains what proof of coverage means and offers help identifying the appropriate campus source.

Alex chooses to save “Ask the insurance office which proof of coverage they accept” as a private next step after reviewing the wording. The binder connects that action to Maria's response version. No claim is made that Alex contacted the office.

If Alex instead says, “Ask Maria which document I should request from work,” Origen prepares an explicitly related request, reads the complete disclosure and waits for approval. Maria receives only that approved question and selected context. Alex's private conversation remains private.

Later phases can ask whether Alex contacted the office, distinguish student-reported action from verified outcomes, and ask separately whether Alex wants to share an update with Maria. Those outcomes can eventually inform a recommendation system after data quality and effectiveness have been evaluated.

## Sequence

Steps 1–6 are implemented locally, including the integrated release rehearsal. Continue using the isolated local PostgreSQL environment and existing services. Before production enablement, complete the deployed authentication, provider listening and physical-device checks documented in step 6. The next planned work is [Phase 3: student-controlled follow-up](STUDENT_CONTROLLED_FOLLOW_UP_PHASE_3_PLAN.md). Recommendation learning remains a later phase.
