# Phase 5 — user control and deletion continuity

Implemented locally on 2026-10-10. **Not committed, pushed, migrated or deployed.** Production remains on its previously deployed version. No real user record was deleted and no live Auth0 Management API request was made. Research remains synthetic; this phase introduces no research or model-improvement consent.

## User experience

Settings now includes an English/Spanish Privacy Center, with responsive layouts checked at 1280, 390 and 320 pixels. It explains saved information, OpenAI/Auth0/Render processing, academic family sharing, institutional separation, and provider/backup limits.

Users choose conversations, notes, plans/actions, and/or saved worksheets for their whole account, one student, or the family workspace. The server returns a deletion preview including automatically removed source-derived notes. A versioned selection must still match when the user types DELETE and confirms. New or edited selected records require a new preview. Independent copies are deleted only when their categories are explicitly selected. Plans remove their revision history; source-summary deletion removes generated notes through existing foreign keys. Other family members' independent academic copies and downloads are unaffected.

Exports, bulk deletion, retention changes and account closure require the authoritative Auth0 authentication-time claim to be within five minutes. Refreshing an access token is insufficient. Reauthentication does not automatically execute a pending operation. Exports also assert the browser privacy lease after reading the response, preventing a late download after account change or logout.

After successful bulk deletion, the current tab clears its private session and reloads. Other same-browser tabs lose their private session and must sign in again. This ends their active voice context and clears recovery buffers. Other devices and information already sent to a provider cannot be recalled by a browser event.

## Retention

The default remains **keep until deleted**. Users may explicitly choose 30, 90 or 365 days since the record was saved (`created_at`, not an imported conversation date). A shorter selection applies to existing summaries. `purgePrivateSummaries` runs at service startup and with the existing hourly cleanup. It rechecks preferences under the same subject/account locks used by saves and closure. Closed or missing accounts are skipped; other failures are surfaced by the existing content-free job error.

Only summaries and their dependent notes expire under this choice. Independent plans, notes, worksheets and profile data remain. Existing diagnostic/progress retention schedules continue separately. No new AI call or model cost is introduced.

Provider logs, abuse-monitoring retention and Render backup expiry have **not** been verified. The UI does not promise immediate deletion of those copies. Receipts currently have no automatic expiry: retain them for at least the entire recoverable backup horizon plus an approved safety margin. Do not purge them until the backup policy is verified and an operator retention policy is approved.

## Database enforcement

Migration `037_privacy_controls.sql` adds owner-scoped retention preferences, an append-only deletion journal, and an operator-managed identity-closure queue. The journal contains subject hashes, account/record identifiers, record kind and time; no conversation prose or audio. These are pseudonymous records, **not anonymous data**.

Owner-executed triggers record deletion of accounts, students, summaries, notes, plans and sheets, including deletion through existing screens, cascades, and scheduled cleanup. Summary deletion writes the existing lifecycle tombstone. Insert guards block recreation of deleted IDs, including delayed note and student upserts. A deleted record needs a genuinely new identifier if the user intentionally creates new work.

Receipts have no account foreign key and survive account closure. Account closure queues identity deletion atomically; closure before an account row exists is also covered. Historical summary tombstones and closure receipts are carried into the new workflow during migration. Earlier note/plan/sheet deletions without receipts cannot be reconstructed retroactively.

The HTTP runtime can only read its own deletion/identity receipts; it cannot insert, change or remove them directly. Triggers perform the writes using schema-pinned, non-public functions. Runtime startup now requires all three new tables, RLS and restricted privileges. Institutional dashboards and analytics get no policy granting access to these tables.

## Restore runbook

The deletion journal must be protected **separately from ordinary database backups**. The implementation provides executable export/replay commands, not a configured external archive. Losing all copies of the latest journal can make deletion replay incomplete. An old journal contained inside a backup is insufficient.

1. Set `PRIVACY_RESTORE_PENDING=true` on the restored deployment and keep routing/workers disabled. Production configuration refuses startup while this flag is true.
2. With a separate operator credential, migrate the isolated restored database and apply runtime grants. Never put the migration credential in the API environment.
3. Export the newest trusted journal from the authoritative primary, with writes stopped for final cutover: `node scripts/privacy-operations.mjs export-deletions`. Set `MIGRATION_DATABASE_URL` and a **new** `PRIVACY_JOURNAL_FILE`; the command refuses to overwrite a file. Archive it with encryption/access controls in a separate recovery location. On Windows, apply the appropriate restricted ACL; POSIX mode alone does not enforce a Windows ACL.
4. Record the manifest checksum through the trusted operator channel. The checksum detects corruption, not malicious replacement. Verify freshness and completeness against the authoritative cutoff; the tool cannot establish that an arbitrary file is the newest available journal.
5. Point the operator credential at the restored database. Set `PRIVACY_EXPECTED_CHECKSUM`, `PRIVACY_JOURNAL_FILE`, and `PRIVACY_RESTORE_PENDING=true`; run `node scripts/privacy-operations.mjs replay-deletions`. Replay is transactional and idempotent. It imports receipts even for rows absent from the backup so delayed writes remain blocked.
6. Account closure replays remove stale family links while preserving another participant's independent local profile. A restored institutional membership halts replay for ownership review; resolve the historical transfer/review before trying again. Other constraint failures also roll back instead of reporting success.
7. Verify deleted targets are absent, closed subjects remain blocked, independent surviving users remain intact, and receipts/identity completion state are present. Run the isolated PostgreSQL tests as a rehearsal. Only then clear the restore flag and reopen traffic. Keep the operator evidence and trusted checksum with the recovery record.

The automated rehearsal restores an older synthetic dataset into a separate real PostgreSQL schema, replays twice, and checks missing-record retries. It is **not** a Render PITR exercise and does not establish production RPO/RTO or recoverability of an external archive. Do not describe the restore flag as an automatically detected restore: the operator must set it and stop routing before recovery.

## Auth0 identity closure

The queue retains only the subject hash, request time and completion time. An operator identifies the requested user in Auth0 (for example, from the verified support request), supplies that exact subject, and the command matches it to an existing Origen closure before any provider request. It will not delete an active Origen user. Tenant is explicitly restricted to `origenedu.us.auth0.com` to avoid the other company's tenant.

Use a dedicated, short-lived Auth0 Management API token with `delete:users`. Keep it out of the application, browser, repository and logs. Auth0 documents this permission in [Manage users using the Management API](https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api) and documents [idempotent DELETE responses](https://support.auth0.com/center/s/article/auth0-management-api-delete-endpoint-returns-204-instead-of-404-for-non-existent-users).

Set operator-only `MIGRATION_DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_MANAGEMENT_TOKEN`, and `PRIVACY_AUTH0_SUBJECT`; run `node scripts/privacy-operations.mjs complete-identity`. Only HTTP 204 records completion. Network errors, redirects, 404, permissions and throttling leave it pending. If Auth0 succeeded but database commit failed, retry is safe. Completed requests skip another API call. This deletes the Auth0 identity, **not** the person's Google account or provider logs. Provisioning the operator token and processing real pending requests are deployment operations, not completed by local tests.

## Rollout and evidence

- Deploy phases 1–4 prerequisites, including the signed `https://origenedu.ai/auth_time` claim and restricted runtime role.
- Apply migration 037 with the migration owner, then rerun `scripts/provision-database-runtime.mjs` / runtime checks using the established phase 2 procedure.
- Deploy server and web together. Old native clients still use the hardened backend but do not gain the new web Privacy Center screen; native parity remains separate work.
- Configure and rehearse a protected external deletion-journal archive. Confirm actual Render backup expiry and provider retention before publishing precise retention promises.
- Configure the dedicated Auth0 operator workflow, assign its owner, and verify pending requests are processed. A pending queue is not completed provider deletion.

Validation: full suite **454 passed, 0 failed, 0 skipped** with isolated PostgreSQL; production build passed with existing Auth0 directive/chunk-size warnings. Browser checks cover English/Spanish, 320/390px layouts, student scope, explicit confirmation, changed-preview rejection, reauthentication parameters, retention saving, and cross-tab session clearing. Synthetic screenshots are under `output/playwright/privacy-phase5-*`; test logs are under `output/privacy-phase5-*`.
