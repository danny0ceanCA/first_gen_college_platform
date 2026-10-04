# Production controls and evidence

Prepared October 3, 2026. Repository safeguards are implemented; provider configuration and operational exercises remain unverified. A successful syntax check does not demonstrate deployment readiness or UC approval.

## Deployment safeguards

With `NODE_ENV=production`, startup now requires nonempty Auth0 domain/audience, allowed origins, database URL and OpenAI API key. Auth0 domain must be a hostname. Origins must be exact HTTPS origins without paths, wildcards or local addresses. Database URLs must use PostgreSQL and name a database. Anonymous voice preview must be absent or `false`. Errors identify fields without printing values.

Run `npm run check:production` in a trusted shell/service environment where the backend variables are already configured. It is read-only, does not load `.env.local` automatically, does not connect to providers and prints no credential values. Never paste secret values into chat or commit them. Startup also enforces the checks. Verify `NODE_ENV=production` on the deployed API; development bypass is intentional for local work.

The API applies `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY` to health, success and error responses. Frontend CDN headers, HTTPS/TLS settings and database transport remain separate provider checks. No permissive CSP was added without enumerating Auth0, voice and resource dependencies.

GitHub Actions runs install, existing tests, production build and an npm production-dependency audit, failing on high/critical advisories. This workflow does not configure branch protection or execute real PostgreSQL integration without test credentials. Enable required checks on the protected deployment branch separately.

## Provider evidence register

For each entry record the actual verifier, verification date, redacted screenshot/configuration export and result. All entries below are currently unverified.

| Control | Evidence required |
| --- | --- |
| Render, GitHub, Auth0 and OpenAI privileged MFA | Privileged-account MFA policy and enrollment; recovery access stored securely |
| Least privilege | Named users/service identities and roles; remove unused access; separate reviewer allowlist |
| Production separation | Separate test/production credentials and databases; no real student records in test fixtures |
| Encryption and region | HTTPS configuration, database transport settings, storage/backup encryption evidence and provider regions |
| Auth0 | Issuer/audience, allowed callbacks/logout/web origins, session/token lifetimes and revocation procedure |
| Preview | `ALLOW_PREVIEW_VOICE` absent/false; anonymous AI requests rejected |
| Secrets | Backend-only secrets, rotation owners and last rotation; no values in evidence |
| Backups | Actual plan capabilities, schedule, retention, access and successful isolated restore |
| AI processing | Applicable agreements and actual project settings; no zero-retention inference from `store:false` |
| Logs | Hosting/access-log contents and expiry, log access permissions and export retention |
| Rate limits | Single-instance assumptions recorded; shared quota strategy before scaling |
| Deletion | Live two-account isolation test, account closure test, local cleanup and closure-receipt restoration process |

## Backup restoration exercise

1. Assign an operator and choose an isolated destination database that cannot serve production traffic. Record backup timestamp and expected recovery scope without credentials.
2. Restore using the provider-supported method; do not overwrite production. Apply a restricted network/access policy before inspecting restored data.
3. Check all migration versions, readiness, foreign keys and closure receipts. Use synthetic test accounts for application checks; avoid unnecessary access to real profiles.
4. Replay verified closures since the backup timestamp before a restored database can serve users. A hash receipt is needed to prevent reopened access; deleting a newer receipt during restore is unacceptable.
5. Verify scoped records, institution reporting separation and recent closure effects. Record elapsed restore time and data-loss window actually observed. Do not claim RTO/RPO targets have been achieved without this exercise.
6. Remove the isolated restored data under the provider's deletion process; retain only redacted evidence. Record exceptions and corrective tasks.

Exercise status: not performed. Production backup retention and deletion handling are not yet established.

## Incident response procedure

Owner/contact and backup contact: to be assigned by business owner before production readiness.

1. Record time, reporter, affected service and request IDs in a restricted incident record. Do not copy transcripts, secrets or student records into ordinary tickets.
2. Triage suspected unauthorized access, cross-account exposure, compromised credentials, destructive database changes and outages. Preserve necessary technical evidence before changes; restrict who can see it.
3. Contain the actual issue: revoke affected identities/credentials, restrict endpoints or pause affected processing. Coordinate production actions with the responsible operator. Stop unsafe processing before restoring availability.
4. Establish affected data, accounts, time window and third parties using the least data needed. Preserve unknowns; do not infer no breach from absent application logs.
5. Notify UC/provider/affected people according to the signed agreement and applicable requirements. Identify the agreed contact and deadline before accepting a contract; this draft does not invent a universal notification deadline. External messages require user authorization.
6. Restore service only after the cause is addressed and isolation/closure behavior is verified. Record impact, remediation, residual risk and a follow-up test.

Tabletop exercise: use a synthetic stolen reviewer credential scenario and walk through revocation, unpublished/public snapshot checks, evidence capture and contact escalation. Record participants, timings, unresolved questions and remediation. Status: not performed.

## Maintenance

At least monthly, review dependency advisories and privileged access; review promptly on a relevant advisory or access change. Prioritize remediation by exploitability, exposure and business impact. Log the finding, owner, due date, fix and validation. Do not use automatic audit fixes that introduce unreviewed breaking changes.

Before every deployment: tests/build/audit, schema readiness, configuration syntax check and smoke checks of authentication/publication/reporting. After material changes: reassess data inventory, provider settings and restore assumptions.

Local validation: 82 tests passed, one real PostgreSQL integration test skipped; production dependency audit reported zero known vulnerabilities on October 3, 2026. Browser/live deployment, backup restore and incident tabletop remain pending.
