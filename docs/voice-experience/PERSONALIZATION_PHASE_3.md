# Phase 3: historical retrieval

Implemented and verified locally on October 18, 2026 using the plan's PostgreSQL keyword fallback. Production is unchanged. Vector search, embeddings, and their durable indexing worker remain pending extension/provider verification.

## Student experience

Origen can now bring relevant older summaries, saved binder notes, and current proposed/confirmed memories into a returning conversation, beyond the previous 24-summary window. The existing recent summaries, student brief, and selected binder item remain available. Search adds up to five dated evidence entries with source references, versions, and content hashes.

When the person chooses **Talk about this**, retrieval starts from the selected item or divider. A guide refresh can use the latest user turn supplied for continuity. Otherwise the server uses saved goals, needs, interests, or the guide topic. This phase supplies context at session creation and guide updates. Searching after an arbitrary new spoken question during an unchanged call is the Phase 4 read tool.

Missing evidence does not become an invented recollection. The prompt requires a focused clarification for missing or conflicting information, gives current corrections priority, and distinguishes parent reports, unreviewed summaries, and saved user entries. Notes and summaries without recorded speaker attribution remain `unknown`; summary language remains `und` because that table does not store it.

## Retrieval and lifecycle

`server/history-retrieval.mjs` implements the common retrieval interface using English and Spanish stemming, simple lexemes for names/acronyms, and a small explicit vocabulary expansion for work/employment and schedules. Ranking combines matched query concepts, full-text relevance, confirmation status, and a small recency preference. This is keyword retrieval; arbitrary paraphrases and cross-language concepts are not guaranteed.

Each SQL source branch requires the authenticated account and exact student or family scope before returning candidates, alongside existing RLS. Source-linked entries must still belong to a valid summary in that same scope. Suppressed summaries and their dependent notes/proposals are excluded. Explicitly confirmed corrected memories can remain usable when their old summary is suppressed. Deleted and superseded memory versions cannot be returned.

Migration `045_historical_retrieval.sql` adds three native GIN expression indexes to existing source tables. PostgreSQL maintains them transactionally with source saves, corrections, deletion, cascades, and recovery-manifest replay. Existing rows are indexed by the migration. There is no second text archive, raw transcript/audio store, queue, cache, or index worker to retry or repopulate stale documents. Asynchronous embedding jobs and bounded embedding backfills are deferred with the vector implementation.

The query returns at most 40 ranked candidates. Selection deduplicates identical text and overlapping summary/note sources, excludes evidence already included in the brief/workspace/recent summaries, and adds at most five entries within 6,500 JSON characters. Excerpts are bounded and centered on matching terms. Existing workspace budgets continue to preserve an explicitly selected item. Search uses at most 24 query terms and a 900 ms whole-operation deadline, with an additional PostgreSQL statement timeout. Late pool acquisitions are released; failed transactions roll back. Search failure or a missing migration falls back to the current brief and recent context. Authorization failures still fail closed.

The voice handler checks the Phase 2 scope revision after retrieval, before constructing the provider session. A correction/deletion during assembly returns `memory_changed`; an active call retains Phase 2's revision invalidation behavior. Browser-supplied historical evidence is discarded. Diagnostic events record the approved `memory.retrieve` operation and timing, never search queries, source content, source IDs, or embeddings. Guidance policy hashes use empty historical evidence.

## Evidence

The reproducible report is [history-retrieval.keyword.v1.json](../../evals/history-retrieval.keyword.v1.json); the frozen new catalog is [history-retrieval.cases.v1.mjs](../../evals/history-retrieval.cases.v1.mjs).

| Check | Result |
| --- | --- |
| New English answerable queries | Correct source in top five: 12/12 |
| New Spanish answerable queries | Correct source in top five: 12/12 |
| No relevant history | Empty results: 2/2 English, 2/2 Spanish |
| Account/student/family boundaries in new query set | No failures |
| Original Phase 1 cases through current voice handler | Required evidence: 16/16, versus baseline 14/16; all 20 boundary checks pass |
| Measured local retrieval latency | p50 3.50 ms; p95 4.61 ms |
| Embedding calls / tokens / cost | 0 / 0 / $0: no embedding API is called |

The original Phase 1 baseline is preserved. Its known work-schedule examples exposed a gap in plain keyword matching; the bounded employment vocabulary and conversational stop words address those development cases. The separate 28-case catalog was held out from the Phase 1 catalog and lifecycle fixtures. These are synthetic source-selection checks, not evidence of perfect recall or response correctness.

Real PostgreSQL regression tests exercise restricted runtime roles, older evidence, English/Spanish matching, attribution, confirmation ranking, conflicts, correction/supersession, source deletion, memory erasure, recovery replay, cross-account and sibling/family isolation, selected-item preservation, forged client context, revision changes during assembly, missing migrations, database lock timeouts, and late pool acquisition. The full server suite passes (566 tests, zero failures or skips); build, 20 offline model contracts, and logging-policy checks pass. Chromium browser checks cover six memory journeys, 25 voice reliability scenarios, and eight binder journeys across desktop/mobile and both languages.

All database fixtures used the isolated local PostgreSQL 17 instance. Provider negotiation and browser WebRTC were mocked. No paid model calls, production database writes, live microphone/Safari checks, or production load tests were performed. Latency measures the real local scoped retrieval transaction, not time to first speech. Extra context can still add live model token cost; production inference costs remain unmeasured.

## Setup and rollout

No new service, dependency, secret, Redis instance, or paid database is required for the fallback. Existing cloud install/start instructions already start the isolated PostgreSQL service; no additional worker startup instructions or environment configuration changes are needed. The new migration was applied to the local development database and its capability probe reports all three keyword indexes ready.

For local verification in this environment:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-concurrency=1 server/history-retrieval.test.mjs
node /workspace/.local-postgres/bin/run-tests.cjs npm run eval:history-retrieval -- --output /tmp/history-retrieval-candidate.json
node /workspace/.local-postgres/bin/run-tests.cjs npm run db:check-retrieval
```

For a later deployment, first follow the Phase 2 migration/grant and privacy-recovery requirements, then apply migration 045 through the repository's migration role and normal migration command. These ordinary index builds occur in the existing migration transaction and can block writes while building; schedule the migration appropriately for database size. Verify `npm run db:check-retrieval` with the intended runtime credential before rollout. If the migration is absent, voice remains usable with its brief/recent-context fallback.

The read-only capability probe reports vector availability, installation, type/schema access, and ordinary PostgreSQL role eligibility to enable the extension. It never enables an extension and does not claim provider-specific grants. Run it separately with the intended deployment role binding when evaluating vector support. Local PostgreSQL reports pgvector unavailable. The configured remote provider and deployment role were not probed: this cloud environment has no remote TCP destination grants. Therefore production vector support remains unverified. A future vector implementation must add model/version metadata, durable deduplicated jobs, bounded backfills, retry/deletion fences, and worker readiness before it can be enabled.
