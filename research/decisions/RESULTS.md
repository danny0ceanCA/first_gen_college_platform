# Phases 1–2 results

Branch: `v1.3-decisions-integration`. Implementation and validation used isolated
fictional data only. No commit, push, deployment or production change.

## Real Decisions API validation

One 36-case run used `gpt-6-luna` through the standalone `/v1/decisions` endpoint.
The classification rubric and the 18/18 calibration/holdout split were fixed
before the run. Semantic fixture IDs, expected labels, split assignments and
the application’s addressed/declined flags were excluded from provider input.
No prompt tuning or relabeling followed the results.

| Language | Valid responses | Support category correct | Already-addressed label correct | Median API time | p95 API time |
| --- | ---: | ---: | ---: | ---: | ---: |
| English | 14/14 | 14/14 | 14/14 | 152 ms | 971 ms |
| Spanish | 14/14 | 14/14 | 14/14 | 133 ms | 380 ms |
| Mixed English/Spanish | 8/8 | 8/8 | 8/8 | 170 ms | 482 ms |
| All | 36/36 | 36/36 | 36/36 | 152 ms | 482 ms |

The first connection took 971 ms. These are client-observed full HTTP request
durations, including connection and response body time, not audible response
times. The p95 uses nearest rank; in the small language groups it equals the
slowest request.

The classifier distinguished 14 unhandled explicit help requests from 22 other
cases, with zero observed false candidates or missed candidates in this set.
Both classification labels matched on all 18 calibration and 18 holdout cases.
Only three cases contain an already-addressed request, so that result is
particularly preliminary.

Applying the calibration threshold unchanged to holdout retained all seven
expected candidates with zero false candidates. The set includes 6 family-role
and 30 student-role cases. Mixed-language holdout contains no positive help
requests, so mixed-language holdout recall is **not established**.

The calibration-only procedure selected a **0.58** selected-choice probability
for shadow measurement. This is not a production threshold or a promise of
calibrated certainty. Confidence is a different field; one correctly classified
mixed-language case had confidence 0.47. Nothing is delivered to Live at any
threshold. Representative independent scenarios and human review are needed
before intervention is considered.

## Cost and failures

- Approved cap: **$5**.
- Estimated cost from the 36 successful requests’ reported usage: **$0.0027367**.
- Three initial attempts failed at the sandbox network boundary. They are
  recorded as unavailable, excluded from successful-request accuracy, and
  retain **$0.15** of conservative reservations because no usage was received.
- Total ledger usage plus reservations: **$0.1527367**; safely unreserved balance:
  **$4.8472633**. No automatic retries; the authorized network run was explicit.
- Provider billing was not independently reconciled. The usage estimate uses the
  documented cache-disabled input price; output tokens have no Decisions charge.
  [Official Decisions pricing guidance](https://developers.openai.com/api/docs/guides/decisions)

## Offline checkpoints and isolation

**60 tests passed**, with no failed or skipped tests:

```powershell
node --test research/decisions/*.test.mjs
node research/decisions/cli.mjs
node research/decisions/verify-isolation.mjs
```

The default CLI validates all 36 fixtures with zero API calls. Git whitespace
checks passed and the local evidence/ledger ignore rules were verified.

The offline suite checks scope and permission changes, stale corrections,
reconnect gaps, bounded whole-fact records, unfinished transcript spans, forged
snapshots, duplicate/coalesced observations, stale completion, refusal, malformed
answers, missing usage, provider errors and timeouts. It includes complete
state → rubric → client → observer → SQLite accounting tests with fake HTTP
transport, and concurrent ledger reservation tests.

An earlier declined/addressed opportunity applies only to its originating
question, so it cannot suppress a newly requested explanation of the same kind.
Provider request IDs and usage remain available in failure diagnostics. Context
acknowledgments and playback observations remain distinct from transcript text.

The final isolation check hashes **3,163 existing tracked non-document files**.
Their combined hash matches the captured pre-implementation baseline:

`0b40a73eaaaf42c288915f9fcfa60857228751d97719555b57e0187c975d834b`

The application has no imports of this laboratory. The live model, voice,
intro, prompts, student brief, context delivery, research tools, worker and
production configuration are unchanged.

## What this establishes—and what remains

The isolated architecture can make and measure bounded classifications while
keeping stale or unavailable observations non-actionable. Its fictional test
results support further evaluation; they do **not** establish a naturalness
percentage, improvement over the current voice, or readiness for release.

The authored English/Spanish cases share some translated scenario templates
across splits. The holdout therefore tests this fixture collection, not unseen
families or independent scenario generalization. Research examples test context
coexistence, not official-source correctness or timing during actual speech.
No new research, voice or production calls were run.

Before phase 3, use a separately authorized representative evaluation and
paired listening tests. Those must check whether any proposed cue is actually
useful, still current, and delivered without changing the intro or interrupting
natural conversation. No such delivery path is included here.

Local detailed run evidence is in `.local/phase12-provider/`; network failures
are in `.local/phase12-baseline/`. The durable budget ledger is shared across
runs. These local files are ignored by Git. `validation-results.json` preserves
the fictional classification measurements and source hashes for review.
