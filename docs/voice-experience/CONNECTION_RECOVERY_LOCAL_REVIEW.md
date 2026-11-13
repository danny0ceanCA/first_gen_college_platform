# v1.3 connection recovery and history timeout repair

Local changes only. No commit, push, deployment, production migration, service
restart, or production flag change was made for this repair.

## Evidence and scope

The November 12, 2026 production incident around 16:40 Pacific had two observable
failures. The first peer reported `disconnected`; inbound RTP packets and audio
energy continued advancing until the browser's eight-second recovery timer
ended the call. A subsequent attempt hit five-second account/permission database
timeouts and returned `account_status_unavailable`. A later control socket
resumed after about two seconds. There was no coincident deployment/restart.

This does not establish whether the initial transport disruption originated in
the client network, provider, or another hop. Nor does it prove every database
timeout was caused by historical retrieval. The repair targets reproduced
application weaknesses rather than claiming to have diagnosed an upstream outage.

## Library alignment

The prior completed review of all 45 Responses snapshots remains applicable;
every manifest file was checked again with normalized line endings and all
45 checksums matched. The saved Responses reference, relevant session lifecycle,
sideband, and conversation-state guidance and local audit/measurement plan were
revisited. The current official WebRTC and Live-session guides were consulted:

- [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live):
  media tracks and JSON event channels have different responsibilities.
- [Managing GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations):
  startup errors, running transport failures, confirmed session closure, playback,
  and backend task state must remain distinct. A new session is not assumed to
  resume the old session automatically.
- [Server controls](responses/pages/api/docs/guides/voice-server-controls.md):
  preserve the existing action owner and authorization boundaries.
- PostgreSQL's [full-text search guidance](https://www.postgresql.org/docs/18/textsearch-tables.html)
  and [generated-column contract](https://www.postgresql.org/docs/18/ddl-generated-columns.html)
  support storing the explicitly configured text vector and updating it with
  its source row, rather than rebuilding it during each search.

The new recovery grace is an application policy, not an OpenAI guarantee or
documented timeout recommendation. No prompt, greeting, delegation mode, model,
speech pace, binder behavior, or research-table rendering was changed.

## Changes

| Area | Local repair |
| --- | --- |
| Transient peer disconnection | At the existing eight-second check, use fresh inbound packet/byte progress plus an open event channel to continue the same session. Recheck every two seconds, with a 30-second recovery limit. |
| Unusable transport | Failed/closed peers remain terminal. Stalled media, a closed event channel, failed/stuck stats, or the recovery limit end the attempt. No automatic second greeting, new voice session, or duplicated tools. |
| Diagnostics | Private archive event `peer_connection_recovery` distinguishes started, continued, recovered and ended, with elapsed time and a bounded reason. Raw stats, candidate addresses, SDP and stream IDs are not recorded by this probe. Packet progress is not labeled audible playback. |
| Optional recall concurrency | One active retrieval per account and two per database facade. Busy requests use the existing brief without queueing another optional search. A late pool acquisition retains its admission slot until it is cleaned up. Admission deferrals are logged distinctly. Permission/account checks are not bypassed or cached. |
| Deadline cleanup | Aborting a history search destroys that client, releasing the pool slot and locks rather than waiting for an unresponsive SQL/rollback. The isolated database facade forwards the destruction error. Late acquisition/results cannot issue further protected reads. |
| Search work | New migration 127 maintains generated English/Spanish/simple text vectors inside the existing protected source tables. Search reuses them and parses coverage terms once, preserving ranking, student/account filters, edits, suppression and deletions. |
| Migration compatibility | The new search path checks the migration ledger; schemas without 127 retain bounded legacy retrieval. Existing indexes and historical migrations are unchanged. Migration 127 has been exercised only on a disposable local database. |

Generated search documents are derived from the same row and update
transactionally. This is not a separate student cache, external embedding service,
or extra worker. Deploying later requires applying migration 127 to obtain the
search-performance improvement. Its generated columns/indexes add storage and
require a table-lock/rewrite window during migration; schedule that separately.

## Local verification

- 278 focused compatibility/regression tests passed: recovery, channel resume,
  audio diagnostics, private capture, profile voice, permissions, research tables
  and visual state.
- 34 real PostgreSQL tests/subtests passed on fictional data with restricted
  runtime roles: account/student isolation, revocation, correction/deletion,
  generated/legacy evidence parity, blocked searches and overlapping bilingual
  recall, pool reuse and permission/account availability.
- TypeScript/production build passed. Existing bundle-size warning remains.
- No paid OpenAI calls were made.

After the final admission-cleanup race fix, the combined suite passed all 312
tests/subtests with zero failures or skips, including the 34 PostgreSQL checks.
Its final artifact is `output/connection-recovery-complete.tap`.

The three-run query comparison used 240 fictional long summaries, alternating
the old and new SQL on the same local database. Ranked records were identical.
These are query timings, not production call latency or statistically stable
performance estimates:

| Language | Old query median | New query median |
| --- | ---: | ---: |
| English | 979 ms | 385 ms |
| Spanish | 1,471 ms | 449 ms |

Artifacts are `output/connection-recovery-regression-final.tap`,
`output/connection-recovery-postgres-final.tap`,
`output/recovery-query-benchmark.json`, and
`output/connection-recovery-build-final.txt`. The benchmark deliberately bypasses the
voice deadline to measure the old query; normal retrieval retains its 900 ms
deadline. An earlier candidate-only materialization experiment did not improve
timing reliably; that result is not presented as a successful optimization.

## Remaining validation

No new real microphone/provider call was run. A local microphone test with a
temporary network disruption is still needed to assess perceived continuity,
bidirectional audio, and warmth. This repair cannot guarantee recovery from an
upstream/provider outage or a complete network loss. It does not alter the
separate normal-close/finalization path or proactively restart ICE.

## Follow-up: missing production tables

Call `a008ad38-110d-48a6-8abf-6e5bc9c155e6` completed three production
catalog jobs in approximately 1.12, 0.59 and 0.85 seconds. The server feature
flag had been enabled, but the browser receive handler still required
`import.meta.env.DEV`. Thus the production build discarded valid table reports.
This was missed during the earlier enablement verification, which exercised the
catalog projection/builder but did not exercise the production browser receiver.

The local fix removes that browser-only development check while retaining
server feature gating, report validation, session generation and closing guards.
Eighteen visual/flag tests and the production build passed. Inspection of the
compiled production bundle confirmed that the table receive/dispatch branch is
now retained. No production change was made; a deployment is still required.

## Subsequent release authorization

Daniel subsequently authorized completing the production repair. On November
13, 2026 at 01:11 UTC, migration 127 was installed on the verified production
database using the separate migration owner, a bounded lock timeout and the
scoped migration runner. All three generated columns and the restricted runtime
role's SELECT privileges were verified. Historical migration 121 and its recorded
checksum were left untouched. No student source text or catalog amounts were
edited. Code release includes the table receiver and the tested connection and
history fixes; unrelated discussion-board working changes are excluded.
