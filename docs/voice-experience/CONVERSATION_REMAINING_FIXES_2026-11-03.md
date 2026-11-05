# Conversation follow-up fixes and bilingual validation

Date: November 3, 2026 (America/Los_Angeles)  
Branch: `Origen-Development`  
Delivery: local, uncommitted changes; no push or deployment.

## Outcome

The save/reconnect failure and missing essay-teaching switch pass fresh English and Spanish voice tests. The unnecessary application wait before tool continuation has been removed. **Tool-backed latency is improved in some comparisons, but is not fully resolved:** the final Spanish essay transition still took about 11 seconds to begin its substantive answer.

The final tests used fictional parent/student records in separate, isolated PostgreSQL schemas, the real `ProfileVoice` component in Chrome, real WebRTC audio, GPT-Live-1, and the configured GPT-6-Luna backend. Production records were not read or changed for these tests.

## Changes

### 1. Save a next step and stay in the conversation

- A successful next-step write now returns a verified receipt without requesting reconnection. The client refreshes the current scoped context in place, updates its known memory revision, and continues the same call.
- The writing voice instance does not mistake its own memory notification for an external change. Other consumers still receive the notification.
- Existing reconnect behavior for edits/deletions remains, so obsolete information is still discarded. A failed in-place refresh retains the safe recovery path.
- Next-step proposals now supply an exact readback. The existing consent checks remain intact: a partial, interrupted, or mismatched readback does not authorize a save.
- Live testing also exposed a Spanish pause-boundary failure. The adapter had registered the final word of a request as a new, standalone turn. It now carries the complete phrase across a brief pause, under a **new** turn identity that fences earlier tool work. It never stitches across an assistant reply or a longer silence.

Primary implementation: `src/ProfileVoice.tsx`, `server/live-memory.mjs`, `src/studentLiveChannel.mjs`.

### 2. Load the relevant teaching when the topic changes

- A genuine specialty change now switches the acknowledged guide before substantive advice, allowing the server to supply the matching teaching, tone, and conversational approach.
- Ordinary follow-ups within the same specialty do not need another guide change.
- The topic controller waits for the update and prevents stale work from restoring an earlier topic.

In both final calls, the essay switch supplied the fictional essay teaching and its warm, unhurried style. The resulting answers discussed ordinary experiences and personal growth; each subsequent request for one gentle question received one question. This demonstrates delivery and observed application in these samples, not a guarantee of perfect adherence in every conversation.

Primary implementation: `src/ProfileVoice.tsx`, `server/live-delegation-policy.mjs`, `server/profile-voice.mjs`.

### 3. Remove avoidable waiting without breaking the provider protocol

- Live backend continuation can begin while a brief acknowledgment is playing. It still waits for unresolved tool work, backend holds, and incoming user speech/transcription. New user turns cannot inherit the bypass.
- Realtime retains its existing playback ordering.
- Backend responses use low verbosity. Instructions encourage concise tool conclusions, combined necessary recall/highlight work, and no repeated greeting or save.
- The required function-output → backend-response continuation remains intact. An earlier experimental shortcut stalled real calls and was discarded.

Primary implementation: `src/voiceTurns.mjs`, `src/studentLiveChannel.mjs`, `server/student-live-session.mjs`, `server/profile-voice.mjs`.

The transport follows the [OpenAI Live delegation documentation](https://developers.openai.com/api/docs/guides/live-delegation). A tool result must be followed by the appropriate backend continuation; directly prompting speech does not replace completion of that workflow.

## Final validation

Each language started from a fresh fixture and completed seven turns:

1. Select Aiden in a parent account with two students.
2. Retrieve an older campus-visit record outside the initial context slice.
3. Request a next step.
4. Confirm its readback.
5. Ask what was saved, explicitly prohibiting another save.
6. Switch to essay support.
7. Request one gentle follow-up question.

| Check | English | Spanish |
| --- | --- | --- |
| Completed turns | 7 | 7 |
| Committed next steps | Exactly 1 | Exactly 1 |
| Provider sessions | Exactly 1 | Exactly 1 |
| Save receipt requests reconnect | No | No |
| Repeated identity question after save | No | No |
| Historical visit recalled, without treating it as a decision | Yes | Yes |
| Essay explanation, tone, and approach delivered | Yes | Yes |
| Recorded output audio and transcript | Yes | Yes |
| Harness failure or client error | None | None |

### Response timing

Approximate seconds from the end of the synthetic caller audio to the first transcript delta of the substantive answer. Brief acknowledgments are excluded where separated from the answer. These are individual local test observations, **not** production percentiles or exact speaker-output latency measurements.

| Interaction | Final English | Final Spanish |
| --- | ---: | ---: |
| Older-history answer | 5.91 | 5.85 |
| Confirmed-save acknowledgment | 6.83 | 5.79 |
| “What did we save?” | 0.68 | 1.07 |
| Essay answer following guide change | 7.58 | 10.98 |
| One gentle follow-up question | 1.55 | 1.59 |

The earlier English comparison took 12.06 seconds for the older-history answer and 11.74 seconds for the essay answer. However, Spanish timings varied, and its final essay response was slower than an earlier 9.80-second sample. The changes remove specific application delays; they do not establish consistently fast end-to-end tool answers. Guide changes still involve backend selection, a context update, and continuation. Production latency needs separate observation.

### Local checks

132 focused checks passed across turn scheduling, adapter behavior, stale work, save consent, memory writes, topic changes, delegation, scope, and prompt budgets. The final production build passed; its existing bundle-size warnings remain. `git diff --check` passed.

## Budget and limitations

- Whole approved campaign, including earlier tests and failed attempts: **$3.6244 observed usage estimate**.
- Conservative cumulative accounting, retaining reservations for incomplete earlier usage: **$5.4584 of the $7 cap**.
- Remaining conservative headroom: **$1.5416**. No further paid calls were needed after final verification.
- The final two calls cost approximately **$0.2928 combined**. Prices use the application's October 28 rate card; these are estimates, not a provider invoice.
- The fixture deliberately does not implement conversation-summary persistence. This validation proves the requested next-step writes and context/teaching behavior, not the full production end-of-call summary workflow.
- No claim is made that delivery of a teaching proves perfect empathy, that all remaining latency is fixed, or that these samples establish universal conversational reliability.

## Local evidence

These artifacts are ignored local test outputs, not files intended for source control:

- `tmp/exhaustive-remaining-pause-en/report.json` — final English protocol events, requests, transcript, state, and usage.
- `tmp/exhaustive-remaining-pause-es/report.json` — final Spanish evidence.
- `tmp/exhaustive-remaining-pause-en/en-output.webm` and `tmp/exhaustive-remaining-pause-es/es-output.webm` — recorded output audio.
- `tmp/remaining-fixes-comparison.json` — transcripts and timing comparisons, including intermediate failures.
- `tmp/verify-remaining-fixes.py` — final state/session/teaching/audio assertions.
- `tmp/exhaustive-cap7-results.json` and `tmp/exhaustive-cap7-budget.json` — reconciled usage and retained reservations.
- `tmp/remaining-fixes-final-unit.log`, `tmp/remaining-fixes-prompt-tests.log`, `tmp/remaining-fixes-final-db-tests.log`, `tmp/remaining-fixes-fragment-tests.log`, and `tmp/remaining-fixes-final-build.log` — local verification logs.
