# Live model personalization implementation plan

Status: Phases 1, 2, 4, and 5 and the Phase 3 keyword fallback are implemented and locally verified. See [Phase 1 evidence](PERSONALIZATION_PHASE_1.md), [Phase 2 evidence](PERSONALIZATION_PHASE_2.md), [Phase 3 evidence](PERSONALIZATION_PHASE_3.md), [Phase 4 evidence](PERSONALIZATION_PHASE_4.md), and [Phase 5 evidence](PERSONALIZATION_PHASE_5.md). Phase 3 vector retrieval/embedding jobs remain pending provider capability verification; Phase 6 release controls and offline verification are implemented; paid live evaluation, physical-device review, and production rollout remain pending. See [Phase 6 evidence and release procedure](PERSONALIZATION_PHASE_6.md). Production rollout has not occurred under this plan. Prepared October 18, 2026 from the current repository. These six phases form a new personalization workstream; they do not rename the existing voice, data architecture, or conversation quality phases. Production model configuration and PostgreSQL extension support have not been verified.

## Outcome and first complete journey

A returning student should receive guidance that reflects their current goals and constraints, recalls relevant earlier discussions, and helps them take a useful next step. The student can inspect and correct what Origen remembers.

The first complete journey is comparing nearby college programs while balancing a job: remember a previously stated schedule, check whether an older preference still applies, retrieve current official program information, save an explicitly accepted next step, and resume accurately in a later call. Exercise this journey in English and Spanish, with a parent account containing two separate students, on desktop and mobile web.

## Existing foundations to reuse

- `server/profile-voice.mjs` loads authorized profile, summary, and workspace context and configures the live model and specialist tools.
- `server/history.mjs` and `src/voiceMemory.mjs` select up to six memories from the latest 24 summaries by recency and guide type.
- `server/voice-workspace.mjs` supplies bounded, scoped notes, unreviewed conversation points, and actions, including an explicitly selected binder item.
- `server/conversation-summary.mjs`, `server/summary-style.mjs`, and `server/topic-notes.mjs` provide narrative summaries and source-linked binder points.
- Existing profiles, topic notes, plans, version checks, account guards, privacy controls, and deletion flows remain the foundation. Avoid creating competing copies of those records.
- Extend `server/model-evaluation.mjs`, the versioned `evals/` catalogs, and the existing browser smoke scripts. Existing offline contract results do not establish live speech or model-response quality.

## Sequence and delivery

| Phase | Deliverable | Dependency | Completion evidence |
| --- | --- | --- | --- |
| 1 | Reliable voice and a measurable baseline | Current app | Reproductions pass after fixes; synthetic evaluation cases and baseline limitations recorded |
| 2 | Student memory and correction controls | 1 | Scoped, versioned memory and binder controls work; correction/deletion tests pass |
| 3 | Relevant historical retrieval | 2 | Older relevant memories retrieved; stale, deleted, and other-student records excluded; fallback demonstrated |
| 4 | Context retrieval and explicit saves during calls | 2 and 3 | Scope-safe tools, cancellation, context refresh, and duplicate-save prevention verified |
| 5 | Adaptive guidance and binder follow-through | 4 | The first complete journey passes in both languages and desktop/mobile web |
| 6 | Measured release and controlled rollout | Evidence gathered throughout 1–5 | Comparable live synthetic evaluations, device checks, cost measurements, and rollback rehearsal |

Use a reviewable PR for each phase; split schema, backend, and UI work into dependent PRs when needed. A phase is complete only with its evidence. Source implementation, automated verification, live model evaluation, and deployment are separate statuses.

## Phase 1 — reliable voice and baseline

Reproduce the three issues identified in the earlier review against the implementation branch before changing them:

1. Diagnostic traffic shares an account request budget with eligibility checks. Separate or bound diagnostic ingestion so normal calls cannot exhaust essential session requests; retain abuse protection on both paths.
2. Audio recovery is inaccessible when browser autoplay is blocked. Add an explicit, keyboard-accessible recovery control that remains visible in compact and expanded layouts.
3. Research can leave a turn pending indefinitely. Apply an end-to-end deadline covering authentication, fetch, and response parsing; support cancellation and ignore late results. Timeout or cancellation must release the turn and preserve usable conversation state.

Primary surfaces: `server/index.mjs`, `src/ProfileVoice.tsx`, `src/SharedVoice.css`, `src/voiceTurns.mjs`, and research progress helpers.

Extend regression tests with a normal multi-turn call including eligibility polling, denied autoplay, stalled authentication/network/body reads, cancellation followed by a new question, and a late result after cancellation. Verify desktop and mobile web, English and Spanish. Preserve onboarding saves, interruptions, and summary recovery.

Create a versioned synthetic personalization case set with known source memories and expected answers. Include old relevant memories, contradictory preferences, corrections, parent attribution, deleted sources, student changes, and failed tools. Record baseline repeat-question behavior, retrieval selection, request counts, and measured timing where available. Label mocked timings and unavailable provider costs explicitly.

Completion: the three reproduced failures have meaningful regression coverage and browser evidence; the current build and applicable existing suites pass or unrelated failures are explicitly diagnosed. The case set is ready for matched baseline/candidate evaluation in subsequent phases.

## Phase 2 — trustworthy student memory and controls

Implement a server-side student brief assembled from existing authoritative profile, note, and action records plus a minimal memory record where an existing record cannot represent the detail. Start with goals, practical constraints, communication preferences, and unresolved questions. Reuse existing decision/action records.

Each new memory record needs an account and exact student/family scope, category, content, speaker attribution, evidence/source reference, source version, recorded date, status, and optimistic version. Distinguish proposed, confirmed, superseded, and deleted information. A summary-derived statement carries that provenance; it cannot silently become a newly confirmed student fact. Conflicting unconfirmed evidence triggers clarification. Corrections to confirmed information supersede older versions.

Add a compact “What Origen remembers” view inside the binder, organized by topic. Support inspect, correct, confirm, and remove. An explicit user edit or save supplies the user's intent; avoid repeated confirmation dialogs for the same action. Show success only after persistence succeeds.

Define lifecycle rules with the schema: removed sources invalidate dependent unconfirmed memories; explicitly saved user notes follow their own established lifecycle. Account/student deletion covers all added records. Prevent deleted information from being recreated by a queued extraction job. A correction or removal during a call must invalidate stale supplied context; use a fresh session boundary when necessary to exclude information already sent to the provider.

Build extraction as an optional source-linked proposal step after a summary is saved. Extraction failure must not lose the summary or block the binder. Backfill existing summaries in resumable batches as proposals; never bulk-confirm old statements. New records and schema changes must follow existing database isolation and runtime/maintenance role contracts.

Completion: tests prove attribution, scope isolation, stale-version rejection, correction precedence, deletion, retry behavior, and failure recovery. A returning call receives the updated brief. Binder controls are usable with keyboard, small screens, and both languages.

## Phase 3 — historical retrieval in PostgreSQL

First verify the configured database provider supports pgvector and that the intended deployment role can enable/use it. Implement and test against the isolated local PostgreSQL database. If extension support is unavailable, ship scoped keyword retrieval and recency ranking behind the same interface; record vector retrieval as pending.

Create embeddings for saved summaries, supported memory entries, and useful binder notes. Preserve source ID/version, scope, language, content hash, embedding model/version, and lifecycle state. Keep vectors as derived data. Store no additional raw audio or transcript archive for this feature.

Generate and update embeddings asynchronously after successful saves, using a durable retryable job mechanism with deduplication and stale-version checks. Backfill in bounded batches. Retry or deletion must not create duplicate or resurrected entries. Include job startup/readiness in reusable environment instructions if a worker is introduced.

Combine exact/keyword matches with vector similarity, relevance, recency, and confirmation status. Apply account and student authorization inside retrieval queries before returning candidates. Recheck source validity and version before constructing context. Include dates and evidence references, deduplicate overlapping summaries/notes, preserve a deliberately selected binder item, and enforce a context budget.

Use a deadline and fall back to the current brief, recent context, and keyword matches when embeddings or vector search are unavailable. A low-confidence match should produce a focused clarification rather than invented memory.

Completion: on a held-out labeled synthetic query set, the expected supporting memory appears in the top five results for at least 90% of answerable cases (proposed initial target). Critical isolation, deletion, and supersession cases must all pass. Report English/Spanish results and no-relevant-memory cases separately. Measure retrieval p50/p95 latency and embedding cost; no latency or cost improvement is claimed from mocked providers.

## Phase 4 — memory tools and updates during live calls

Add tools for retrieving relevant student context and persisting explicitly requested memory updates or accepted next steps. Resolve identity and confirmed student scope on the server. Validate arguments, allowed actions, record ownership, expected versions, and idempotency keys. Tool arguments never grant account access or establish that the user consented to a change by themselves.

Read tools can retrieve context when a question changes topic. Write tools require evidence of the user's explicit request or acceptance in the active interaction; ambiguous intent receives one focused clarification. Keep current spoken corrections effective immediately, with durable changes acknowledged only after successful storage.

Refresh context after successful edits and relevant binder changes. Reject responses from a previous student, session generation, or superseded request. Reuse the existing explicit student-switch boundary. Invalidate in-flight retrieval on removal; restart the provider session when needed to prevent continued use of already-supplied deleted information.

Apply the Phase 1 cancellation/deadline behavior to new tools. Preserve turn ordering, interruption handling, one response per completed turn, and natural transitions between specialists. A tool failure should return a useful structured outcome and let the conversation continue.

Completion: browser/integration tests cover mid-call correction, topic change, concurrent edit, double delivery, interrupted save, delayed old-student result, delete during retrieval, and retry after a failed save. The model never claims successful persistence when the backend reports failure.

## Phase 5 — adaptive guidance and binder follow-through

Apply explicit communication preferences across planning, finance, loans, and admissions: language, response length, examples, and step-by-step pacing. Keep subject-specific instructions and current official-source verification. A previously discussed topic is evidence of discussion, not mastery.

Offer at most one relevant unresolved question or next step when opening a returning session, while following the student's current priority. Avoid repeatedly raising a task the student deferred. Attribute parent aspirations separately and recheck older constraints when they materially affect advice.

After a call, retain the concise narrative summary and organize supported points into the existing topic dividers. Persist accepted actions through existing plan contracts; reuse identifiers/provenance to avoid duplicate notes and actions after retries. Show pending saves and failures clearly. Extend “Talk about this” to carry the relevant item and current context into the call.

Completion: the first complete journey passes end to end with two returning sessions, a goal correction, an old relevant constraint, an official-source lookup, and an accepted action. Verify English/Spanish and desktop/mobile web, including accessibility, reduced motion, and compact voice controls. Native mobile app integration is a separate scope if its voice path needs changes.

## Phase 6 — measured release and controlled rollout

Collect evaluation evidence throughout the work, then compare the same synthetic scenarios and rubric against the baseline. Extend the existing evaluation framework with memory relevance, correction handling, unnecessary repeated questions, and action persistence. Keep automated contract checks distinct from actual model-response and speech evaluations. Review real synthetic outputs for source support, attribution, plain language, and conversational flow.

Use the existing rubric and release workflow, explicitly adopting or revising proposed thresholds rather than silently changing them. Critical memory isolation, correction, deletion, and false-save cases must all pass. Report sample sizes, failures, and unrun cases. Establish an explicit live-evaluation cost budget before paid runs. Measure first-audio delay, added retrieval delay, provider/embedding usage, and cost per completed synthetic session, including failed/retried attempts.

Roll out behind server-owned feature controls, initially to an internal test cohort with synthetic records. Rehearse disabling retrieval and write tools while preserving saved records and falling back to the existing scoped profile/summary experience. Verify migrations with both old and new application behavior and verify how pending jobs behave when a feature is disabled. Prepare the concrete deployment/configuration change for the existing release process.

Completion: required automated and live checks have inspectable evidence, observed latency/cost are within the adopted limits, rollback works, and release status is documented accurately. Passing synthetic cases is evidence for the tested behaviors, not a guarantee of all future responses or academic outcomes.

## Cost and working boundaries

Use the existing PostgreSQL deployment and the free isolated PostgreSQL instance already prepared for cloud development. Redis and another paid database are outside the initial plan. pgvector support and available capacity must be checked; embedding calls, model calls, storage, and worker compute still have costs.

Generate embeddings only for new or changed supported content. Bound backfills, context size, retries, and retrieval work. Keep direct conversation responsive, with extraction and indexing after saves. Reuse established diagnostic instrumentation for counts/timing without copying private memories into logs.

Each implementation phase uses synthetic data and the isolated test database for migrations and destructive tests. Repository implementation and test verification can proceed independently of production rollout. Deployments and production backfills belong to the concrete release step, with the applicable existing authorization and release requirements.

## First implementation unit

Start with Phase 1: reproduce the diagnostic-quota interruption, inaccessible autoplay recovery, and stalled research turn; implement focused fixes and their regression coverage; verify the build and desktop/mobile smoke scenarios; capture the synthetic personalization baseline. The resulting PR should describe demonstrated behavior and any remaining limitations before Phase 2 begins.
