# Research structure and supplemental worker: $20 local campaign

November 11, 2026, Los Angeles. Branch: `v1.3-decisions-integration`.

The research structure is stronger, and the repaired supplemental path delivered
a new bus benefit with its student-ID condition in both final English/Spanish
voice trials. **This is not evidence that a second worker consistently improves
every conversation, or that Decisions is ready to select every opportunity.**
Long primary answers, repeated qualifications and inconsistent selection remain.
Keep this experiment isolated before considering activation.

No commit, push, deployment, migration, production data access, Render service
change, or production flag change occurred. The existing intro, pacing prompt,
student briefing, binder and call indicator were not edited in this campaign.
Decisions reply recovery was not supplied to any test session.

## Scope, spending and evidence

- New authorization: **$20 total**, including unsuccessful attempts.
- Final conservative ledger: **$19.6505625 accounted/reserved**. This includes
  full voice/TTS/Decisions reservations and conservatively priced reported
  research usage; it is not a reconciled OpenAI invoice.
- Six scenarios, each in English and Spanish: costs/transit, applications/fee
  waivers, FAFSA/language assistance, grants/scam warnings, adult ESL/enrollment
  help, first-generation support/food access.
- **33 fresh source jobs**: 24 initial primary/supplement checks plus nine
  targeted retests. Additional fresh source work occurred during voice tests;
  the ledger contains **67 standalone Responses research attempts** in total.
- **32 native voice attempts**: two initial harness failures, a 24-call matched
  worker-off/Decisions-on comparison, and six targeted retests. Thirty attempts
  have final JSON; 26 completed all three scripted turns. Four reached a script
  boundary timeout. The first two retain WAVs but lost final JSON to the harness
  cleanup error. All reservations remain counted.
- **132 classifier checks**: three variants of the same 44-case English/Spanish
  positive/negative matrix. These are classifications, not 132 voice calls.
- Final focused unit suite: **213 passed**. Earlier complete controller/research
  regression invocation: **301 passed**. Counts overlap and must not be added.
  The build passed outside the sandbox after its directory-access failure;
  existing bundle-size/Auth0 warnings remain.

The callers are generated fictional audio. GPT-Live output PCM and transcript
events are real. Playback timing is simulated; no human microphone, physical
speaker, deployed second Render service, production queue or load test was used.
The existing production research worker runs against an in-memory queue.

During native calls, most source results replay this campaign's actual public
research at its measured duration. The Decisions-on costs path can do real
concurrent supplemental research; the successful English `voice-r2` trial did
so. Final `voice-r4-focus` English/Spanish trials use simple rules and recorded
source timings to isolate the delivery repair. They do **not** prove Decisions
caused the final bilingual improvement.

## What changed and why it matters

| Before | Local change | Practical benefit |
| --- | --- | --- |
| Valid records using `2026–2027` or `Otoño 2026` were discarded. | Losslessly normalize supplied year/term fields, reject contradictory terms, never invent a year. | A cited fact survives a formatting variation without gaining false certainty. |
| Descriptive headings could prevent a finding from matching its own institution. | Prefer canonical institution IDs; accept bounded, corroborated population/facet descriptors. | Useful tuition or deadline facts do not disappear behind heading text; other campuses/programs remain distinct. |
| Spanish/English names for the same program could fail literal matching. | Narrow aliases for Pell and noncredit ESL, with negative checks for credit ESL and unrelated degrees. | Equivalent bilingual records are usable while retaining actual scope. This is not unrestricted fuzzy matching. |
| An empty finding array could skip recovery. Search-discovered pages were confused with pages actually opened. | Recover missing requested facts once; separate opened sources from unopened official leads. | One bounded recovery can inspect a relevant detail page without repeating every search or claiming inaccessible means unpublished. |
| A waiver request could select the already-known fee amount. | Recognize the waiver rule separately from a numeric fee request. | Research/delivery can address the obstacle instead of restating the price. |
| The optional worker could race primary work or repeat an already-known record. | Separate task identity, fresh pending-work checks, source-time and delivery-time novelty checks, revision fences and conflict quarantine. | Primary findings stay intact; optional work can be dropped when it becomes redundant or outdated. |
| A short inline fact could omit a finding-wide limitation or sibling eligibility rule. | Keep all aggregate qualifications; multi-fact/step records use the complete path rather than an isolated attractive fact. | A cheap bus ride or free service is not detached from the conditions that make it true. |
| The main cost question's filter could remove the supplemental bus fact. | Give the supplemental task its own evidence focus; do not replay the primary question into its filter. Later caller turns still update/retire the task. | The model receives the actual qualified finding instead of only a completion state plus an opaque reference. |
| “First eligible pause” could be logged while the primary-answer gate was still closed. | Log hold-reason transitions and require the same external gate for the pause marker. | Diagnostics distinguish primary work, caller space, active audio, unfinished clauses and actual delivery opportunity. |

The second worker remains an explicit local strategy in
`research/worker-comparison/`. It is not an active application route or a new
Render deployment. The normal voice controller keeps its default delivery
path; the optional test sink now permits a selective `false` return to leave
primary evidence on that default path.

## Across-topic results

These are coverage assessments of the latest retained source records with the
current parser, after targeted source retests where recorded. “Partial” is not
a transport failure: useful cited facts can coexist with an unverified requested
cycle or missing condition. Reparsed records remain distinct from original raw
provider recordings; an exhausted replay is labeled incomplete.

| Scenario | English / Spanish primary coverage | Supplemental finding and observed limitation |
| --- | --- | --- |
| UC Davis costs and transit | Partial / complete | Final bilingual delivery includes Unitrans/Yolobus and the student-ID condition. English's total is useful even though its requested fee subdetail remains unverified. |
| Stanford application | Partial / partial | Published fee/waiver information is useful; a month/day deadline and a current fee do not establish the requested fall-2027 cycle. An early Spanish recital repeated the fee rather than efficiently explaining the waiver. |
| FAFSA contributor invitation | Complete / complete | Correct account/invitation facts are available. Contact sources do not fully establish contributor-specific Spanish assistance or phone availability; those limitations must remain. |
| Pell versus loans | Complete / complete | Supplemental warnings/free FAFSA appeared, but one Spanish native explanation wrongly made Pell repayment sound unconditional. Source validation does not guarantee the live model verbalizes every exception. |
| Adult noncredit ESL | Partial / complete | Narrow program aliases restore Spanish tuition/step coverage. English still has an incomplete procedural detail. A Spanish registration video does not prove Spanish-speaking staff availability. |
| First-generation support | Partial / complete | Pantry access is useful. English office contact remains partial; the initial Spanish food result was more concrete than its baseline. Do not infer individual CalFresh eligibility. |

Initial source results had 12 complete, six partial and six unavailable records.
The latest derived set has 15 complete and nine partial records. This combines
fresh retests and parser repairs; it is **not** a controlled success-rate gain or
proof that all requested facts were found.

## Timing and natural conversation

The initial matched sweep produced these **first-audio** medians. They include
acknowledgments and are not first-useful-answer or comprehension measurements.
The sample is six scenarios per language/arm, without replicated runs.

| Language | Worker off | Decisions worker on | Ordinary follow-up, off / on |
| --- | ---: | ---: | ---: |
| English | 3.55 s | 2.00 s | 1.81 / 1.98 s |
| Spanish | 2.12 s | 3.07 s | 1.87 / 1.44 s |

There is **no consistent measured speed win** from adding the worker. In
particular, the first costs-on trials admitted no supplemental work; their
timing differences cannot be attributed to a worker benefit.

The early harness could advance after eight words and a quiet interval even
when a thought was unfinished. It now additionally checks sentence completion;
the final pair had complete transcript boundaries. This is still an estimated
boundary, not proof of physical playback. Three earlier Spanish calls exceeded
the initial turn window during long speech; a later English call timed out on
its final topic-switch turn. These are retained as incomplete trials, not API
failures or clean passes. Final JSON trials recorded no provider API errors.

### Final filter-repair trials

| Measurement | English | Spanish |
| --- | ---: | ---: |
| First response audio | 1.77 s | 1.37 s |
| Ordinary follow-up first audio | 1.65 s | 1.95 s |
| Supplemental source ready, from call start | 26.84 s | 26.85 s |
| First eligible publication opportunity | 71.09 s | 70.67 s |
| Qualified evidence publication | 71.09 s | 70.67 s |
| First Unitrans/Yolobus transcript marker | 82.73 s | 84.28 s |
| Extra research appends after explicit topic revision | 0 | 0 |

The roughly 44-second source-to-publication interval is mostly the primary
answer gate, native speech and caller-response space. It must not be called
44 seconds of silence. Publication occurred at the logged eligible opportunity.
The following 11.6/13.6 seconds to the bus-name marker includes context receipt,
the caller's follow-up in English, and speech leading into that fact. It is not
a pure network-latency measurement.

Both final transcripts contain the bus benefit **and** valid student-ID/card
condition, retain the published-cost estimate caveat, answer the ordinary
follow-up and move to the essay topic without a later bus recital. They still
contain repeated estimate/bill qualifications and longer primary answers than
ideal. The successful earlier English Decisions trial supplied its real
concurrent-research bus marker about 4.75 seconds after context publication.

## Decisions findings: do not confuse selection with benefit

| Selector experiment | Positives admitted | Raw negative false positives | Interpretation |
| --- | ---: | ---: | --- |
| Choice plus independent support | 9 / 12 | 2 / 32, both already-known tasks | Application known-task checks block those executions. Three useful needs still missed. |
| Institution/known-task scoped choice | 8 / 12 | 3 / 32, explicit refusals | Application refusal checks block those executions. Scoping did not establish a recall improvement. |
| Independent predicate per opportunity | 4 / 12 | 0 / 32 | Too conservative on this set. Remains a separately selectable lab experiment, not the default. |

The support threshold (.8), choice threshold (.6), margin (.2), and confidence
floor (.3) were not lowered to make the worker appear active. Raw classifier
results and application admission are different observations. Passing 32
negative fixtures is not a production safety or calibration guarantee.

The final bilingual delivery proof deliberately uses the simple explicit-bus
rule to isolate the transport bug. A prior English Decisions trial proves the
model can initiate a useful supplemental task, but **the campaign does not prove
Decisions reliably outperforms rules or consistently improves conversation**.
Do not enable the per-task predicate experiment because its raw test score
looks safe; it misses too many positive needs.

## Guidance review and implementation checks

The retained complete unique-content review covers the 45 Responses snapshots
and the Decisions/conversation-state libraries. All **110 manifest pages are
available and match their normalized saved hashes**. The saved Responses
reference, local configuration audit and measurement plan were revisited, with
focused rereads of the applicable contracts and current official guidance.
This is not represented as a fresh literal reread of all repeated generated SDK
schemas; see the preserved inventory for the exact review boundary.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation):
  coherent verified results, quiet thinking versus spoken commentary, application
  task ownership, 500-token append limit, receipt distinct from heard speech.
  Whole units remain below a conservative byte ceiling; oversized qualified
  records use grouped context and acknowledgments. No documentation enters the
  runtime context.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting):
  ordinary follow-ups stay conversational, truthful progress rather than padding
  a wait. No artificial hold for classification, extra greeting or new pacing
  instruction was added.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations):
  transcript fragments, context receipt and audio playback are separate. The
  adapter stages evidence outside the session during active speech/unfinished
  thoughts, and logs the playback-idle observation as an estimate.
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
  schema conformance is not factual correctness. Preserve source-backed fields,
  missing facts, citations, unknown years, incomplete sequences and conflicts.
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search):
  distinguish search leads from opened evidence and keep claim/source mappings.
  Stanford, Unitrans, The Pantry and Napa registration pages were independently
  inspected against the recorded research.
- [Decisions](https://developers.openai.com/api/docs/guides/decisions): typed
  choice/predicate results require workload evaluation; probability and
  confidence do not verify research or prove a spoken improvement. The negative
  fixtures and failed selector experiment remain in the evidence.

The final contract check retained the existing managed Responses tool
continuation; it did not replace it with standalone Responses events. The scout
neither cancels native speech nor sends `response.create` to buy another turn.
No model call was added merely to rewrite source facts for speech.

## What still needs work before activation

1. Shorter primary-answer behavior and less repeated qualification, tested
   separately without altering the successful intro. A second worker does not
   fix a long primary answer by itself.
2. More reliable supplemental selection on held-out bilingual paraphrases. The
   final delivery repair has bilingual speech evidence, but broad Decisions
   selection does not have a clean pass.
3. Native use of partial facts and exceptions: one Spanish Pell answer omitted
   repayment exceptions, and an early ESL answer revisited tuition after the
   user moved to practice-at-home. No new supplemental append after a revision
   does not prove the live model will never volunteer already-known old facts.
4. A human local browser/microphone check, followed later by actual service,
   queue-load and reconnect tests if activation is authorized. Opening recaps,
   table rendering and subjective warmth were not revalidated by these scripts.

## Inspect and reproduce

- `output/worker-cross-scenario-20261111/metrics.json`: aggregate observations.
- `transcript-review.md`: fictional provider transcript evidence by trial.
- `budget.json`: all reservations/reported research costs; failures retained.
- `research/`, `research-retest/`: immutable source recordings and worker traces.
- `research-current/`: derived current-parser replays, with incomplete replay
  flags and original source timings, not invented faster searches.
- `classification-r2/`, `classification-r3/`, `classification-r4/`: raw requests,
  typed answers and assessed routing. These are different selector experiments.
- `voice-initial/harness-failure.json`: explanation of the first two missing
  final records, with retained WAVs.
- `voice-r1/`, `voice-r2/`, `voice-r3-rules/`, `voice-r4-focus/`: actual native
  events, appends, source decisions, per-turn audio and partial/final reports.

Offline:

```powershell
node --test research/worker-comparison/*.test.mjs
node research/worker-comparison/reparse.mjs
node research/worker-comparison/cross-summary.mjs
```

Do not rerun paid stages blindly: only about $0.35 is unreserved, which is not
enough for another safe bilingual campaign. The runner resumes existing trial
IDs; new revisions still require room in this same ledger. This campaign does
not authorize a deployment or a larger total.
