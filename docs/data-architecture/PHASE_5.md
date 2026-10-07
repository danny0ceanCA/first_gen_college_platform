# Phase 5: governed research sandbox

Implemented October 6, 2026 as a **synthetic sandbox**, as requested. No approved institution protocol exists yet. The architecture gate requires partner decisions before live study collection; this phase builds a testable simulation without crossing that gate.

## Separation from the product

`research/sandbox/governance.mjs` creates its own in-memory pg-mem database. It does not accept a PostgreSQL connection, read `DATABASE_URL`, import family repositories, expose an HTTP route, or grant access through institution membership. `research/sandbox/schema.sql` is deliberately outside `server/migrations`; it is **not** applied to the production database. The production schema remains migrations 001–016 (34 tables including bookkeeping).

Nine sandbox tables demonstrate study versions, recipient grants, participants, restricted identity mappings, permission events, scoped measurements, release manifests, restricted manifest membership and access audits. All identities and protocol references are explicitly synthetic. Sandbox operator/recipient names simulate authorization; they are not verified Auth0 identities. Do not expose this module as a live API or represent it as a production research access system.

## Demonstrated controls

- Immutable protocol/notice versions with hashes; newer versions suspend prior versions and invalidate prior stored releases. Consent never carries into a new version automatically.
- English/Spanish synthetic notices; explicit consent, decline and withdrawal events with language, notice hash, event ID, sequence and receipt time. Replay cannot change a previous choice. Re-consent requires a new affirmative event. No service access depends on participation: the module is disconnected from normal registration/voice.
- Simulated adult self-only participation. Minor, guardian-proxy, linked-person and multi-person consent are rejected rather than assumed valid. Adult self-confirmation is a simulation input, **not an age/authority verification method** for production.
- Separate recipient grants restricted to aggregate research. Institution roles confer nothing. Model training, summaries, raw audio/transcripts, profile text and arbitrary fields are unavailable.
- One latest synthetic helpfulness report per participant, checked against the approved simulated month window. The instrument is a service-feedback example, not a validated learning measure. No unprovided outcomes or retrospective measurements are invented.
- Every release re-checks current study, recipient and participant state. Aggregate payloads contain no account/student subjects, identity mappings or participant rows. Manifest membership stays internal for withdrawal handling.
- Cohorts below ten cannot release. When any positive bucket is below the configured minimum, the entire breakdown and corresponding missingness counts are withheld. This avoids recovering one hidden count by subtraction. It is not a general anonymity guarantee; repeated releases and external information still require disclosure-risk review.
- Manifests contain protocol/notice/query version, recipient, window, allowed fields, exclusions, suppression, missingness, provenance, payload checksum and expiry. Reads deny suspended/revoked/invalidated/expired datasets. Expired stored manifests can be purged, including their dependent membership rows.
- Withdrawal removes the person's synthetic measurement, excludes them from future releases, and invalidates stored datasets that included them. Recipient revocation blocks reads and further releases. Neither can erase already downloaded copies: a real protocol must specify recipient follow-up, duties, retention and limits on recall. No real notifications are sent.
- Allowed and denied operations are audited. Rejected non-synthetic identity strings are not copied into audit actor fields. Lab operations are serialized and restored on failure, but **pg-mem does not prove real PostgreSQL locking or transaction behavior**.

## Run the complete exercise

```powershell
npm run research:sandbox
node research/sandbox/demo.mjs > research/sandbox/latest.synthetic-report.json
node --test server/research-governance.test.mjs
```

The demo creates twenty fictional consenting adults with ten helpful/ten partly responses, releases one aggregate, withdraws one participant, verifies the old dataset is inaccessible, releases a nineteen-person cohort with suppressed breakdown, then revokes the recipient and verifies access denial. The generated report states zero real participants and no institution approval. It omits the restricted identity mapping and raw permission/measurement rows.

`research/sandbox/protocol.v1.json` is a bilingual **simulation notice**, not a deployable consent form. A partner must review the research question, instrument and participant-facing wording. There is no account-facing research invitation or opt-in button in production.

## Decisions needed before live implementation

Use [PARTNER_PROTOCOL_WORKSHEET.md](PARTNER_PROTOCOL_WORKSHEET.md) with the partner. Required decisions include the institution/sponsor, research question and population, study owner and protocol/version, instruments, review determination/reference, adult/minor and multi-person rules, exact allowed fields and periods, recipient identities, retention, withdrawal/recipient obligations, repeated-release/small-cohort review, permitted improvement uses, and distinct training permissions if contemplated.

After those decisions, a separate implementation must bind verified identity/authorization, approved enrollment and subject authority, exact eligible service records and data minimization, scoped recipient credentials, account export/erasure and permission-evidence retention, restricted mappings, real database concurrency, access revocation, release delivery and access audits. Account closure/student deletion must revoke future study use without silently retaining identifiable research records under an invented retention policy. Existing downloads/backups require the approved lifecycle process.

Real research must not be enabled by changing a synthetic flag or pointing the lab at production. Complete disclosure-risk/security review, staging PostgreSQL release-versus-withdrawal/deletion race tests, recipient follow-up exercises, reviewed notices and named owner approval first. Research permission is not automatically model-training permission; institution page ownership is not researcher authorization.

## Status

Phase 5's synthetic foundation and export/withdrawal exercise are implemented. The **live phase 5 acceptance gate remains pending partner agreement and applicable reviews**. This work claims no institutional approval, legal determination, anonymization guarantee, research enrollment, model improvement or revenue commitment. No production migration or deployment was made.
