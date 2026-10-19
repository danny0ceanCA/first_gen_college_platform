# Phase 7 — Notifications and lifecycle operations

Implemented locally October 18, 2026. Production coordinator flags remain off. Phase 8 owns staging activation, provider verification, retention approval and the partner pilot.

## Delivered behavior

Students and coordinators have an English/Spanish Updates panel with unread counts, mark-read controls and links to the relevant connection, shared binder, guidance or sharing controls. Notices cover requested/accepted connections, new publications, guidance, replies, expiring access and ended access. They contain generic copy only: no names, topic titles, note bodies, reply text, invitation codes or family information.

Database triggers enqueue notices in the transaction that changes the source. A separate restricted outbox delivers them to the in-app inbox. Event keys make delivery idempotent. Each delivery, listing and link opening checks current ownership and authorization. Destination screens authorize again before fetching content. Withdrawn access cannot be recovered using a notification ID. Coordinator links still require verified email, MFA, current staff access and the exact recipient relationship. Student guidance notifications can survive revocation because the student owns that retained copy.

The UI keeps notices only in component memory, clears them on privacy/session/visibility/offline changes, rejects late responses, and refreshes the visible scope every minute. It does not provide instantaneous push revocation; the server denies subsequent unauthorized reads. No email is sent. Email preferences, provider configuration and email delivery remain an optional future implementation, not a Phase 7 prerequisite.

## Maintenance and operational controls

Migration `056_coordinator_lifecycle.sql` adds the outbox, operation counters/events, content-free feedback creation receipts, notification metadata, report decisions and narrow SQL capabilities. Runtime gets no raw access to these tables. The maintenance identity receives only `EXECUTE` on `origen_coordinator_maintain()`; the function requires retention scope and returns counts, not private data. The former guidance implementation is now an internal helper, and runtime provisioning explicitly revokes its direct execution.

The API process reuses the existing maintenance database and advisory-lock job runner every 30 seconds. It processes up to 250 eligible grants and pending deliveries per tick. Expiry warnings already queued are excluded from subsequent grant scans, so they cannot starve later grants. Jobs do not transfer students to replacement staff.

- Staff removal, organization suspension, eligibility/permission changes and student closure continue to invalidate the existing exact grants and publications. New staff need their own code, connection and explicit student publication.
- Delivery failures retry after five minutes, up to five failed attempts. The administrator can retry failed deliveries after repairing the cause; every retry rechecks current permission. Outbox updates and inbox insertion commit together.
- Sharing operations is available in the coordinator workspace to independent Origen operators with `manage:institutions`. It shows pending/failed counts, oldest pending age, last cleanup success, last-sweep expirations and 24-hour authorization/conflict totals. These are operational counts, not student activity analytics.
- Abuse review lists only an opaque feedback reference, reason enum and date. Operators can record review or disable the author’s coordinator capabilities. Resolution and retry require fresh authentication/MFA; disabling uses existing revocation triggers. No private binder/feedback preview is added to the operator dashboard. Investigations needing additional evidence require a separately authorized support process.

Existing restricted staff/share audit records keep actor hashes, action, outcome and opaque references. Routine logs retain the existing allowlisted endpoint, status, safe reason code, duration and correlation metadata. Outbox failures never log database exception text or request content. Diagnostic agents do not receive the notification tables, publications, guidance, replies, codes or family information.

## Adopted retention and limits

These are implementation defaults for the adult synthetic pilot; confirm partner terms and the privacy notice in Phase 8 before real enrollment.

| Record | Behavior |
| --- | --- |
| Connection request | Ineligible at seven days; maintenance marks expired |
| Connection code | Ineligible at 30 days; maintenance marks revoked; hashes are not exposed |
| Sharing grant | Expires after 90 days; checks deny immediately, independent of the job |
| Sharing preview | Valid for two minutes; stale preview metadata removed after 15 minutes from creation (expiry plus 13 minutes) |
| Superseded/revoked/source-invalidated publication | Existing triggers erase text immediately; maintenance provides a defensive invalidated-body sweep |
| Student guidance | Retained while visible/hidden until student removal, author withdrawal or account deletion; ended sharing alone does not delete it |
| Removed/withdrawn guidance | Body/revisions/replies redacted immediately; maintenance physically deletes the parent and cascading revisions/replies |
| Creation retry receipt | Content-free account-scoped author hash, request ID, feedback ID and deletion flag persist until account deletion, preventing delayed retries from recreating erased guidance |
| Notifications and outbox | Expire at 30 days; invalid notices are filtered immediately and removed/suppressed by maintenance |
| Binder access evidence and new operation events | 180 days, then physically purged |
| Existing organization/security audit | Keeps its existing separate policy; Phase 7 does not silently change unrelated audit retention |
| Deletion journal / closure evidence | Existing protected recovery policy; not subject to the 180-day notification/audit cleanup |

Physical cleanup depends on a running, successful maintenance job. Authorization and normal destructive redaction do not depend on the sweep. Watch oldest queue age and last successful cleanup; repair delivery failures before retrying. No new external queue or scheduled Render service is required while the existing API process runs continuously.

## Account export and recovery

The existing recently authenticated account export includes the owner’s connections/grants, guidance, revisions and sent replies. It also includes their own coordinator profile metadata. It excludes code secrets, other students’ binder content and staff-private identity fields. A coordinator cannot use their personal export to export student publications. Account deletion cascades through owner-scoped sharing/outbox/feedback rows and retains the existing content-free closure/deletion evidence.

Removal or author withdrawal records feedback deletion immediately. Physical deletion records a durable creation receipt. A reused creation request cannot generate a new guidance ID after cleanup. Recovery manifests now carry feedback version/hidden-state fences and these content-free creation receipts in addition to the existing source/account deletion journal.

Use the existing [privacy recovery procedure](../PRIVACY_SECURITY_PHASE_5.md) with these additional requirements:

1. Stop incoming traffic and all writers. Keep every coordinator flag off and keep the existing restore guard enabled.
2. Export the newest trusted evidence from the authoritative primary using `node scripts/privacy-operations.mjs export-deletions`, with operator `MIGRATION_DATABASE_URL` and a new `PRIVACY_JOURNAL_FILE`. Protect it separately from ordinary backups; verify freshness, cutoff, checksum and Windows ACLs. A checksum alone does not authenticate the source.
3. Restore into an isolated environment and apply migrations through 056 before replay. Reuse the existing `replay-deletions` operation documented by the privacy CLI. Replay can be repeated.
4. Replay **suspends all coordinator organizations, disables coordinator profiles, revokes codes/connections/grants, empties publication bodies and clears previews/inboxes/outboxes**. It never restores old sharing merely because a backup contains an active grant. This conservative reset substitutes for relying on a possibly stale revocation manifest.
5. Replay removes deleted, hidden, unverifiable or version-mismatched feedback from the restored copy. A legacy manifest without feedback evidence removes restored feedback rather than making an unsafe historical copy visible. This can lose otherwise valid guidance; record the recovery limitation. Current safely evidenced student receipts can remain, with no coordinator access.
6. Verify erased sources and guidance are absent, creation retries stay blocked, closed accounts stay closed and queued notifications cannot reopen access. Run the PostgreSQL lifecycle/recovery tests. Reconcile identities and the existing telemetry deletion ledger separately.
7. Reapprove the organization and staff only after review. Students must approve new recipient connections and publish a fresh selection. Do not migrate grants to replacement staff. Reopen production only after Phase 8’s gates and the established recovery sign-off.

Provider backup/PITR expiry for the application database remains **unverified**. Local tests do not establish Render recovery guarantees or erase provider backups. Record the actual horizon and protect the independent deletion evidence for at least the supported recovery horizon before the pilot; keep this gate in the deployment record. The existing telemetry store has its own separately documented limits.

## Deployment and rollback

1. Keep production flags off. In synthetic staging, apply all migrations through 056 using the migration identity.
2. Run `npm run db:grant-runtime` and `npm run db:grant-maintenance` with the established operator credentials and role names, then `npm run db:check-maintenance`. Both provisioners are required. No new environment variable, password, OpenAI model, email provider or external service is introduced.
3. Start the compatible API. With coordinator accounts enabled, startup requires the notification/export/operator functions and maintenance execution privilege. Confirm a successful `coordinator-lifecycle` job before testing the UI.
4. Exercise connection, publication, feedback and reply delivery; fail a synthetic delivery and retry it; remove staff, revoke eligibility/access, expire a grant, delete a source/account and rehearse restored-old-record deletion. Check direct helper/table denial under the restricted runtime identity.
5. Leave production activation to Phase 8. To pause, disable coordinator viewing/linking/accounts using the existing flags. Keep the compatible backend and maintenance job running to retain student controls and perform cleanup. Do not drop data tables or disable redaction triggers as a rollback.

## Verification

Focused PostgreSQL tests cover generic/idempotent delivery, cross-account and cross-recipient denial, staff MFA/email, operator permissions, retries and terminal failure recovery, request/code/grant expiry, physical retention, source deletion, staff departure, organization suspension, guardian eligibility withdrawal, account closure, student export, feedback retry resurrection, concurrent revocation, recovery replay and restoration of an old deleted guidance row.

Browser reproduction is `output/playwright/coordinator-phase7-preview.js`, using the real notification component with synthetic responses.

Final local verification on October 18, 2026:

- All **701 server tests passed**, with no failures or skips (138.3 seconds). This includes the 15 Phase 7 lifecycle tests and the existing coordinator, privacy, account, voice and observability regressions.
- The production build passed. Existing Auth0 directive and large-chunk warnings remain; no new build errors were introduced.
- `npm run check:logging` and `git diff --check` passed.
- Real-browser checks at 390 × 844 and 1280 × 900 found no horizontal overflow. English/Spanish notices, unread counts, mark-read and destination opening worked. Blur cleared the panel, a held response arriving afterward was ignored, and a refreshed revoked notice disappeared. Notification contents were absent from browser storage.
- The synthetic preview had no application JavaScript errors. Vite's development WebSocket encountered browser local-network restrictions; that environment limitation does not verify production networking. Live Auth0, email delivery and provider deployment remain untested here.
- Database checks used a disposable local PostgreSQL 18 cluster with synthetic records and restricted runtime/maintenance roles. Durability settings were relaxed only in that temporary cluster to speed fixture setup, so these checks do not establish crash durability or provider recovery guarantees. The temporary browser, development server and database were stopped after verification.

No production deployment, feature activation, migration, credential change, commit or push was performed. Apply the deployment steps above in synthetic staging before proceeding to Phase 8.
