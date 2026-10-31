# Binder guidance loop — Phase 4

Implemented locally on October 31, 2026: private, explicit follow-through on coordinator guidance. This extends the evidence projection, permission-aware conversation context, and optional next-step ranking from phases 1–3.

## Student experience

Each visible coordinator comment has a small **My follow-up · Private to you** area in English and Spanish. The student can mark an idea explored, set it aside, or revisit it. Reading a comment, talking about it, or ending a conversation never changes this state.

The existing **Add to my next steps** flow remains the explicit acceptance mechanism. Once linked, the comment displays the current private task status and directs the student to My next steps to manage it. It no longer offers duplicate acceptance. A completed task is described as student-reported; an archived plan is not completion. Plan-change notifications refresh the comment's status.

These choices do not send a reply or notification to a coordinator and do not alter sharing. The existing explicit Reply and sharing controls remain separate.

## Conversation behavior

- An optional opening excludes guidance already explored, set aside, or linked to a task. Another eligible suggestion can still be considered.
- Accepted unfinished tasks continue through phase 3's task ranking; the original suggestion is not simultaneously offered for acceptance again.
- A student can deliberately return to a comment through Talk about this or a relevant question. Its current private progress accompanies the authorized context.
- Both voice paths receive the common instructions distinguishing exploration, acceptance, deferral, student-reported completion, and archived plans. No comprehension or completion is inferred from conversation.
- Changes invalidate prepared voice context so an older snapshot cannot restore a stale private choice. Existing plan triggers cover task changes.
- Author edits preserve the original feedback version on the student's choice and linked task. Neither the UI nor the prompt treats revised advice as automatically accepted.

## Storage and access

Pending migration **093_private_guidance_follow_through.sql** adds state, separate optimistic revision, source comment version, and timestamp to the existing feedback receipt. It reuses existing idempotency receipts, account ownership checks, audit paths, and feedback commands. No new public API or direct runtime table access is introduced.

An internal SQL projection joins the existing feedback-to-step links with current owned plans and steps. It excludes deleted steps, retains plan and feedback versions, and bounds the projection to 30 links. A truncation flag prevents a bounded subset from being mistaken for completion of every linked task. Staff projections return no private progress.

The helper has a pinned search path and no PUBLIC or runtime execute grant. The existing command invokes it as its owner. Runtime readiness requires migration 093 when feedback is enabled; deployment must apply it before enabling this code. No new runtime grant is needed.

Students can keep managing private follow-up on a retained receipt after a sharing grant ends. This does not reopen coordinator access. Hidden, withdrawn, or removed guidance retains existing restrictions. Parent/family voice scope does not gain this student context.

## Verification

59 focused tests passed across binder evidence, ranking, coordinator voice context, feedback, follow-through, adaptive guidance, voice workspace, and plans. Real PostgreSQL tests use isolated disposable schemas and the runtime role, with simulated voice providers. Cases include duplicate retries, conflicting versions, wrong accounts/students/staff, hidden or revoked scope, staff projection privacy, no extra replies/outbox events, author edits, task progress/archive/removal, and English/Spanish prepared-context refresh.

The production build passed. A synthetic browser preview exercised exploration, set-aside, retry after failure, Spanish controls, linking a task, and updating its completion status. A 390-pixel viewport had no horizontal overflow. Browser testing found and corrected Spanish label encoding and a redundant reload after saving.

No paid live conversation was run. These checks establish persistence, authorization, projection, and prompt construction; they do not establish perfect spoken compliance. No production migration, permission update, commit, push, or deployment was performed.

## Deliberate limits

This phase does not automatically classify subsequent conversations as explored or completed, store private transcripts against coordinator comments, expose private task progress to coordinators, or estimate student understanding. Suggestions remain optional. The lightweight state is deliberately based on student choices rather than a new trained model or hidden assessment.
