Current supplemental evidence: [privacy phase 4](../PRIVACY_SECURITY_PHASE_4.md), October 10, 2026. It distinguishes local controls, read-only production observations, and console settings still requiring verification.

# Provider and external-resource inventory

Observed in source October 3, 2026. Inclusion describes technical integrations, not a legal determination that every provider is a contracted subprocessor. Contracts, regions and configuration require verification.

| Provider/service | Observed purpose/data | Status and required verification |
| --- | --- | --- |
| Render | Intended API/static hosting, PostgreSQL and operational logs | Deployment documented; live plans, region, encryption, backup/log expiry and access unverified |
| Auth0 | Authentication identities and tokens; passwordless connection referenced in setup | Actual identity attributes, connections, MFA, session settings, location and deletion process unverified |
| OpenAI | Text/voice guidance, selected profile/history context, transient audio/transcripts, research questions | Actual project configuration and agreements unverified; `store:false` is not a zero-retention assurance |
| Google Fonts | CSS font fetches from `fonts.googleapis.com`/font resources; visitors' requests reach external infrastructure | External IP/request processing and privacy disclosure need consideration; self-hosting can remove this dependency |
| GitHub Actions | Proposed CI checks of repository source; dependency installation/audit | Workflow exists locally; repository access, retention and required checks unverified; no customer-data fixtures intended |
| npm registry/advisory services | Package installation and dependency audit for build/maintenance | Operational dependency metadata; protect build credentials and review supply-chain permissions |
| University/resource websites | User-activated outbound links, opened without referrer on institution pages | Independent websites' processing is outside Origen's counters; approved page links are public |

Twilio is referenced as a future/pending SMS setup in existing documentation. Do not list it as verified active until the actual Auth0 messaging configuration is checked. Search-provider processing through AI tools must be confirmed from applicable provider documentation/agreements.

Do not copy secret keys, tokens, private account records or contract-sensitive material into this public repository. Record redacted references and keep confidential evidence in a restricted location.

## Private diagnostics addition — October 16, 2026

Phases 1–8 add locally implemented, separately controlled content-free diagnostics: technical events up to 14 days, detailed spans up to 7 days, aggregate metrics up to 90 days, an independent 30-day erasure ledger, short case-bound agent reports and 90-day access audit. Application account/student mappings stay in the application database. Provider backups/platform logs have separate unverified expiry and access policies; erasing application telemetry does not certify provider erasure.

No new external log/model processor, diagnostic database service, agent provider project, runner host or notification destination was activated. The diagnostic agent uses scripted synthetic fixtures only; production model processing and the runner's real isolation gate remain unapproved/unverified. The proposed runner uses a reviewed pinned Node 22 image and gVisor on a disposable host, not production Render or a developer workstation. Record the actual hosting provider, region, plans, TLS, backup horizons, retention, access owners, terms and model project before activation in [the operations record](../observability/OPERATIONS_RECORD.md). A dependency on gVisor/Docker software does not establish a new hosted processor.

English/Spanish source notices describe this pipeline conditionally. Confirm deployed behavior against those notices before publishing the revised legal reference and enabling export or technical investigations. Existing OpenAI user-facing voice/text processing is separate from approval to send technical diagnostic evidence to a future agent model.
