# Personalization phase 2: student memory and correction controls

Implemented and verified locally October 18, 2026. Production has not been migrated or deployed. This builds on Phase 1; it does not add vector retrieval or live model write tools.

## Student experience

The binder now includes a collapsible **What Origen remembers / Lo que Origen recuerda** section. It groups additional personal details into goals, practical needs, communication preferences, and open questions. Three entries appear per page. Students can inspect the supporting summary excerpt, review attribution and dates, confirm a suggestion, write a detail, correct it, or remove it. Saving an edit supplies confirmation; there is no second confirmation dialog. Failed saves keep the draft. A concurrent edit requires reviewing the latest version before saving.

The section references existing profile goals and needs instead of creating another profile. Existing notes, decisions, and actions retain their own storage and controls. The live voice prompt combines that authoritative profile/workspace with the additional student memory. A parent report remains attributed to the parent even when confirmed. Summary-derived entries remain proposals until explicitly reviewed. Prompt instructions require clarification when uncertain evidence conflicts; actual model compliance remains a live-evaluation task.

## Storage and source lifecycle

Migration `044_student_memory.sql` adds three private tables:

- `origen_student_memories`: account and exact student/family scope, category, content/language, speaker and reporting role, source summary ID and content fingerprint, source conversation date, created/updated dates, optimistic version, last mutation, and proposed/confirmed/superseded/deleted status. Superseded and deleted versions retain metadata with empty content and quotes. No archive of previous private prose is introduced.
- `origen_memory_batches`: extraction receipts and source suppression. Dismissing all suggestions does not regenerate them on the next load.
- `origen_memory_scopes`: a scoped revision that fences asynchronous extraction and identifies outdated voice context.

All tables use account RLS and existing runtime grants. Repository operations serialize with the existing account guard, validate owned student scope, and recheck source identity, fingerprint, and revision before saving proposals. Create retries use a stable ID; confirm/edit/remove retries do not produce extra versions. Runtime cannot bypass another account's RLS or the existing deletion guards.

Correcting or removing a derived detail suppresses its entire source summary from voice recall, including linked binder notes and automatic recap points. Other unreviewed memory proposals from that source are invalidated. The source remains visible in the binder/history. This conservative rule avoids reintroducing the old detail through a differently worded excerpt; it can also exclude unrelated useful information from that same summary. An independently written note remains independent. A source-linked confirmed memory follows the existing linked-note lifecycle: deleting its conversation removes it too.

Source deletion, retention cleanup, student deletion, and account deletion cover the new records. The Privacy Center includes a memory category and counts memories derived from selected conversations. Bulk memory erasure suppresses existing source summaries and fences queued extraction. Account export includes memory records and receipts. The separately protected recovery manifest now carries content-free source exclusions and version fences, preventing an older backup from reviving removed or superseded memory. Existing version-1 manifests remain readable; newly exported manifests include the additional fields.

## Optional extraction and bounded backfill

`/api/student-memory` provides authenticated load/revision/create/update/confirm/delete/sync operations. A sync processes **one saved, server-owned summary**. The binder requests one batch after its scoped history changes and offers a resumable button for older conversations. Selection happens in PostgreSQL, so older sources beyond the history screen's 100-item limit remain reachable.

Extraction uses the existing summary model setting (`OPENAI_MODEL_SUMMARY`, default `gpt-4.1-mini`) and API credential, with `store:false`, a 20-second total request deadline, at most four proposals per summary, a maximum of 200 active details per account, and 12 extraction attempts per account per hour per server process. Provider and database operations use content-free diagnostic instrumentation. New production extraction calls incur normal model costs; local verification used mocked providers. Summary persistence and binder reading do not depend on successful extraction. Failed extraction leaves the source intact and can be retried; it never bulk-confirms older statements.

There is no new worker, Redis service, embedding store, or paid test database. Backfill resumes while using the binder; it is not an unattended worker job. Semantic search and historical ranking remain Phase 3.

## Active calls

The server discards caller-supplied memory and builds the selected scope's brief itself. An unresolved parent scope receives no private brief. The voice response includes the memory revision, and the server checks that it stayed current while constructing context.

Explicit edits/removals publish an identifier-only notification in the current tab and other tabs. Active calls also check the server revision every five seconds, with a five-second request deadline, covering changes on another device and retention cleanup. Profile, linked academic profile, note, and plan corrections/removals invalidate the applicable scope; note translation alone does not.

A changed or unverifiable revision ends the current provider session. The visible English/Spanish notice invites a new call with current information. The interrupted call is not summarized or recovered, because its assistant turns may repeat the removed information. The memory editor explains this behavior before changes. Same-tab notifications are immediate; remote changes depend on polling and browser scheduling. No claim of instantaneous global revocation is made. Restarting creates a fresh provider context instead of retaining old turns in an in-place guide update.

## Verification

Use the isolated cloud test wrapper, which excludes production URLs and application credentials:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-concurrency=1 server/*.test.mjs
node /workspace/.local-postgres/bin/run-tests.cjs node --test server/student-memory.test.mjs server/account-isolation.test.mjs server/privacy-controls.test.mjs server/database.test.mjs
npm run build
npm run check:logging
node /workspace/.local-postgres/bin/run-tests.cjs npm run eval:contracts
```

The local Vite server and Chromium support these synthetic browser checks:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/student-memory-smoke.cjs
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/voice-reliability-smoke.cjs
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/binder-experience-smoke.cjs
```

Evidence:

- **553 server tests passed**, no failures/skips. After narrowing note invalidation to meaningful edits, **39 focused tests passed** against the final migration.
- TypeScript/Vite build and production logging policy passed; existing bundle-size warnings remain.
- Existing offline prompt contracts: **20 passed**.
- **Six memory browser journeys passed**: English and Spanish at 1280, 390, and 320px widths; the narrow case uses a 568px viewport height. Cases cover keyboard activation, provenance, parent attribution, confirm/edit/remove/create, failed saves retaining drafts, stale versions, failed extraction/retry, scope-filtered cross-tab notifications, remote revision changes, and a fresh voice session after correction. Spanish mobile screenshots were visually inspected.
- **25 voice regression scenarios passed**, including stalled research, cancellation, audio recovery, late authentication, and diagnostic quotas through a real local gateway.
- **Eight binder regression journeys passed**, covering English/Spanish at 320, 390, 768, and 1280px, motion/reduced motion, focus restoration, all 18 test notes, pagination, edits/reloads, and bottom clearance of 16px.

Real PostgreSQL tests use restricted runtime roles and synthetic records. They cover account/student/family isolation, pending extraction races, correction precedence in the actual voice handler, source suppression across summaries and recap points, confirmation attribution, idempotency, retention/privacy cascades, account export, linked-profile invalidation, resume beyond 100 summaries, and replay of recovery manifests. An existing directory test now fixes its exclusive upper time bound after PostgreSQL's submillisecond fixture timestamp. The binder smoke scrolls the summary into view before awaiting its existing lazy generation.

No live model answers, real microphones, iOS/Safari devices, production-scale latency, or provider costs were evaluated. The Phase 1 summary-selection baseline is preserved; its older-memory retrieval misses are not claimed fixed by this phase.

## Reviewable rollout

Apply the additive migration with the established migration credential, rerun `npm run db:grant-runtime`, verify `npm run db:check-runtime`, and deploy the reviewed application. Export fresh deletion manifests with the updated recovery tooling before relying on a backup restore. The existing maintenance role uses the established source/account deletion paths and their cascades; no broad new memory read grant is needed. Older schemas continue their existing voice context behavior and report that the new controls are unavailable.

These are prepared deployment instructions, not a record of a production deployment. The cloud environment still uses its free isolated PostgreSQL instance for tests. Native mobile integration and live provider evaluation remain outside this web implementation.
