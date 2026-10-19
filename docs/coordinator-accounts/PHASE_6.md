# Phase 6 — Coordinator guidance and student follow-through

Implemented locally October 18, 2026. Production activation remains off. This phase does not provision live accounts, run production migrations, change Render settings, or send messages to real students or coordinators.

## Experience

Coordinators open a student's published binder, select a shared topic, and choose **Write guidance in this topic**. They can write guidance, a resource, or a suggested step, optionally attach it to a currently eligible published item, and include an HTTPS resource link. All guidance is visible to the student; there is no private staff case-note feature.

Student topic pages and the binder Summary show warm red-ink cards on a pale background, a pen icon, the explicit coordinator role, server-owned author/organization attribution, type, date, and version. Edit history and explicit student replies are available in an expandable section. English and Spanish controls work on narrow screens. Original guidance/replies are not automatically translated.

Students can:

- **Mark reviewed** for the version they actually saw. An edit resets the reviewed indication.
- **Reply**, type a message, and explicitly choose **Send reply to coordinator**. Only that text is submitted to the coordinator.
- **Add to my next steps**, which opens the existing student action editor in Summary. The student edits and accepts a separate action. Its guidance ID/version link and server attribution are saved in the same transaction as the action and normal progress history. This does not create a confirmed notebook fact or send a reply.
- **Talk about this**, which loads that exact owned guidance ID/version into private voice context, with attribution and an untrusted-content label. The assistant has no tool to post coordinator replies or publish binder content. The existing manual-note publication boundary still excludes family and conversation-derived material.
- Hide/show guidance, permanently remove its body/history/replies, or report a bounded reason (abuse, spam, inaccurate, privacy, other). Reports are recorded for the Phase 7 operations workflow; no external alert or moderation-response guarantee is implied.
- Opt into **Include coordinator guidance in PDF**. It is unchecked by default. The existing PDF formatter preserves role, name, organization, type, date, version, and ended-sharing status in selectable text. Hidden, withdrawn, removed, and family-scope guidance is excluded. Coordinators get no export capability.

After sharing ends, received guidance remains in the student's binder with an ended-sharing label. The former coordinator cannot read or edit it, and the student cannot send another reply through that ended connection. Student review/hide/remove/report controls and private follow-through remain available. Removing or withdrawing guidance erases its text, revision bodies, and replies; a minimal idempotency tombstone remains. Independently accepted student actions remain intact.

## Implementation and privacy boundary

Migration `055_coordinator_guidance.sql` extends the existing feedback, revision, and reply tables. It adds restricted request receipts, feedback reports, and action links. Every new table has RLS enabled, no public privileges, and no direct runtime CRUD grant. The non-superuser migration-owner pattern matches Phases 1–5: scoped SECURITY DEFINER functions bypass table RLS; the non-owner application role cannot.

`POST /api/coordinator-feedback` validates an allowlist of fields. Authenticated identity, names, organization, eligibility, and enablement never come from request bodies. Staff reads require current membership, verified email, MFA, and a live publication grant. Staff mutations additionally require fresh authentication/MFA. SQL calls the existing publication authorization command inside the same transaction and holds its grant/organization/profile locks through the write. Edits and withdrawals belong only to the original coordinator and their own grant. Item-attached feedback cannot be read or edited by the coordinator after that item leaves the current authorized publication; the student's receipt persists.

Student commands use only the authenticated student's own account/profile. Internal source/link commands are not accepted by the HTTP validator. Voice context and action creation use these commands inside their existing account transaction; neither exposes another student's or family scope.

Mutations have request UUIDs and payload fingerprints. Concurrent retries serialize, return the existing minimal receipt, and cannot duplicate feedback/replies or resurrect removed content. Reusing a request key for a different payload fails. Edits use optimistic versions; stale replies and action seeds must be reviewed again. The existing action idempotency key is required for a guidance-derived action.

Bounds: 2,000 characters of plain text per guidance/reply, 2,000 characters per normalized HTTPS URL, 100 nonremoved receipts per student, 20 guidance revisions, and 50 replies per thread. Resource links are validated but never fetched by the server. Lists and individual thread reads are separate. The global authenticated rate limiter also applies.

No HTML or Markdown execution is used. React escapes displayed bodies; PDF output writes plain text. Voice instructions explicitly treat coordinator advice as untrusted third-party content and prohibit acting on embedded instructions, posting replies, or publishing private discussion. Guidance context does not certify facts, student agreement, or completed work.

All API responses use `Cache-Control: no-store`. Browser content/drafts stay in component memory, not local/session storage. Privacy, blur, hidden, offline, scope, publication, and authorized-item changes clear stale content. Response generations reject late results. The coordinator parent view retains Phase 5's periodic reauthorization and expiry clearing. These are bounded stale-view controls, not server-push revocation or erasure of something a person already saw.

Staff gate auditing and grant events contain identifiers/hashes, action, outcome, revision, and request ID only. Request bodies, resource URLs, guidance, replies, names, and family context are not logged. Phase 7 owns report operations, notifications, retention, offboarding, and broader access evidence.

## Activation and rollback

1. Keep production coordinator flags off until Phases 7–8 are complete and the pilot is approved.
2. In disposable/synthetic staging, apply migrations through 055 using the migration identity, then run `npm run db:grant-runtime`. The provisioner excludes the three new restricted tables and allowlists only `origen_coordinator_feedback_command(jsonb)`.
3. Complete the existing organization approval, coordinator membership/MFA, adult-owned student pilot enrollment, connection acceptance, and explicit manual-note publication steps.
4. Keep accounts, linking, binder sharing, and coordinator viewing enabled in that synthetic environment. Add `ORIGEN_COORDINATOR_FEEDBACK=true` to enable new guidance, edits, and student replies. Startup verifies the migration and runtime capability. There is no new service, secret, or OpenAI model dependency.
5. Rehearse author isolation, stale edits, concurrent retries, attachment withdrawal, both revocation lock orderings, voice privacy, PDF opt-in, and student removal before considering a real pilot. Live Auth0 verification and full operational readiness remain Phase 8 gates.

To pause new guidance/edits/replies, set `ORIGEN_COORDINATOR_FEEDBACK=false`. Student receipts and controls remain available; authorized coordinator reads and withdrawals continue while viewing remains enabled. To stop coordinator reads too, disable `ORIGEN_COORDINATOR_BINDER_VIEWING`. Keep the compatible backend, migrations, and redaction triggers. Repair forward rather than dropping data tables.

## Verification

The focused PostgreSQL tests cover account/recipient isolation, server attribution, concurrent retries, optimistic edits, attachment withdrawal, post-revocation controls, private voice context, explicit replies, action links/progress, request allowlists, safe URLs, runtime table denial, MFA/email, write pause, and both write/revocation orderings. PDF tests cover explicit inclusion, attribution, exclusions, pagination, and nonexecutable text.

Synthetic browser reproduction uses `output/playwright/coordinator-phase6-preview.js` and `coordinator-phase6-race-check.js` with the real component. Checks include reviewed state, explicit replies, private voice selection without another reply, coordinator edits, markup escaping, edit history, English/Spanish controls, 390px/1280px layouts, no content in browser storage, late-response rejection, and retained student copies after revocation/pause. Measured text contrast on the actual card background is 6.13:1 for attribution, 7.71:1 for body text, and 6.75:1 for metadata. Role/name labels remain present without color.

Final verification results:

- Complete server suite: **686 passed, zero failures, zero skips**, against disposable PostgreSQL 18 (139.4 seconds). An earlier run identified three obsolete blanket-disable assertions from prior phases; the final tests distinguish malformed feedback requests, paused new writes, and retained student receipt controls.
- Production TypeScript/Vite build passed (2,106 modules). Existing Auth0 module-directive and bundle-size warnings remain.
- Logging-policy, whitespace, and changed-source UTF-8 checks passed.
- Browser checks passed with no JavaScript page errors. The deliberate revoked-access request returned 404; a Vite development hot-reload socket timed out during concurrent test/build activity. Neither restored revoked content nor interrupted the checked interactions.
- The temporary browser and preview server were closed, and the disposable PostgreSQL server/data were removed after verification. No live provider, production database, real recipient messaging, or partner account was used.
