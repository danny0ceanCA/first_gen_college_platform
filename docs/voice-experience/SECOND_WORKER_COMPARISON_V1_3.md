# Second research worker: current system, rules, and Decisions

November 11, 2026. Branch `v1.3-decisions-integration`. Isolated prototype and fictional callers; no commit, push, deployment, production data access, production flags, or Render service changes.

## What this experiment compares

The current arm uses the existing production voice controller and formal research tools. The rules arm adds a background task scout using a small bilingual keyword set. The Decisions arm uses the same scout and candidate tasks but chooses a task from transcript context through `/v1/decisions`. Both added arms share deterministic refusal checks, known/pending-task coalescing, revision fences and a two-task limit.

Candidate topics are Stanford application-fee waivers, FAFSA contributor invitations, and UC Davis transit benefits. These are bounded experimental candidates, not a complete cross-topic research planner. Rules inspect the latest turn; Decisions receives context. This intentionally simple rules comparator does not establish that Decisions outperforms a stronger context-aware rule system.

The source researcher uses `gpt-6-luna` through the existing `processResearchJob` parser, citation validation, requested coverage and bounded recovery. A second deployed Render process is not necessary to compare these behaviors. In this experiment, the queue is in memory: service contention, networking, horizontal scaling, and durable multi-worker execution are not tested.

## Selection tests: English and Spanish

There are 22 labeled scenarios, 11 per language: five useful research opportunities and six negative/known cases. The current arm intentionally has no proactive classifier and must not be assigned a conversation failure merely for selecting none.

| Trigger | Useful tasks admitted, English | Useful tasks admitted, Spanish | Unwanted tasks, across 12 negative cases |
|---|---:|---:|---:|
| Simple rules | 2/5 | 2/5 | 0 |
| Decisions with .8 confidence admission threshold | 3/5 | 2/5 | 0 |

Decisions' raw choice selected the intended task in all ten positive cases, but the conservative admission gate withheld five. The API confidence field and the individual choice probability are separate values. This .8 threshold is exploratory, not calibrated. In one known-task negative case the model selected a task already available; the shared application deduplication prevented another research job. Explicit refusal/hypothetical guards prevented model dispatch in those cases, so model-only accuracy must not receive credit for those successes.

This reveals a possible useful contribution—resolving contextual references such as “that contributor email”—and a recurring limitation: classification does not help if admission or evidence validation subsequently blocks it. The sample is small, authored locally, and used for diagnosis. It is not a held-out benchmark or a production accuracy estimate. No threshold was relaxed during these voice trials.

## Real public-source research

The following are actual provider-backed research runs, independent of voice replay:

| Task | English | Spanish | Finding |
|---|---:|---:|---|
| Stanford fee-waiver options | 24.85 s; two passes | 29.37 s; two passes | Useful cited fee/waiver information returned, but requested-coverage/subject matching did not recognize the answer as complete. |
| Parent accepting a FAFSA invitation | 12.36 s; one pass | 27.62 s; two passes | English completed coverage. Spanish initially published useful verified steps, then recovery marked the steps partial because similarly keyed steps were worded/ordered differently. |

The Spanish recovery marked using the parent's own account as conflicting even though the underlying first pass was useful. The saved raw outputs support investigation of whether the second pass represented a material contradiction or merely a different sequence/wording. It would be wrong to count that final output as fully verified or to assume another worker fixes this. Existing coverage, entity matching and recovery reconciliation need attention before relying on extra research volume.

## Native voice comparison

Six native provider calls compare current/rules/Decisions in English and Spanish. Every call uses the same fictional parent scenario, ordinary account follow-up, and switch to brainstorming an essay. Opening recaps are excluded because the fictional student is already selected. Intro prompts, voice selection, speaking pace, interruption policy and Decisions reply recovery are unchanged.

Voice calls use generated caller PCM and actual GPT-Live output PCM/transcripts. During these calls the just-retrieved public research is replayed with a common eight-second retrieval delay. There is no fresh web search during each call, and no prepared assistant audio. This holds evidence and retrieval time constant across arms, but does not establish production web-search speed. A formal lookup joins a scout task if one is already in progress; the experiment does not purchase another identical search. A scout result reaching the call before a formal lookup is supplied only as quiet context, never an unsolicited spoken instruction.

Final call metrics and exact transcripts are in `output/second-worker-comparison-20261111/comparison.json` and `voice/`. Provider transcript arrival, PCM receipt and simulated playback remain distinct. Human microphone/browser playback, perceived warmth, and exact talk-over were not independently verified. The calls are single trials in a fixed order, not a randomized statistical comparison. Correct ordinary advice that could come from model knowledge is not proof the model used newly injected context.

| Arm / language | First audible response | Account follow-up response | Formal research requests | Scout outcome |
|---|---:|---:|---:|---|
| Current, English | 1.81 s | 2.03 s | 1 | No added scout |
| Current, Spanish | 2.36 s | 1.96 s | 1 | No added scout |
| Rules, English | 1.73 s | 1.51 s | 1 | No trigger from the indirect wording |
| Rules, Spanish | 1.76 s | 2.26 s | 0 | No trigger from the indirect wording |
| Decisions, English | 1.76 s | 1.47 s | 1 | Started 1.866 s before formal lookup; candidate accepted |
| Decisions, Spanish | 1.88 s | 1.47 s | 1 | Started 1.410 s before formal lookup; candidate rejected as unverified |

All six calls completed their three turns with no recorded provider API errors. All answered the account follow-up using the parent's own account and moved to the essay topic. First-response timings are often acknowledgments, not useful-answer timings. The useful account fact appeared during the initial turn in current Spanish at about 12.00 seconds, rules English at 13.56 seconds, and Decisions English at 13.09 seconds; in the other calls it appeared in the follow-up. This is not a consistent useful-answer win for the added worker.

Both Decisions calls coalesced the formal request with the pending scout task. Neither supplied an additional standalone quiet scout append: the formal request had already joined before research finished. Thus the tested benefit is earlier scheduling, not demonstrated enrichment through a separate quiet injection. The English result traveled through the existing formal research delivery path. The Spanish scout rejection did not prevent the existing formal tool path from completing, and its correct ordinary account answer does not establish that accepted research supported it.

There were small conversation rough edges: English current output had an old-answer fragment before responding to the follow-up/topic change; Decisions English had a short fragment before its account answer; Decisions Spanish began the follow-up with an unnecessary greeting. Estimated simulated overlap at the account follow-up was 1.59 seconds for current English and .32 seconds for Decisions English; other trials recorded zero there. These single synthetic observations do not prove a reduction in interruptions. Late research arriving after the topic switch was checked by revision-fence unit tests, not by this live scenario, whose research had already finished.

## Assessment and next decision

Decisions has demonstrated a specific role: contextual task selection can begin useful work before a formal tool request. The admitted positive-case gain over this limited rule set was small (five of ten versus four of ten), and the native calls did not demonstrate a dependable improvement in guidance or natural flow. A new production worker is not yet justified by this sample alone.

The next useful steps are to fix false coverage/recovery rejection, evaluate confidence admission against a separate bilingual test set, and compare against rules that also maintain conversational state. Explicit tasks can use rules; contextual opportunities can use Decisions when its admission is calibrated. A later voice comparison should include a task that remains useful but is not immediately requested by the live model, so it actually exercises quiet enrichment and novelty assessment. Preserve the current speech controller and do not add a serial model approval call before ordinary replies.

## Guidance and verification

The earlier full 45-page Responses library review is retained. All 45 snapshots remain present and match their manifest after Windows newline normalization. The saved references, relevant Decisions guide and contract, native voice integration, Live delegation/transcript processing, conversation-state boundaries, latency guidance, and local measurement plan were revisited. Current official Decisions, Live delegation and `gpt-6-luna` tool support were checked. This is not claimed as another fresh full reread of all generated SDK schemas. No documentation enters runtime context.

- [Decisions](https://developers.openai.com/api/docs/guides/decisions): fixed typed choices, application-owned actions, probabilities/confidence, and threshold evaluation.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation): useful speculative transcript processing, quiet versus spoken updates, outdated-result rejection, and receipt not proving playback.
- [Latency](https://developers.openai.com/api/docs/guides/latency-optimization): independent background work, bounded extra requests, and no unnecessary sequential model gate before an answer.
- [Model capabilities](https://developers.openai.com/api/docs/models/gpt-6-luna): Responses web-search support for the inexpensive source researcher.

47 local tests pass across scout safeguards, existing Decisions transport and context packet formatting. The active application does not import the prototype; no user call is routed into it. Artifacts and a shared $5 ledger live under `output/second-worker-comparison-20261111/`. The campaign accounts for/reserves **$4.40884 of the approved $5**. Research token accounting uses conservative upper rates; Decisions/voice/TTS reservations remain counted. Ledger totals are not a final provider invoice.
