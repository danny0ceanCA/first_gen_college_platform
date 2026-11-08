# Durable research diagnostics

Implemented locally on `v1.2`, November 7, 2026. Starting commit: `991d7118adb0545470547c365a3793195dfae08a`. Production migration/grant setup was subsequently authorized and completed as recorded below. No paid provider test or additional worker service was used.

## What this adds

One call can now be traced through its research jobs, worker attempts, optional recovery, polling, context delivery, speech observations, and browser playback reports. Each component keeps its own evidence and timing. A completed lookup is not proof of a spoken answer; a transcript match is not proof the person heard or understood it.

| Observation | Retained information |
| --- | --- |
| Queue lifecycle | Call/job IDs, mode, language, queued/started/finished times, status changes and queue cleanup |
| Worker attempts | Unique attempt ID, initial/recovery pass, duration, HTTP status, provider request/response IDs, classified failure stage, incomplete/output-limit reason, token/cache/reasoning-token counts, requested/provider model, output/tool limits, reasoning effort, structural configuration hash, bounded search action types/statuses |
| Network failures | Allowlisted network error category and shutdown/deadline/job-state stop category; no raw error messages |
| Reuse/recovery | Retained/lookup counts, recovery decision and final outcome, evidence version, finding status counts |
| Polling | State changes, failures, durations, HTTP status when available, cumulative poll count and periodic progress samples |
| Delivery | Context supplied/acknowledged, deferred/commentary stages, interruption/repetition reasons, request revision and evidence version where available |
| Speech | Transcript-derived completion/overlap classifications, explicitly separate from playback |
| Playback | Browser-reported idle/version observations, explicitly labeled browser evidence |
| Research evidence | Account-private snapshots of the server-shaped public question, retained official evidence supplied to research, and parsed report/findings/qualifications/sources |

### Correlation

Operational events use purpose-separated SHA-256-derived `researchCallKey` and `researchJobKey` values, truncated to 32 hexadecimal characters. The same job has matching keys in worker lifecycle, research delivery, and live measurement records. `measurementRun` still identifies a particular collection run; it is not the call/job identity. Worker startup and global queue-health errors are service-level events and therefore have no particular call/job. Every per-job worker lifecycle event carries the join keys.

Exact application call/job IDs and provider IDs are retained in the private database archive. They are not added to stdout or browser diagnostic event attributes. Keys are for joining observations, never authorization.

Each Responses attempt sends its generated UUID as `X-Client-Request-Id` and records the returned `x-request-id` when available. This lets an operator identify an attempt even if a network failure prevents receipt of the provider's request ID. Request IDs are metadata; no new prompt, response generation, model/tool choice, retry, or voice instruction is introduced.

## Storage and retention

Migration `124_voice_research_traces.sql` adds:

- `origen_voice_research_traces`: durable per-job identity, status/timing, gap markers, and private research snapshots.
- `origen_voice_research_trace_events`: timestamped observations linked to the job, account, and call.

**Neither table has an expiration time or a scheduled TTL purge.** Neither depends on the expiring queue through a foreign key. Queue cleanup and worker connection/process replacement do not remove saved diagnostics. Account deletion remains authoritative and cascades to both tables.

Queue lifecycle/archive updates occur in the same database transaction as the queue change. Existing jobs still present when migration 124 runs are projected into the archive. Already-expired historical jobs cannot be reconstructed by this migration.

Private snapshots contain allowlisted research input/result fields, not entire arbitrary objects. Research reports retain their source qualifications without truncation. Each input/result snapshot is bounded to 512 KiB; an oversized snapshot is omitted with `snapshot_omitted=true` instead of cutting a qualification. The snapshot fields are returned only with the owner's explicit `includeReports=1` diagnostic export. They are never operational telemetry and are never a source for the live model's normal retrieval/reuse tools.

This retention change applies to research diagnostics and research evidence. It does not change existing transcript, audio, private voice capture, or student-memory retention. Profiles, raw conversation transcripts, credentials, provider hidden reasoning, raw exception text, and duplicated output parts are excluded from this archive projection. Research snapshots remain account-private data.

Longer diagnostic retention does **not** extend evidence freshness. Live reuse continues to use its existing short-lived, authorized research records and scope/year checks. Diagnostic exports are historical evidence, not newly verified policy.

## Conversation isolation and failure handling

Detailed event writes use a finite queue, one in-flight write per collector, and timeout/gap reporting. Call instrumentation observes existing events and never awaits a database write on the model's speech/control path. A stalled diagnostic sink cannot send commentary, interrupt speech, start research, or add an instruction. Worker detail queues are flushed after publishing their final result.

The database trigger makes queue lifecycle/archive updates transactional. Fine-grained observations remain bounded asynchronous telemetry: a hard process crash or unavailable database can lose a final buffered observation. Such absence must be treated as unknown. Service gap events and retained `diagnostics_dropped` markers identify collection problems where storage is available. A call-wide collector's gap marker may conservatively affect several jobs; do not sum those markers as exact lost-event counts across jobs.

State changes and failures are recorded on polling; unchanged successful polls are sampled every ten polls. No model events or transcripts are sampled or altered by this code. Playback observations are recorded on state/version changes, not on every heartbeat.

Raw worker errors are replaced by fixed failure categories. A provider `incomplete` response, exhausted output budget, HTTP rate limit, malformed JSON, validation rejection, network error, and cancellation/shutdown observation remain distinguishable. No success is synthesized when a terminal observation is missing.

RLS and composite account/call/job foreign keys protect archive ownership. The research worker can read/append/update the archive metadata required by its work and append events, but cannot delete research traces or read student/account tables. Owner-authorized API reads use the existing account guard. Client packets cannot select a different account or insert server delivery observations.

## Setup when deployment is authorized

Migration 124 and the required archive grants were applied to production on November 7, 2026 (01:27 UTC on November 8), following explicit user authorization. The API and worker logins were verified; public API health and readiness returned HTTP 200. Main and service deployments were not changed. For future environments, use the normal migration role and provisioning workflow:

```sh
npm run db:migrate
npm run db:grant-runtime
npm run db:grant-research-worker
```

These commands require the existing migration/runtime-role environment configuration. Do not point tests at production. API readiness and worker startup check the archive's existence/privileges so a missing migration/grant is visible. Existing release metadata comes from `RENDER_GIT_COMMIT`, `APPLICATION_REVISION`, or `GITHUB_SHA`; no new secret or worker service is required.

## Read and summarize one call

Authenticated owner endpoint, with the application's normal origin/access checks:

```text
GET /api/voice-research-jobs?diagnostics=1&sessionId=<call UUID>
```

Add `includeReports=1` only when reviewing private research input/results. The endpoint remains readable for the owner when background research is disabled. It does not require the transient job row to exist.

Events are paged, up to 500 per response. Follow `next.after` and `next.afterId` until `next` is null, merging event pages and retaining the job summaries. Cursor timestamps preserve database microseconds; this prevents repeated or skipped events within the same millisecond. Private report snapshots are absent from the default metadata export.

Save the authorized export locally, then run:

```sh
node scripts/research-trace-report.mjs /path/to/authorized-export.json
```

The report contains per-job queue/worker timings, provider attempts, delivery-stage/reason counts, speech/playback evidence counts, collection warnings, and a sanitized timeline. It does not reprint report bodies. Queue wait is computed from database timestamps; worker durations use worker measurements. Cross-machine timestamps provide approximate ordering, not accurate cross-machine latency subtraction.

Useful review sequence:

1. Find the call, job and release; check collection gaps first.
2. Compare queue wait with provider pass duration to locate the delay.
3. Inspect HTTP/incomplete/validation/network categories and request IDs.
4. Check whether initial evidence was published before recovery finished.
5. Compare poll state with publication and context acknowledgment.
6. Check deferred/repeated/interrupted announcements and transcript evidence.
7. Inspect browser playback separately. Use authorized audio/transcript review for warmth, factual quality and whether an answer was useful.

## Guidance review and verification

The prior complete review of all 45 official snapshots' unique content was reused. All 45 files were checked against the manifest before edits: zero missing files and zero checksum differences. The saved Responses reference, configuration audit and measurement plan were consulted again, alongside relevant current official guidance. This was not a new literal reread of millions of repeated schema tokens. No documentation was supplied to the runtime model.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#verify-the-complete-interaction): action IDs/task revisions and separate backend versus spoken outcomes shaped correlation and evidence labels.
- [Managing Live sessions](https://developers.openai.com/api/docs/guides/live-conversations): acknowledgment, transcript and usage observations have distinct meanings; logging does not change the event protocol or conversational timing.
- [API request debugging](https://developers.openai.com/api/reference/overview#debugging-requests): provider/client request IDs support troubleshooting, including failed network requests.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): incomplete results, refusals and output validation are technical outcomes rather than evidence of a factual answer.
- [Data controls](https://developers.openai.com/api/docs/guides/your-data): application-owned diagnostic retention is separate from provider storage. Existing research `store:false` behavior is preserved.

Local verification uses fictional English/Spanish fixtures and isolated PostgreSQL on localhost. It covers provider correlation, incomplete output, HTTP 429, malformed JSON, network reset, polling transitions/failures, stalled sinks, speech versus playback evidence, ownership isolation, restricted worker grants, queue cleanup, worker reconnection, durable report projection, microsecond pagination, and account deletion. Conversation/control tests protect the existing intro, native flow, scope changes and research delivery. Build/logging policy checks are recorded in the task review. No new paid voice call was made; these tests do not establish production pacing or audible quality.

No additional worker is needed to collect this archive. A future analysis/export worker could read the retained observations to summarize recurring delays or failure patterns without joining the live conversation. Its need should be decided from measured workload and collection gaps.

## Production setup record

The additive migration and required new-table grants were applied in one transaction using the migration advisory lock. The target was `origen_edu_database`; verified service roles were `origen_api` and `origen_research_worker`. RLS is enabled on both archive tables. The worker has no archive DELETE permission and no account/student SELECT permission. Credentials were kept in process memory and not printed or checked in.

Preflight detected a pre-existing checksum difference in `121_private_test_mirrors.sql`. Migration 123 matched; migration 124 was the sole pending application migration. Only 124 and its grants were applied, without rewriting migration 121 or any historical checksum. A future full-directory migration run still needs that separate history mismatch reconciled.

The running Render API and worker track `main`. Database setup alone does not activate the new per-attempt/delivery instrumentation; that requires deploying the corresponding code. The database trigger can already preserve the existing queue lifecycle and research snapshots.
