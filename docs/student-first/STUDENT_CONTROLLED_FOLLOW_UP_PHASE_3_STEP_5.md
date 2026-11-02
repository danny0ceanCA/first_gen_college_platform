# Phase 3, step 5 — Separately approved coordinator updates

Implemented locally, default-off. Students can deliberately share a selected update through the existing coordinator review-request flow. Follow-up permission, a check-in answer and a private save remain separate from sharing consent. No production migration, feature enablement, deployment or real provider call was performed.

## Student and coordinator experience

**Share an update** appears alongside an answered private update in the binder and alongside a current coordinator response. Choosing it opens the existing private request composer for the original coordinator. From a saved report, only its written detail is copied into the editable draft; structured progress, outcome, helpfulness, dates, plan notes and other reports are not attached. A report without detail starts with blank wording. The student chooses what to say and may select eligible written notes using the existing controls.

The preview names the recipient and organization, displays the exact wording and selected notes, and includes the minimal original approved question and exact response reference. The student must separately approve this disclosure. **Edit before sharing** creates a fresh draft and resets approval. A preview, private draft or lost response cannot be interpreted as successful delivery; **Check saved request** resolves an uncertain approval before another attempt.

The shared update is a separate copy. Correcting or deleting a private report does not change or delete the approved copy. Students can create and approve a revised request in **My requests**, then explicitly withdraw or delete the earlier request. The earlier copy stays available until withdrawn, expired or invalidated by its source/access rules; a correction is not an automatic replacement. These distinctions are explained in the preview, voice readback and private-update area.

The existing coordinator card labels the request **Student-reported update · Not institution-verified** and retains its existing review and response controls. Delivery, opening, review, response, reported completion and reported resolution are independent facts. There is no new chat interface, caption stream, coordinator layout, automatic sharing prompt or recurring prompt after a refusal.

## Voice

Live and Realtime expose the `student-update` kind only when the server derives permission for the current student. A complete request such as “Share this update with my coordinator: I called and am still waiting” prepares a private draft. Ambiguity requires clarification; the current captured instruction must explicitly request sharing and mention the coordinator. Names alone are not resolved by the consent parser: Origen can request a complete instruction mentioning “my coordinator.” The exact source response and its original accepted connection remain required.

The application-generated readback includes the recipient, exact proposed words, every selected note, original approved question, response date/version, expiry, withdrawal, student-reported provenance and separate-copy warning. The existing playback controller requires complete audible playback and explicit approval in the immediately following independently captured turn. “Yes, send it” / “Sí, envíalo” can approve sharing; “Yes, save it” / “Sí, guárdalo” only belong to the private-save flow and do not approve this request. Interrupted, shortened, muted or unverified playback cannot approve sharing. A later correction requires a new readback and approval.

Private follow-up tools still only save privately. The model cannot authorize sharing by passing a consent flag, report ID, recipient permission, provenance claim or an entire report. Instructions prohibit automatically copying private history or helpfulness and prohibit implying verified outcomes or causation.

## Implementation and lifecycle

- Migration `108_student_shared_updates.sql` adds `student-update` to the existing request kind constraint, requires an exact response reference and adds server-derived `student_reported` / `separate-copy-v1` metadata to the approved payload. It patches the existing scoped creation, preview, submission and coordinator-read functions. It creates no report projection, tables, grants, messaging system or new paid service.
- New drafts and previews/approvals require `ORIGEN_STUDENT_FOLLOW_UP`, existing review-request and response-context capabilities, delivery and the student's personalization retrieval/cohort permission. Model-supplied flags are discarded by profile-voice preparation. Readiness now requires migrations 104–108 and the existing four scoped follow-up command grants.
- Migration 103's immutable response relationship and current-source checks remain in force. Create/approve locks and checks the source, original recipient, membership and sharing permission. Delivery/opening recheck access. A source edit, withdrawal or permission loss cannot silently detach or retarget the update. An unavailable linked request stops; the student may deliberately use **Write a request** to compose a separate ordinary request to a current coordinator.
- Existing request creation receipts, preview digests, atomic publication, transactional outbox, delivery deduplication and withdrawal/deletion are reused. A private correction does not invalidate a separately selected disclosure. A source response change invalidates linked shared access and scrubs the publication payload. Notification/outbox records contain routing metadata rather than update prose.
- Account export, deletion, restore and privacy boundaries reuse the existing request lifecycle. Private report storage remains separate and inaccessible to coordinator reads. A shared request retains no private-report identifier or live report relationship.
- The release verifier now includes `student-shared-updates.test.mjs` and six bilingual `student-shared-update-smoke.cjs` browser journeys. Prompt identity includes the migration and request-policy module. Previous release reports describe previous source snapshots; this document does not replace step 6 release certification.

Pause new student updates with `ORIGEN_STUDENT_FOLLOW_UP=false`; students can still inspect, withdraw or delete existing requests. Pausing creation is not revocation of an already approved publication. Keep migrations in place during a compatible code rollback, and use the existing request withdrawal/sharing revocation controls for published access. Production remains unchanged.

## Validation

Validation uses isolated local PostgreSQL, disposable schemas, synthetic identities and synthetic voice/HTTP transport. The runner strips application credentials and production database settings. No additional database service is required.

**207 affected regression tests passed**, with zero failures, skips, cancellations or TODOs. After the final Live speaking-policy and evidence-validator edits, all 69 focused policy/model/sharing rechecks also passed. The targeted checks cover private-report isolation, exact approved snapshots and selected notes, correction/deletion independence, duplicate and concurrent submissions, cohort/flag pauses, original-recipient enforcement, source changes before approval/delivery/opening, source-edit races, coordinator replies and withdrawal. Both provider configurations and both spoken approval languages are exercised, with existing playback-controller regression coverage.

Eighteen browser journeys passed: six shared-update journeys, six existing private-update journeys and six existing linked-question journeys, each in English/Spanish at 1280, 390 and 320 pixels. They cover editing/resetting approval, uncertain-send recovery, unchanged shared copies after private correction, stale-source cancellation, private controls and existing coordinator cards. TypeScript, the isolated production build and the production logging policy checks passed. The existing large-bundle build warning remains.

Evidence: `/tmp/origen-step5-regression.log`, `/tmp/origen-step5-final-policy-check.log`, `/tmp/origen-step5-types-final.log`, `/tmp/origen-step5-build.log`, `/tmp/origen-step5-logging.log`, `/tmp/origen-step5-browser-final.log`, `/tmp/origen-step5-private-browser.log` and `/tmp/origen-step5-linked-browser.log`. Browser screenshots/results are under `/tmp/origen-followup-step5-browser-final`, `/tmp/origen-followup-step5-private-browser` and `/tmp/origen-followup-step5-linked-browser`.

Real provider listening, physical-device audibility and deployed identity checks remain for step 6. Local synthetic checks do not certify those conditions or enable the production flag.
