# Local conversational support results

November 7, 2026, Pacific time. Branch: `v1.3-decisions-integration`.

Conversational support is enabled in the isolated local app at
`http://127.0.0.1:5173/#app`. The existing local copy of Daniel's account contains
Aiden and Elodie. The database is `origen_decisions_local_20261107` on loopback
port 55480. No production database, deployment, commit, or push was changed.

## What is enabled

Decisions can identify three explicit conversational needs: finding a starting
point, explaining something more simply, or identifying one manageable next
step. A local gate may pass a short fixed English or Spanish note through the
existing Live provider connection. It never waits in the normal response path.

The gate skips late or uncertain candidates, requests already answered, new
caller speech, an answer already beginning, changed students, unknown playback,
active research/delegation, and pending context. It permits at most two notes
per call, at least 30 seconds apart. It never queues an old note for later.
The initial intro must finish first. A later student selection requires the
existing selection receipt and a new assistant boundary followed by fresh idle
playback. A short acknowledgment alone does not unlock that selection.

Research assessments remain **observe-only in Decisions**. The original
research worker and the original conversation's research tools still operate
normally. This support adapter cannot start, cancel, revise, or announce research.
It does not change the voice configuration, opening instructions, recap wording,
existing research instructions, or student records.

## Validation

**150 offline tests passed.** These include bilingual cue delivery, duplicate
prevention, stale results, genuine interruptions, active research/delegation,
student/language changes, intro/receipt races, unknown playback, worker failure,
and acknowledgment uncertainty. The isolation verifier matched all 3,163
protected files against the saved baseline, allowing only the two previously
reviewed local dependency-injection hooks. Those hooks were not changed by this
support implementation. The other 3,161 runtime files matched unchanged.

Six real WebRTC voice calls used fictional cached English and Spanish audio,
the original voice configuration builders, the actual session wrapper, and real
Decisions classification. No TTS, database access, or research execution was
needed for those calls. Each language's initial baseline/support pair had
identical startup configuration hashes.

Times below measure the end of input audio to the first observed output audio,
except the intro column, which starts at the opening request. They are small
samples, not percentile estimates or evidence of a statistically reliable speedup.

| Language / run | Intro | Essay encouragement reply | Simpler explanation reply | Support notes sent |
| --- | ---: | ---: | ---: | ---: |
| English baseline | 1.165 s | 1.237 s | 1.371 s | 0 |
| English support | 0.889 s | 1.150 s | 1.149 s | 0 |
| Spanish baseline | 0.898 s | 1.306 s | 1.292 s | 0 |
| Spanish support | 1.431 s | 1.366 s | 1.100 s | 0 |
| English support, focused short request | 0.869 s | 1.575 s | 1.148 s | 0 |
| Spanish support, focused short request | 1.278 s | 1.299 s | 1.656 s | 0 |

The calls reported no provider or harness errors. The focused calls confirmed
the intro gate had become ready. Decisions recognized the explicit English and
Spanish requests for a simpler explanation, but Origen had already begun
responding; stale observations were discarded. The 23 observations comprised
13 completed results and 10 stale discards, with zero classification errors.
This is intentional protection against an
interruption or a second answer. The response path did not wait for Decisions.

A separate [controlled bilingual validation](SUPPORT_CONTROLLED_VALIDATION.md)
passed **6/6 cases** covering all three support categories. It used real Decisions
and the real worker/gate, but a fake voice provider, simulated idle playback,
and simulated acknowledgment. It withheld assistant speech to test the eligible
send path. The fixed note was sent 152–381 ms after the request boundary. Those
times must not be presented as live voice improvement.

## What remains unproven

No support note was actually appended during the six real voice calls. The
ordinary model answered quickly, leaving the later classification either stale,
unneeded, or already addressed. Therefore this validation demonstrates a working
eligible delivery path and preservation of the tested response flow, **not an
incremental audible conversational benefit**. Application transcript grouping
plus classification can finish after Live has already begun answering. That
timing limitation is retained rather than weakening the interruption safeguards.

The audio tests started with an already-confirmed fictional student. The
multi-student selection and late-recap paths were exercised in offline tests;
Daniel's microphone test should separately assess those paths with the local
account copy, as well as warmth, pacing, usefulness, and perceived interruption.
Browser RMS shows media activity, not intelligibility or that the listener heard
particular words. Transcript, playback, send, and provider acknowledgment evidence
remain separate. There is no percentage claim about naturalness.

## Budget and retained evidence

The new $3 authorization was split into immutable $1.50 allocations for automated
voice validation and Decisions/local support. Voice usage for the six completed
calls was 332 seconds, estimated at **$0.2766667**. The Decisions ledger recorded
35 requests and **$0.0121056**, with no unknown outcomes or held reservations at
the reporting checkpoint. Combined estimated use: **$0.2887723**, about **$0.29**.
The remaining Decisions allocation is available for the local support trial;
the earlier $5 and $2 approvals were not reset or increased.

Retained ignored artifacts under `research/decisions/.local/`:

- `support-live-validation.json`: original paired voice calls.
- `support-live-focused-validation.json`: final-gate focused calls.
- `support-live-validation-summary.json` and `SUPPORT_LIVE_VALIDATION.md`:
  consolidated voice findings. All 12 reply latencies were independently
  recomputed from the retained input-end times and browser audio samples.
- `support-controlled-validation.json`: six real-classifier controlled replays.
- `support-voice-*.webm` and corresponding `.jsonl`: fictional audio and separate
  native/application/Decisions evidence, correlated by local call ID.
- `support-tests.log`: offline test results.
- `support-voice-budget.json` and `approved-support-decisions-budget.sqlite`:
  durable accounting.
- `support-app.stdout.log` / `support-app.stderr.log`: isolated app startup and
  health output. Existing app logs were preserved.

Actual microphone-call observer traces use their diagnostic session ID as the
JSONL filename and persist until deliberately removed. They can contain real
account transcript excerpts. Acknowledgment timeout is logged without retry or
claiming that the person heard a cue.

## Guidance and local readiness

The [library and contract review](SUPPORT_REVIEW.md) records all 110 available,
unchanged snapshots, reuse of the completed full unique-content review, focused
contract rereads, current official guidance checks, and an independent final
audit. No snapshot was unavailable. It does not claim a fresh literal reread of
all pages in this turn.

OpenAI's [Live delegation guidance](https://developers.openai.com/api/docs/guides/live-delegation)
distinguishes quiet context from speaking instructions and explains that thinking
appends cancel pending automatic delegation acknowledgments. This shaped the
decision to use only `session.thinking.append`, keep research/delegation fenced,
and avoid instructions/commentary appends. Its acknowledgment semantics also
shaped the separate context/transcript/playback diagnostics. Standalone Decisions
classification remains separate from Live configuration and Responses continuation.

Local readiness was verified with `supportEnabled:true`, `cuesEnabled:true`,
`researchObserveOnly:true`, `workerReady:true`, and zero construction failures.
The UI returned HTTP 200. Refresh the local app and start a new call. See
[launcher instructions](LAUNCH.md) for the switches and how to return to
observe-only mode.
