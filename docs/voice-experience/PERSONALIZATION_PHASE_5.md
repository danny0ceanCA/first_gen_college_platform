# Phase 5: adaptive guidance and binder follow-through

Implemented locally on October 18, 2026. Production is unchanged. Phase 3 continues to use keyword retrieval; embeddings and vector search remain pending.

## What changed

Planning, financial aid, loans, and applications now receive the same bounded adaptive-guidance policy. It selects up to four confirmed communication preferences within 2,800 JSON characters, preserving attribution and dates. Requested brevity, examples, and step-by-step pacing override generic answer-length defaults while keeping necessary qualifications. The current spoken request and conversation language take priority. A parent report cannot become the student's own preference, and unreviewed preferences are not communication defaults. The authenticated account supplies the speaker role for informational sessions.

A new returning conversation can offer one relevant unfinished action or saved question. A deliberately selected binder item and the current spoken question take priority. Handoffs and reconnects do not add another opening reminder. Completed, archived, and deferred actions are excluded from proactive opening candidates. The policy also checks recent discussions for declined or deferred work and avoids inferring mastery from past discussion. These are model instructions; actual conversational adherence still needs live evaluation.

The binder's Summary now includes the existing compact **Your next step** component, restoring access to actions that were previously saved without a mounted home-page action view. Students can view their plan, edit actions, mark them done, **Set aside**, or **Resume action**. Setting aside is persisted as `deferred`, distinct from completion, and is excluded from the compact next-step preview. If all remaining actions are deferred, the UI says so instead of claiming everything is complete. The plan follows the binder's exact student/family selection.

**Make a next step** opens a separate action draft from a note or conversation point. The person reviews and explicitly accepts it before saving. Drafts remain mounted while switching binder dividers. Saving reuses the existing plan creation receipt and note-version link; it keeps the original note and carries its owned source references. It never converts an unreviewed point into a confirmed decision. Application actions now have an `applications` category so their context belongs to the Applications guide.

**Talk about this** is available on unreviewed conversation points as well as saved notes and actions. The server validates the point's owner, exact scope, topic, version, extraction receipt, supporting quote, and surviving source summary. It rejects stale, suppressed, removed, or other-student evidence. The selected point and its source stay labeled unreviewed, survive the context budget, and guide historical retrieval. Selecting a point does not save or confirm it.

Pending summary saves now appear in the compact conversation bar. Both compact and expanded controls read the same save state, fixing a stale error that could remain in conversation details after a successful retry from the compact bar. Live memory requests also show a pending status. Failures retain their existing retry controls and never become a saved acknowledgment.

## Reused persistence and boundaries

No new memory store, transcript archive, service, worker, environment variable, or paid database is introduced. Migration `047_adaptive_guidance.sql` expands two existing check constraints: the plan-step status adds `deferred`, and the plan category adds `applications`. Existing account isolation, optimistic versions, creation receipts, note provenance, progress history, deletion cascades, and memory-revision invalidation continue to apply.

The existing post-call pipeline still saves one narrative summary, then organizes supported key points into topic dividers. Extraction retries reuse the summary receipt rather than creating another set of points. A failed extraction does not remove the saved conversation. Summary instructions now preserve explicit deferrals without turning them into completion or renewed commitment. A spoken “not now” is respected within the conversation and in available summary context; choosing **Set aside** supplies the durable structured status. This phase does not add a tool that silently changes a plan's progress from speech.

Official-source requirements remain in every specialty. Preferences can change wording or pacing, not waive current-source verification or establish eligibility. The live memory tools retain Phase 4 consent, cancellation, scope, and atomic-save behavior. Their fresh-session boundary still discards the old unsaved segment after a memory mutation to avoid resurrecting corrected details.

## Verification

All database work used the isolated PostgreSQL 17 instance and synthetic records. No production data or paid provider calls were used.

| Check | Result |
| --- | --- |
| Full server suite | 586 passed, no failures or skips in the final full run |
| New returning-student browser journeys | 6 passed: English/Spanish at 1280, 390, and 320 px |
| Existing voice reliability | 25 scenarios passed |
| Existing student-memory journeys | 6 passed |
| Existing live-memory journeys | 6 passed |
| Existing binder journeys | 8 passed, including keyboard focus, normal/reduced motion, and bottom spacing |
| Production build, logging policy, offline model contracts | Passed; 20 contract checks |
| Historical retrieval recheck | 24/24 answerable queries; 4/4 no-match cases; no scope failures |
| Migration | Applied only to local development and disposable test schemas |

`scripts/adaptive-guidance-smoke.cjs` exercises a parent account with two students through old work-schedule recall, a goal correction, a fresh provider context, an accepted application action, an official-source lookup, failed summary/extraction recovery, task deferral, and a later conversation launched from an unreviewed binder point. It also checks that a note-derived action requires review, retains its draft across dividers, preserves source linkage, and leaves the original point unreviewed. Desktop/mobile layout and keyboard interactions are checked in both languages; the narrowest viewport uses reduced motion.

The browser uses real local handlers, authorization scope, PostgreSQL, and research citation validation. Authentication, microphone/WebRTC events, and provider outputs are synthetic. The official-source fixture verifies how a valid citation flows through the application; it does not claim a fresh external policy lookup occurred. The server tests additionally verify preference correction, all four specialties, forged context rejection, sibling isolation, deferred status history and stale-version conflicts, source deletion, and idempotent summary/extraction retries.

The historical retrieval recheck is written to `/tmp/origen-phase5-retrieval-evaluation.json`; the earlier frozen reports are preserved. The final selected-point query change also passed 18 targeted guidance/retrieval tests after the full server run. The build retains the existing bundle-size warning. Live model response quality, real microphones, Safari, native mobile, inference cost, and production performance remain unverified. Phase 6 owns that evaluation and controlled rollout.

Local reproduction:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-concurrency=1 server/*.test.mjs
node /workspace/.local-postgres/bin/run-tests.cjs env ORIGEN_BROWSER_MODULE_ROOT=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules ORIGEN_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/adaptive-guidance-smoke.cjs
npm run build
npm run check:logging
npm run eval:contracts
```

## Deployment

Apply prior phase migrations and migration 047 through the normal migration role before deploying the new backend and then the web client. No additional table grants or startup processes are required by 047. Existing cloud setup instructions remain sufficient.

Older backend versions cannot validate the new status/category, and older clients may not display them correctly. Once these values are in use, retain a compatible backend during rollback; do not narrow the constraints or rewrite deferred actions as completed. Unreviewed-point selections also require the new backend validator. Production deployment, feature controls, live evaluation, and rollback rehearsal remain separate Phase 6 work.
