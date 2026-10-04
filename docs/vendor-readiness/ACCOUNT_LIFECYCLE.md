# Account data lifecycle implementation

Implemented locally October 3, 2026. Deploy backend before frontend; migration 010 creates hashed account-closure receipts, and readiness requires it.

Follow-up: migration 011 and [fresh-auth/concurrency controls](RECENT_AUTH_AND_CLOSURE.md) now add stable subject transaction locks and require verified recent login for account closure. Current readiness requires 011. Lock records and closure receipts must be covered by recovery/privacy procedures.

Web Account settings now offers an authenticated JSON download and typed-confirmation account closure. Exports include the signed-in account's stored profiles, summaries, plans/steps/sources, representative details and memberships. Linked profiles export the stored local snapshot, which can differ from the current shared profile. Other accounts' private records, invitation tokens/hashes and identity credentials are excluded. This is not an export of all provider-held information or institution review/content records.

Closure deletes the account's active family database records via cascades and removes standalone representative details. Both sides must explicitly unlink family connections first; unlink preserves the latest shared academic snapshot and each participant's private records. Institution memberships and reviewer records block self-service closure pending an ownership/record review. No automated transfer or public-page deletion occurs.

The API retains a SHA-256 hash of the Auth0 subject and closure timestamp. This is a pseudonymous closure receipt, not anonymous data. It prevents normal authenticated gateway requests and family imports from recreating records. It currently has no automatic expiry because deleting it could reopen that path. Backups must restore closure receipts consistently; a restore from before closure requires replaying subsequent closure requests before serving traffic. Establish this operational process before production readiness is claimed.

Closure clears this browser's known account-scoped Origen local/session-storage keys and unmounts the signed-in UI, which ends mounted voice sessions. It logs out through Auth0. Other devices, unscoped legacy copies, downloaded exports, infrastructure logs and provider processing are not remotely erased. Auth0 identity deletion and provider/backup retention require separate operational handling; no zero-retention guarantee is made. Already-sent provider requests can complete. Native mobile does not yet have equivalent self-service controls, although its API requests are blocked after closure.

Expired family invitations are removed at API startup and hourly. Aggregate metrics retain the current UTC month plus the preceding 11 months. No inactivity-based deletion of student profiles/history is enabled: business policy, notice and linked-account rules must be settled before adding destructive scheduled retention.

Validation covers account-scoped exports, family unlink requirements, deletion cascades, preservation of another account, confirmed closure, gateway rejection of closed identities, and invitation expiry. Real PostgreSQL integration, live Auth0 logout, backup expiry and a browser interaction check remain unverified.

Remaining lifecycle work: native controls, complete provider identity deletion workflow, institutional closure/ownership workflow, inactivity policy, logs/backups evidence and production recovery tests. Account closure is not a claim that all data has disappeared from every provider.
