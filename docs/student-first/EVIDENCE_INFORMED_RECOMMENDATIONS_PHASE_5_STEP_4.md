# Phase 5, step 4 — Student-controlled recommendation acceptance

Implemented locally on November 2, 2026, on `codex/evidence-informed-recommendations`. The existing binder, Live and Realtime experiences can now deliver the step 3 selector's suggestion, capture approval and save it through canonical plan storage with its exact source relationship. Both recommendation flags remain false by default. This is not a production deployment or permission to collect recommendation-evaluation data.

## Student experience

The existing **My next steps** section offers a collapsed “Help me choose a next step” control. Students select a process and goal, review one suggested action and its reason, and can expand the source explanation. Missing supported prerequisites appear as one focused question at a time. Answers are explicitly student reports, not verified university requirements. An unchecked approval box and a separate save button confirm the exact private action. Setting a suggestion aside schedules nothing.

The existing coordinator-response card can open a recommendation review of that exact response. The coordinator workspace layout is unchanged. Accepted recommendations show their source status in the existing action card and can be edited, removed or revisited. Revisiting an existing accepted action does not create another action. Source withdrawal makes the attribution historical while preserving the student's independently accepted wording.

Live and Realtime use the same server selector and canonical save operation. A recommendation starts only from an independently captured student request. The model cannot supply approval, facts or a different candidate through tool arguments. A save request produces the full action, reason and privacy readback; complete observed audible playback and explicit approval on the immediately following registered turn are required. Partial, interrupted, muted and forced-flush playback cannot authorize saving. Playback observation is not a claim of comprehension.

No captions, chat interface or additional conversation opening is introduced. A changed priority cancels the pending suggestion; reconnecting after a save does not grant another opening. Missing or ambiguous goal/process produces clarification. For this version, students include the process and goal in one spoken request, and answer any missing structured prerequisites through the binder. The model does not extract prerequisite assertions from arbitrary conversation text.

Saving a recommendation creates one private, not-started action. It does not mark completion, enroll a check-in, send a coordinator update or authorize evaluation. The application checks an uncertain save result before retrying; a voice timeout directs the student to inspect My next steps without claiming success or automatically rewriting the action.

## Delivery, approval and persistence

`server/recommendation-delivery.mjs` serves authenticated, same-origin POST requests at `/api/recommendations` and `/api/recommendation-voice`. Requests have closed schemas and a 24 KB body limit. Binder requests identify an exact student, goal/process and optional source focus. The server resolves the organization for a coordinator response. The four supported yes/no/unknown answers are `document_requested`, `document_prepared`, `submission_reported` and `decision_pending`; contradictory evidence remains a conflict rather than being overwritten. These answers cannot establish campus, term or institutional eligibility.

The voice tools are `suggest_next_action`, `prepare_recommendation_action`, `confirm_recommendation_action` and `dismiss_recommendation`. They accept no model-authored arguments. Clients negotiate `recommendation-v1`; the backend also requires the existing student scope, follow-up capability and live-memory write controls. Registered turn IDs, transcript hashes, scope revisions and playback barriers bind selection, readback and approval. Generic next-step voice tools cannot bypass an active recommendation's approval path.

Migration `117_recommendation_acceptance.sql` adds:

- One temporary approval preview per account/student, containing source/request references, four structured reported facts, digests and optional voice turn metadata. It contains no suggested prose or transcript and is usable for five minutes. New selection supersedes it. Expiration is checked independently of cleanup, including when more than 1,000 expired previews are waiting for deletion.
- A durable recommendation reference attached to the canonical plan action: exact source/version, policy, goal/process, language, accepted plan version, action hash and acceptance time. It contains no second copy of the action text.
- A scoped delivery command, denied raw table access and PUBLIC execution, an owner-only restore fence, and a maintenance-only expired-preview purge.

Acceptance locks the account, reselects against current sources, compares request/input/decision digests, calls the existing plan writer and attaches provenance in one transaction. The selector reuses that transaction without committing it. No action can be saved without its relationship if the final source check fails. Preview IDs are idempotent receipt IDs: retries and concurrent confirmations return the same saved target. A receipt reads an already accepted record even after a feature pause or source withdrawal; it does not renew authority to save.

The existing selector's bounded reads and candidate limits remain in force. The five-minute approval window does not extend the authority of the selector's original 60-second transient receipt: verification and acceptance recompute selection against fresh inputs. The binder and voice client also check active suggestion context every five seconds. Server revalidation at acceptance protects the intervals between client checks.

Temporary metadata is removed on cancellation, replacement, acceptance, account/student deletion and restore. Expired entries are deleted in batches of up to 1,000 during delivery operations and the existing hourly maintenance job. Expired approvals are unusable immediately; physical deletion timing depends on job health and backlog. No retained recommendation exposure history or evaluation event stream is added.

## Explicit outcome relationship

Migration `118_recommendation_outcome_provenance.sql` adds a typed accepted-recommendation relationship to an independently eligible, student-approved outcome episode. The outcome preview identifies the exact reference and explains in English or Spanish that the relationship does not prove the recommendation caused the result or permit evaluation/sharing. The unchanged canonical action hash and exact recommendation reference are rechecked when committing that preview.

New binder/voice clients request `recommendation-provenance-v1` when preparing an outcome. Older clients receive their original preview and cannot silently authorize a relationship they did not disclose. Existing episodes are not backfilled, and no relationship is inferred from matching wording or dates. Editing the accepted wording prevents a new exact link; an episode correction invalidates the current relationship. Replacing an episode without approval of a recommendation relationship removes the old relationship for that episode.

Current Phase 4 outcome recording remains limited to independently eligible accepted coordinator-response actions. A general template recommendation does not gain follow-up or outcome-recording eligibility just because it was accepted. This step supplies provenance where the existing outcome workflow permits recording; it does not introduce a new follow-up system.

Own-account export includes accepted recommendation references and approved outcome relationships, with their current/historical state. Step removal prunes its provenance; plan, student, account and episode deletion cascade. Restore clears pending approvals and outcome relationships, preserving independently accepted actions and their historical provenance. Existing separately approved coordinator disclosures retain their existing boundaries. No recommendation-evaluation permission is inferred from `service_quality` consent.

## Verification and limits

Verification used isolated local PostgreSQL and synthetic identities, sources and audio. Application, production database and provider credentials were excluded from test processes.

The affected regression run executed 247 tests: 246 passed and one old step 1 assertion incorrectly prohibited all recommendation tables. That assertion was updated to allow the new temporary approval table while verifying read-only source resolution creates no preview or provenance records. All **38 final focused tests passed, with zero skips**, covering the corrected contract, delivery and voice bridge, including concurrent confirmation, structured prerequisites and expiry under a cleanup backlog.

The connected browser matrix passed **18 journeys**: English/Spanish at 1280, 390 and 320 pixels for binder, Live and Realtime. It exercised real React components, local handlers and PostgreSQL, with synthetic provider/audio transport. Binder cases cover exact approval, lost-response recovery, duplicate prevention and source withdrawal. Voice cases cover audible readback, independent approval, canonical persistence and reconnect without an extra opening. Screenshots were inspected at desktop and narrow Spanish mobile widths; no horizontal page overflow was detected. The existing student follow-up and private-report browser suites also passed their six journeys each.

TypeScript, production logging policy and the environment-excluded Vite build passed. The build retains its existing large-chunk advisory. `scripts/verify-review-request-release.mjs` now includes the new server suites and validates the complete 18-journey acceptance matrix separately from the existing Phase 4 browser record. The full combined release verifier and external live-provider smoke tests were not run; combined release verification remains step 6.

Local evidence: `/tmp/phase5-step4-regressions.log`, `/tmp/phase5-step4-focused-final.log`, `/tmp/origen-recommendation-acceptance-browser/results.json`, `/tmp/phase5-step4-followup-browser.log`, `/tmp/phase5-step4-private-followup-browser.log`, `/tmp/phase5-step4-types.log`, `/tmp/phase5-step4-logging.log` and `/tmp/phase5-step4-build.log`.

Institution-specific recommendations remain withheld: the repository still has no trusted confirmed campus/term applicability producer. Only general reviewed questions and explicitly selected private guidance qualify. The feature requires deliberately reviewed publications and scoped capabilities; this implementation publishes no production templates. It adds no learned weights, success probabilities, cross-student outcome ranking or causal claims.

## Operation and next step

Apply migrations through 118 and refresh runtime and maintenance grants before enabling this capability in a future authorized release. Runtime receives only scoped delivery/export execution, not raw recommendation tables, restore helpers or the purge function. Maintenance receives only the bounded purge entry point. Startup readiness checks both migrations and access isolation.

Keep `ORIGEN_RECOMMENDATIONS=false` and `ORIGEN_RECOMMENDATION_EVALUATION=false`. Pausing recommendations stops new selection/acceptance while preserving existing actions and receipt recovery. Retain the compatible schema and action history during rollback; do not revive expired approvals or withdrawn sources. No production migration, grant, publication, deployment or provider call was performed.

Next is step 5: separately permitted recommendation evaluation, with explicit opt-in, bounded reporting and no automatic policy promotion.
