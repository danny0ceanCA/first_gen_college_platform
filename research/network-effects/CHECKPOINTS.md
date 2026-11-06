# Network Effect Architecture — phases 1–4 checkpoints

Completed locally on `v1.1` using Node.js v24.15.0. Implementation is confined to `research/network-effects/`. The existing application, live prompts, briefs, binder feeds, research delivery, production databases, Render services, and production settings were not changed. No commit, push, deployment, or paid provider call was made.

## Checkpoint results

Each phase was checked before advancing. Final review added lifecycle regressions and a scale check, then the combined suite was rerun.

| Phase | What was verified | Final automated checks |
| --- | --- | ---: |
| 1 — Define evidence | Exact source quotes; known vs unknown information; student, parent, and family attribution; English, Spanish, mixed and unknown language; broad navigation topics | 11 passed |
| 2 — Process separately | Durable jobs, crash leases, bounded retries, duplicate/replay handling, stale source/extractor rejection, Responses request/response handling through mocks, scoped context, 1,000-family processing | 20 passed |
| 3 — Connect the history | Guidance-to-action-to-result links, separate family/student understanding, pending and unsuccessful results, source corrections/deletion, later confirmation, event-time ordering, review invalidation | 19 passed |
| 4 — Inspect and evaluate | Local API isolation, revision-checked reviews, evidence-safe UI rendering, evaluation scoring and known-error detection | 14 passed |
| **Total** | **Combined final run** | **64 passed; 0 failed** |

Command: `node --test research/network-effects/*.test.mjs`. Local run log: `.local/final-tests.log`.

Browser checks used the standalone review workspace at `http://127.0.0.1:8791`. Verified Spanish and reporter filters, clearing filters, original-source inspection, a corrected Spanish outcome remaining pending, saved review notes across reloads, and responsive layout at 390px. The document remained within the viewport; the job table has its own horizontal scroll. No warning/error entries were captured in the browser log. Screenshots are `.local/desktop-review.jpg` and `.local/mobile-review.jpg`.

## Local data and scale exercise

The review demo has **15 fictional source records, 10 concern histories, and 26 current evidence items**. It includes a corrected historical observation, so evaluation of all source observations has 27 reference items. No real account information was read or imported.

A separate disk-based smoke check added 1,000 fictional families, each with one source and two prepared evidence items, to a copy of the 15-record demo:

| Measurement | Initial implementation | After indexing and scoped context loading |
| --- | ---: | ---: |
| Import and validate 1,000 new sources | 224.8 seconds | 1.05 seconds |
| Read the completed review state | 80 ms | 92 ms |
| Current evidence after import | 2,026 | 2,026 |

The initial implementation rebuilt every family's review state for each extraction. The revised path queries only the relevant account and student. These are individual local runs using prepared fictional labels, not model response times, a controlled production benchmark, or a production capacity guarantee. The repeatable automated scale check uses 1,000 families in memory and verifies isolation and duplicate-free replay without a brittle timing threshold. The scale databases are separate from the 15-record review demo and remain ignored under `.local/`.

## Plain-English before and after

Existing Origen functionality already records notes, summaries, accepted actions and some outcome/evaluation information. This local work adds a broader evidence layer; it does not replace or activate those existing paths.

| Before this work | Available locally now | Benefit for future network-effect algorithms |
| --- | --- | --- |
| Useful information could remain together in summary prose. | Separate records for questions, obstacles, explanations, understanding, intentions, actions, preferences and results. | Algorithms can compare the specific problem and what followed a particular piece of guidance. |
| Accepted actions and some outcomes were structured, but broad family navigation was not covered by this new evidence workflow. | One source-backed format across starting college, applications, costs, enrollment, family concerns, work/transportation, paths and asking for help. | Patterns can span first-generation college navigation instead of being limited to transfer credits or financial aid. |
| A family's discussion could describe different people at different stages of understanding. | Reporter, account, student scope and original language stay attached to each observation. | A parent's understanding does not incorrectly count as a student's understanding; families and siblings stay separate. |
| A submitted task and its eventual benefit could be easy to conflate. | Intention, attempt, completion, pending result, unsuccessful result and unknown result remain distinct. | Analysis can locate where progress stops and avoid counting missing evidence as success. |
| Later corrections could undermine a simple success count. | Versioned source history, explicit corrections, source-removal handling, and review invalidation. | Future analyses can use current evidence and trace why a result changed. |
| There was no standalone workbench for this new broad extraction layer. | Filters, exact source inspection, concern timelines, review notes, processing diagnostics and an offline evaluation harness. | Reviewers can improve data quality and compare extraction versions before using findings in guidance. |

## What is prepared, and what is still future work

The data contracts, local queue, extraction adapter, histories, review interface and evaluation harness are implemented. A later algorithm can use reviewed topic/barrier/guidance/action/result records as input, retain denominators that include pending and unknown cases, and generate hypotheses about which explanations help whom. An observed association would not establish causation.

The Responses adapter uses strict structured output and validates source evidence, but was exercised with mocked transport only. The demo uses human-authored reference labels. Its evaluation replay verifies scoring, **not AI extraction accuracy**. Real-model semantic calibration, representative human labeling, and quality thresholds remain necessary before relying on extraction results.

No production ingestion connector, cross-user recommendation algorithm, aggregate publication workflow, or live-context integration was enabled. Organization scope and permissions must be mapped explicitly in any future production connector. Existing access/consent settings were not changed. This task adds no student forms or extra voice questions.

The live model receives nothing from this workspace. Any later use in a brief or conversation remains a separately designed and tested integration.

## v1.2 checkpoints — steps 1–3 (2026-11-05)

Branch `v1.2` was created from the v1.1 baseline at `f78568b`, retaining the existing local work. No commit, push, deployment, production migration or production-data import was performed.

| Checkpoint | Result |
| --- | --- |
| Calibration infrastructure | 60 fictional cases: 25 English, 25 Spanish, 10 mixed; development/held-out partition, sequential own-model context, source/candidate/expected comparisons, timing and durable spending ledger. |
| Research regression suite | 76 tests passed, including provider mocks, cancellation, restart accounting, invalid-result isolation and known scoring failures. |
| PostgreSQL integration | 11 PGlite tests passed using actual PostgreSQL SQL, including restricted roles, corrections, deletions, leases, budgets, restart persistence and the worker-to-Admin path with mocked provider transport. |
| New Admin/worker regression checks | 10 tests passed for authentication, revocation, audit failure, read/write capabilities, stale review, disabled behavior, input bounds, budget exhaustion and uncertain provider usage. |
| Existing Admin/staff checks | 14 tests passed. |
| Combined run | **111 passed, 0 failed, 0 skipped**. Log: `.local/v12-tests.log`. |
| Application build | TypeScript and Vite build passed. Existing large-chunk advisory remains; new Admin module is lazy loaded. Log: `.local/v12-build.log`. |
| Browser verification | Actual Admin preview on port 8792: evidence timeline, original mixed-language source, pending confirmation, job history and honest empty evaluations state. Separate simulated evaluation preview checked English/Spanish comparisons; it was then stopped. |
| API rehearsal | Review save 200, stale revision 409, unauthenticated request 401; preview voice route 404. |
| Render template | Optional standalone Blueprint passed the current public Render JSON Schema. No Render service was created or changed. |
| Real AI accuracy/cost | **Not run; $0 spent.** New paid-calibration authorization remains pending. No inference about extraction accuracy is made from prepared reference replay or provider mocks. |

The preview uses 15 fictional sources, 10 histories and 26 current observations. It remains available at <http://127.0.0.1:8792/#admin>. The real Admin integration is disabled until its feature setting and restricted database credential are supplied; no production settings were modified.

The tracked implementation changes outside the new evidence directories are limited to Admin routing, staff capability definitions and the Admin dashboard. The live model, voice prompts, brief, binder, memory/research delivery and existing deployment configuration are unchanged. See [the v1.2 guide](V1_2_IMPLEMENTATION.md) for exact setup steps, constraints and remaining real-model validation.

### Paid calibration follow-up

After Daniel approved a new $5 cap, two unchanged 60-case runs completed using fictional data and the real Responses API. Estimated total usage cost was $0.017329, with no unresolved reservations. Current validation accepted 116/120 outputs; median extraction time was 1.69 seconds and p95 2.57 seconds. These are format/evidence-contract acceptance and offline extraction timing, not semantic accuracy or voice timing.

The test found a repeated correction failure that leaves stale outcome state, unsupported dates, noncanonical language labels and inconsistent action/outcome classifications. Independent AI-assisted reviews covered all 120 outputs; human review remains pending. See [the complete findings](CALIBRATION_RESULTS_V1_2.md). The real-model reports are available in the isolated Admin preview on port 8793. No production, live-model or implementation changes were made during this follow-up; no commits, pushes or deployments occurred.

### Correction fixes and retest

The next local pass fixed correction recovery first, then metadata and
classification. Subsequent edge-case checks added protection for deleted unread
sources and duplicated positive outcomes across concerns. The final compact v4
extractor passed 120/120 repeated-case contracts and 19/20 fresh-case contracts;
the rejected date was not stored. Local replay passes all 8 correction safety
checks, while one possible duplicate remains explicitly held for review.

151 automated tests passed; build and final TypeScript check passed. Actual
fictional model outputs were replayed through fresh PostgreSQL and inspected in
Admin at port 8794. The same $5 ledger now accounts $0.109945 including all
intermediate attempts and one unresolved reservation, leaving $4.890055.
See [the full before/after, costs and limitations](V1_2_FIXES_AND_RETEST.md).
Live inputs and production remain untouched; no commit, push or deployment.
