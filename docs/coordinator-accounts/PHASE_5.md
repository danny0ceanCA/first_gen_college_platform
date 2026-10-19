# Phase 5 — Coordinator shared binder workspace

Implemented locally October 18, 2026. Production remains disabled. No migrations, flags, identity-provider settings, or services were changed outside the disposable local test environment.

## What coordinators see

The coordinator workspace now includes Shared binders, New updates, and Help requested views. A student appears only after publishing an eligible selection to that individual coordinator. Organization ownership or administrator status never grants access to another coordinator's publications.

Search matches permitted student display names, not note contents. Counts and ten-record keyset pages use the same current authorization set. A pagination cursor is a grant UUID, never a credential: it must still belong to this coordinator and match the current search/filter. Revoked, expired, unrelated, and nonexistent cursors use the same unavailable response. An empty active publication can remain listed, with empty topic pages explaining that entries may have been edited or withdrawn.

The read-only binder uses the existing topic/page visual language with a dedicated publication adapter. Its banner identifies the student, publication version/time, access expiry, and the limited sharing scope. Summary is a deterministic contents digest of the available topics and shared-entry counts. It does not load or generate a narrative from private conversations, summaries, memory, or a student's unpublished notes.

Mark this publication reviewed explicitly records the publication ID. Opening the binder does not mark it reviewed. A new publication creates a New update. Editing or withdrawing a source removes its shared copy; it does not fabricate a new publication or infer engagement.

## Explicit student help requests

Within People with access, the student can select “I would like help with these shared notes.” The request applies only to that recipient's current published selection. It resets on a new publication; it never follows private activity or automatically reveals new material. The student can clear it while sharing is paused. Ending access makes it invisible to the coordinator.

No feedback, replies, red-ink writing, PDF export, bulk download, AI retrieval, or automatic reassignment is enabled here. Attributed guidance belongs to Phase 6.

## Server and database boundaries

- Migration `054_coordinator_binder_workspace.sql` adds a publication-bound help marker and the RLS-protected `origen_binder_reviews` table. There are no direct runtime table grants or public function privileges.
- `POST /api/coordinator-binders` accepts only bounded list/read/review arguments. It requires authenticated staff, current MFA/authentication, verified email, current organization membership, and an active coordinator profile. Request bodies cannot supply trusted identity or permission facts.
- `origen_coordinator_binder_command(jsonb)` is the narrow runtime capability. Its internal metadata helper has no runtime EXECUTE. The read adapter serializes only publication item ID, topic, kind, language, and content. Lists never retrieve note bodies.
- Every operation checks current student adult-pilot eligibility, permission revision, connection, coordinator revision, organization approval, grant expiry, current publication pointer, publication revision, and invalidation. Shared item reads additionally match current certified lineage/version/digest and allowed topic. Phase 4's narrow new manual-note eligibility remains unchanged. Family, parent, mixed, uncertain, legacy, and conversation-derived material stays excluded.
- Shared locks order reads/review receipts with grant changes and organization suspension. A read already authorized can finish before a waiting revocation; after revocation commits, subsequent reads, counts, searches, and cursor requests cannot disclose the grant.
- `origen_binder_help_command(jsonb)` is a separate student-owned capability used through the existing sharing endpoint. It cannot grant coordinator access. It stores no student prose.
- Staff gate auditing is mandatory, and successful detail reads write content-free grant access events. Logs exclude note bodies, names, search strings, and request bodies. Phase 7 will extend lifecycle/access-evidence controls.

## Browser behavior

English and Spanish layouts support narrow screens without sideways scrolling. Topic buttons have visible selected/focus states. Published notes remain plain text in their original language.

The view keeps no publication data in local storage, session storage, an offline cache, or URLs. It clears displayed material on hidden/offline/blur/privacy lifecycle events and reauthorizes on return. Scope/filter changes and response generation counters discard late responses. Foreground access refreshes every 25 seconds, with a five-second deadline that clears content if background verification stalls. The displayed binder also clears at its known expiry. These controls bound stale display; they are not server-push revocation or a way to erase information someone already saw.

## Activation and rollback

1. Keep all coordinator flags false in production while completing Phases 6–8.
2. In synthetic staging, apply migrations through 054 using the migration identity, then rerun `npm run db:grant-runtime`. The existing runtime provisioner now allowlists the two new scoped commands and explicitly excludes the review table from ordinary runtime grants.
3. Keep the existing account/linking/student-publication flags enabled only for the approved synthetic setup. Add `ORIGEN_COORDINATOR_BINDER_VIEWING=true` to enable viewing. It requires `ORIGEN_BINDER_SHARING=true`, which in turn requires linking and accounts. Missing settings default to off. Feedback remains unavailable even if requested.
4. Startup readiness checks require the new functions and runtime EXECUTE grants. Verify MFA/verified-email behavior with real Auth0 accounts before a partner pilot; synthetic tests do not establish live identity-provider readiness.
5. Rehearse recipient isolation, source edits, withdrawal, expiry, student eligibility changes, staff suspension, cursor changes, mobile navigation, and paused/resumed views before enabling a small approved pilot after Phase 8.

No new service, secret, model integration, or provider key is required. The only new rollout setting is `ORIGEN_COORDINATOR_BINDER_VIEWING`. To pause viewing, set it false. Disabling the sharing master switch also blocks viewing; student stop-sharing controls remain available. Retain the migrations and invalidation triggers, and repair forward rather than dropping tables.

## Verification

The implementation includes real PostgreSQL tests in `server/coordinator-binders.test.mjs`, alongside the prior sharing regression suites. They cover recipient and organization isolation, untrusted IDs/cursors, counts/search/pagination, exact publication serializers, explicit reviews/help, source edits/withdrawal, both lock orderings of read versus revoke, expiry/eligibility/suspension, MFA/email checks, no-store responses, and disabled viewing.

The reproducible browser fixture `output/playwright/coordinator-phase5-preview.js` uses fictional people and notes with the real component. Verification results:

- The complete server suite passed 673 tests, zero failures and zero skips, against disposable PostgreSQL (207.7 seconds).
- A subsequent non-superuser migration-owner check exposed an incompatible FORCE RLS setting on the review table. The migration now follows the existing sharing-table ownership pattern. After that correction, all 40 focused coordinator/publication/privacy tests passed with zero skips, including the added owner-compatibility check and direct-runtime-access denial. The full suite was not repeated after this isolated correction.
- The production TypeScript/Vite build passed (2,104 modules). Existing Auth0 directive and bundle-size warnings remain. The logging policy and whitespace checks passed.
- The real component passed synthetic browser checks at 390px and 1280px, in English and Spanish: topic navigation, explicit reviewed state, no horizontal overflow, no publication text in local/session storage, rejected late responses after revocation, and cleared content while viewing was paused. No JavaScript page errors occurred. Expected 404/503 responses were exercised deliberately; one initial browser navigation timed out while the build/tests ran, then the loaded page completed the interaction checks successfully.
- Reproduction uses `coordinator-phase5-preview.js` followed by `coordinator-phase5-race-check.js` in a fresh test browser. The disposable browser, preview server, and PostgreSQL cluster were stopped after testing. No live Auth0, OpenAI, or partner account verification was performed.
