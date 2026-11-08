# Decisions: meaningful conversational support on v1.3

Local implementation and evaluation, November 8, 2026. No production deployment, commit, push, database migration, or native Decisions trigger activation.

The goal is to help Origen recognize a caller's need without making the caller wait for classification. The existing intro, voice configuration, research controller, and production delivery path remain protected. Changes are inside the isolated Decisions laboratory.

| Area | Before this change | Local implementation | Practical benefit and limit |
| --- | --- | --- | --- |
| Explanation evidence | Eight recent dialogue rows; an older explanation could disappear. First needs without an active support record could miss output produced during classification. | Bounded raw history retains up to 40 observations/32 KiB and selects recent plus lexically relevant earlier observations. Native source IDs, omissions, corrections and post-caller output revisions remain explicit. | Decisions can see prior attempts and renewed confusion. This is temporary in-call evidence, not a permanent student fact or semantic concept database. Cross-language synonyms outside the recent window can still be missed. |
| Check distribution | Eight early checks could be exhausted near the beginning, plus 24 completed-contribution checks. | Up to 16 early and 16 completed-contribution checks; early burst of three, one slot replenished per 25 seconds, at most two per contribution. Only changed meaningful evidence starts work. | Later questions retain a chance to receive support within the same maximum of 32 checks. No periodic inference polling and no voice waiting. Long calls can still reach the cap. |
| Short confusion | Two-word statements could fail the scheduling threshold. | Direct English/Spanish confusion such as “I'm confused” and “No entiendo” reaches the classifier; context determines the subject. | Short natural replies are eligible for assessment without treating “okay” or “sí” as proof of understanding. |
| Caller speech protection | An early thinking note could be sent while caller transcript input remained open. | Classification stays parallel, but delivery requires both the controller and source-matched transcript evidence to show an application-estimated input boundary. New words, assistant output or stale evidence withdraw the pending note. | Reduces the risk of nudging Origen during caller speech. It never delays native voice and may deliberately withhold more optional cues. Application boundaries do not prove physical microphone completion. |
| Outcomes | Receipt and classification logs were available, but did not establish conversational improvement. | An offline evaluator separates provider receipt, reviewed transcript adaptation, linked client playback, and caller-reported clarity over up to three following caller contributions. | Reviewers can compare the right evidence. There is no automatic naturalness score or causal claim. Scripted test reactions are not measured learning. |
| Late delivery | Any observed assistant speech closed the early window. | A separate default-off experiment requires fresh classification of the full post-caller output, unchanged source IDs/revisions, settled application boundaries, fresh browser idle, no current speech/research/delegation/context delivery, and strict age limits. | A stale pre-answer cue can never become a late cue. The note is quiet, optional context, with no instruction to restart speech. Silence or punctuation alone is not proof of a finished thought. |

All support notes remain short, authored English/Spanish text. Raw history is supplied to Decisions as evidence, not appended to Live. A new simplification note conditionally asks for a different approach when an earlier explanation did not help. Research decisions remain observe-only.

The complete classifier request stays within its 32 KiB transport limit, including the rubric and JSON encoding. Whole optional history rows are omitted with explicit metadata if needed; current corrections and the evidence used to determine whether Origen already answered are never silently cut off. Scope changes and reconnects clear the temporary history.

The confidence thresholds, request caps and quiet-window durations are Origen's experimental application policy, not timing guarantees or mandatory settings from OpenAI.

The first live comparison exposed a scheduling defect: the second reserved check could run after only one new connector word. Distributed checks now require meaningful text growth and avoid dangling English/Spanish articles, prepositions and conjunctions. Recorded English cadence and Spanish long-pause replay tests verify that the second check reaches the actual subject. These hints select when to classify; they do not decide what the caller means or hold voice output.

## Guidance review and implementation decisions

The team completed the full 45-page Responses manifest before editing, including unique generated schema content and duplicate checks. It also reviewed the saved Responses, Decisions and conversation-state references, the local configuration audit and measurement plan, and relevant current official pages. No required Responses page was unavailable or left incomplete. This is a collective review, not a claim that one reviewer independently reread all pages.

Review allocation by zero-based Responses manifest index:

- Responses guide reviewer: 0, 18, 19, 21, 24, 26, 27, 28, 29, 30, 33, 34, 35, 36, 38.
- API/state reviewer: 1, 6–17, 39–44; unique schema contracts checked against duplicate copies.
- History reviewer: 2–5, 20, 22–23, 25, 31; shared Live/state copies compared.
- Primary reviewer: 32 and 37, saved references, measurement plan, and current official guidance.

This change does not claim a new complete reread of every optional Decisions/conversation-state SDK snapshot or every external link. The relevant Decisions, Live, state and data contracts were reviewed. Documentation is never inserted into runtime model context.

| Official guidance | Application decision |
| --- | --- |
| [Decisions](https://developers.openai.com/api/docs/guides/decisions) distinguishes predicate truth probabilities and application policy. | Keep independent questions, explicit uncertain/refused states, labeled bilingual tests, and application-owned thresholds. No confusion inference from income, language or first-generation status. |
| [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation) distinguishes quiet thinking context, speakable commentary and interrupting instructions. Appends can cancel pending automatic acknowledgments. | Use fixed thinking notes only; fence competing context and delegation work. Preserve the existing Responses delegation architecture. |
| [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations) separates transcript fragments, estimated context delivery and audio. | Keep native source IDs and application grouping provenance. Provider acknowledgment is never labeled playback, answer completion or understanding. |
| [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) separates caller-managed state from provider continuation. | Maintain bounded local evidence; no new Conversations store or extra Responses extraction call in the live path. |
| [Decisions voice integration](https://developers.openai.com/api/docs/guides/decisions-voice) supports independent transcript triggers, combined pending deltas and out-of-order results. | Native triggers are considered below, not enabled. Exact source/revision validation remains required whichever transport is used. |

## Verification

Automated tests cover history eviction and corrections, source conflicts, scope changes, short bilingual confusion, budget refill, no polling, matched boundaries, stale timers, intro protection, research/context fences, output arriving during classification, separate receipt/playback evidence, and late-candidate invalidation.

Final offline suite: **538/538 passed** (`node --test research/decisions/*.test.mjs research/decisions/local-call/*.test.mjs`). The explicit late experiment now classifies the complete post-caller output even if a prior deferred cue established a newer temporary support anchor.

Independent review found and fixed an offline measurement defect: matching source IDs alone could previously accept a completed playback interval that ended before the referenced output existed. Completed playback now requires coherent timing and sufficient interval coverage on the same timeline; normal buffered playback remains valid. Accelerated or trimmed audio would need an explicit timing map and is not accepted as full coverage by this evaluator. This correction changes evidence accounting only, not the live conversation.

The audio comparison uses fictional English and Spanish callers, a confirmed fictional student, unchanged startup/voice configuration, and no database or real research. Its shadow condition disables early-cue delivery while retaining the same observation and existing preference/continuation layers. It is not an all-Decisions-off baseline. Audio activity, transcript content and provider receipts are stored separately. The study cannot establish real caller learning from scripted lines such as “I understand now,” or establish perceived warmth without listening review.

The protected runtime verification still matches baseline `f4073c02e561cfd4dbb997cedc535427e7bd1083`: 3,161 runtime files unchanged and the same two previously reviewed local observer hooks. Runtime digest: `0b40a73eaaaf42c288915f9fcfa60857228751d97719555b57e0187c975d834b`.

Real classifier validation used fictional cases, no voice, research, database, or student records:

| Measurement | English | Spanish | Combined |
| --- | ---: | ---: | ---: |
| Initial exact policy-label agreement | 9/12 | 10/12 | 19/24 |
| Initial support eligibility agreement | 11/12 | 12/12 | 23/24 |
| Unwanted support | 0 | 0 | 0 |
| Median request latency | 288 ms | 307 ms | 295 ms |
| P95 request latency | 851 ms | 1,007 ms | 851 ms |

One application-policy issue was fixed: uncertainty about replacing a nonexistent prior need no longer vetoes a confident explicit current need. Pending corrections and uncertainty about an existing need still block delivery. A five-case development retest produced 5/5 correct eligibility and 2/5 exact labels, median 306 ms. It is not an independent holdout. EN/ES topic abandonment remained a label mismatch but replay tests prove the prior support is withdrawn without an append. Explicit Spanish clarity still falls below the clearing threshold; the retained record is bounded and cannot authorize a later cue without fresh validation.

Classifier spend for the 24-case run and five-case retest was $0.0079199. Three restricted-network failures retain $0.15 as unknown reservations in the existing $5 ledger; those were not reset or silently released.

The separate $3 live-audio ledger also retains an interrupted pre-fix call's $0.40 reservation because its final usage was not received. Two setup failures demonstrably stopped before creating a provider session and were settled at zero, with that evidence preserved. Interrupted or failed runs remain in the audit trail and are not treated as completed comparisons.

### Six-condition voice comparison

The first complete comparison contains six calls and 24 scripted replies. Each condition used the same voice/session configuration within its language. “Shadow” disabled early cue delivery, while the existing preference and continuation layers remained identical. This was a small development comparison, not a randomized user study.

| Condition | Intro first audio activity | Median reply audio activity after caller ended | Important observation |
| --- | ---: | ---: | --- |
| English shadow | 1.43 s | 1.74 s | No early support append. |
| English early support | 1.24 s | 1.63 s | One real pre-answer support note, with provider receipt. |
| English late experiment enabled | 1.43 s | 1.62 s | One pre-answer note; a separate late classification was withheld. No late note sent. |
| Spanish shadow | 0.89 s | 1.33 s | No early support append; brief listening-sound overlap. |
| Spanish early support | 0.79 s | 1.37 s over three comparable turns | Excludes one substantive answer that began before the caller finished. |
| Spanish late experiment enabled | 1.00 s | 1.39 s | One pre-answer note; one optional Decisions request timed out while voice continued. No late note sent. |

These times measure audio activity, including acknowledgments. They are not time to a complete useful answer or evidence of greater warmth. Four genuine Decisions notes received provider acknowledgments. There were no voice transport errors or extra `response.create` commands after opening. An unnecessary career-research attempt in one condition was blocked by the isolated harness; its four research-state appends are not counted as Decisions notes.

The Spanish early-support overlap is a real limitation: substantive output started about 2.24 seconds before caller audio ended, with browser audio activity about 2.04 seconds before the end. The cue had arrived roughly 620 ms before substantive output began. This does not establish causation, but it makes the previously calculated 169 ms post-end first-audio value unsuitable as a latency improvement. Whole-turn overlap must be evaluated alongside post-turn latency.

That observation led to an additional input-state guard. A cue now requires closed input in both the delivery controller and the matching transcript tracker; replaying an earlier contribution's completion cannot open the current contribution's delivery window. English/Spanish regression tests cover held candidates, new caller words, assistant output, expiry and replayed boundaries. Delivery logs explicitly mark `inputBoundaryEvidence: matched_application_estimate`, `callerAudioEnded: unknown`, and `playbackClaim: false`. A new voice-measurement helper records the entire caller-audio window and signed playback onset, so overlapping speech cannot be mistaken for a faster response.

The completed comparisons demonstrate that Decisions can reach the live session without making voice await its request. They do **not** establish consistent improvements in spoken answers. Some answers still used “thinking” prefaces, and one Spanish condition gave an overgeneralized loan explanation. Scripted expressions of clarity are not proof that a real caller understood. No actual late note was delivered, so the late experiment remains disabled by default.

Fresh six-call voice/backend cost was $0.776950; related Decisions cost was $0.033447, with one $0.05 unknown reservation. Before the targeted caller-speech retest, the full voice ledger stood at $0.915283 settled plus $0.40 held, and the Decisions ledger at $0.061942 settled plus $0.20 held. All uncertain reservations remain counted against their approved caps.

### Guarded English/Spanish retest

Two additional four-turn calls used the same cached caller audio and enforced the earlier voice/session configuration hashes. Code remained frozen during both calls. These were development retests after the guard, not new untouched holdouts.

| Measurement | English | Spanish |
| --- | ---: | ---: |
| Intro first audio activity | 1.19 s | 0.90 s |
| Median reply audio activity after caller ended | 2.38 s | 1.34 s |
| Reply range | 1.52–2.51 s | 0.97–1.38 s |
| Early cues sent / provider receipts | 0 / 0 | 0 / 0 |
| Browser playback during recorded caller input | 0 turns | 0 turns |
| Voice errors / research attempts | 0 / 0 | 0 / 0 |

Each language produced an eligible cue while input was open; the new guard held it, and later caller words invalidated it. Ordinary voice continued. Brief Spanish native transcript intervals intersected around “Claro” and “Sí,” but those fragments arrived after caller audio ended, and browser playback did not overlap the recorded caller. Native interval timing and browser playback remain different evidence.

The English reply median was higher than its earlier shadow sample, while Spanish was similar. There was no added application hold for classification and no cue delivery in these retests; a small nonrandom comparison cannot attribute timing variation to the change or prove no latency effect. The defensible result is narrower: the new guard exercised safe withholding without blocking voice. It also reduced cue opportunities. There is still no demonstrated, repeatable improvement in answer quality from Decisions, and no real late delivery has been validated. Human listening and a more varied controlled comparison remain necessary before promoting either experiment.

Final accounting after all comparisons and development retests:

| Approved ledger | Settled cost | Unknown usage still held | Remaining available |
| --- | ---: | ---: | ---: |
| New $3 voice/audio comparison cap | $1.171865 | $0.40 | $1.428135 |
| Existing $5 Decisions cap | $0.073092 | $0.20 | $4.726908 |

No unknown reservations were added by the guarded retest, and neither ledger was reset. Eight complete calls and 32 scripted replies were evaluated, in addition to the separately documented setup failures and interrupted development call.

Detailed ignored local reports:

- `.local/meaningful-classifier-20261108-1794156050324.json`
- `.local/meaningful-classifier-20261108-1794156305366.json`
- `.local/meaningful-final-offline-tests.log`
- `.local/meaningful-conversation-live-1794156760697.json`
- `.local/meaningful-voice-metrics.json`
- `.local/meaningful-conversation-model-review-1794156760697.json` (model review of transcript/timing evidence; not human listening)
- `.local/meaningful-conversation-live-1794158131580.json`
- `.local/meaningful-retest-metrics.json`

## Native integration decision

Do not enable native triggers on the user's main local call yet. First establish an audible benefit for eligible cues, separately from receipt. Native triggers can remove application transport work, but cannot resolve ambiguous classification, old evidence, inappropriate timing or duplicate support by themselves.

A later isolated comparison should use the same rubric and scenarios; permit both source transcript events and `decision.event`; match `source_event_id` and `trigger_id`; reject stale results independently for input/output directions; measure actual trigger frequency and cost; and retain the existing intro, scope, playback and research gates. Never run two delivery owners at once. Start that comparison observe-only, then enable the winning path only after human review of audio and turn-by-turn outcomes.

Prefer evaluating independent `session.triggers` first while retaining the current Responses delegation. Changing `delegation.type` to `decisions` would replace how backend work is initiated and requires a new session; that is a different architectural experiment. The official guide explicitly distinguishes transcript triggers from delegation. Native integration may reduce a transport round trip, but its effect must be measured against this workload rather than assumed.

The late experiment is explicitly enabled only with `ORIGEN_LOCAL_LATE_DELIVERY_EXPERIMENT=true` and the existing local early/conversation support prerequisites. Its default is false. The normal local startup uses guarded pre-answer support.

## Local review setup

The local app was refreshed after the caller-speech guard and checked at `http://127.0.0.1:3001/__local_observer`. It reports branch `v1.3-decisions-integration`, isolated database `origen_decisions_local_20261107`, `productionWrites: false`, conversational/early support enabled, `lateEnabled: false`, `researchObserveOnly: true`, and a ready worker. The user interface remains `http://127.0.0.1:5173/#app`.

This local microphone setup uses the previously authorized isolated account copy. The automated comparisons used fictional callers and no database or real research execution. No production configuration, migration, commit, push or deployment was performed. These experiments do not establish that live research delivery or the production experience improved.
