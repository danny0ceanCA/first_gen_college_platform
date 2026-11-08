# Local call observation and optional conversational support

> Production release update: the authenticated production entry point is documented in [Decisions production release](../../../docs/voice-experience/DECISIONS_PRODUCTION_RELEASE.md). Local trial descriptions below remain historical; the isolated launcher still rejects production mode. Research Decisions remain observe-only and late delivery remains off.

## Current meaningful-support trial

See [the v1.3 implementation and results](../MEANINGFUL_SUPPORT_V1_3.md) for the
current history, scheduling, evaluation and delivery behavior. The rubric is
`early-conversation-8`. This local trial keeps up to 40 raw history observations,
selects bounded relevant evidence, and distributes up to 16 early plus 16
completed-contribution checks across the call. Early checks have a burst of three,
refill one slot per 25 seconds and allow at most two checks per contribution.

Classification runs alongside voice. Sending an early cue requires a matching
application-estimated closed input boundary and no observed assistant answer;
new words or expired evidence withdraw the cue. No voice response waits for it.
Research classification remains observe-only. The separate late-delivery flag
`ORIGEN_LOCAL_LATE_DELIVERY_EXPERIMENT` defaults to false; enabling the flag does
not bypass fresh-output classification, intro, scope or playback checks.

Current validation uses the existing approved $5 microphone Decisions ledger
and a separately approved $3 voice-comparison ledger. Failed or interrupted
requests with unknown usage remain reserved. Earlier budgets below are historical
and do not authorize resetting a ledger or adding spend. Provider receipt,
transcript adaptation, playback and real caller understanding remain separate.

## Earlier need-continuity trial (historical)

The following records the preceding trial and its old scheduling and budget
settings. The linked current report above supersedes those settings.

The newest isolated trial can examine meaningful native transcript fragments
before the application's completed-transcript estimate. It runs in parallel with
the existing voice controller: Origen's answer never waits for classification.
`ORIGEN_LOCAL_EARLY_DECISIONS=true` is **default-off** and requires
`ORIGEN_LOCAL_CONTINUATION_SUPPORT=true`,
`ORIGEN_LOCAL_CONVERSATION_SUPPORT=true`, and
`ORIGEN_LOCAL_DECISIONS_APPROVED=true`. These flags are accepted only by the
isolated local launcher; they do not enable a production feature. Lasting
preferences remain a separate optional flag.

The parallel tracker keeps provisional caller evidence, recent dialogue, source
event IDs, contribution/revision IDs, and student/language/connection scope. A
fragment is not a completed turn. Independent predicate questions check simpler
language, examples, a starting point, related follow-ups, corrections, resolution,
an unfinished subject, and whether observed output already addressed the need.
The parent independently checks the current evidence and delivery
window. Only a fixed, short English or Spanish `session.thinking.append` can be
sent, before observed assistant output for that contribution and with fresh idle
playback evidence. Intro and student-selection fences remain in place. Existing
intro prompts, audio, research routing, and production behavior are unchanged.

A late useful classification stays in local temporary support state for at most
90 seconds and three later caller contributions. It is not appended after an
answer or automatically applied to another topic. A fresh classification must
connect a later question to that support need before it can be used. New speech,
student/language changes, connection changes, expired evidence, uncertain
classifications, or an ambiguous send can prevent a cue. Research Decisions
remain observe-only; the established research flow still runs normally. An exact
older prefix may be retained as a provisional observation while new background
words arrive. It cannot authorize a note: a fresh classification of the latest
words, retained need version, and assistant evidence is required. Corrections
suspend that observation; confirmed resolution or a substantive observed answer
clears it. Transcript evidence never proves playback or understanding.

The early observer keeps its first two opportunities on a bounded 160 ms
accumulation window, with at least 16 additional bytes required for the second.
It reserves its third opportunity for 350 ms without new transcript fragments,
accepting even a one-byte addition after the previous classification. A provisional
retained need also permits a bounded check of a short suffix or a newly received
support-state revision. Unchanged evidence cannot cause a retry loop. This gives
small but meaningful late additions a chance without classifying every fragment.
The pause is an application estimate, not proof the caller finished speaking;
assistant output and other delivery fences still take precedence. The limit
remains three observations per contribution and eight per call.

The early path allows at most eight classifications per call; the existing
completed-snapshot path allows 24 when early support is enabled. Both use the
same new ledger, so the combined maximum remains 32. Four completed-snapshot
slots remain reserved for meaningful research observations. Delivery allows at
most four early attempts per call, at least 2.5 seconds apart, with no automatic
retry of an unconfirmed write.

The **$5 total authorization includes prior validation**, not $5 more. The fixed
refinement allocation is $0.30 for Decisions, while the existing $2.10 voice
allocation remains unchanged. Every reservation verifies the older Decisions
ledgers are fully settled and request-exhausted. It counts their $0.0635401
actual total and both full voice ceilings: `2.50 + 0.0635401 + 0.30 + 2.10 =
$4.9635401`. Unknown reservations remain held. New Decisions uses
`approved-early-refinement-decisions-budget.sqlite` with an immutable 200-request
limit; voice uses the existing `early-voice-budget.json`. Opening a ledger
or launching another call never resets a cap. See [launch instructions](LAUNCH.md)
and [detailed diagnostics](DECISIONS_DIAGNOSTICS.md).

The [earlier classifier validation record](EARLY_CLASSIFIER_VALIDATION.md) and
[earlier audio comparison](EARLY_RESULTS.md) preserve the preceding version-4
results. The current review is recorded in
[need-continuity guidance](NEED_CONTINUITY_GUIDANCE_REVIEW.md), and the current
[v7 results](NEED_CONTINUITY_RESULTS.md) separate development, untouched holdout,
real voice and post-run offline evidence. The fixed classifier request allowance
is exhausted after that validation; default-off status is unchanged. A successful
classification or context acknowledgment does not prove better spoken flow.
Runtime files are frozen throughout each paid English/Spanish baseline/support
comparison; reports must identify the tested code and keep transcript evidence
separate from audio/playback evidence. This trial does not claim effectiveness
until that evidence is reviewed.

## Confusion and accepted explanations trial

The preceding isolated trial adds temporary confusion detection and recognizes a
caller accepting an offered explanation or example. Enable the additional
`ORIGEN_LOCAL_CONTINUATION_SUPPORT=true` flag only with approved local support.
The normal app defaults remain unchanged. See [current results](CONTINUATION_RESULTS.md),
[guide review](LOCAL_REVIEW_GUIDES.md), and [contract review](CONTINUATION_CONTRACT_REVIEW.md).

Optional confusion context can be sent only before the current ordinary answer
starts. Late results stay local and need fresh caller evidence before reuse.
A stalled accepted explanation has a separate bounded recovery gate after an
unanswered offer or a completed short acknowledgment. It cannot authorize a
lookup, saving a record, or another external action. Origen never waits for it.
Research Decisions remain observe-only; this flag also clarifies the terminal
status in existing local research-state packets without adding an announcement.

All snapshots are still recorded, but assistant-only boundaries and unchanged
research polls no longer spend classifier requests. Four of the existing 32
per-call slots are reserved for meaningful research updates. The diagnostics
distinguish classification, eligibility, attempted injection, provider receipt,
transcripts, and browser audio evidence.

This trial uses its own approved allocation and immutable request limits.
Earlier experiment budgets and results below are historical, not additional
spending authorization. The continuation-trial ledgers have exhausted their
request slots; no budget is automatically reset for a new microphone call.

## Lasting preferences trial

The local `v1.3` trial now supports explicit ongoing requests for plain language
and one small step at a time. Enable `ORIGEN_LOCAL_LASTING_PREFERENCES=true` along
with the two support flags below. A preference lasts within this call and selected
student/language; it is not saved as a cross-call profile preference. One-off
requests, inferred needs, and uncertain classifications do not create preferences.

Unlike a one-time support cue, a validated preference can remain useful after
Origen has already answered. The local gate waits for a completed-thought estimate,
fresh browser playback idle, and a quiet interval. It never delays normal replies
or asks for a new spoken announcement. Exact-zero reflected PCM frames do not count
as speaking; real or unknown audio restarts the quiet interval. A new transcript
fragment invalidates the thought estimate. These are application safeguards, not a
provider guarantee of a perfect conversational boundary.

Corrections supersede the current preference snapshot. New caller speech requires
revalidation; student/language changes reset scope. Intro/selection, active research,
delegations, pending context, stale playback and disconnects prevent delivery.
Unconfirmed sends are logged without retrying. Research classifications remain
observe-only. The normal production controller and prompts remain unchanged.

See [preference results](PREFERENCE_RESULTS.md), [the fresh whole-library review](PREFERENCE_GUIDANCE_REVIEW.md),
and [API contract review](PREFERENCE_CONTRACT_REVIEW.md). This new review covers all
110 current manifest entries across the three libraries, using the user's approved
unique-content deduplication. Older review and experiment results below are retained
as history.

The current local experiment adds opt-in conversational support to Phase 3A.
See [support results](SUPPORT_RESULTS.md) and the [contract review](SUPPORT_REVIEW.md).
Observe-only remains the default. Support is available only through this isolated
launcher, with `ORIGEN_LOCAL_DECISIONS_APPROVED=true` and
`ORIGEN_LOCAL_CONVERSATION_SUPPORT=true`. It is not enabled in the normal app.

`createObservedLocalSession(options, lab)` wraps the existing `voiceControlSession`
for an explicitly allowlisted local call. [The isolated launcher](LAUNCH.md)
connects it to the app for microphone testing. The normal app does not import
the lab; two dependency-injection hooks opt into the wrapper locally only.
Production rejects custom factories. Intro, prompts, audio, research and brief
delivery behavior use the existing controller.

The local constructor requires `localOnly:true`, an explicit data origin, a
seed matching the call/student scope, and `allowedCallIds`. Fictional fixtures
use `fictional:true`. The authorized account copy uses `fictional:false`,
`isolatedLocal:true`, and `dataKind:'isolated-copy'`; the launcher verifies the
loopback database, account and student allowlist. Production mode is rejected.
Supply the same provider, config, emit and jobRequest options as the
existing controller; call its usual start/receive/playback/flush/close methods.
The extra `observation.ready`, `observation.closed` and `observation.status()`
properties belong to the test operator, never the call's startup path.

Copies of selected events go to a separate Node worker thread. The observer
has no provider socket, sender, speech callback or tool executor. Selected
transcript/interval/identifier/playback fields and bounded research evidence
are copied; audio, credentials, full tool arguments and configuration are
excluded. The worker has an empty inherited
environment and opens only the explicit local files it needs. Queue overload or
oversized packets stop observation, invalidate current scope and expose a gap;
they stop observation without awaiting it in the voice path. Worker boot,
transport and exit failures leave the original voice controller usable.
Same-student configuration updates continue observation. An allowlisted student
change suspends classification during the change and clears prior student
context before resuming; unknown scope stops observation.

Classification defaults off. `paid:true` with an explicit test API key enables
Decisions using twelve evaluations maximum per observe-only call, one in flight
and newest pending snapshot only. That original mode retains its existing $5
ledger. The separately authorized support experiment has a new $1.50 Decisions
ledger, 32 evaluations per call, and a 200-request ceiling. The other $1.50 of
the new $3 authorization is reserved separately for automated voice validation.
Unknown request outcomes remain reserved; reopening cannot reset either cap.

With support enabled, the worker can return only a typed starting-point,
simpler-explanation, or next-step candidate. It never receives a provider writer.
A separate local gate may send one fixed, short English or Spanish
`session.thinking.append` through the existing provider connection. It sends no
commentary, speech command, research action, generated advice, or student data.
The original reply never waits for Decisions. Late, uncertain, already-addressed,
wrong-scope, overlapping, or duplicate candidates are dropped, not queued.

Support waits for the initial introduction to finish. After a later student
selection, it also waits for the existing selection receipt, a new assistant
transcript boundary, and fresh browser-idle evidence. A quick acknowledgment or
context-delivery acknowledgment alone cannot unlock it. Missing receipt, unknown
playback, pending context, active delegation, or active research keeps support
off. At most two cues can be sent per call, at least 30 seconds apart. Every send,
skip, acknowledgment, rejection, and unconfirmed delivery is logged separately
from transcript and playback evidence. An unconfirmed cue is never retried.

The worker now uses the broader observation policy. A one-way tap copies only
responses that the existing research owner already fetched; it does not start
requests, poll, cancel, delay the returned promise or modify results. Repeated
polls are deduplicated, older evidence versions and old student scopes are
rejected, and oversized evidence is explicitly unavailable. Research arriving
mid-utterance is captured immediately but classification waits for the next
estimated transcript boundary. Job completion and speech/playback remain
separate records.

Research findings preserve answer, year/scenario when present, subject, aspect,
local and shared qualifications, and source IDs. The observer can also assess
scope stated in the answer or qualification text. It cannot infer a missing
figure, independently verify a source, or conclude that a result was heard.
See [broad observation results](../BROAD_OBSERVATION_RESULTS.md).

The earlier separate $2 approval still covers only `broad-cli.mjs` fictional
observation tests. It is not reused by the new support experiment.

Native transcript intervals remain provisional. Existing application grouped
transcripts supply a separate estimated boundary for classification. Their
timestamps record receipt; they do not replace provider interval times or prove
turn completion. Browser playback is separate and never proves the person heard
or understood the answer. Source text and classifications are preserved in
ignored local JSONL files under `research/decisions/.local/<fictional-call>.jsonl`.
These traces persist until deliberately removed; microphone traces from the
authorized account copy can contain real transcript excerpts.

## Verification

```powershell
node --test research/decisions/*.test.mjs research/decisions/local-call/*.test.mjs
node research/decisions/verify-isolation.mjs
```

The EN/ES paired controller replays compare baseline and observed provider
commands and emitted event sequences, including the greeting and ordinary reply.
Other checks cover partial spans, repeated boundaries, scope invalidation,
queue saturation and evidence separation. Existing controller regressions are
also run. These are synthetic transcript replays through the actual controller,
not recorded microphone conversations or a listening evaluation.

For explicitly paid fictional Decisions validation only, set the dedicated
`ORIGEN_DECISIONS_TEST_KEY` and run:

```powershell
node research/decisions/local-call/validate.mjs --real-decisions
```

The test feeds fictional English and Spanish transcripts through the actual
controller with a fake voice provider and real Decisions. It checks observations
before and after a substantive assistant answer. It makes zero voice API calls.

The local microphone launcher now constructs this wrapper through the
authenticated server control path. It uses a separate database cloned from the
existing November 4 account copy and upgraded locally. The original copy and
production records remain unchanged. Automated voice tests still need a voice
test budget; the operator can test with their microphone. Naturalness has not
been rated from audio in these observer checks.

## Guidance and review record

The existing all-page review from phases 1–2 covers all 45 Responses, 30 Decisions
and 35 conversation-state manifest pages. This phase reread the three saved
references, checked every snapshot against its manifest and rechecked relevant
transcript, delegation and state contracts against the implementation. All
content hashes match (Responses requires normalization of Windows newlines).
No documents were unavailable. This is review reuse with focused rechecks,
not a claim of another literal full-library reread.

Current official [voice Decisions guidance](https://developers.openai.com/api/docs/guides/decisions-voice)
and [Live conversation guidance](https://developers.openai.com/api/docs/guides/live-conversations)
were checked. Native trigger configuration would change the session, so this
phase uses independent standalone classification. Transcript fragments and
out-of-order results require explicit source evidence and stale-result checks.
Phase 3A introduced no append event or provider continuation. The new optional
support gate adds only the bounded quiet append described above. Research
classifications remain observation-only; the established research worker still
runs normally when the original conversation requests it.

## Prior Phase 3A replay results

**117 automated tests passed**, including the 60 prior observer tests, five new
local observation checks and the existing voice-control regression suite.
The final isolation check again matched all 3,163 protected existing files.
Additional estimated Decisions cost was **$0.0003651**. The shared ledger totals
$0.0031018 estimated usage plus $0.15 held for earlier unknown outcomes, leaving
$4.8468982 unreserved under the original $5 cap.

The four completed EN/ES worker-validation observations correctly recognized
the explicit starting-point request, then recognized that the transcript had
addressed it. Durations: EN 650/225 ms; ES 295/262 ms. One earlier EN observation
also succeeded at 579 ms; its replay timed out awaiting an assistant boundary
because the test flushed before the existing async event adapter had processed
the output delta. The replay was corrected and retested; live code was untouched.
No provider failure occurred in that attempt.

Detailed timings and cost are in `validation-summary.json`. These observations
demonstrate the worker path, not an improvement in spoken naturalness. No cues,
commits, pushes, deployment or production changes were made.

## Microphone hookup review

[REVIEW_MICROPHONE.md](REVIEW_MICROPHONE.md) records manifest verification,
reused whole-library coverage, focused full rereads, current official contract
checks and the independent implementation audit. No library document was missing.
The completed hookup tests and local readiness checks are recorded in
[MICROPHONE_RESULTS.md](MICROPHONE_RESULTS.md). The original results above describe
the earlier replay, not a new live audio test.
