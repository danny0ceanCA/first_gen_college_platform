# Phase 2 — operational guidance history

Implemented in source on October 6, 2026. Not deployed or enabled by this task. Migration `015_guidance_history.sql` is additive; migrations 001–014 remain unchanged. The web voice client also covers mobile browsers. Native Expo voice remains a placeholder and is not connected by this phase.

## Implemented behavior

- Authenticated calls have account-scoped sessions and topic/target segments. Preview calls never write this history, even if anonymous voice is enabled.
- Topic changes keep one call and one display summary, with multiple same-target attribution links. Student-scope reconnections keep the logical session but receive separate segments/summary IDs. Private summaries are not combined across students.
- A prepared configuration is distinguished from one the browser acknowledged. Prior segments close on connection/configuration acknowledgement, not just the change request. These events are client claims, not independent proof of playback.
- New onboarding profiles have pending IDs. Attribution becomes confirmed only after the matching reviewed profile is saved. Deferred-summary intents reconcile atomically with persistence.
- Atomic attribution/event writes accompany summary saves. Retries cannot replace student/topic attribution. Legacy summaries stay readable without fabricated history.
- Immutable configuration references record reusable prompt/tool hashes, requested model, policy version and application revision. Personal prompt text is excluded. Resolved provider model/token usage are retained only when actually returned; unknown usage remains null. SDP negotiation does not reveal total Realtime audio usage.
- Actual research requests record timing, status, safe codes and bounded source references. Questions, answers, titles, raw arguments and URLs with queries/fragments/credentials are excluded from metadata. Source counts describe retained references; academic effective periods remain unknown.
- Late results retain their initiating segment. Browser response/language events are allowlisted. This adds no model calls, raw audio store, transcript corpus, research enrollment or training permission.
- Account export includes owned metadata and referenced configurations. Account/student deletion cascades appropriate records. Existing linked-family/institution closure restrictions remain. Shared configuration records contain no user content.

## Collection and reporting

`origen_guidance_events` is a committed transactional event log and local outbox. Domain events appear only after the write commits. Consumers read this log directly; no external relay, broker or research sink is enabled. UUID/sequence deduplication, server receipt time, bounded client clocks and per-session event/segment limits apply. Unknown/content-bearing fields are rejected; conflicting replays cannot replace evidence.

The implemented subset covers negotiation, segment preparation/application, connection/end/failure, response completion, language, tool execution, target confirmation and summary persistence. Route events are accepted but not automatically produced yet. Phase 1's larger event catalog remains a design; onboarding cohorts and outcome instruments are later work.

An operator can run `node server/guidance-report.mjs` in the backend environment for aggregate counters without identifiers. POST `{"action":"report"}` to `/api/guidance-history` provides a signed-in account's own coverage report, never another family's data. Institution membership grants no additional access. Account reports cap sessions at 1,000 and label truncation; negotiation totals cover retained operations and may exceed that cohort.

Counts start at server SDP negotiation, after microphone permission. Permission denials, unsupported browsers and requests rejected before negotiation are absent from that denominator. Connection does not prove an accurate/useful answer. Missing browser events stay unknown. Reconnect attempts are separate operations within one logical session. Browser cache hits do not create server tool executions. These counts do not establish cost, unique people or causal learning outcomes.

## Retention and lifecycle

Startup/hourly cleanup deletes session metadata older than 90 days from session start, including dependent segments/events/executions/sources/attribution/intents. Deletion may occur up to one cleanup interval after cutoff. Disabling collection does not disable cleanup. Operations/sessions unfinished for 30 minutes are marked abandoned.

Existing summaries/profiles/plans have a separate lifecycle. Expiring attribution does not delete a saved summary. An unsaved summary recovered beyond the metadata window can proceed without attribution when that metadata has expired; lost provenance is not invented. Hosting logs, provider records and backups remain separate. No universal erasure or zero-retention claim is made.

## Rollout

1. Deploy matching backend/frontend with collection disabled (default). Migration 015 runs through the existing runner. No frontend environment setting is needed. Older clients stay compatible and uninstrumented without a segment header.
2. Review the bilingual privacy/voice notices, 90-day operational retention and responsible owner. This is service diagnostics, not research consent.
3. Set backend `GUIDANCE_DATA_OWNER` to the responsible operator. Supply `APPLICATION_REVISION` unless Render provides `RENDER_GIT_COMMIT`. Enabled production collection requires both ownership and revision evidence.
4. Verify the issuer of existing account/representative subjects. Only if those records are known to belong to the configured tenant, set `GUIDANCE_LEGACY_ISSUER=https://origenedu.us.auth0.com/` (the exact configured issuer). This asserts historical provenance; do not set it for uncertain old-tenant accounts. Startup rejects unmapped legacy identities without this confirmation and blocks existing mappings from another issuer.
5. Set backend `GUIDANCE_HISTORY_ENABLED=true`, then restart/deploy. Exercise synthetic signed-in calls, topic/student changes, summaries, export and deletion before broad use. Roll back by setting it to `false`; keep migration 015 and cleanup.

The app still trusts one configured Auth0 issuer. Mapping prevents silent issuer replacement; it does not implement automatic cross-tenant linking or email-based merges. Existing representative identities are mapped at startup; new representative mappings are added at subsequent startup. JWT issuer validation applies on every request.

## Validation and deployment checks

Focused tests cover account boundaries, replay/conflict/reorder, onboarding attribution, topic changes, acknowledgement, delayed results, issuer ambiguity, allowlists, retention, export/closure and summary model provenance. Production build validation is required. A dedicated PostgreSQL integration test additionally checks migration/cascade and transaction rollback when `DATABASE_TEST_URL` is supplied; pg-mem alone does not prove production locking/rollback.

Before production enablement, run the dedicated PostgreSQL test, exercise signed-in browser flows and verify cleanup/provider settings. No production database or conversations were accessed by this implementation. Research datasets, permission workflows, progress instruments and model evaluation/training remain later phases.
