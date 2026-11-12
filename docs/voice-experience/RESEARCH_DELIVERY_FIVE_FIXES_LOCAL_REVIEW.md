# Research delivery and evaluation repairs

November 11, 2026, America/Los_Angeles. Branch: `v1.3-decisions-integration`.

Implemented all five follow-ups locally. Validation was offline, using fictional
fixtures and existing saved evidence. No new OpenAI calls, production access,
database changes, flags, commits, pushes, deployments or service activation.

## What changed

| Item | Before | Now | Scope |
| --- | --- | --- | --- |
| Consistent concise delivery | Quiet evidence used the typed budget headline, but direct comparison, acknowledgment and requested-result paths could resend the full breakdown. | Those paths use the same presentation helper. A total-only question gets the scoped total and qualification; requested details remain available. Original records and table components stay intact. | Application delivery |
| Caveat continuity | A single sentence could establish the estimate/bill distinction; two naturally connected sentences did not. | Adjacent completed assertions with an explicit pronoun/subject link can establish the distinction. Questions, uncertainty, quotations, unfinished clauses, unrelated intervening statements and separate observation windows cannot be joined. | Application delivery |
| Fact and condition coverage | The laboratory recognizer could retire a typed finding after hearing its benefit without its condition, or after one fact from a multi-fact record. | All verified textual facts, their qualifications and finding-wide limitations must be observed before that recognizer suppresses the optional recital. New coverage diagnostics distinguish missing facts from missing conditions. | Isolated worker/evaluation adapter |
| Task-specific primary gate | A global boolean reset on completed research events; completed speech after an acknowledgment overlap did not qualify. | The gate tracks job, request revision, evidence version and the requested findings. Unchanged recovery retains coverage. Unrequested scalar details do not erase the requested answer. Prerequisites and steps remain obligations. Complete qualified portions after an acknowledgment can count; interruption, stale versions, unrelated jobs and unverified playback cannot. | Isolated second-worker runner |
| Continuous conversation tests | The runner waited for eight words, punctuation and silence between prompts, and cleared research before the scripted third prompt. | Caller audio follows one continuous scheduled clock, with an optional overlap trial. Only actual application topic-change events invalidate the scout. Recording windows are labeled as such rather than semantic assistant turns. An optional opening window removes the prior no-recap testing override. | Isolated voice runner |

The gate still relies on the adapter's complete-thought, audio-idle,
caller-priority and delegation checks. It does not stop audio, force a pivot,
request another backend response, or insert filler while waiting. The new
coverage matcher is conservative duplicate/measurement evidence, not a semantic
grader or proof that the caller heard or understood a statement.

The application intro, voice configuration, pacing, backchannels, binder and
white-table rendering were not rewritten. The second-worker strategy remains
an isolated experiment; this change does not connect another Render service.
No Decisions model or confidence threshold was changed.

## Offline validation

- **388 core, research, speech-observation and experimental-worker tests passed.**
- **319 voice-controller, opening and session tests passed.**
- **707 tests total** across those two disjoint runs.
- TypeScript/Vite production build passed. The first attempt hit Windows sandbox
  parent-directory access restrictions; the permitted local retry passed.
  Existing bundle-size warnings remain.
- The native runner passed syntax checking. It was not executed against OpenAI.
- English and Spanish coverage includes direct total delivery after mm-hmm/ajá,
  comparison changes, explicit requests for completed results, two-sentence
  caveats, omitted transit ID conditions, grant repayment exceptions, uncertain
  Spanish-language assistance, multiple facts, changed dates/cycles, stale
  results, prerequisite recovery, research arriving during a primary answer,
  audio still playing, and ordinary caller/topic changes.

Artifacts are under `output/research-delivery-five-fixes-20261111/`:
`core-tests.txt`, `voice-tests.txt`, `gate-tests.txt`, `build.txt`, and
`library-review.json`. These are local implementation checks, not new native
voice calls or new source-research timings.

## Guidance review

The manifest check confirmed all **110 saved snapshots available and unchanged**,
including all **45 Responses pages**. The prior complete, user-approved
unique-content review remains the basis for those unchanged documents. This
task reread the saved starting references and relevant contracts, and checked
current official guidance before implementation and again afterward. It was
not a new literal reread of millions of repeated generated SDK schema tokens.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation):
  concise coherent facts retain their conditions; thinking and commentary have
  different purposes; receipt does not prove speech. The existing managed
  Responses continuation and grouped-context acknowledgment contracts remain.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations):
  transcript fragments and audio playback are different evidence. The gate uses
  the existing speech observer and explicitly labels playback as an estimate.
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting):
  demonstrated verbosity can justify short routine answers. Concision changes
  the amount said, not the established warmth, pace or opening.
- [Voice evaluation](https://developers.openai.com/cookbook/examples/audio/voice_agent_evaluation):
  retain continuous audio, allow overlaps, observe rather than enforce turns,
  and assess spoken interaction separately from correct backend results.

No library content is added to runtime model context. Standalone Responses
events and Live delegation commands remain separate.

## Remaining evidence limits

The previous roughly 27-to-71-second supplemental delivery interval has **not**
been remeasured after these changes. Smaller/directly consistent packets and
passing offline gates do not establish a new speech-latency number.

Unknown paraphrases may remain unconfirmed by the conservative matcher.
That is observable in the gate log; it is not a reason to automatically lower
thresholds or interrupt speech. The earlier Spanish Pell omission is now a
negative coverage fixture, not a claim that a new voice call verbalized the
exception correctly.

A later authorized bilingual voice pair should measure first useful primary
answer, repeated caveats, actual useful supplemental speech and the wait reasons
between source readiness and speech. Include the overlap and opening variants,
inspect missed topic detection rather than pre-clearing its consequences, and
retain human browser/microphone review for warmth, pacing and physical playback.
Actual Render queue/load/reconnect behavior remains untested here.
