# Earlier Decisions support — isolated v1.3 results

Implemented and tested November 7–8, 2026 on `v1.3-decisions-integration`.
No commit, push, deployment, migration, production access, or production
configuration change. The user's microphone app was not restarted.

**Result:** the three improvements are implemented. A real English call
demonstrated support reaching Live before its answer without holding audio.
Spanish calls continued normally but the early results were withheld for low
confidence or stale evidence. Reliable improvement in both languages is **not
yet established**. This remains a default-off local experiment.

## What changed

| Before | Implemented now | Benefit and limit |
| --- | --- | --- |
| Confusion analysis waited for the application's approximately 1.1-second transcript grouping timer. | A separate tracker observes meaningful accumulated native fragments and starts a small two-question Decisions request. | Creates an earlier opportunity while the caller is speaking. Fragments remain provisional; the original timer and native voice response are unchanged. |
| Support delivery depended on the later completed-turn stamp and frequently lost the race to the ordinary answer. | A separate parent gate validates exact current source IDs, contribution/revision, student, language, and connection. A short fixed quiet note is eligible only before observed assistant output. | A timely finding can help the upcoming reply. Late or uncertain results cannot force an extra acknowledgment, reopen an answered contribution, or interrupt speech. |
| A missed cue could be discarded or repeated later without enough relevance. | Useful, still-current support is retained locally for up to 90 seconds/three later contributions. A fresh classification must connect the next question to the same unresolved idea. | Supports continuity without permanent student labels or automatic cue replay. Resolution, topic/scope changes, expiry, or unsupported evidence prevent reuse. Real cross-turn benefit still needs a longer call. |

The initial audio test revealed that three early checks could all be spent on
unfinished prefixes. The final scheduler keeps the first two bounded 160 ms
windows with 16-byte growth, then reserves the third for a 350 ms quiet gap with
any new text. New fragments reset only that final timer. The same three-per-
contribution/eight-per-call limits apply; normal observation has 24 slots.

The classifier distinguishes an established need followed by unfinished
background elaboration from an unfinished correction. The final policy is
`early-conversation-4`. Both action and meaning-readiness still require
confidence at least 0.85 and selected probability at least 0.90. No threshold
was lowered to make a test pass.

The existing intro, student briefing, voice configuration, audio controller,
research routing, and steady call indicator were not changed. Decisions research
classifications remain observe-only. Only the isolated wrapper can enable the
new flag, `ORIGEN_LOCAL_EARLY_DECISIONS`.

## Library and contract review

Before editing, the team covered all 110 manifest entries: 45 Responses,
30 Decisions, and 35 conversation-state entries, using the approved unique-
content review method. Coverage includes 37 distinct guide snapshots and
8,641 unique contract lines across 53 non-guide entries, plus the saved
references. No saved page was unavailable. Relevant current official guidance
was checked against the code. Review scope and attribution are recorded in
[EARLY_GUIDANCE_REVIEW.md](EARLY_GUIDANCE_REVIEW.md).

OpenAI guidance shaped three distinctions:

1. Meaningful transcript fragments may trigger background work; they are not
   completed turns, and later corrections can invalidate work.
2. A thinking append supplies quiet context, but is not a guarantee of silence.
   Appending an instruction or commentary to force a late result would risk the
   flow this experiment is intended to preserve.
3. Classification, a write attempt, provider acknowledgment, transcript output,
   and browser playback are different evidence. None alone proves better
   conversation or reveals private model reasoning.

## Automated checks

**441 tests passed; zero failed or skipped** in the final serial suite.
Log: `research/decisions/.local/early-final-tests.log`.

Coverage includes bilingual interpretation/delivery, exact provenance, the
recorded fragment cadence, unfinished corrections, intro protection, assistant
output winning the race, related follow-up revalidation, scope/language changes,
reconnects, stale playback, uncertain writes, bounded requests, budget holds,
worker failure, and the existing server voice regression tests.

The isolation verifier matched the saved 3,163-file baseline: 3,161 runtime files
unchanged and the same two previously reviewed local hooks in `server/index.mjs`
and `server/voice-control.mjs`. This task did not edit those hooks. Final paid
reports' runtime source hashes match the current files.

## Real classifier tests

| Policy / set | Correct action + readiness labels | Passed delivery eligibility checks | Interpretation |
| --- | ---: | ---: | --- |
| v2, original 16 bilingual cases | 16/16 | 15/16 | One correct result was withheld below threshold. |
| v3, eight partial-speech cases | 6/8 | 5/8 | Exposed difficulty retaining an established need when background speech was unfinished. |
| Final v4, four targeted repair cases | 4/4 | 2/4 | Both unfinished corrections were safely rejected. Both positive elaboration cases still fell below readiness confidence. |

These are authored development cases, not independent holdout data. The original
16-case set was not rerun with final v4; its score must not be attributed to v4.
Full provenance, earlier v1 results, latency, and costs are in
[EARLY_CLASSIFIER_VALIDATION.md](EARLY_CLASSIFIER_VALIDATION.md).

## Real voice comparison

Seven real WebRTC calls used fictional Morgan/Aiden data and prerecorded English
or Spanish caller audio. No database or research calls were made. The initial
four-call comparison kept its runtime frozen. Two final focused calls and one
Spanish recording follow-up used the final runtime; source hashes were checked.

### Initial four-call comparison — before the timing refinement

| Measure | English control | English enabled | Spanish control | Spanish enabled |
| --- | ---: | ---: | ---: | ---: |
| Caller questions | 4 | 4 | 4 | 4 |
| Median browser audio activity after recorded input ended | 1.584 s | 1.748 s | 1.711 s | 1.481 s |
| Intro browser audio activity | 0.935 s | 1.320 s | 0.933 s | 0.976 s |
| Early Decisions requests | 0 | 8 | 0 | 8 |
| Median early Decisions API time | — | 232 ms | — | 177 ms |
| Support notes sent | 0 | 0 | 0 | 0 |

Seven results were stale and nine uncertain. The timing differences therefore
do not establish a Decisions benefit. The enabled condition included all local
support, while control disabled it; this was not an isolated comparison against
the previous completed-turn support implementation.

Browser activity is not necessarily a useful answer. For example, English
enabled follow-up showed activity at 1.894 seconds, but the first lexical
transcript/nonzero sideband audio arrived around 4.31 seconds. All 16 new lexical
answers began after input ended. In Spanish, prior-answer nonzero sideband audio
packets were received as late as 819 ms after the next input began, with no
support injection involved. Packet receipt does not establish the duration of
audible overlap; browser playback evidence must be considered separately.

### Final focused validation

| Measure | English | Spanish | Spanish with corrected recording drain |
| --- | ---: | ---: | ---: |
| Early requests / completed | 3/3 | 3/3 | 3/3 |
| Median API time | 241 ms | 165 ms | 287 ms |
| Notes sent / acknowledged | 1/1 | 0/0 | 0/0 |
| Browser activity after input | 1.604 s | 1.441 s | 1.192 s |
| Intro browser activity | 0.879 s | 0.837 s | 0.837 s |
| Delivery finding | Timely, before answer | Three uncertain results withheld | One uncertain and two stale results withheld |

In English, the note was sent 2.564 seconds after the first caller fragment,
while input was still open: **6.377 seconds before recorded caller audio ended**
and **8.125 seconds before the later application transcript boundary**. The
provider acknowledged it 673 ms after send. First lexical output came 7.757
seconds after send, 1.380 seconds after caller audio ended. There was no
additional spoken acknowledgment caused by the note. The response explained
grants versus loans and offered to inspect the letter. This demonstrates a real
early delivery opportunity, not proof that the note caused the wording; Live
also heard the caller's confusion directly. The answer was not especially short.

The first focused Spanish recording was closed during a later continuation
because the old harness mistook a brief quiet period for answer completion.
That recording cannot establish a complete answer or a provider cutoff. The
harness now drains the final response until transcript and browser audio are
both quiet for ten seconds, with independent hard call limits. The follow-up
captured the complete Spanish reply; no support note was sent and the hard limit
was not reached. Quiet time remains an estimate, not semantic completion.

No provider errors or research attempts were recorded. No support note was sent
during any intro. The initial samples contained unsupported familiarity in two
intros (transfer costs/UCSC absent from the fictional seed), and some native
replies overgeneralized loan terms. These occurred without any support note;
they remain separate baseline quality concerns, not fixes or improvements
attributed to Decisions here.

Raw local reports:

- `.local/early-live-1794120194738.json`: initial four calls.
- `.local/early-live-1794121051455.json`: final English/Spanish focused calls.
- `.local/early-live-1794121259709.json`: full Spanish recording follow-up.
- `.local/<call-id>.jsonl`: durable detailed observer logs.
- `output/playwright/early-decisions/`: browser audio artifacts.

Paths above are relative to `research/decisions/`, except `output/`, which is
relative to the repository root. The offline
[analysis script](analyze-early-live.mjs) keeps transcript and playback measures
separate. Audio files were captured; this assessment is based on transcript and
event evidence, not a human listening panel or an audible warmth score.

## Cost accounting

The increased $5 authorization was treated as a combined cap including earlier
validation, not $5 additional. All ledger configurations and prior unknown
holds were preserved.

| Accounting category | USD |
| --- | ---: |
| New Decisions: 80 settled requests | 0.0107668 |
| New voice: seven calls, provider usage settled | 0.5562321 |
| New TTS reservation retained because usage was not reported | 0.10 |
| Earlier known voice + Decisions usage | 0.5911066 |
| Earlier unresolved voice/TTS reservations retained | 1.60 |
| Known usage + all retained reservations | **2.8581056** |

Amounts are estimates computed from reported provider usage, rather than a
reconciled billing invoice. Unknown usage retains its full reservation.

The conservative allocation ceiling is $4.9527733, below $5. The new 80-request
Decisions allowance is now exhausted; subsequent optional classifications stop
without blocking voice. No cap or ledger was reset. Further paid validation
requires a separately configured allocation; these completed tests do not authorize
indefinite microphone inference.

## What remains

- Better timing is demonstrated in English. Spanish semantic-readiness
  confidence and rapidly changing evidence still prevent useful delivery.
- Cross-turn retention/revalidation passed integration tests; a longer real
  conversation must establish that it improves subsequent explanations.
- Longer, unscripted bilingual calls are needed to judge warmth, interruption
  handling, late corrections, real student selection/briefing, and background
  research coexistence. These tests used an already confirmed fictional student.
- There is no defensible percentage improvement or statistical speed claim from
  these small samples. The next evaluation should focus on helpful spoken
  changes, not maximizing how many notes are injected.

The implementation is available for review with default-off flags. See
[LAUNCH.md](LAUNCH.md) for the isolated setup and
[DECISIONS_DIAGNOSTICS.md](DECISIONS_DIAGNOSTICS.md) for event correlation.
