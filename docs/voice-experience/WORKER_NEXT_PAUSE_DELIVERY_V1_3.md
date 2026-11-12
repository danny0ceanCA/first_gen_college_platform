# Second worker: next-pause delivery repair

November 11, 2026. Branch: `v1.3-decisions-integration`.

**Local prototype implemented; final live confirmation is incomplete.** No
commit, push, deployment, migration, production access, or production flag
change was performed. The active application's intro, voice instructions and
conversation floor keep their existing behavior. The optional server delivery
sink is supplied only by the isolated experimental harness.

## What caused the wait

The standalone scout previously sent six quiet context packets and had no
spoken-delivery opportunity of its own. Quiet context is available for later
use; it does not request a timely spoken result. When a formal lookup joined
the scout, the existing controller could wait for the end of a continuous
answer. Its final announcement could also miss a paraphrased native answer and
request an unnecessary second recital.

The earlier retained Decisions trials took 10.46 seconds in English and 17.96
seconds in Spanish from quiet append to the AggieCard transcript marker. The
Spanish rules trial took 41.36 seconds. These intervals include ongoing speech
and caller follow-ups; they are not measurements of dead silence.

The new trials exposed two further issues: the script could treat a short
listening sound as a completed answer, and quiet context arriving mid-answer
could influence the next words before a stable boundary. The initial test
attempts and their reservations were retained rather than overwritten.

## Final local implementation

| Change | Behavior |
| --- | --- |
| One delivery owner | A standalone scout and a formal lookup joining it share a canonical task key and evidence version. The result is not also announced by the default channel. |
| Stage before delivery | Research waits outside the voice context while audio is active or a clause is unfinished. A completed transcript sentence plus an audio-idle estimate is required. |
| Preserve caller space | The latest caller question gets its native answer opportunity. An unanswered assistant question gets three seconds of caller space before optional delivery. |
| Short, self-contained result | A suitable typed fact is sent directly as a commentary update, with its entire recorded scope, fact-specific qualification and citation reference. Aggregate finding qualifications are included when they also fit. The original full result remains in the retained research record. |
| Avoid the packet/announcement loop | The self-contained path needs neither six quiet packets nor a later opaque-reference prompt. Each body is at most 500 UTF-8 bytes, conservatively within the documented 500-token limit. |
| Conservative fallback | Oversized units, multi-step sequences, unmatched requested facts and later evidence versions use the existing context/ACK/incremental-delivery controller. No caveat or step is truncated to force the short path. |
| Suppress optional repeats | Completed native source-clause evidence can retire an optional recital; it is explicitly not labeled a complete answer or comprehension. Inline requests are recorded separately from provider acknowledgments and spoken evidence. |
| Bound stale work | Staged opportunities expire after two minutes. An explicit request to set the task aside rejects its delayed formal join. Scope close clears timers; receipt failures do not trigger a new lookup or automatic speech retry. |

The implementation does not add an instruction append, cancel speech, make Live
wait for Decisions, issue an extra backend response request, or start another
web lookup. Decisions still selects whether a useful research task exists; the
delivery repair is application logic, not a new Decisions capability.

`server/voice-control.mjs` adds an optional server-only `researchDeliverySink`.
Without it, the existing `send` path is unchanged. The isolated harness supplies
`createPauseDelivery`; no application route or Render service enables it.

## Validation and unsuccessful attempts

194 focused tests passed, including 30 new adapter tests. All 96 controller
tests passed, including the delivery-owner seam. The TypeScript/Vite build
passed. Existing build warnings about chunk sizes and an Auth0 module directive
remain unrelated to this change.

Bilingual offline cases cover complete thoughts, unfinished clauses, idle audio,
ordinary questions before research, unknown ACKs, active backends, duplicate
formal joins, explicit topic changes, expiration, closed sessions, full scope
and qualifications, large facts, step sequences and unmatched requested facts.

Six paid native voice attempts used fictional students, actual provider output
PCM/transcripts, generated caller audio, and previously verified public transit
research replayed at its measured 11.14/12.19-second duration. These were not
new web searches and did not exercise a deployed second Render worker.

| Attempt | English | Spanish | Assessment |
| --- | --- | --- | --- |
| First thought-boundary adapter | Card marker 8.44 s after quiet context | Card marker 15.54 s after quiet context | Calls completed, but a redundant commentary request remained; the script also advanced after a listening sound. |
| Improved script and native-portion suppression | The result was fragmented across scripted follow-ups; no complete AggieCard marker | Card marker 9.51 s after context | Not a clean bilingual pass. The English interruptions are retained as failures, not hidden. |
| Stage quiet context at a pause | Card marker 5.59 s after context; full benefit and valid-card restriction appeared in the initial answer | The result began after a long completed answer, but the harness deadline cut it off | English later hit the output-PCM bound during the topic-switch turn. Spanish did not complete. These bounds were harness limits, with zero provider API errors. |
| Final self-contained commentary policy | Offline only | Offline only | **Not yet validated with fresh native speech.** |

The final two short attempts had first-response audio at 1.59 s in English and
1.67 s in Spanish. This measures first audio, not the useful research answer.
The Spanish result was ready while Origen was still speaking for roughly 28
seconds. Preserving that thought is different from leaving the caller in
silence. The final policy addresses avoidable delivery machinery after a safe
boundary; it does not promise to shorten every conversational answer.

### Recorded-prefix replay of the final policy

The replay stops using recorded events when the old policy first changes the
model's context. It never treats subsequent old-policy audio as speech produced
by the new policy.

| Language | Source ready | Final-policy update request | Evidence boundary |
| --- | ---: | ---: | --- |
| English | 24.68 s from call harness start | 36.40 s, at the first observed safe thought boundary; 410-byte complete unit | Counterfactual dispatch on the recorded prefix; no new provider acknowledgment or speech. |
| Spanish | 26.56 s | 56.80 s if silence continues after the unanswered question; 488-byte complete unit | The old policy had injected context at 54.64 s. The additional quiet continuation is simulated, not observed. |

These are dispatch checks, not proof of faster spoken answers. Do not present
them as end-to-end latency improvements or a Decisions-versus-rules result.

## Budget and remaining test

The separate `worker-pause-delivery-20261111` ledger conservatively accounts for
**$2.86 of the approved $3**, including unsuccessful attempts. This is reserved
test accounting, not a final provider invoice. No more paid calls were started
under that cap.

An additional $1 was requested for the final bilingual confirmation and remains
pending at this checkpoint. `inline-confirm.mjs` is prepared, preflighted, and
not executed. It uses a separate $1 ledger and reserves at most $0.87 for two
single-turn calls. Its longer bounded wait avoids cutting off the result it is
measuring. It will not run without authorization.

The remaining verification is actual spoken use of the final short commentary
in both languages, including the valid-card condition and absence of another
recital. Browser/human microphone playback, perceived warmth, opening recaps,
production queue contention and broader source topics remain outside these
isolated transit tests.

## Guidance applied

The preceding complete 45-page Responses library review remains part of the
preparation for this work. The saved Responses and Decisions references, relevant
Live delegation/conversation sections, local audit and measurement plan were
reviewed again. The existing manifest verification found all 45 snapshots
present and matching after newline normalization. This is not claimed as a new
literal reread of every repeated generated SDK schema. No documentation was
injected into runtime voice context.

- [Live delegation: update types](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update): quiet context and spoken commentary have different purposes; use a concise coherent fact rather than a long backend report. General session supplements use `delegation_id: null` in the existing Responses-delegation session. This does not change delegation mode.
- [Live conversation timing](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model): match ACK IDs, distinguish estimated context delivery from speech/playback, and verify behavior independently.
- [Live transcript guidance](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas): fragments and punctuation are not sufficient playback evidence. The adapter additionally requires idle audio and rejects unfinished clauses.
- The local measurement plan keeps source progress, application dispatch, provider receipt, transcript evidence and playback evidence separate. The application retains task state and discards stale results rather than treating a spoken interruption as confirmed cancellation of backend work.

## Artifacts

- Implementation: `research/worker-comparison/pause-delivery.mjs`
- Tests: `research/worker-comparison/pause-delivery.test.mjs`
- Retained native attempts: `output/worker-pause-delivery-20261111/voice/`, `voice-fixed/`, `voice-final/`
- Full comparison and limitations: `output/worker-pause-delivery-20261111/comparison.json`
- Counterfactual dispatch only: `output/worker-pause-delivery-20261111/final-policy-prefix-replay.json`
- Budget: `output/worker-pause-delivery-20261111/budget.json`
- Test logs: `output/worker-pause-delivery-tests.tap`, `output/worker-pause-control-tests.tap`
