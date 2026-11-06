# Origen network effects research workspace

**v1.2:** The next three implementation steps add actual Admin integration, a separate PostgreSQL worker and a real-model calibration runner. See [the v1.2 implementation and operating guide](V1_2_IMPLEMENTATION.md). The sections below describe the original isolated SQLite foundation; its `cli.mjs` remains provider-free.

**Latest local validation:** [Reviewer restraint and obstacle fixes](V1_2_VERIFIER_RESTRAINT_FIXES.md)
adds bounded edits, exact-source obstacle mapping, v1/v2 audit compatibility and
fresh multilingual retesting. The live model and every feeding path stay untouched.

The earlier [Step 2 targeted AI evidence checks](V1_2_VERIFICATION_STEP_2.md)
adds a separately metered review pass, durable before/after audits and Admin inspection.
Its safeguards and remaining semantic limits are documented; it supplies nothing
to the live model.

The earlier [Step 1 interpretation improvements](V1_2_INTERPRETATION_STEP_1.md)
adds evidence coverage, supported links and pending-milestone progression, with
fresh fictional tests and an explicit list of remaining omissions. The live
model and everything feeding it remain untouched.

The earlier [correction fixes and real-model retest](V1_2_FIXES_AND_RETEST.md)
documents the completed paid fictional-data tests, protected corrections, Admin
review and remaining semantic limits. The mock-only statements below describe
the original foundation checkpoints, not this later validation.

Phases 1–4 provide an isolated local foundation for reviewing how first-generation college students and their families describe questions, guidance, understanding, preferences, actions, and outcomes over time. The workspace keeps the original reporter, language, source version, and supporting text attached to each observation.

The subject matter includes understanding college, exploring paths, applying, costs and aid, enrollment, family expectations, work and transportation, and asking for help. English, Spanish, mixed-language, and unknown-language records are supported. The system does not infer that someone is first-generation or that a parent’s understanding represents a student’s understanding.

Previously, a saved summary could leave the question, suggested next step, and eventual result together in undifferentiated prose. This workspace organizes them into reviewable concern histories: guidance offered, action intended, action attempted, completion reported, and benefit reported remain distinct. A reported positive result remains a report, with its supporting evidence available for inspection.

## Implemented scope

| Phase | Local capability | Main files |
| --- | --- | --- |
| 1 | Strict source and extraction contracts; reporter and language attribution; exact supporting quotes; fictional reference cases | `contracts.mjs`, `fixtures.mjs` |
| 2 | Durable extraction jobs, retries, leases, timings, idempotent replay, source/extractor version checks, indexed family/student context, and an explicitly invoked Responses adapter | `store.mjs`, `worker.mjs`, `extractor.mjs` |
| 3 | Concern episodes, linked observations, corrections, historical source versions, conflicting reports, evidence warnings, and revision-aware human reviews | `store.mjs` |
| 4 | Loopback review API and standalone browser workbench with filters, evidence inspection, review notes, job history, and offline evaluation | `service.mjs`, `ui/`, `evaluation.mjs` |

The demo uses hand-authored synthetic reference labels. Those labels test the infrastructure; they are not AI-generated findings or evidence about real families. The Responses adapter has been tested with mocked provider responses only. No provider calls or paid semantic calibration were performed for these checkpoints, and passing the tests does not establish extraction accuracy. Paid calibration is a separate next step requiring its own authorization and evaluation plan.

## Architectural boundary

All persistent state belongs to a new SQLite database under `research/network-effects/.local/`; the default is `.local/review.sqlite`. The directory has its own `.gitignore` entry. The store rejects disk database paths outside that directory. Tests can use `:memory:`.

This workspace does not connect to the production database, collect live conversations, read existing voice sources, or inject context into Origen. The review server binds only to `127.0.0.1`. It serves local assets without a CDN and accepts revision-checked review writes with a local request token. The UI has no source-editing, deletion, or job-execution action.

The existing permission model remains in force. For non-demo records, a manually supplied local import is the only data-entry route exposed by the CLI; it does not grant permission to access or use an account’s production data. Use only sources already authorized for this purpose. No production collector has been added. Future cohort analysis and live context delivery—phases 5 and 6—are not connected.

Future live work should retain `v1.1` as its baseline and consult the [saved OpenAI Responses reference](../../docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md) and its current official guidance before changing live conversation or integration behavior.

## Run locally

Use Node.js 22.13 or newer with the built-in `node:sqlite` module. This workspace was exercised with Node.js `v24.15.0`. There are no package dependencies to install for this directory; Node may print an experimental SQLite warning.

Run these commands from the repository workspace root:

```powershell
node research/network-effects/cli.mjs demo
node research/network-effects/cli.mjs serve --port 8791
```

Open `http://127.0.0.1:8791`. Stop the server with `Ctrl+C`. The demo loads fictional cases and processes their reference extractions through the durable queue. Repeating the same demo does not add duplicate evidence.

Other commands:

```powershell
node research/network-effects/cli.mjs import --input snapshots.json
node research/network-effects/cli.mjs export --output review.json
node research/network-effects/cli.mjs status
node research/network-effects/cli.mjs evaluate
node research/network-effects/cli.mjs evaluate --input predictions.json --output evaluation.json
```

Commands that use stored evidence accept `--database` with a path under `research/network-effects/.local/`, for example `--database research/network-effects/.local/experiment.sqlite`. Separate databases can keep a fictional demo and an authorized manual review separate. `evaluate` runs without opening a database.

`import` accepts prepared `{ "records": [{ "source": ..., "extraction": ... }] }` JSON. It validates the supplied evidence and stores the batch transactionally; it does not run a model or fetch account data. The limits are 1,000 records and 8 MB per import file. An unchanged replay is idempotent. A changed extraction for an already completed import is rejected instead of silently replacing it.

`export` writes the complete review state, including source text, historical source versions, episodes, jobs, and reviews. It refuses to overwrite an existing file. This inspection snapshot is not the import bundle format; importing it directly is not a supported round trip.

`status` reports source count, episode count, current evidence item count, pending concern count, and failed job count. “Pending” counts concerns with an open/partly answered question or pending outcome, not queued extraction jobs. The workbench shows job status separately.

`evaluate` runs the offline scoring harness in `evaluation.mjs`. Without an input file, it compares the fictional reference labels with an identical replay and then with deliberately corrupted candidates, including incorrect attribution, false positive outcomes, a missing item, and a duplicate. This checks that scoring detects known errors; it does not measure AI extraction accuracy.

With `--input`, the evaluation format is `{ "records": [{ "source": ..., "expected": ..., "actual": ... }] }`. `source` uses the source contract below; `expected` and `actual` use the extraction shape. `expected` is the human reference, while `actual` is a previously prepared candidate. Evaluation does not generate candidates or contact a provider. It reports exact quote-and-kind precision/recall, status and reporter agreement, preservation of pending/unknown outcomes, and contract validity. Comparable fields from invalid candidates remain in diagnostic scores; those candidates still fail storage validation. These measures do not grade semantic truth or student benefit. `--output` writes the report once and refuses to overwrite an existing file; without it, the report is printed to the terminal.

No CLI command loads `.env`, reads provider credentials, or calls a paid provider.

## Source and extraction format

Every source has exactly the following fields. Extra fields are rejected.

| Field | Meaning |
| --- | --- |
| `id` | Stable source identifier |
| `version` | Positive integer; increase it when the source changes |
| `accountId` | Explicit account scope |
| `studentId` | Student identifier, or `null` for family/unspecified-student scope |
| `reporter` | `student`, `parent`, `family`, `coordinator`, or `unknown` |
| `language` | Language tag such as `en` or `es`; `mixed` or `und` when appropriate |
| `kind` | `summary`, `transcript`, `note`, or `coordinator` |
| `recordedAt` | UTC timestamp with milliseconds, such as `2026-11-01T10:00:00.000Z` |
| `text` | Original source text, up to 32,000 characters |
| `synthetic` | Boolean marking fictional/reference material |

Identifiers use letters, digits, underscores, dots, colons, and hyphens, begin with a letter or digit, and are at most 160 characters. Account, student, reporter, and source-kind scope cannot change under an existing source ID. Use a distinct source for a distinct scope.

An extraction contains `schemaVersion: 1` and at most 30 items. Every item supplies all fields shown in the example below, including explicit `null` values where appropriate. Its `quote` must be an exact substring of the original source. This establishes a textual evidence link; it does not prove that the observation’s interpretation is accurate. A quote taken from a summary is evidence of that summary, not a verbatim transcript of the conversation.

This complete, fictional import bundle illustrates a Spanish-speaking parent’s cost question:

```json
{
  "records": [
    {
      "source": {
        "id": "example-family-cost-question",
        "version": 1,
        "accountId": "example-family",
        "studentId": null,
        "reporter": "parent",
        "language": "es",
        "kind": "summary",
        "recordedAt": "2026-11-01T10:00:00.000Z",
        "text": "Quiero entender el costo de la universidad. No sé si debo pedir ayuda.",
        "synthetic": true
      },
      "extraction": {
        "schemaVersion": 1,
        "items": [
          {
            "key": "cost-question",
            "episodeKey": "understanding-college-cost",
            "topic": "costs",
            "barrier": null,
            "kind": "question",
            "status": "open",
            "statement": "La persona que reporta como madre o padre quiere entender el costo de la universidad.",
            "quote": "Quiero entender el costo de la universidad.",
            "reportedBy": "parent",
            "language": "es",
            "occurredAt": null,
            "linksTo": null,
            "corrects": null
          }
        ]
      }
    }
  ]
}
```

`occurredAt` is an event time only when supported by the source; otherwise it stays `null`. Saving a source does not establish when an event happened. `linksTo` and `corrects` are a single item reference or `null`, not arrays. A reference can be an item key in the same extraction or an existing item ID such as `source-id@1#item-key`. References must stay within the same account, student scope, and concern. A correction must refer to the same reporter and observation kind.

The topic values are `college_basics`, `paths`, `applications`, `costs`, `enrollment`, `family_support`, `practical_needs`, `finding_help`, and `other`. The status depends on the observation kind:

| Kind | Allowed statuses |
| --- | --- |
| `question` | `open`, `partial`, `resolved`, `unknown` |
| `guidance` | `offered` |
| `understanding` | `reported`, `uncertain` |
| `action` | `intended`, `attempted`, `completed`, `declined`, `postponed` |
| `outcome` | `pending`, `positive`, `unsuccessful`, `mixed`, `unknown` |
| `preference` | `exploring`, `stated`, `changed` |

## Review and lifecycle behavior

Filter concerns by topic, language, reporter, review status, or text. Select a concern to compare current question/action/outcome states with its full evidence timeline. Expand an original source to see its exact version, reporter, language, account/student scope, text, and summary/transcript distinction. Superseded observations remain visible. Unknown, conflicting, unresolved, and invalidated evidence remain explicit.

A review records a human assessment with an optional note of up to 2,000 characters. It does not establish that an action or outcome occurred. Reviews use the episode revision visible when the reviewer loaded it; a stale submission is rejected. Evidence changes can invalidate a review, and unresolved evidence can continue to require attention after a review is recorded.

Source revisions preserve historical source versions and superseded evidence for inspection. Corrections suppress the earlier corrected observation. Removing or revising a correction does not automatically restore the earlier claim as true; affected concerns can return to unknown or need review. Newer independent evidence for the same reporter and observation kind can resolve that uncertainty. A later save of an older event cannot override a more recent event; event time is used when supplied, otherwise source-record time is used.

Deletion is currently a programmatic store operation, `store.deleteSource(sourceId)`, not a browser or CLI action. It removes that source’s current and historical text, derived items, and jobs, and clears review prose on affected concerns. Tombstone/invalidation records retain identifiers and limited state needed to prevent reimport or resurrection of removed claims; they are not a retained copy of source text. Deletion from this store does not remove a separately exported file or a source held by another system.

The database and exports can contain sensitive original text and review notes; evaluation reports include supporting source excerpts. `.local/` is ignored by this directory’s Git configuration, but local files are not encrypted by this implementation. Keep authorized imports, exports, and reports in appropriate local storage. Files written outside `.local/` are not covered by its ignore rule.

## Responses adapter boundary

`createResponsesExtractor({ apiKey, model, fetcher, timeoutMs })` in `extractor.mjs` creates an explicitly configured extractor. It is used programmatically with `runJob(store, extract)` from `worker.mjs`; there is no provider-backed CLI mode. Credentials and model selection must be passed by the caller. The adapter does not load environment files or discover credentials.

When deliberately invoked with a real provider, the adapter sends the source text and narrowly scoped prior evidence to the Responses API, requests strict structured output with `store: false`, and validates the result against the local contracts before committing it. Setting `store: false` does not make a provider call local or eliminate the need for authorized handling of the submitted data.

The completed checks cover request construction, output handling, refusals, incomplete responses, timeouts, and evidence validation through mocks. Semantic accuracy across languages, family roles, summaries, and ambiguous outcomes still needs a separately authorized calibration exercise before any broader use.

## Validation checkpoints

Run the local tests from the workspace root:

```powershell
node --test research/network-effects/*.test.mjs
```

The implementation checkpoints recorded during this work are below. Lifecycle regressions are grouped by the phase they exercise; these figures are checkpoints, not an aggregate final test total.

| Checkpoint | Recorded result |
| --- | --- |
| Phase 1 contracts | 11 tests passed |
| Phase 2 extractor and worker | 16 tests passed, plus 3 lifecycle regressions and a 1,000-family isolation/replay test |
| Phase 3 timelines | 8 tests passed, plus 11 lifecycle regressions |
| Phase 4 API and evaluation | 6 API tests and 8 evaluation tests passed |
| Phase 4 browser workbench | Desktop and 390px mobile layout checked; filters, source inspection, correction history, saved review, and reload persistence verified; no captured browser errors |

Final combined result: **64 tests passed, 0 failed**. See [CHECKPOINTS.md](CHECKPOINTS.md) for the completed checkpoint record, scale measurements, before/after explanation, and remaining boundaries.

These checks establish the exercised local infrastructure behavior. They do not establish real-provider extraction quality, production readiness, or a demonstrated network effect across users.
