# Confusion and conversational continuation — isolated v1.3

Implemented and validated November 7–8, 2026. Branch: `v1.3-decisions-integration`.
No commit, push, deployment, production data access, migration, or production
configuration change was made. The new behavior is default-off, available only
through the explicitly enabled isolated wrapper. The microphone app was not
restarted by this task.

## What changed

| Before | Now | Practical benefit and limit |
| --- | --- | --- |
| A caller's temporary confusion could be treated as a one-time cue or an ongoing style preference. | Two separate classifications recognize current confusion and acceptance of a concrete conversational offer. Confusion is temporary and scoped to this caller, student, language, and topic. | Supports a simpler next explanation without permanently labeling the student or inferring needs from their language/background. |
| A short “yes” could leave Origen acknowledging again instead of delivering its offered explanation. | A current accepted explanation may receive one bounded recovery direction after a safe gap, if no substantive answer has started. | Can recover an unanswered example/explanation. It does not authorize research, saving, applying, or any external action. It is conservative and will miss some phrasings. |
| An optional quiet note could arrive after an answer, prompting another unsolicited voice turn. | Confusion notes are only eligible before the current ordinary answer begins; late notes remain local and require a fresh classification on a later caller turn. | Protects fast native replies and the intro. A fast model can leave every optional confusion note unsent. |
| A finished job with incomplete evidence could sound as though it was still running. | Existing local terminal research-state packets explicitly distinguish an ended check from missing/unverified information. | Clarifies what is finished without inventing results, adding an announcement, rerunning research, or altering source/fact packets. Model use still needs a fresh research call. |
| Assistant boundaries and unchanged polling consumed the per-call Decisions allowance. | All snapshots remain logged; only meaningful caller/research changes qualify for inference. Four of the existing 32 slots are reserved for research. | Preserves later capacity without raising the per-call cap or putting Decisions on the voice response path. |
| API completion could be mistaken for successful help. | Correlated logs distinguish classification, gating, delivery attempt, provider acknowledgment, transcript output, and browser audio evidence. | Shows why support was sent, withheld, stale, redundant, or uncertain. No private model reasoning is logged. |

## Library review and guidance applied

All **110 manifest entries** were covered twice: 45 Responses, 30 Decisions,
and 35 conversation-state entries. Following the user's approved unique-content
method, 57 guide entries were reviewed as 37 distinct complete snapshots, and
53 generated-reference entries as 8,641 unique contract lines. Differences and
code examples were included. The three saved reference documents, local audit,
measurement and diagnostics documents were also reviewed twice. The relevant
contracts were checked again against implementation and observed call evidence.

Current verification covered all 40 unique non-guide official URLs and 37 guide
URLs. Eight old `/docs/...` reference links returned 404; their current
`/api/docs/...` equivalents were read, including `images-vision` for the old
`images` path. Three older saved guides had newer variants elsewhere in the
libraries; both variants were covered. No saved manifest content was missing.
This is complete coverage of the explicit reference/manifest documentation,
not a recursive crawl of every link on the OpenAI website.

- [Decisions guidance](https://developers.openai.com/api/docs/guides/decisions)
  shaped independent, typed questions with separate confidence/probability
  checks. Classification is evidence, not authorization.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
  distinguishes quiet facts, speech suggestions, and interrupting instructions.
  The tests confirmed that a thinking append is not a guarantee of silence.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations)
  shaped caller/scope freshness and the separation of transcript estimates from
  playback. Provider receipt is not proof that an answer was heard.
- [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)
  support observing through the existing sideband while leaving microphone
  media and the normal conversation under their existing owners.
- [Latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization)
  supports removing redundant requests and measuring each stage rather than
  blocking native speech for an optional classification.

Review evidence: [guides](LOCAL_REVIEW_GUIDES.md),
[contracts](CONTINUATION_CONTRACT_REVIEW.md), and
[trigger review](../LOCAL_REVIEW_TRIGGERS.md). Documentation was not injected
into the model context.

## Regression and classifier results

**349 automated tests passed**, with zero failures or skips in the final serial
run. This includes bilingual delivery/integration cases, partial and repeated
acknowledgments, changed questions, genuine interruptions, intro/selection
fences, stale or missing playback, native answers winning the race, scope and
language changes, malformed/uncertain classifications, terminal research packet
preservation, durable logging and budgets, and the existing server voice tests.

An earlier parallel run encountered an existing WebSocket test timing race;
its targeted retry and the final serial suite passed. No production code/test
was changed to conceal it. Final log:
`research/decisions/.local/continuation-verified-tests.log`.

| Real Decisions test | Result | Timing |
| --- | --- | --- |
| Initial 32 bilingual cases | 31/32 passed | Median 186 ms |
| Revised explicit-offer policy, all 32 rerun | 32/32 passed | Median 251 ms; p95 573 ms |
| Final policy 3 targeted set | 10/10 raw labels correct; 8/10 met delivery thresholds | Median 298 ms; p95 745 ms |

The final policy adds narrowly grouped adjacent affirmative fragments. Its
English and Spanish repeated-acknowledgment cases selected the correct label
but did not meet the unchanged confidence gate. They therefore could not
trigger recovery. The full 32/32 result belongs to policy 2, not a full rerun
of policy 3. These are authored tests, not an independent holdout.
See [full classifier findings](CONTINUATION_CLASSIFIER_VALIDATION.md).

## Real voice findings

The harness uses real WebRTC audio, the existing application session builder,
the local sideband wrapper, real Decisions requests, and fictional caller
audio. It does not access a student database or execute official-source research.
The same startup configuration hashes were retained in English and Spanish.
The fixture starts with a confirmed student; selection/brief intro behavior is
covered by existing regression tests, not a fresh full onboarding microphone call.

Early five-question calls completed in both languages, but exposed a problem:
post-answer quiet confusion notes were followed by an extra unsolicited voice
turn. Changing the wording to “future replies” did not reliably prevent it.
The final implementation therefore prevents those late appends, rather than
relying on a prompt to make them silent.

In the final English five-question call, the intro began in **0.93 seconds**;
first reply audio ranged from **0.93 to 1.63 seconds**, median **1.57 seconds**.
Origen simplified the explanation, asked the requested offer, delivered the
accepted example, and followed the changed question. No support append or
research attempt occurred, and no API/browser error was recorded.

In the first final Spanish call, the intro began in **0.78 seconds**, and the
first two replies began in **0.87 and 1.66 seconds**. The second answer continued
for over 30 seconds and the test's answer deadline ended it. This was a harness
cutoff, not a silence, a Decisions injection, or a provider-reported failure.
It also exposes an unresolved tendency to overexplain when the caller is confused.

The remaining three Spanish steps were completed in a separate final call,
with an 85-second total hard limit and 45-second answer limit. Its intro began
in **1.02 seconds**; offer, accepted example, and changed-topic replies began
in **1.67, 1.38, and 1.78 seconds**. There were no recorded errors, support
appends, or research attempts. Thus all five scenario steps were exercised
in Spanish across two final calls; the second confusion answer was observed
but cut off by the original test limit. This is not a single uninterrupted
five-question Spanish pass on the final code.

Two completion attempts failed during connection setup. A subsequent no-charge
probe identified a local `EACCES` network restriction; the run with approved
network access completed. The original failed attempts did not retain their
nested transport error, so that diagnosis is an inference for those attempts.
Their complete cost reservations remain held rather than assumed free.

All twelve recorded runtime-source hashes matched the final files for both
final reports. Startup session configuration hashes also matched the earlier
English/Spanish runs. Private evidence files:

- `.local/continuation-live-validation.json`: earlier five-question calls.
- `.local/continuation-live-smoke.json`: preliminary wording-only retest;
  delivery code changed during that test, so it is not exact-final evidence.
- `.local/continuation-live-refinement.json`: final English and first Spanish call.
- `.local/continuation-live-spanish-completion.json`: remaining Spanish steps.
- `.local/continuation-final-proof.json`: final hashes, ledgers, and compact findings.

The English trace explains why all optional notes stayed unsent: the existing
adapter waited about 1.1 seconds to finalize caller text, then Decisions added
0.27–1.20 seconds. Native speech had already begun on every turn. The pre-answer
gate is reachable when native speech starts later, but this run demonstrates
preserved flow, **not a measured improvement caused by Decisions**.

## Earlier-call replay and retained diagnostics

The read-only local replay of call `e66ef13f-11db-43eb-b71c-450d0c1ce910`
retained all **45 snapshots**. It identified **26 inference-eligible snapshots**:
24 caller contributions and two research updates; 19 assistant-only snapshots
remained logged without paid inference. The earlier path spent its 32-request
allowance and skipped 13 later checks. The replay does not change that recorded
call or prove how a new call would sound.

The initial bilingual live audit found 16 caller snapshots yielding 16 API
requests, and 23 assistant-only snapshots yielding no requests. Queue waiting
was around 0.7–1.3 ms median, at most 6.4 ms. Waiting for the observation worker
was not the bottleneck in those calls.

Logs remain append-only local JSONL files. Relevant event meanings and join
keys are documented in [Decisions diagnostics](DECISIONS_DIAGNOSTICS.md).
The application does not expire or truncate these files; ordinary filesystem
loss is still possible, so this is not a backup guarantee.

## Approved $3 validation budget

| Component | Accounted cost | Unresolved reservation retained |
| --- | ---: | ---: |
| Real Decisions requests, both immutable ledgers | $0.0527733 | $0 |
| Successful voice sessions with reported usage | $0.5383333 | $0 |
| Fictional TTS audio, no returned usage | Not settled | $0.10 |
| Two failed voice setup attempts, unknown provider outcome | Not settled | $1.50 |
| **Total** | **$0.5911066** | **$1.60** |

Accounted cost plus all unresolved reservations is **$2.1911066**, within the
approved **$3**. TTS's character-based estimate is about $0.00906, but its full
reservation remains held. This is conservative local accounting, not a claim
to have verified the provider's invoice.

The original 80-request Decisions ledger is exhausted with all requests settled.
The guarded refinement allocation used $0.10 from the remaining original
approval and is also exhausted at 20 requests; no ledger was reset. Voice
retained its $2.50 ceiling, including failed-setup reservations. The shortened
Spanish completion run used the same conservative per-second reservation rate.
No new paid tests should be started by silently resetting these request limits.

## What remains before claiming a conversational improvement

- Human microphone/listening validation of warmth and natural timing. Audio
  RMS establishes sound activity, not intelligibility, comfort, or a useful answer.
- A real stalled accepted-offer call. The automated voice model answered the
  simple acceptance natively; actual recovery delivery is covered offline.
- A fresh real research call confirming that ended/partial state produces the
  intended spoken behavior. Serializer/replay tests establish the metadata fix,
  not that the model used it correctly.
- Broader holdout phrasing, especially rapid fragmented acknowledgments. Keep
  conservative thresholds until there is evidence to change them.
- The 1.1-second transcript grouping delay makes many confusion classifications
  too late for the current answer. No new delay, speculative trigger, or change
  to native turn-taking was introduced to hide that limitation.

The final protected-runtime check matched **3,163 files**, including the same
two previously reviewed local dependency-injection hooks; 3,161 other runtime
files remained identical to the isolation baseline. Production prompts, intro,
voice selection, call indicator, routing, and deployment settings were untouched.

Local controls and budget availability are described in [launch instructions](LAUNCH.md).
Do not treat this report as production enablement or as a guarantee of silence,
perfect boundaries, or 100% natural conversation.
