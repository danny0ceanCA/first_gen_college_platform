# Phase 5 Scoped support investigations

Phase 5 adds investigations for specific technical issues. A user can report an account-owned error reference, and authorized support staff can inspect a short technical timeline through a separate HTTPS gateway. Transcripts, summaries, student profiles, emails, support prose and raw provider responses never enter an evidence packet. Production access remains disabled until the deployment steps below are completed.

## Case scope and access

`POST /api/support-diagnostics` accepts exactly `action`, `purpose` and `reference`. Authentication, account closure checks, eligibility, the existing account request budget and permission leases apply before dispatch. The feature is off unless `SUPPORT_DIAGNOSTICS_ENABLED=true`.

For a report, `action` is `report`; `reference` is a server request or operation UUID currently mapped to the authenticated account. `purpose` is one of `sign-in`, `onboarding`, `voice`, `saving` or `availability`. The response contains a random `caseId` and `status`. Unknown, foreign, expired and unmapped references do not establish a case. Pre-authentication login errors cannot be attributed through this endpoint. Reproduce them synthetically; do not search identities or bypass ownership checks.

A report includes one operation and a window of 15 minutes before and after its recorded request time. An operation reference, or an older request without a recorded time, uses the operation start time. Migration 043 preserves unknown historic request times as null. Cases expire after 24 hours. Ten successful reports per account per hour are allowed, serialized under its account lock; rejected lookups also consume the API's existing 120 requests per account per minute budget. No endpoint accepts an account/student identifier, arbitrary window or additional operation list from a user.

Use `action: close` with the case UUID and its purpose to close an owned case. Column grants permit only the status change; users cannot change the scope. Account export includes case metadata. Account deletion cascades cases; deletion of a student or mapped operation closes every case containing that operation. Eligibility revision changes and staff access-control changes close affected cases, including cases opened as service incidents.

Support uses the explicit Auth0 permission `observability:investigate` and a dedicated gateway audience different from the application audience. Administrative and institution permissions and legacy allowlists do not grant it. Existing administrator sign-in behavior is unchanged. Every evidence query checks current staff controls and current eligibility for every mapped operation. Revoke a staff member through `origen_staff_access_controls` when withdrawing access; removing an Auth0 permission alone does not invalidate already-issued JWT claims immediately.

## Gateway protocol

All requests require TLS on the actual socket and a verified RS256 JWT for the gateway issuer/audience. Forwarded TLS headers do not establish trust. Requests and responses use `Cache-Control: no-store`. There is no CORS access, public event feed, arbitrary SQL tool or email search.

| Endpoint | JSON body | Result |
| --- | --- | --- |
| `POST /v1/capabilities` | `caseId`, matching `purpose`, optional `recipient` | Signed capability, case ID and expiry |
| `POST /v1/evidence` | `capability` | Fresh scoped packet and signed manifest |
| `POST /v1/revoke` | `capability` | Revokes the grant and aborts local work |

Capabilities use Ed25519 signatures, expire within 15 minutes and bind the case fingerprint, issuing staff member, recipient, environment and audience. Possessing a reference or capability alone grants no access: each query also requires the recipient's verified JWT with the investigation permission. A recipient other than the issuing staff member must appear in the service's `SUPPORT_MACHINE_SUBJECTS` registry. Both the staff member's and recipient's live controls are checked. The issuing staff member or recipient can revoke a delegated grant. This supplies a machine access boundary for a future agent; it does not connect a model, expose code execution or implement phase 6.

The gateway limits traffic to 600 requests per process per minute, 30 per authenticated principal per minute, 1,000 in-memory rate buckets and 100 active evidence readers. The independent control store caps issuance at 20 grants per actor per minute and 1,000 live grants per environment. Bodies are bounded to 12 KiB and two seconds; API report bodies to 1 KiB and two seconds. PostgreSQL pools have two connections, two-second acquisition and statement timeouts. Evidence queries return at most 200 events and 200 metric rows, with truncation stated explicitly.

## Evidence and integrity

Packets separate server-observed events from client reports. Server-observed means the server recorded an event; it does not prove the underlying user claim. Metrics describe the entire service environment in the approved hours, not the individual student. Coverage explicitly marks sampling as best effort, missing events/outcomes as unknown, excluded unmapped requests, missing source revisions and truncation. Hypotheses start empty. No free-form support prose becomes model context.

Each packet preserves original event UUIDs, receipt times and release revisions. Known revisions link to the configured repository at that exact commit. The signed manifest binds the packet SHA-256 digest, case, capability, environment, audience, expiry, gateway source revision, signing-key fingerprint and original event/receipt lists. Its signature proves packaging integrity, not the truth of client reports. `verifyManifest()` in `ops/diagnostics-gateway/capabilities.mjs` verifies the signature with the operator-distributed public key; a consumer must also compare the packet hash and expected audience/environment and reject expired manifests.

There are no server packet files, reports, positive authorization caches or retained model contexts. Each request regenerates evidence through a fixed query constrained by the case's operations, environment and time window. Returned evidence must stay in a restricted support session; this phase does not authorize copying it to an external model or artifact store.

## Revocation and erasure

The gateway reads live application scope and the independent ledger on every query, before evidence collection and again before release. Queries fail closed on an unavailable source, mismatched environment/generation, failed audit, closed case, expired/revoked grant, withdrawn permission or missing operation. Startup rejects recovery replicas. An application erasure outbox entry older than 60 seconds blocks all case resolution; there is no fallback to stale cached permissions.

Active readers are checked every 15 seconds. If a previous check is still outstanding at the next tick, all active readers are aborted. Readers that ignore abort retain their capacity slot until settling; the production PostgreSQL statement timeout bounds their query work. Results receive another live check before return. This bounds polling initiation to 15 seconds; database acquisition/query time and an already-running check add detection delay, and Node process suspension can delay timers. Access is also checked directly on every request rather than relying on polling.

Case closure and deletion transactionally append an opaque case tombstone to the existing erasure outbox. The worker transfers it to the independent ledger and advances the telemetry verification generation. Case tombstones invalidate all matching capabilities. Operation tombstones suppress delayed ingestion. Replay skips case IDs when erasing event rows because a case closure withdraws investigation access without deleting unrelated retained telemetry. The ledger retains tombstones for 30 days; grant rows expire after 15 minutes, cases after 24 hours, and the restricted gateway access audit after 90 days. Existing conversation/event retention policies remain unchanged. Keep the erasure and ledger-retention services running even when intake/export is disabled.

Revocation aborts local pending readers and prevents fresh retrieval. Evidence already delivered to an authorized recipient cannot be recalled. No provider receives evidence in this phase; a future agent must terminate runs and erase retained context through its own lifecycle hooks. Incident preservation is a separate restricted operator process and does not extend this case lifetime.

## Deployment

1. Keep `SUPPORT_DIAGNOSTICS_ENABLED` and `SUPPORT_GATEWAY_ENABLED` off. Complete phase 4's region, processor, TLS, backup, access, notices and staging gates in the deployment record. Review both English and Spanish support notices before enabling real-user intake. Start with synthetic operator cases.
2. Apply application migration 043 using `npm run db:migrate`. Refresh runtime and maintenance grants through their existing operator commands. Application startup checks the migration, capture triggers and narrow privileges whenever support intake is enabled.
3. Apply independent-ledger migrations 002 and 003 with `node ops/observability/manage.mjs migrate --ledger`, using `LEDGER_MIGRATION_DATABASE_URL`. Provision a fresh restricted LOGIN with purpose `support` and the intended environment through `manage.mjs grant --ledger`. It receives only generation, environment, fixed grant and audit routines; no ledger/audit table reads. The erasure worker needs its updated code before handling new case tombstones.
4. Provision a fresh application resolver LOGIN with `APPLICATION_SUPPORT_MIGRATION_DATABASE_URL` and `SUPPORT_RESOLVER_ROLE`; run `npm run db:grant-support-resolver`. It receives only `origen_support_scope(uuid,text,bigint,boolean)`. The function returns approved technical scope and checks live account/eligibility/staff controls. It never returns account or student identifiers. Keep owner/operator credentials outside the gateway.
5. Configure a separate Auth0 API audience and explicitly assign `observability:investigate` to the limited support staff. Configure machine recipients separately when needed. Do not give all administrators or coordinators this permission.
6. Generate an Ed25519 signing key with the operator's secret-management tooling. Store the private key as `SUPPORT_SIGNING_KEY_FILE` and its trusted public key as `SUPPORT_VERIFY_KEY_FILE`. Distribute the public-key fingerprint through a trusted operator channel. Use distinct keys per environment; rotation invalidates existing capabilities. Supply an actual HTTPS certificate/key through `SUPPORT_TLS_CERT_FILE` and `SUPPORT_TLS_KEY_FILE`.
7. Start `npm run support:gateway` with the environment below. The service verifies restricted roles, primary databases, matching environments and ledger freshness before listening. Keep it private to the support network and restrict access at the network layer as well as through JWT verification.
8. Exercise ownership denial, a 15-minute grant expiry, closure during a read, permission withdrawal, dependency outage, delayed ingestion and the restore procedure. Then enable limited intake with `SUPPORT_DIAGNOSTICS_ENABLED=true` on the API. The client support flow can call the documented report/close action; no new browser support panel or production provider has been activated by this implementation.

| Gateway variable | Meaning |
| --- | --- |
| `SUPPORT_GATEWAY_ENABLED=true` | Explicit startup switch |
| `OBSERVABILITY_DEPLOYMENT_RECORD` | Completed operator release record reference |
| `APPLICATION_SUPPORT_DATABASE_URL` | Application resolver LOGIN only |
| `TELEMETRY_QUERY_DATABASE_URL` | Phase 4 telemetry query LOGIN |
| `SUPPORT_CONTROL_DATABASE_URL` | Independent ledger support LOGIN |
| `TELEMETRY_ENVIRONMENT` | `production`, `staging`, `test` or `development` |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` | Issuer and ordinary application audience |
| `DIAGNOSTICS_AUDIENCE` | Separate audience required by gateway JWTs |
| `SUPPORT_SOURCE_ROOT` | Exact `https://github.com/owner/repository` root |
| `RENDER_GIT_COMMIT` or `APPLICATION_REVISION` | Gateway's 40/64-character commit revision |
| Signing and TLS file variables above | Secret-manager mounted files |
| `SUPPORT_MACHINE_SUBJECTS` | Optional comma-separated trusted machine principals |
| `TELEMETRY_SSL_CA` | Optional trusted database CA |
| `PORT` | Listener port, default 3003 |

The service rejects ordinary `DATABASE_URL`, `MIGRATION_DATABASE_URL` and provider secrets. Database TLS is verified. Local plaintext database tests require the explicit synthetic-test configuration from phase 4 and localhost.

For an operator-created incident, run `npm run support:incident` outside the gateway with `SUPPORT_OPERATOR_INCIDENT=true`, the application operator credential in `APPLICATION_SUPPORT_OPERATOR_DATABASE_URL`, a restricted `TELEMETRY_QUERY_DATABASE_URL`, `TELEMETRY_ENVIRONMENT`, `SUPPORT_INCIDENT_PURPOSE`, comma-separated `SUPPORT_INCIDENT_OPERATIONS`, and ISO `SUPPORT_INCIDENT_START` / `SUPPORT_INCIDENT_END`. The resolver requires 1–100 distinct operations actually present in that environment/window and a window no longer than 24 hours. It returns only the new case ID. Live eligibility and erasure checks still apply to every operation in an incident; incident status cannot bypass a user's withdrawal.

## Restore and rollback

Before any application or event-store restore, stop the gateway and block telemetry reads. Apply the phase 4 restore barrier and replay the independent erasure ledger before reopening event access. A logical restore into a running PostgreSQL process cannot be detected reliably from its startup epoch; the operator must keep readers stopped throughout it.

After restoring application data, run `npm run support:restore-reset` with `SUPPORT_RESTORE_GATEWAY_STOPPED=true`, `APPLICATION_SUPPORT_OPERATOR_DATABASE_URL`, `LEDGER_MIGRATION_DATABASE_URL` and `TELEMETRY_ENVIRONMENT`. It revokes independent grants first and closes all restored open cases second. It is safe to rerun if either write fails. Drain the resulting erasure outbox, replay the ledger and verify health before restarting the gateway. Require new reports and grants. This also handles application outbox writes lost by an older backup.

If the independent ledger itself is restored, keep access unavailable until its deletion history is reconciled against the authoritative recovery record. Rotate the gateway signing key before reopening, run the reset above, and never reuse restored capabilities as authorization. An old application mapping or restored telemetry row cannot override a surviving independent tombstone.

Rollback disables intake and stops the gateway, then revokes active grants through the independent operator procedure. Continue erasure, tombstone replay and expiry. Do not delete the ledger, broaden runtime privileges or reintroduce raw error logging.

## Verification

`npm run test:support` covers signed JWT audiences/issuers, forged and expired capabilities, recipient proof, machine delegation/revocation, account/student isolation, fixed windows, operator incidents, mandatory audit failure, environment mismatch, closure during a pending read, permission/staff withdrawal, stale erasure backlogs, delayed ingestion, restore replay and global restore reset. Integration tests require `TELEMETRY_TEST_DATABASE_URL` and create disposable application, event and independent-ledger databases with restricted roles. CI runs them in the existing PostgreSQL job.

Local PostgreSQL 18 validation passed: **11 support tests**, **14 telemetry tests**, and the full server suite with **518 passed, zero failed and one existing skip**. The production build passed with the existing Auth0 directive and bundle-size warnings. The logging policy and whitespace checks passed. Role checks also reject accidental column-level reads of protected data. Disposable databases and test logs are removed after validation.

Phase 5 is implemented locally; production enablement and the existing phase 4 provider/staging gates remain pending. The preexisting `test:ops` recovery-test failure documented in phase 1 remains separate from these suites.

[Phase 6](PHASE_6.md) adds the independently audited diagnostic broker and typed gateway pagination. It remains restricted to pinned synthetic cases; no external provider processing has been enabled.
