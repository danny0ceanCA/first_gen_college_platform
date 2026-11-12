# Isolated second-worker comparison

## Latest cross-scenario campaign

The [five local delivery/evaluation repairs](../../docs/voice-experience/RESEARCH_DELIVERY_FIVE_FIXES_LOCAL_REVIEW.md)
add consistent concise presentation, qualified coverage and task-specific
delivery gating. `cross-voice.mjs` now schedules caller audio continuously rather
than waiting for assistant turn completion, and invalidates old work only after
an application-observed topic change. `--overlap` schedules an early follow-up;
`--include-opening` retains the configured opening and gives it an initial
window. These runner changes have offline tests but no new provider call yet.
Do not execute paid stages under the exhausted campaign budget.

The subsequent [offline primary-answer concision repair](../../docs/voice-experience/PRIMARY_RESEARCH_CONCISION_LOCAL_REVIEW.md)
uses saved fictional records only. It does not spend from the earlier ledger
or claim a new spoken timing result. Reproduce its no-network comparison with
`node research/worker-comparison/primary-concision-replay.mjs`.

See [the $20 English/Spanish review](../../docs/voice-experience/WORKER_CROSS_SCENARIO_20_DOLLAR_REVIEW.md)
for the six-scenario campaign, primary research repairs, supplemental-focus
delivery fix, unsuccessful selector experiments and retained trial limitations.
`cross-*.mjs` and `campaign.mjs` use their own single shared $20 ledger under
`output/worker-cross-scenario-20261111/`; they do not reset older ledgers.
The broad catalog is passed explicitly by these harnesses. The older three-task
experiments described below retain their historical configuration.

Branch: v1.3-decisions-integration. This directory is an experiment, not an active app integration or a Render service configuration. No production flags are changed. The existing intro, speaking style, floor control and binder are untouched.

## The three arms

- **Current:** existing voice controller and research tools, without a proactive scout.
- **Rules:** an asynchronous scout using a deliberately small set of bilingual keyword rules on the latest turn.
- **Decisions:** the same scout, candidate tasks, research budget and validation path, but task selection uses a Decisions choice over conversation context.

The rules arm is a limited comparator, not a claim about the strongest possible rule system. It does not resolve context-dependent pronouns as the model can. Both experimental arms use the same deterministic refusal/hypothetical guard, known/pending-task deduplication, two-job limit, and revision fence. Topic changes discard late classifications and research before publication. Cancellation does not imply that a provider request has stopped or that its cost disappears.

The candidate catalog covers application-fee waivers, FAFSA contributor invitations, and student transit. This is a bounded prototype, not an all-topic deployed planner. The observer returns immediately to its caller; background failures do not become conversation commands. No automatic spoken announcement is issued by the scout.

### Next-pause delivery experiment

`pause-delivery.mjs` is a separate, opt-in local strategy. It stages verified facts until a completed thought with idle audio, then sends
one compact self-contained commentary unit when possible. Larger records keep
the existing research delivery/ACK controller. It respects a current
caller question and gives an unanswered invitation three seconds of caller
space. Native use suppresses an optional repeat; this is not a claim of full
answer delivery or comprehension. The shared controller retains ownership of
incremental evidence and context errors.

`pause-voice.mjs` selects this strategy explicitly via the server-only
`researchDeliverySink` test seam. Both standalone scout work and a formal lookup
that joins it use one canonical task identity. The default application does
not supply that sink and keeps its existing delivery path. No environment flag
or Render service was activated. Intro and voice instructions are unchanged.

This campaign uses real native audio and Decisions with generated fictional
caller speech. Public research is replayed at its earlier measured duration,
so it isolates delivery rather than claiming a new search speed improvement.
The new approved $3 ledger is separate from every previous campaign, and retains
the initial exploratory calls as well as corrected retests.

```powershell
node --test research/worker-comparison/pause-delivery.test.mjs
node research/worker-comparison/pause-voice.mjs
# Paid, only within the approved remaining ledger:
node research/worker-comparison/pause-voice.mjs --execute
```

See `docs/voice-experience/WORKER_NEXT_PAUSE_DELIVERY_V1_3.md` for measured results.

## Reproduce

Offline tests:

```powershell
node --test research/worker-comparison/scout.test.mjs
```

Paid stages require a new explicit authorization when the existing campaign cap is exhausted. They load the existing local OpenAI credential without printing it. No application or production database is read.

```powershell
node research/worker-comparison/validate.mjs --stage=selection --execute
node research/worker-comparison/validate.mjs --stage=research --execute
node research/worker-comparison/voice.mjs --execute
```

The selection and research stages resume completed rows. The voice stage must not be rerun blindly: it reserves against the same ledger and does not resume completed calls automatically. Do not run paid stages concurrently; they share one ledger. Unknown/failed request reservations remain counted.

## Evidence boundaries

Selection tests use fictional English/Spanish transcripts with preassigned labels; model confidence is a routing signal, not factual proof. The original comparison used a .8 confidence-only threshold. The subsequent repair uses an independent support predicate, winning-choice probability and margin, plus a confidence floor; see `scoutAdmissionPolicy` and `WORKER_VALIDATION_AND_GATE_REPAIR_V1_3.md` for exact thresholds and validation limits. Neither policy is a production-calibrated accuracy guarantee. Historical output remains unchanged. Do not grade the current system's intentionally absent proactive classifier as a failed conversation.

Research tests call the existing `processResearchJob` with an in-memory queue and the inexpensive `gpt-6-luna` Responses model. They use public Stanford/Federal Student Aid questions, production parsing, coverage and recovery. This does not exercise an actual second Render service, database contention, service networking, or worker queue load.

Native voice trials use the existing production controller and real GPT-Live audio, generated caller audio, fictional student context, and a shared eight-second simulated retrieval delay. Public findings come from this campaign's real research stage. They are replayed during calls to hold evidence/source latency constant across arms; those voice timings are not fresh web-search timings. Formal tool requests and scout work share a result, rather than triggering a second web lookup. A scout result that precedes a formal tool request is supplied only as quiet context through the existing packet formatter. Decisions reply recovery remains off. The same conversation instructions apply to all arms; the fictional student is already selected, so opening recaps are not being tested.

Provider transcript, received PCM, and simulated playback are saved separately. These tests cannot establish what a human heard through a browser speaker or whether the experience felt warm. Topic-change or overlap claims require inspecting the timeline, not simply searching the final transcript for a word.

## Documentation review

The complete 45-page Responses review from the preceding implementation remains applicable. All 45 pages were checked against the manifest here; their hashes match after Windows newline normalization. The saved Responses/Decisions references and current relevant Decisions, Live delegation, transcript trigger, latency, conversation-state and measurement guidance were consulted again for this comparison. This is not represented as a second fresh full read of every generated schema.

- https://developers.openai.com/api/docs/guides/decisions
- https://developers.openai.com/api/docs/guides/decisions-voice
- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/guides/latency-optimization
- https://developers.openai.com/api/docs/models/gpt-6-luna

The design follows typed choices and explicit application actions; useful transcript-based speculative checks; quiet context rather than forced spoken pivots; outdated-result rejection; and receipt versus playback distinctions. No documentation is supplied as runtime voice context.

Results and budget: `output/second-worker-comparison-20261111/`. See the companion report under `docs/voice-experience/` for findings and limitations.
