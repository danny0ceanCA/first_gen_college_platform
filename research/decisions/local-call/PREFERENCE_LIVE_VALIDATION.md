# Lasting preferences: English and Spanish live validation

Run November 7, 2026, approximately 9:00 PM Pacific. Isolated fictional data only; no account database, production service, research job, commit, push, or deployment.

## Final real-audio result

Two continuous GPT-Live WebRTC calls used the actual local observer worker, paid Decisions classifications, preference gate, real sideband connection, and browser playback. Each caller requested simple words and one small step at a time for the whole conversation, asked an ordinary essay-support question, then withdrew both preferences. The withdrawal explicitly requested a brief acknowledgment to keep the test within its 90-second cap. Normal model replies were never held waiting for Decisions, and no classifier result or outgoing preference cue was fabricated.

| Measurement | English | Spanish |
| --- | ---: | ---: |
| Intro request to first browser audio | 0.897 s | 0.831 s |
| Preference utterance end to first reply audio | 1.154 s | 0.908 s |
| Essay question end to first reply audio | 1.277 s | 1.607 s |
| Withdrawal end to first reply audio | 1.115 s | 1.158 s |
| Quiet preference snapshots sent / provider acknowledged | 2 / 2 | 2 / 2 |
| Browser quiet before enable / withdrawal snapshot | 2.088 / 2.002 s | 1.706 / 2.145 s |
| Snapshot send to provider acknowledgment | 0.544 / 0.545 s | 0.508 / 0.694 s |
| Extra audible samples after append, before next caller/end | 0 | 0 |
| Provider errors / research attempts | 0 / 0 | 0 / 0 |
| Provider-duration-based voice cost | $0.06083 | $0.05583 |

The ordinary essay turn reused the active preferences without sending another identical snapshot. Both later withdrawal snapshots correctly contained no active preference. The English essay reply offered a familiar example and one gentle question. The Spanish reply explained that an everyday experience could be useful and offered one manageable starting step. The caller then received a short acknowledgment of the withdrawal.

Startup session configuration hashes exactly matched the prior focused-support validation for each language. The intro and voice configuration were not changed for this experiment.

## What the first pair discovered

An initial pair correctly recognized preferences but delivered no quiet snapshots. It exposed a real transport behavior the controlled tests had missed: `session.output_audio.delta` continued arriving with silent PCM after the answer finished. The old gate treated every audio frame as active speaking and repeatedly invalidated the completed-thought estimate. For the English example, every frame from 23.575 to 26.402 seconds after test start contained 9,600 bytes of exactly zero PCM; independent browser playback also showed silence.

The local gate was corrected to distinguish silent transport frames from speaking, while keeping fresh browser playback evidence and transcript boundaries as separate protections. New transcript content still invalidates the boundary. The final pair above confirmed that real quiet delivery now occurs without forcing another spoken turn.

The first Spanish call reached the 90-second test limit while giving a long response to withdrawal; its final answer was therefore truncated by the harness. This was recorded as a test-duration timeout, not a spontaneous disconnect or unexplained silence. The final withdrawal audio asks only for a brief acknowledgment; both final calls completed without that timeout. The first English call also introduced an unsupported UC Santa Cruz topic before any campus was requested. No preference cue had been sent at that point, so this is a baseline conversational-quality observation, not evidence that a preference append caused it.

## Timing and diagnostic evidence

Each delivered snapshot can be traced from the classification operation and provider request ID, through validated preference state and its source user turn, to deferral, sent event, and provider acknowledgment. Classification API request durations for the four delivered snapshots were 447/241 ms in English and 382/524 ms in Spanish. These are request durations, not queue time or complete caller-to-context latency. Three results were retained for preferences even though the broader one-time observation had become stale after the assistant began answering; the independent caller/scope revision remained valid.

Separate evidence is retained for:

- Native input/output transcript intervals and the application's estimated grouping into thoughts.
- Browser RMS playback samples and synthetic caller audio start/end times. All reply latency values were independently recomputed from these records.
- Preference enable/disable state, source revision, deferral reason, quiet send, and provider acknowledgment.
- Provider final session duration and separate Decisions usage/request records.

The new expanded queue/API-lifecycle instrumentation was not present in these two paid calls. Its additional fields require their own regression or controlled-request verification; this report does not claim they were observed here.

An acknowledgment proves estimated context delivery, not that the model followed it or a person heard it. Browser audio activity does not establish intelligibility or warmth. Because GPT-Live directly heard the caller's preference too, these tests do not isolate Decisions as the cause of the simpler answers. They demonstrate real delivery after an answer, preservation across an ordinary turn, and explicit withdrawal without a new spoken announcement. Two calls do not establish a statistically reliable speed or naturalness improvement.

## Cost and artifacts

The initial voice pair cost $0.14583 and the final pair cost $0.11667, based on complete provider duration usage. Six new fictional TTS clips are estimated at $0.01038 using the current $15/million-character rate. Decisions usage is accounted separately in the existing approved support ledger. All charges remain within the previously approved $3 allocation. TTS reservations remain conservatively held because the speech endpoint did not return usage; one additional $0.10 hold records the first launch blocked by sandbox networking before a request was sent.

- Harness: [validate-preferences-live.mjs](validate-preferences-live.mjs). Without `--execute`, it makes no paid request.
- Final detailed report: `research/decisions/.local/preferences-live-validation.json`.
- Independently recomputed summary: `research/decisions/.local/preferences-live-validation-summary.json`.
- Initial evidence: `research/decisions/.local/preferences-live-validation-before-silence-fix.json`.
- Final English call: `preference-voice-d157f922-c463-4e35-97f8-40b2a69a86e4`.
- Final Spanish call: `preference-voice-2c76efca-9b41-4b1e-880c-ead1a039bd4e`.
- Per-call JSONL logs: `research/decisions/.local/<call-id>.jsonl`.
- Captured browser audio and fictional input clips: `output/playwright/preferences/`.
- Voice/TTS reservations: `research/decisions/.local/support-voice-budget.json`.

Human microphone testing is still needed for warmth, pacing, usefulness, and realistic interruptions. Research behavior remains separately protected and was not exercised with real lookups in this test.
