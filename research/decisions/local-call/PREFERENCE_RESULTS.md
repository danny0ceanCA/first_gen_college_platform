# Lasting preferences and quiet delivery on v1.3

Implemented November 7, 2026, on `v1.3-decisions-integration`, using isolated local
data. No commit, push, deployment, production database change, or new production
runtime dependency was made.

## What changed

| Before | Now | Benefit |
| --- | --- | --- |
| One-time support was discarded when Origen started answering. | Explicit ongoing requests for plain language or one small step at a time remain valid after that answer. | Later replies can use the preference without waiting for Decisions. |
| Any audio frame could leave support permanently marked as speaking. | Exact-zero reflected PCM is distinguished from real/unknown audio, and browser playback is checked separately. | Silent transport frames no longer prevent a quiet update. |
| Only immediate support candidates could be delivered. | A bounded preference snapshot waits for a completed-thought estimate and sustained fresh playback idle. | No forced speaking turn, interrupted answer, or hold on the caller's response. |
| A stale observation could hide a still-valid caller preference. | Preference provenance is checked independently against the latest complete caller turn, student and scope revision. | Assistant speech alone does not discard an ongoing request; newer caller speech still invalidates it. |
| Preference changes had no dedicated delivery trail. | Typed classifications, API timing/cost, eligibility, deferral, delivery and acknowledgment have correlated persistent logs. | A later call can be diagnosed without treating a transcript or acknowledgment as proof of playback. |

Preferences are **in-call state**, scoped to the selected student and language.
They are not saved to a student's profile or carried into another call. Explicit
withdrawal sends a newer snapshot; it does not claim to erase earlier Live context.
One-off requests, quotes, third-person statements, unsupported preference types,
malformed results and uncertainty do not create preferences. Both classification
dimensions must pass the existing 0.90 selected-probability and 0.85 confidence
thresholds before a snapshot is accepted.

The initial introduction, selected voice, live prompts, brief preparation, normal
research workflow and steady call indicator are preserved. Decisions research
observations remain non-actionable. Existing research can still run normally.

## Guidance applied

The fresh review covered all 110 manifest entries: 45 Responses, 30 Decisions,
and 35 conversation-state pages, plus all three saved references. Unique content
and differing snapshots were reviewed under the user's approved deduplication.
Relevant current official guidance was checked. See the [guide review](PREFERENCE_GUIDANCE_REVIEW.md)
and [contract review](PREFERENCE_CONTRACT_REVIEW.md) for the checklist and limits.

The implementation uses a short `session.thinking.append` with a unique event ID
and `delegation_id: null`. It uses no speech-triggering commentary, forced response,
or prompt replacement. Because quiet appends can cancel pending automatic
acknowledgments, delivery waits while selection, research, delegations or other
context is pending. Transcript punctuation/grouping is treated as an estimate;
fresh browser idle and a quiet interval are also required. Unconfirmed sends are
not retried automatically. These timing rules are application safeguards, not an
OpenAI guarantee of naturalness.

## Verification

The final combined observer/controller regression suite passed **267 tests**, including
the additional diagnostics tests. The isolation audit matched all 3,163
protected files against the recorded baseline, including the two previously
reviewed local dependency-injection hooks; the other 3,161 runtime files were unchanged.

The final real Decisions classifier run used 32 fictional English/Spanish cases.
All 64 raw action labels matched the expected actions. Applying the actual
whole-snapshot eligibility gate gives **31/32 expected outcomes**: 15/16 English,
16/16 Spanish, with no false activation. One English withdrawal was withheld
because the unrelated unchanged preference had insufficient confidence. The
thresholds were kept conservative. These authored cases were used to refine the
rubric and are not an independent holdout benchmark.

The real audio tests found and then verified the silent-frame timing fix:

| Final live measurement | English | Spanish |
| --- | ---: | ---: |
| First intro audio | 0.897 s | 0.831 s |
| Ordinary essay reply after caller finishes | 1.277 s | 1.607 s |
| Preference enable / withdrawal snapshots acknowledged | 2/2 | 2/2 |
| Extra audible samples after quiet update before next caller/end | 0 | 0 |

Across the six replies, first audio arrived in 0.908–1.607 seconds. Startup
configuration matched the previous focused-support calls. The model's normal
answer never waited for classification. See the [full live report](PREFERENCE_LIVE_VALIDATION.md)
for initial failed-path evidence, audio timings, costs and limitations.

Human microphone testing remains necessary to judge warmth and naturalness during
unscripted interruptions and longer conversations. These tests prove actual quiet
delivery and withdrawal, not that Decisions caused an improvement: the live model
also heard the caller's request directly. Real research was not exercised in these
paid calls; regression tests cover its isolation and delivery fences.

## Detailed local diagnostics

Call files append to `research/decisions/.local/<call-id>.jsonl` and have no automatic
expiry or truncation. Worker run ID, sequence, UTC and monotonic times distinguish
restarts and receipt timing. API lifecycle rows retain call/student/snapshot/turn,
operation, request and reservation identifiers; rubric version; queue/build/API/
parse durations; usage and cost; outcome; and candidate disposition.

Preference delivery records retain typed actions and scores, confidence thresholds,
source revision, pending duration, changing deferral reasons, intro/research/context
fences, transcript-boundary age, browser-idle evidence, send attempt and provider
acknowledgment or uncertainty. A late acknowledgment retains its original student
and language even if selection has since changed. Repeated identical deferral
states do not flood the file.

The added API lifecycle records exclude credentials, request/response bodies,
generated explanations and private reasoning. Existing isolated transcript-evidence
records remain separate and can contain the authorized test call's words. Provider
acknowledgment, audio activity, intelligibility and useful conversational behavior
remain distinct claims.

The expanded lifecycle logging was added after the final paid voice pair and is
verified separately with regression tests and a controlled real Decisions request
(10/10 checks; $0.0004235). Two actual local worker starts also verified append-only
retention, unique run IDs and contiguous per-run sequence numbers without API calls.
See [the diagnostic event guide](DECISIONS_DIAGNOSTICS.md).
Its additional fields should be inspected on the next microphone call.

## Local use

See [launcher instructions](LAUNCH.md). Enable the approved Decisions and local
support flags plus `ORIGEN_LOCAL_LASTING_PREFERENCES=true`. This is available only
through the isolated launcher. Refresh the local browser and start a new call to
load it. Try: “For our conversation, please use everyday words and one small step
at a time.” Ask an ordinary college question, then withdraw the preference. The
next diagnostic file should show enable, quiet delivery, no unchanged resend,
withdrawal and its acknowledgment, with separate browser playback evidence.

The isolated app was refreshed with all three flags enabled and its research
worker ready. Its health endpoint confirmed the local database and zero production
writes. Shared Decisions usage after validation was $0.0662237 across 161 requests;
the fixed 200-request ceiling and $1.50 Decisions allocation remain unchanged.
Voice tests and conservatively held TTS reservations stay within their separate
$1.50 allocation. Nothing was committed, pushed or deployed.
