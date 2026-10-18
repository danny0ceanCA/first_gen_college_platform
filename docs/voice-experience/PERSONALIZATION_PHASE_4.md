# Phase 4: live recall and explicit saves

Implemented and verified locally on October 18, 2026. Production is unchanged. This phase uses Phase 3's PostgreSQL keyword retrieval; vector search and embedding jobs remain pending.

## Student experience

The live guide can retrieve relevant older information when the student changes topics, save a requested goal, constraint, preference, or question, correct/remove a saved memory, and add an explicitly accepted next step to the existing action plan. A saved next step starts as **not started**. It has no invented deadline, completion, or official source.

Three tools are available only after the account and student/family scope are established: `recall_student_context`, `save_student_memory`, and `save_next_step`. The server supplies dated, bounded evidence and requires the guide to preserve source uncertainty and parent attribution. Profile fields and binder notes retain their existing editing controls.

Ordinary conversation is not consent to save. Clear requests can save directly, for example “Remember that I work on Saturdays,” “Change I work on Saturdays to I work on Sundays,” or “Add Email my counselor to my next steps.” Spanish commands include “Recuerda que trabajo los sábados,” “Cambia trabajo los sábados a trabajo los domingos,” and “Guarda llamar a mi consejera como mi próximo paso.” The requested content must match the tool's proposed text; the guide cannot expand or rewrite it into an unsupported fact.

An ambiguous request such as “Please save my schedule” produces one specific proposal. Before a short “yes” can authorize it, the app must observe an assistant question containing the exact proposed text and, for an edit/removal, the previous text. Acceptance applies only to that proposal in the immediately following user turn, within two minutes. A statement claiming something is already saved does not establish confirmation. Revised or unsupported wording can require clarification; this is a deliberately limited English/Spanish command grammar, not a general natural-language consent classifier.

After a committed change, the UI acknowledges the save and automatically reconnects with fresh context for the same student and language. The binder and action plan refresh. Current spoken corrections take priority in the model instructions; persistence is acknowledged only after a committed result. The old provider connection is closed, and its pending summary/recovery segment is discarded to prevent removed or corrected details from being written back through summarization. Earlier saved summaries remain subject to the Phase 2 source-suppression rules.

## Scope, consent, and persistence

`server/profile-voice.mjs` opens a short-lived server capability using the authenticated account, owned student/family scope, and current memory revision. The public `/api/live-memory` endpoint accepts that capability and rejects caller-supplied account/student identifiers. Tool schemas contain no identity or consent override fields. Existing gateway authentication, eligibility, rate limiting, account guards, and row-level security apply.

The browser registers each independently received user transcription with its turn ID and sequence. The server stores only its hash and language, then compares the write request with that registration. A tool's arguments alone cannot authorize a write. Assistant proposal presentation is checked against a separately received assistant transcription. These events come from the authenticated application; they are not server-attested recordings of microphone audio. The authenticated user already has permission to edit their own binder through the ordinary controls.

Memory ownership, exact student scope, current record version, and current scope revision are checked inside the write transaction. Parent accounts retain parent attribution. Existing memory and plan repositories accept a shared transaction, allowing the content change, scope revision, and idempotency receipt to commit together. There is at most one committed mutation per user turn. Duplicate deliveries return that receipt; altered payloads conflict. A receipt cannot replay a saved acknowledgment after a subsequent correction or deletion changes the revision.

Migration `046_live_memory.sql` creates two account-scoped RLS tables for capabilities and receipts. They store IDs, versions, hashes, timestamps, and status metadata, with no raw transcript, proposal text, audio, or duplicate memory archive. Capabilities expire after 15 minutes; at most 20 are active per account. Closed/expired rows are removed on that account's next session opening. Expiry immediately prevents use even before physical cleanup. Account/student deletion cascades through both tables. No worker is introduced.

## Interruptions and failures

Live reads use Phase 3's exact account/student filtering, current source lifecycle, five-item/6,500-character budget, and 900 ms retrieval deadline. Scope, turn, and revision are checked again after retrieval. A deletion during retrieval returns a conflict rather than stale evidence.

The browser coordinator binds requests to the current physical call and turn, deduplicates tool delivery, cancels superseded work, and ignores late results even if a dependency ignores abort. Its 12-second deadline includes authentication, network response, and body parsing. Database operations use a five-second statement timeout. Cleanup closes the capability on a best-effort deadline; expiry remains the fallback.

An interrupted transaction rolls back if cancellation is observed before commit. Cancellation cannot undo a transaction that has already committed. If the connection fails or times out without a save result, the app ends the stale provider session and tells the user to check the binder before retrying. It does not claim success or automatically replay the mutation. A structured failure returns an instruction to continue without claiming persistence. Existing revision polling invalidates a call when another device edits or deletes its supplied context.

## Verification

All database testing used the isolated PostgreSQL 17 development instance and synthetic accounts. The new browser script uses the real local API gateway and repositories, with synthetic authentication, WebRTC, and provider negotiation.

| Check | Result |
| --- | --- |
| Full server suite | 581 passed, zero failures or skips |
| New live-memory browser journeys | 6: English/Spanish at 1280, 390, and 320 px |
| Existing student-memory browser journeys | 6 passed |
| Existing voice-reliability browser scenarios | 25 passed |
| Build, logging policy, offline model contracts | Passed; 20 model contract checks |
| Historical source-selection recheck | 24/24 answerable hits; 4/4 no-match cases; no scope failures |
| Local migration | Both new tables present with RLS enabled |

The live-memory journeys cover an older recall, failed save and retry, duplicate delivery, a correction followed by a fresh provider prompt, an accepted action, an observed spoken proposal followed by acceptance, interrupted save, late read suppression, and remote deletion. Server tests additionally cover other-account/sibling targets, forged turn evidence, ordinary speech, acceptance without an observed question, optimistic conflicts, atomic rollback/retry, metadata-only receipts, expiry/erasure, deletion during retrieval, unconfirmed routing, and delayed results from a previous student session.

The keyword retrieval evaluation was rerun to `/tmp/origen-phase4-retrieval-evaluation.json`; the frozen Phase 3 report and Phase 1 baseline were preserved. Build output retains the existing bundle-size warning. Passing tool contracts and synthetic browser events does not establish how often a live model selects the correct tool or speaks the requested clarification. Paid provider responses, live microphones, Safari, native mobile, production latency, and inference cost remain unverified and belong in the later evaluation/release phase. No paid model calls or production database changes were made.

Reproduce checks in this cloud environment:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-concurrency=1 server/*.test.mjs
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/live-memory-smoke.cjs
npm run build
npm run check:logging
```

## Setup and deployment

No new environment variables, service, Redis instance, paid database, or worker startup instructions are needed. Existing cloud setup starts the isolated local database. Migration 046 was applied only to that local database and disposable test schemas.

A later deployment must include the prior phase migrations, apply migration 046 using the normal migration role, and rerun `server/runtime-grants.mjs` through the established grants command for the new tables. Deploy the backend before the frontend: older clients do not request these tools, and a missing capability table leaves the existing voice experience available without them. Production rollout, server-owned cohort controls, real-provider evaluations, and rollback rehearsal remain Phase 6 work.
