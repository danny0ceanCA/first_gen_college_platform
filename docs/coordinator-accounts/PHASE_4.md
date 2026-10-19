# Phase 4 — Student preview and snapshot publication

Implemented locally on October 18, 2026. No production migrations, environment settings, services, Auth0 settings, or accounts were changed. Nothing has been committed or pushed as part of this phase.

## Student experience

The student binder has **Share with a coordinator** and **People with access** controls. Only operator-approved adult student profiles can prepare a publication. A coordinator must already have accepted the connection.

1. Choose the named coordinator and organization.
2. Choose individual topics or all eligible topics. Both use the same server filter.
3. Select specific notes, up to 50 per publication. There is no automatic selection or publication.
4. Review the exact note text, recipient, student profile, and expiration in a confirmation dialog.
5. Press **Publish these entries**. The short-lived preview is the confirmation identifier; duplicate requests cannot create another publication or renew access.
6. Review the current selection, remove individual entries or topics, stop sharing with a person, or stop all sharing.

A publication lasts 90 elapsed days from its preview. Publishing a new selection replaces the previous selection for that coordinator and requires a new explicit confirmation. Merely selecting topics, giving Origen a connection code, accepting a connection, adding a note, editing a note, or reconnecting never publishes content.

English and Spanish copy is included. The review uses a native modal dialog, keyboard-operable checkboxes, an Escape/cancel path, visible focus, and controls sized for mobile. Source text is shown in its original language without generating a translation.

## Eligible content and family privacy

Phase 4 deliberately uses the narrowest proven source path: **new, explicitly written manual notes saved by the authenticated student while the exact student profile is enrolled in the approved adult pilot**. Server triggers establish that evidence. Request bodies and model outputs cannot supply provenance or change its classification.

Existing notes with unknown origins remain private. Parent/family/mixed sources, conversation-derived key points, imported summaries, transcripts, audio, personal memory, quotes, and translations are excluded. Editing an unknown or protected note does not make it eligible. Selecting all topics does not relax these rules.

Generated conversation entries are not automatically certified: the current generation paths can use private context, and the full input lineage is not yet verified as student-only. Supporting those entries requires an additional complete-provenance implementation and acceptance tests. Do not backfill `student_only`, infer it from the current role, or copy a protected record into a new record to bypass its lineage.

Students may choose what to write in a new personal note; provenance controls cannot determine the real-world origin of arbitrarily retyped prose. The application never copies or reclassifies protected conversation content for sharing.

## Backend contract

Migration **053_binder_snapshot_publication.sql** adds the private `origen_binder_previews` table and a narrow `origen_binder_sharing_command(jsonb)` capability. The runtime still has no direct table access to grants, previews, publications, or publication items. RLS remains enabled with no direct runtime policies on those tables. Helper functions have fixed schema search paths and no runtime/PUBLIC execution privilege.

`POST /api/binder-sharing` accepts these authenticated student operations:

| Action | Result |
| --- | --- |
| `status` | Own grant/recipient metadata and currently authorized published items; no item text while paused |
| `entries` | Exact eligible saved notes, using an explicit response field list |
| `preview` | Exact selected entries plus recipient, profile, and expiration; no publication |
| `publish` | Transactional publication of the server preview after explicit confirmation |
| `cancel` | Invalidates a preview |
| `withdraw` | Removes one publication item and wipes its copied text |
| `remove-topic` | Removes a topic and wipes its publication items |
| `revoke` / `revoke-all` | Ends access, clears publication pointers, and wipes copied text |

The server derives the authenticated account and rollout state. Preview requests accept only connection ID, allowed topics, and note IDs; publication accepts only the server preview ID and explicit confirmation. A preview expires after two minutes and binds recipient identity, organization revision, connection revision, eligibility revision, grant revision, student identity, topic selection, source versions, lineage revisions, and content digests. Only eligible sources enter the preview metadata or digest. Conflict responses contain a fixed safe code and require a fresh review.

The command locks the subject/account, eligibility, pilot, institution, relationship, grant, source notes, and lineage as appropriate. These coordinate with account closure, ordinary note edits, coordinator lifecycle changes, and revocation. Publication and pointer replacement happen in one transaction; superseded copied text is wiped. An authorized publication that holds its locks may finish before a concurrent revocation, after which revocation wipes it. If revocation holds the locks first, the later publication fails. New reads after completed revocation cannot obtain shared content.

Source edits, translations, deletion, suppression, and newly protected ancestry synchronously invalidate old publication items through the existing lineage triggers. Updated notes remain unpublished until another preview and confirmation. Role/permission/pilot changes and coordinator suspension disconnect the relationship and revoke grants; restoring the prior state or reconnecting cannot revive a publication. Expired grants are denied on access even before later retention processing.

Content-free publication/withdrawal/revocation events use the existing sharing event table. Request contents, note text, codes, and preview digests are not added to logs or analytics. No AI/provider request, shared summary generation, email, or notification is triggered by publication.

## Browser privacy and kill switch

Sharing requests and responses use `no-store`. The UI holds sharing data only in component memory and does not use browser storage, offline queues, or service-worker caches. No service worker is currently registered by this web app.

Logout/privacy lifecycle events, student changes, offline/hidden state, focus refresh, permission errors, and content-free cross-tab sharing events clear stale selections. The active panel also refreshes authorization every 30 seconds; server checks are authoritative even if a browser is disconnected. This is not a server push revocation stream. Phase 5 coordinator views must reauthorize every read and use the same invalidation discipline.

`ORIGEN_BINDER_SHARING=true` enables student preparation/publication only when `ORIGEN_COORDINATOR_ACCOUNTS=true` and `ORIGEN_COORDINATOR_LINKING=true`. All default to disabled. With any of these settings disabled, entry discovery, preview, publication, and shared-text responses stop. The authenticated ownership-gated status, cancellation, withdrawal, topic removal, and stop-all API remain available. Stop controls do not depend on continued pilot enrollment, active coordinator membership, or adult eligibility.

`/api/coordinator-binders`, `/api/coordinator-feedback`, and `/api/coordinator-notifications` still return unavailable. This phase does not allow coordinators, organization owners, administrators, voice tools, or background jobs to read a student publication. The future coordinator adapter must query only authorized current publication items and must not reuse the student's private notes API.

## Verification

The complete server suite passed **664 tests, zero failures, zero skips** against disposable loopback PostgreSQL databases (184.8 seconds). The production build and logging policy check passed; existing Auth0 directive and bundle-size warnings remain. `git diff --check` passed. The focused real-PostgreSQL suite covers private source exclusion, server field allowlists, tampered ownership/recipient IDs, duplicate publication, exact version conflicts, source mutation/deletion/protection, topic/item withdrawal, both transaction orderings of publication versus revocation, reconnect behavior, expiry, organization suspension, eligibility changes, no direct runtime access, no-store responses, kill-switch stop controls, and blocked coordinator routes.

The synthetic browser checks passed at 390 px and 1280 px with no horizontal overflow, in English and Spanish. Keyboard checkbox selection, Escape cancellation, explicit publication, stop-all removal, and no sharing text in local/session storage were verified. No browser errors were reported. A final UI response-ordering fix was rebuilt and exercised with a deliberately delayed pre-revocation status response: it could not restore removed content. The reproducible check is `output/playwright/coordinator-phase4-race-check.js`, run after loading the preview fixture.

The synthetic browser fixture is `output/playwright/coordinator-phase4-preview.js`. It uses the real component and fictional API responses; it is not a substitute for the database tests or a live Auth0 deployment check.

## Deployment when requested

1. Keep all coordinator flags false. Rehearse migrations 050–053 in staging with a backup and the current application release available for rollback.
2. Run `npm run db:migrate` with the migration credential, then `npm run db:grant-runtime` with the established restricted-runtime provisioning procedure. Do not give the web service the migration credential.
3. Run `npm run db:check-runtime`, `npm run check:production`, and `npm run check:logging` against the intended environment. Enabling publication requires the new command and its execution grant; startup refuses missing capabilities.
4. Complete Phase 2 organization approval and Phase 3 exact-profile adult pilot enrollment. Use fictional accounts only for the initial publication rehearsal. Create new manual notes after enrollment; legacy notes intentionally will not appear.
5. Enable accounts, linking, and binder sharing in staging. Rehearse accepted connections, preview/publish, edits, withdrawals, permission revocation, and the kill switch. Voice linking is optional and still does not publish.
6. Keep coordinator reading and feedback disabled. Complete Phases 5–8 and live Auth0/provider readiness before an actual partner pilot. No new service, secret, or provider integration is required by Phase 4.

Rollback: disable `ORIGEN_BINDER_SHARING`, retain the compatible API for stop controls, and leave migration 053 plus its invalidation triggers in place. Do not drop tables or backfill provenance. Repair forward with a new migration after any non-disposable deployment.
