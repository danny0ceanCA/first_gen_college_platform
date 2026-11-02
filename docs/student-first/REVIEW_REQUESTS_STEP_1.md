# Structured review requests — Phase 1, step 1

Implemented November 1, 2026 on top of main `5bc99c5`. This is the private record foundation for the new review-request workflow. It does not mark the earlier binder guidance phases complete or replace their records.

## Delivered behavior

Each question has a server-generated ID independent of its binder publication. Multiple questions can refer to the same notes and coordinator. The record contains the owning student/account, original wording, a separately labeled proposed clarification, language, request kind, intended coordinator and organization, relationship/permission revisions, selected note version references, creation time, and private lifecycle state.

The stored original question is never rewritten by a model. A proposed clarification is not approved wording. `origin` identifies the requested entry path (`notebook` or `voice`); it is not proof of verbatim speech, successful audio playback, or permission to share. Future handlers must derive this value from their entry path. No raw audio or full transcript is stored.

`server/review-requests.mjs` provides the private repository and strict input contract. `095_structured_review_requests.sql` implements storage and a scoped database command. There is no mounted HTTP endpoint, client control, voice tool, publication, delivery worker, or coordinator read for these records. Existing coordinator screens, sharing, help flags, and feedback continue using their existing paths.

## Record contract

| Field | Meaning |
| --- | --- |
| `id` | Stable server-generated identity for this question |
| `requestKey` | Client retry key; reusing it with different content is rejected |
| `studentId`, authenticated account | Exact ownership; request bodies cannot choose another account |
| `originalQuestion` | Original supplied wording, including uncertainty, limited to 2,000 characters |
| `proposedClarification` | Optional, unapproved proposed wording, limited to 2,000 characters |
| `kind`, `language`, `origin` | Question/concern/review, English/Spanish, notebook/voice |
| `recipient` | Server-loaded coordinator/organization IDs, names, connection and revision references |
| `entries` | Up to 20 unique eligible manual-note IDs, versions, lineage revisions, digests, and topic metadata |
| `status`, `version`, timestamps | Private draft or cancelled record; no submitted/reviewed/resolved state is accepted |

Zero supporting entries is permitted for a standalone spoken or written question. Initial supporting entries must be current saved student-owned manual notes accepted by the existing sharing eligibility function. Parent/family content, summaries, and derived excerpts are excluded from this initial contract. Expanding that scope needs a separately reviewed contract using the existing derived-sharing controls.

Selection references remain fixed after a source changes or disappears. They do not contain a copy of note text, and their existence does not certify that the source is still available or shareable. Step 2 must rehydrate and revalidate all selected versions before presenting and accepting a preview. It must not silently substitute newer note text or drop missing entries.

## Lifecycle and isolation

The repository supports `create`, `get`, `cancel`, and `remove`. Creation derives ownership from the authenticated database context, requires an eligible student and accepted active coordinator relationship, and uses the existing relationship lock order. There is a limit of 500 retained records per account. Concurrent identical creation retries return one record. Cancel changes draft version 1 to cancelled version 2; stale versions are rejected and a replay cannot revive it.

Removal deletes question text and child selection references. A content-free deletion receipt retains the retry key and record ID so delayed requests cannot recreate removed content. Receipts survive until student/account deletion. All retained private records and deletion receipts are included in the owner's account export. Student/account deletion cascades through all three new tables. Recipient removal does not erase the student's private record; those recipient references are historical and do not grant access.

All new tables have row-level security with no direct runtime read/write grants or policies. The one runtime-callable command checks the authenticated account for every operation. Its internal projection helper is not callable by runtime or PUBLIC; both functions have pinned schema search paths. Parent links, another student/account, and coordinator membership confer no access to private requests. Privacy reads, cancellation and removal remain available to the owner after coordinator access ends; new creation is denied.

The new records create no grants, publications, feedback, notices or outbox jobs. Legacy help IDs and messages are not backfilled: existing help flags do not establish approval of a new structured question.

## Verification

`server/review-requests.test.mjs` exercises real disposable PostgreSQL through the restricted runtime role, including concurrent retries, different questions, source scope/version rejection, edits/deletion, RLS, forged fields, cancellation, deletion replay, export, coordinator offboarding, migration reapplication, and student deletion. The fixture uses synthetic identities and local databases; no live model or production data is required. The existing CI server-test glob includes it.

Final local verification: **64 tests passed, zero failures and zero skipped** across review requests, sharing database/lifecycle, coordinator follow-through, account isolation/lifecycle, privacy controls and database suites. This includes 13 new request tests. TypeScript/Vite production build and production logging checks passed; the existing bundle-size warning remains. The environment used Node 24 and PostgreSQL 17; CI uses Node 22 and PostgreSQL 18. No browser or provider test is claimed for this backend-only step.

The current branch's lockfile dependencies were installed with development dependencies explicitly included. An initial export compatibility issue with older schemas was corrected by using the existing optional-function detection convention; the final account export tests pass against both the legacy fixture and real PostgreSQL.

## Next boundary

Step 2 adds the common preview, confirmation and submission workflow. Approval must bind the exact question, selected content versions, recipient, current permissions and an expiry. It must recheck those facts atomically, persist the approved publication linkage and notification intent, and expose truthful submission state. Record IDs and versions from this step are the foundation; they are never confirmation receipts.

Later steps connect notebook and voice entry points, coordinator responses, private follow-up, optional shared updates and outcomes. Learning from outcomes is not enabled by this migration.

Migration 095 has only been exercised locally. Deployment requires applying additive migrations in order and reprovisioning the runtime command grant. No production migration, deployment, commit, push or pull request was performed for this step.
