# Phase 2: coordinator provisioning

October 18, 2026. Implemented locally; production activation is pending. This release prepares coordinator profiles and connection codes. It does not allow students to connect, publish a binder, or receive coordinator feedback. Those remain Phases 3–6 of the [implementation plan](IMPLEMENTATION_PLAN.md).

Phase 3 now adds separately gated pilot connections; see [Phase 3 activation](PHASE_3.md). The instructions below describe the provisioning-only Phase 2 rollout.

## Workflow now implemented

1. An organization registers through the existing institution workflow. An independent Origen reviewer confirms its affiliation. Its page can remain unpublished.
2. An Origen reviewer with `manage:institutions`, a verified sign-in email, and fresh MFA opens `/#coordinators` and approves the organization for the coordinator pilot. This creates an entry in a database-backed allowlist. A reviewer cannot approve an organization they belong to, including its parent organization.
3. An organization owner opens the coordinator workspace and uses **Invitations and team** to create an existing, email-bound staff invitation. The owner shares the invitation manually; this release does not send email. The recipient must accept with the verified email named in the invitation.
4. After acceptance, the owner enables that member's coordinator capability. Owner/editor/outreach/analyst membership alone does not confer this capability. Owners who also need to coordinate must explicitly enable themselves.
5. The coordinator verifies their email and completes staff MFA, opens their own profile, edits their public display name, and creates a connection code. They can copy the code or its connection link and view its QR code.
6. Owners can disable a coordinator or remove their membership. Origen reviewers can suspend the organization's pilot. Restoring staff or organization access requires explicit re-enablement and new codes; old grants and connections stay revoked.

Personal, institutional, and coordinator workspaces have explicit navigation. Signing in for staff MFA returns to `/#coordinators`. The owner manages staff capability; owning the organization does not grant access to student records.

## Identity and authorization

`POST /api/coordinator-access` is available only when `ORIGEN_COORDINATOR_ACCOUNTS=true`. It runs behind the existing verified bearer-token, account-closure, and per-account rate gates. Every request requires the existing mandatory staff audit gate and current staff security controls. Email verification comes from the configured Auth0 tenant's authenticated `/userinfo` response, whose subject must match the verified access token. Browser profile fields are not identity evidence.

Staff reads require signed authentication and completed MFA timestamps no older than 12 hours. Mutations require both proofs within 12 hours. Future timestamps, token issuance as a substitute for authentication, missing claims, blocked staff, and pre-revocation tokens fail closed. The HTTP gate creates an internal database context only after these checks. Database commands independently enforce current organization status, membership, coordinator capability, and staff blocks/token cutoffs.

The API supports these actions:

| Action | Required authority |
| --- | --- |
| `overview` | Current coordinator, organization owner, or Origen reviewer; only corresponding organization metadata is returned |
| `approve-organization`, `suspend-organization` | Origen `manage:institutions`; approval also requires independent review and verified affiliation |
| `team`, `enable-member`, `disable-member` | Current organization owner; enabling requires an approved, verified organization and an unblocked existing member |
| `profile`, `save-profile`, `rotate-code`, `revoke-code` | The actor's own enabled coordinator profile in an approved organization |

`id` identifies an organization, not an arbitrary account to impersonate. Client-supplied administrator flags, email/MFA assertions, code hashes, student IDs, and source classifications are discarded. The overview is capped at 100 organizations for this controlled pilot.

## Codes and privacy

- Codes contain ten uniformly random characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (50 bits), displayed as `XXXXX-XXXXX`.
- Only the SHA-256 hash of the canonical ten-character value is stored. The raw code is returned once, held in the current screen's memory, and cleared on refresh or workspace change. It is not saved to browser storage or logs.
- Codes expire after 720 hours, exactly 30 elapsed days, including daylight-saving transitions. They can be revoked early. Rotation serializes on the organization and invalidates previous codes without cancelling previously approved grants.
- The text code and fragment link `/#connect/XXXXX-XXXXX` encode the same lookup value. The QR is generated locally from that link. Phase 2's link destination states that student connections are not yet available and performs no lookup or sharing. Phase 3 must add normalization, rate-limited lookup, student confirmation, and voice-tool support.
- Request diagnostics record only the fixed endpoint and approved metadata. Codes, emails, note text, and database error details do not enter these diagnostics. Access changes also create content-free institution access events.

Family conversations, family-derived notes, raw conversations, and private student records remain inaccessible to coordinators. No publication eligibility is relaxed. The family exclusion and lineage protections from Phase 1 remain in place.

## Database changes

Migration `051_coordinator_provisioning.sql` adds the RLS-protected `origen_coordinator_organizations` allowlist and one narrowly scoped `origen_coordinator_command(jsonb)` function. The runtime receives EXECUTE on that function; it still receives no direct table privileges on coordinator profiles, codes, connections, publications, feedback, or the allowlist. Existing source-lineage privileges remain read-only and account-scoped.

The security-definer function and trigger helpers have pinned schema search paths and no PUBLIC execution privilege. Only the command is granted to the restricted runtime. Direct application SQL cannot mark source content shareable or read sharing tables. Startup checks still reject elevated runtime credentials and excessive sharing/lineage privileges; enabled provisioning additionally checks migration 051 and the command's execution privilege.

Database triggers synchronously revoke codes, connections, and grants when a coordinator is disabled or when its organization is suspended, archived, or loses verification. Staff blocks and token resets disable current coordinator profiles. Membership deletion cascades its coordinator profile, codes, connections, and grants. Previously issued student-owned feedback receipts retain the Phase 1 deletion behavior. Existing institution locking serializes code issuance against membership removal and organization changes.

## Activation procedure

No production configuration, database, Auth0 tenant, or partner account was changed during implementation. Do not treat the local browser preview or automated MFA tests as proof that live Auth0 enrollment works.

1. Rehearse in staging with fictional adult staff/student accounts. Keep all coordinator flags absent or false initially. Retain the current release and a verified database backup.
2. Run `npm run db:migrate` using `MIGRATION_DATABASE_URL`. This applies 050 if it is still pending, then 051. Never run the HTTP process with this owner credential.
3. Run `npm run db:grant-runtime` with `MIGRATION_DATABASE_URL` and the existing restricted `DATABASE_RUNTIME_ROLE`. Run `npm run db:check-runtime` with the restricted `DATABASE_URL`.
4. Verify the existing Auth0 setup described in [Privacy/security Phase 3](../PRIVACY_SECURITY_PHASE_3.md): Authenticator/OTP enabled; `auth0/staff-mfa-action.cjs` bound before `auth0/recent-auth-action.cjs`; API access tokens include signed `https://origenedu.ai/auth_time` and `https://origenedu.ai/mfa_time` only after actual authentication/MFA. Assign `manage:institutions` only to the intended Origen pilot reviewers. No Auth0 Management API key is required by this release.
5. Exercise a real synthetic login, first-time enrollment, completed OTP challenge, fresh write, expired 12-hour write, token refresh, unverified-email denial, and staff suspension. Refresh must not manufacture a new authentication or MFA timestamp. The existing **Verify my identity** control requests the staff verification flow and does not replay a mutation automatically.
6. Enable **only** `ORIGEN_COORDINATOR_ACCOUNTS=true` and deploy the compatible application. Leave `ORIGEN_BINDER_SHARING`, `ORIGEN_COORDINATOR_FEEDBACK`, and `ORIGEN_COORDINATOR_VOICE_LINKING` absent or false. Production configuration rejects activation of those future features. No additional service, model key, or email provider is needed.
7. Approve only named pilot organizations through `/#coordinators`. Test one owner, an enabled coordinator, an ordinary staff member, and an unrelated organization. Confirm ordinary staff cannot issue codes and owners cannot read student content.
8. Record migration/release identifiers, runtime checks, live Auth0 evidence, approved organizations, and rollout status before inviting real partners. Complete the later sharing phases before offering student binder access.

Rollback: set `ORIGEN_COORDINATOR_ACCOUNTS=false` and redeploy to close the provisioning endpoint. Keep the additive tables and privacy triggers. Suspend a specific pilot or disable staff when their existing relationships must be permanently revoked. Do not restore an older broad runtime-grant script against the new schema. Restoration of a pilot does not revive prior access.

## Local verification

The new PostgreSQL tests cover independent approval without page publication, non-coordinator and cross-organization denial, family-summary isolation, one-time code disclosure, expiry, concurrent rotations, grant preservation on rotation, staff/organization suspension, restoration without reactivation, archival, membership deletion/re-addition, signed MFA/email gates, and disabled future APIs. Existing Auth0 Action contract tests also verify enrollment, completed MFA, and refresh behavior.

The synthetic Playwright preview uses only fictional staff and mocked API responses. Code creation and QR rendering were inspected at 390-pixel mobile width and 1280-pixel desktop width; mobile had no horizontal overflow. This is a UI check, not a live identity-provider verification.

| Check | Result |
| --- | --- |
| Complete server suite with disposable PostgreSQL and all three test database settings | **641 passed, 0 failed, 0 skipped** |
| Coordinator tests included above | 10 passed, including seven PostgreSQL/API scenarios |
| Production build (`npm run build`) | Passed; existing Auth0 directive and large-bundle warnings remain |
| Logging policy (`npm run check:logging`) | Passed |
| Patch whitespace (`git diff --check`) | Passed |
| Synthetic browser preview | Code creation/QR rendered; 390px mobile and 1280px desktop inspected |

The full command was `node --test --test-concurrency=4 server/*.test.mjs`, with `DATABASE_TEST_URL`, `ORIGEN_TEST_DATABASE_URL`, and `TELEMETRY_TEST_DATABASE_URL` pointing only to the disposable loopback cluster. Source files were held fixed during the full run. The restricted-role tests created and removed their own schemas and roles. The test cluster was stopped and removed after verification.

The reproducible browser harness is `output/playwright/coordinator-phase2-preview.js`. It intercepts API calls with synthetic responses and must only be used in a separate test browser. It does not enable the feature or verify a real staff session. No production migration, environment update, commit, or push was performed.
