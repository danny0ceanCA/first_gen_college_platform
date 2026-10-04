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
