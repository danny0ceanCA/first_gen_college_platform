# Origen data inventory

Source review: October 3, 2026. Deployment configuration, provider agreements and actual production records have not been inspected. Retention values marked unknown are gaps, not assertions of indefinite provider retention.

| Data category | Location / recipient | Purpose and access | Lifecycle evidence | Gaps to resolve |
| --- | --- | --- | --- | --- |
| Account subject, first name, email | PostgreSQL `origen_accounts`; authenticated API | Account identity/profile; account-scoped queries | `001_family_storage.sql`, `server/family.mjs` | Complete account deletion/export, inactivity policy, region, backup expiry |
| Student name, stage, GPA, school, interests, activities, goals, needs, notes, selected institutions/term | PostgreSQL `origen_students`; browser/mobile copies | Family planning; shared academic fields via explicit account links; private notes/needs remain account-scoped | `server/family.mjs`, `server/account-links.mjs`, `src/FamilyStore.tsx` | Age/guardian rules, free-text sensitivity, device cleanup, retention |
| Conversation summaries, source links and dates | PostgreSQL `origen_conversation_summaries`; client preview/import storage | Guidance history and bounded voice context | History routes, migrations 001/003/005/006 | Account-wide export/deletion, local backups, linkage semantics |
| Plans, steps, notes, sources and summary references | PostgreSQL planning tables | Private education planning | `007_planning_records.sql`, `server/plans.mjs` | Retention and full account lifecycle |
| Family links and invitation hashes | PostgreSQL links/invite tables; pending invitation on devices | Family sharing and invitation acceptance | `004_account_links.sql`, `server/account-links.mjs` | Expired invite cleanup, local token expiry/cleanup, account deletion effects |
| Institution representative subject, name, work email and role | PostgreSQL representative/membership tables | Institution management; private representative metadata | `008_institutions.sql`, `server/institutions.mjs` | Deprovisioning, representative deletion/export, multiple-staff onboarding |
| Institution draft/public snapshot, contact email, links | PostgreSQL institution table; published content to all visitors | Public page and publication workflow | Public endpoint selects approved snapshot only | Content policy, unpublish/deletion, draft retention |
| Reviewer subject, action, note, revision and time | PostgreSQL institution reviews | Affiliation/content review record; privileged queue and member feedback | `server/institutions.mjs` | Review retention/access governance; notes must exclude confidential verification documents |
| Login identity and tokens | Auth0; browser/native authentication runtime | Authentication and verified API identity | `src/main.tsx`, `server/index.mjs`; mobile authentication documented in `DATABASE_PHASES.md` | Verify actual connection, identity attributes, MFA, token/session configuration, region and deletion route |
| Selected profile/context, chat messages, tool inputs and voice-context summaries | Backend to OpenAI | User-requested guidance/research | AI and profile-voice handlers | Verify provider processing terms/retention; no zero-retention claim based on `store:false` |
| Microphone audio and transient transcripts | Browser/WebRTC and OpenAI Realtime; transcript input to summary endpoint | Live guidance and summary generation | `src/ProfileVoice.tsx`, `server/profile-voice.mjs`, `server/conversation-summary.mjs` | Provider retention, notice, user deletion expectations; database summaries differ from raw audio |
| Research question/search inputs | OpenAI research services and search processing | Official-source research | Finance/admissions/opportunity handlers | Verify inputs avoid personal details in practice; prompts alone do not establish enforcement |
| Request/diagnostic metadata | API stdout/hosting logs; local `.camino-logs` in local diagnostics | Troubleshooting, response timing and safe error codes | `server/api-logging.mjs`, `server/diagnostics.mjs` allowlist; local log rotates by size | Hosting IP/access logs, expiry, support access, time-based retention |
| Browser/device copies, settings, legacy import backups | localStorage / mobile device storage | Preview, language preferences and migration of existing records | Family/history/planning clients; database phase documentation | Inventory exact keys by account; shared-device exposure; deletion and logout behavior |
| Database backups | Hosting provider configuration, unverified | Recovery | No restore exercise verified | Region, encryption, expiry, permissions, restore handling and deletion propagation |
| Engagement metrics | Not implemented; proposed aggregate counters in PostgreSQL | Institution-level views/clicks | `SERVICE_SCOPE.md` proposal only | Final counting/suppression, retention, abuse protections and staff authorization |

## Simplified flows

1. Family browser/native client authenticates through Auth0, then calls the API with a token. The API verifies the token and accesses account-scoped PostgreSQL records.
2. User-requested AI features send selected context to OpenAI. Voice uses WebRTC; summaries can be stored in PostgreSQL. The institution report must not receive that content.
3. Institution representatives authenticate through the same identity infrastructure but use separate institution tables. Approved snapshots are readable publicly; drafts and representative data are restricted.
4. Proposed page engagement collection produces only validated aggregate counters for institution reporting. Infrastructure request metadata may still exist outside the application analytics database.

## Ownership register

Business owner, security contact, privacy contact and production administrators: assign named people before submitting the packet. For a solo business these can be the same person, with realistic availability and escalation arrangements. Do not invent staff, certifications, policies or assessment results.
