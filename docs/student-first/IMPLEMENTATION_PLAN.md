# Student-first implementation sequence

Recorded 2026-10-21. Baseline: `d0fe03e80b6b106d4ff57f9ec005efc122ede891`.

The product goal is a simple conversation: the student talks, Origen organizes useful information in the binder, and asks a useful question when missing context matters. Students should not have to manage an extraction pipeline or fill out an intake form. Coordinator participation is optional and follows student control.

This plan preserves the four priorities from the proposal:

1. Improve conversation-to-binder organization first.
2. Make questioning depend on missing context.
3. Make the next conversation continuous.
4. Add coordinator sharing around that experience.

These are the **student-first phases**, distinct from older numbered personalization, voice, and coordinator projects already in `docs/`. A phase is implementation plus its relevant verification, documentation, and remaining limitations. Reinspect HEAD and uncommitted work before each phase. Do not assume the baseline is still current after another commit.

## Run in order

Phase 2 implementation is recorded in [Automatic conversation organization](PHASE_2_ORGANIZATION.md). It remains disabled by default and has not been deployed. Verification results and limitations are recorded with that implementation; later phases remain separate work.

Phase 3 implementation is recorded in [Corrections, removal and recent undo](PHASE_3_CORRECTIONS.md). It also remains disabled by default. Its migration has an explicit sharing-snapshot refresh effect that must be included in the release rehearsal.

Phase 4 implementation is recorded in [Useful questions and spoken corrections](PHASE_4_GUIDED_CONVERSATION.md). It remains disabled by default. Phase 6 preserves earlier unsummarized discussion across live-write reconnects when eligible recovery is selected; the non-opt-in path retains its previous behavior.

Phase 5 implementation is recorded in [Carry current context into the next conversation](PHASE_5_CONTINUITY.md). It remains disabled by default. The Spanish retrieval miss is covered by a regression; the underlying privacy-redaction false positive remains documented. Phase 6 recovery is recorded below.

Phase 6 implementation is recorded in [Recover interrupted conversations](PHASE_6_RECOVERY.md). It adds opt-in, bounded temporary checkpoints and uses the existing worker to save their summaries. Corrected-context reconnects preserve earlier discussion for explicit review when recovery is selected. It remains disabled by default; the document specifies consent, retention, unsupported paths and rollout limits.

Phase 7 work is recorded in [Student-selected conversation details](PHASE_7_DERIVED_SHARING.md). Implementation is in progress and disabled by default. Browser/static checks pass; database verification is blocked by Windows denying loopback socket binds on port 55487 after the authorized start retry. PostgreSQL shut down and readiness confirms no listener. Do not treat the Phase 7 completion gate as met yet.

Phase 8 work is recorded in [Coordinator follow-through](PHASE_8_COORDINATOR_FOLLOW_THROUGH.md). It adds generic help notifications, derived-item guidance support, current-publication context and bounded organization-review reads. Six synthetic browser journeys and targeted non-PostgreSQL tests pass. New help notifications remain disabled by default; database verification and measured pilot capacity are still blocked. Do not treat the Phase 8 completion gate as met yet.

| Phase | Work and rationale | Completion gate |
| --- | --- | --- |
| **1. Establish the baseline** | Inventory what exists, reconcile the latest bug fixes, run existing checks, and record code/configuration/production evidence separately. Avoid rebuilding existing memory, queues, plans, or sharing. | Reproducible baseline and explicit unresolved issues. See [Phase 1 baseline](PHASE_1_BASELINE.md). |
| **2. Automatically organize conversations** | Extend the existing summary-to-topic pipeline into one bounded organization contract. Preserve goals, constraints, preferences, open questions and tentative versus decided statements. Route information into existing binder sections and memory stores through one authoritative orchestration path. Reuse durable jobs instead of creating a second queue. Keep new behavior behind a server gate. | English and Spanish scenarios produce supported, correctly attributed items once; no invented commitments, cross-student writes, or reintroduced deleted items; current summary/manual-note behavior remains available when disabled. |
| **3. Make corrections, removal and undo dependable** | Give each affected item a stable identity/version and provenance; handle edit/delete/undo as explicit operations. Define what removal does to the original summary, derived memory, retrieval and shared snapshots. Reuse current version checks and suppression. | Correction replaces the effective fact everywhere relevant; retries do not duplicate; stale edits conflict clearly; undo cannot restore revoked sharing or erased source data. |
| **4. Ask useful clarifying questions and accept spoken corrections** | Build a small context-gap policy around the current topic, known information and importance of uncertainty. Ask one relevant question, allow skipping and avoid asking again without reason. Extend current narrow spoken-write grammar with grounded intent validation and explicit confirmation for ambiguous or consequential changes. | A missing detail changes the next helpful question; known or declined details are not repeatedly requested; tentative statements remain tentative; interrupted/ambiguous corrections do not silently mutate records. |
| **5. Carry context into the next conversation** | Assemble current, student-scoped context from the corrected binder, relevant history and outstanding questions. Treat policy claims separately from student statements; keep checked dates and application-cycle context. Use existing keyword retrieval before considering embeddings. | Return conversations use current corrections, omit deleted information, avoid repeating resolved questions and refresh stale official guidance. Spanish retrieval miss from Phase 1 becomes a regression case. |
| **6. Recover from interrupted conversations** | Extend durability before the existing saved-summary boundary using bounded checkpoints and explicit retention. Reuse permission leases, job retries, idempotency and interruption handling. Design the checkpoint schema with Phase 2 but implement after the item and correction contracts settle. | Browser close, reconnect, duplicate delivery and worker restart recover acknowledged work without double writes. Never say “saved” before acknowledgement. Logout, deletion and permission revocation fence late work. |
| **7. Let the student review and share derived information** | Extend existing preview/snapshot sharing to explicitly selected eligible conversation-derived items. Preserve attribution and uncertainty; exclude family-origin and sensitive information according to policy. Do not make automatic organization automatically share. | Student preview matches published content; coordinator sees only granted material; revoked, expired and removed items disappear; concurrent publication/revocation and stale-preview tests pass. |
| **8. Support coordinator follow-through** | Build on the current coordinator workspace, attributed guidance, help requests, action plans and in-app notifications. Show what the student wants help with and what changed, using accessible shared content only. Resolve or bound the documented organization-review burst issue before expanding organization onboarding. | Coordinator can review, respond and follow up; student can accept/correct an action; private content does not leak into notifications or workload summaries; capacity checks match pilot load. |
| **9. Validate the whole experience** | Combine realistic end-to-end scenarios, actual provider evaluation, accessibility, multilingual quality, faults, privacy and measured costs. Use synthetic cases first, then consented pilot activity. Earlier phase tests remain required; this phase integrates them. | Named acceptance thresholds met on the same release/configuration; measured speech quality, latency and cost; no critical privacy or invented-commitment failures; human review of English and Spanish examples. |
| **10. Prepare release and pilot** | Reconcile deployed code/schema/flags; rehearse migration and rollback; stage enablement with monitoring and support procedures. Start with a small group and measure student correction burden, continuity and coordinator usefulness. | Reviewable release packet, rollback rehearsal, named operator, bounded pilot cohort and success criteria. Production deployment and configuration changes are separate actions requiring explicit authorization. |

## Shared implementation rules

Phase 9 local validation is recorded in [PHASE_9_VALIDATION.md](PHASE_9_VALIDATION.md). Real PostgreSQL testing resolved the earlier Phase 7/8 execution blocker and uncovered forward fixes through migration 071. Actual provider recordings are available for Daniel under the authorized $5 aggregate budget; conversational correction/continuity/language quality still blocks release, alongside human listening and complete live interactive acceptance. Automated test passes do not close that gate. No production rollout is authorized by this status update.

- Reuse `conversation-summary.mjs`, `topic-notes.mjs`, `student-memory.mjs`, `binder-jobs.mjs`, `history-retrieval.mjs`, `live-memory.mjs`, `plans.mjs` and the existing sharing commands. Introduce a small organization service/contract where it removes duplicate work, not a new general-purpose agent platform.
- Treat student statements, parent reports, coordinator advice and external policy evidence as different provenance classes. A quote from an AI-generated summary is evidence of that summary, not an exact recording of the student's words.
- Store uncertainty explicitly. “Maybe nursing” is an interest under consideration, not a decision. “I work evenings” lacks days; ask only when days affect the advice.
- Use server-owned account/student scope and authorization. A model cannot choose who owns a record or widen coordinator access.
- Carry operation IDs, source version and item version through writes. Make retry results stable, and reject changed payloads under an existing operation ID. Recheck permission at commit time.
- Keep raw conversation content out of telemetry. Measure counts, timings, outcomes, versions and error categories. Use synthetic evidence for debugging.
- Add forward-only migrations; never edit applied migration files. Flags roll back new behavior, not already-committed data. Keep old readers compatible during staged release.
- Do not build a replacement state planning portal, generic analytics dashboard, new vector database, new message broker, autonomous application submission or automatic sharing as part of this sequence.

## Example acceptance thread

Alex says: “I'm thinking about nursing. I work evenings, and I don't know whether I can afford college.” Origen keeps nursing tentative, records the schedule constraint without inventing days, and saves the cost question. It asks about working days when comparing program schedules, not as an unrelated intake questionnaire. Alex says “Actually, only Tuesdays and Thursdays.” The correction replaces the broad effective constraint and retains appropriate source attribution. Next visit, Origen uses the corrected schedule and the outstanding cost question. If Alex chooses to share, the coordinator previews only the selected current items, can add attributed advice, and loses access when sharing is revoked.

## Planning estimates and decisions

Working estimates for one experienced engineer with review/design support: Phase 2: 4–7 days; Phase 3: 3–5; Phase 4: 4–7; Phase 5: 3–5; Phase 6: 4–7; Phase 7: 3–5; Phase 8: 3–5; Phase 9: 4–7; Phase 10: 2–4 plus pilot observation time. These are engineering estimates, not commitments. They assume current auth, database and voice providers remain in place and no mobile parity or procurement work is added. Re-estimate after Phase 2's contract and Phase 6's checkpoint retention are agreed in implementation.

Resolve within the relevant phase: item taxonomy and sensitive-content exclusions (2), undo versus deletion semantics (3), when ambiguity requires confirmation (4), policy freshness windows (5), checkpoint retention and consent (6), exact sharing eligibility (7), coordinator responsibility and response expectations (8), live-evaluation budget and release thresholds (9), pilot cohort and rollout owner (10). Keep ordinary student interactions simple while making these policies explicit in code and tests.
