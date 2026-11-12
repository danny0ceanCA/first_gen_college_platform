# Shorter primary research answers and caveat continuity

Branch: `v1.3-decisions-integration`. November 11, 2026, Los Angeles.

Implemented locally, with **offline validation only**, as requested. No new
paid API calls, real student data, database changes, flags, commits, pushes or
deployments. The previous campaign ledger remains $19.6505625 accounted/reserved.

The goal is to leave an earlier natural opening for useful supplemental
research by reducing unnecessary primary explanation. The repair does not
interrupt a thought, accelerate the voice, clip generated audio, force a pause,
or make Origen wait for a classifier.

## Evidence and repair

The saved final-pair traces showed that a total-cost question supplied the
voice model with a complete nine-category budget recital, even though the
table/report already held that breakdown. The primary answer also repeated
the estimate-versus-bill distinction. A supplement could be ready around
27 seconds but remain behind the primary answer until roughly 71 seconds.
Those old intervals include ongoing work and speech; they are not pure silence.

| Before | Local change | Expected benefit |
| --- | --- | --- |
| A total-only request supplies every budget line item to Live. | Use the typed budget's headline, with its year, population, period, housing scenario, citation and full finding qualification. Include a specifically requested component, such as transportation, with its value and condition. | Fewer unrequested figures invite a shorter primary answer. |
| A request for detail could be confused with a simple total. | Explicit breakdowns, compound tuition questions, requested connected steps and non-budget evidence keep their complete existing presentation. Unverified findings are not promoted into numeric headlines. | Concision does not hide requested information or invent a verified total. |
| Long answers remain possible despite general style advice. | Seed a compact research-only policy into the Live and managed Responses prompts: normally one or two short sentences, fact plus material caveat, then listen. Keep the same relaxed pace. | Shorten the amount of explanation while preserving the familiar delivery. This is guidance, not a guaranteed word limit. |
| An unchanged general caveat can be taught again for a new result. | Record the completed introduction of `estimate_not_bill` for the current scope. Supply `spokenDelivery.previousExplanation` with later research context. | Label the next figure as an estimate without repeating the lesson; new exceptions, assumptions and uncertainty remain explicit. |
| A transcript or receipt could be mistaken for successful explanation. | Only non-forced, audible completed text can record the caveat marker. Questions, uncertainty, quoted examples and unfinished clauses do not qualify. | The marker remains a bounded observation, not a claim that the caller heard or understood it. |

The complete research record and table data remain unchanged. The projection
never cuts arbitrary prose sentences or qualifications to fit. A requested
component with an unavailable value or unsafe role falls back to the existing
complete finding. The original readback, selection and onboarding rules keep
precedence. No new instruction append is sent during the call.

The one-to-two-sentence default and no repeated waiting lesson apply across
research topics. The typed numeric projection applies specifically to budget
records; it does not try to shorten a FAFSA process, scholarship exception or
language-assistance limitation by dropping facts.

## Offline checks

- **349 focused/regression tests passed**, including English/Spanish projection,
  complete caveats, requested components/detail, unverified totals, scope reset,
  onboarding, opening/selection and delivery behavior.
- **97 voice-controller tests passed** separately.
- TypeScript/Vite build passed; existing bundle-size warnings remain.
- **33 retained fictional source findings** checked; all original records and
  qualifications remain intact. The 31 non-budget findings retain their answer
  text. No source research was rerun.
- A queued supplement remains staged through an unfinished primary clause,
  then obtains one delivery opportunity after the qualification finishes and
  audio is idle. It requests no cancellation, instruction pivot or extra
  backend response. Existing topic-change/duplicate protections still pass.
- The compact policy fits the isolated runner's existing session-size guard,
  including its setup allowance. No provider/API limit was changed.
- `caveat_observed / estimate_not_bill` is retained by the bounded diagnostic
  schema. Its operational event contains no transcript or source qualification.

### Source-packet comparison

Same input, same selected findings, same reference ID: the control renderer
uses the previous full-answer serialization, and the repaired renderer uses
the concise projection. All qualifications and source links remain present.

| Language | Control bytes | Repaired bytes | Control / repaired packets |
| --- | ---: | ---: | ---: |
| English | 1,854 | 1,456 | 5 / 4 |
| Spanish | 1,944 | 1,699 | 5 / 5 |

The new answers retain the explicitly requested transportation allowance.
The much larger original recorded English payload also contained other
findings/configuration differences; its 11-packet size is **not** used to claim
the gain above. Every packet remains within 480 UTF-8 bytes and preserves the
existing grouped-context/acknowledgment semantics.

These are **payload measurements, not speech-latency measurements**. The old
audio after the first changed context is not a counterfactual result of this
repair. No claim is made that the 44-second wait is now a particular number,
that new speech is shorter, or that a human finds the result more natural.
Those questions require a fresh English/Spanish call later.

## Library and current-guidance review

The prior user-approved full unique-content library review remains the basis
for the unchanged saved pages. This pass verified all **110 available matching
snapshots**, including all **45 Responses pages**, and revisited the saved
Responses reference, applicable prompting/delegation/context contracts and
the implementation together. This was not a new literal reread of every
repeated generated SDK schema. The per-page inventory and hashes are preserved
in the offline artifact directory.

Current official guidance was checked before editing and checked against the
result afterward:

- [Prompting GPT-Live](https://developers.openai.com/api/docs/guides/live-prompting):
  optional response-length guidance for demonstrated long answers; normally
  one or two short sentences; conversational progress without repeated status
  or padding. Keep sound/pacing distinct from response length.
- [Delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation):
  keep large structured payloads in the backend, return relevant complete facts,
  avoid an extra rewriting call, and retain the distinct quiet-context and
  spoken-commentary roles. The existing managed Responses continuation remains.
- [Managing Live sessions](https://developers.openai.com/api/docs/guides/live-conversations):
  context receipt is not speech/playback; transcripts are fragments, and changes
  need behavioral verification. The new marker uses completed speech evidence
  and stays separate from comprehension.

The existing intro, voice, pace, backchannels, scope handoff, mandatory readbacks,
table rendering, research request structure and second-worker selector were
not replaced. No documentation is injected into runtime context.

## Files and reproduction

- `server/research-answer-policy.mjs`: bounded research-only prompt policy.
- `src/researchAnswerDelivery.mjs`: non-mutating typed projection and narrow
  call-scoped caveat observation.
- `src/liveResearchContext.mjs`, `src/researchDelivery.mjs`: supply the shorter
  presentation and observation hint without removing qualifications.
- `src/publishedBudget.mjs`: shared headline formatter; existing full formatter
  retains its behavior.
- `research/worker-comparison/primary-concision-replay.mjs`: no-network source
  replay/control comparison.
- `output/primary-concision-offline-20261111/replay.json`: exact before/after
  payloads and evidence limits.

```powershell
node --test src/researchAnswerDelivery.test.mjs
node research/worker-comparison/primary-concision-replay.mjs
```

A later voice validation should compare the first useful primary answer,
repeated qualification count, time to a genuine idle boundary and actual
supplemental speech. Preserve complete exception/condition delivery and test
both a quick acknowledgment and a real correction. Do not infer a successful
spoken change from a smaller payload or provider acknowledgment alone.
