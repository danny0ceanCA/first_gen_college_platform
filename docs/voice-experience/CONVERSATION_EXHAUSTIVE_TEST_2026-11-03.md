# Conversation and retrieval validation — November 3, 2026

## Assessment

The development changes support useful conversation from supplied context, explicit retrieval of older history, and student choice around coordinator suggestions. They are **not yet ready for a broad production release**. Saving can interrupt conversational continuity, topic changes do not reliably supply the appropriate teaching, and some useful answers still arrive noticeably later than their acknowledgments.

This campaign exercised the real browser voice component, GPT-Live-1 audio, delegated backend responses, application tool handlers, and an isolated PostgreSQL fixture. It did not use Daniel's actual account data or write to production. All changes remain uncommitted on Origen-Development; nothing was pushed or deployed.

## Coverage and evidence

Twelve English/Spanish conversation runs attempted 78 scripted user turns. The driver completed 77 turn waits; one timed out after a successful database save caused a provider-session replacement. There were 17 provider sessions, including reconnects. Completing a test-driver wait is **not** a behavioral pass.

| Scenario | Languages / turns | What was exercised | Result |
| --- | --- | --- | --- |
| History | EN + ES / 16 | Profile recall, simpler explanation, unknown meeting, spoken correction without saving, changing students | Correct fictional school/interests; options remained distinct from decisions; switched to Elodie's record. Some awkward selection language remained. |
| Support | EN + ES / 14 | Overwhelm, one counselor question, essay discouragement, fictional example, interruption, future deadline | Supportive wording and shorter follow-ups observed. English failed research did not invent a deadline. Spanish asked about the entry term and did not reach the equivalent failed research call. Essay-specific teaching was not supplied on the topic switch. |
| Coordinator guidance | EN + ES / 12 | Recall an actual fixture publication and coordinator suggestion, decline it, change focus, ask about sharing/private family notes, ask about completion | Suggestions stayed optional; private family notes were not disclosed; no accepted/completed step was invented or written. One Spanish completion question was transcribed as a statement, limiting that particular check. |
| Initial recovery | EN + ES / 14 | Old campus visit outside the opening brief, injected read failure, explicit retry, identity continuity, suggest versus save | Old visit was retrieved on retry. English exposed a confirmation parser bug. The original driver's turn timing confounded part of the Spanish sequence. |
| Save retest | EN + ES / 8 attempted, 7 completed waits | Explicit save followed by a natural confirmation | English persisted the step, then restarted with a greeting; driver timed out on an outstanding tool from the retired session. Spanish initially declined a save request, then asked for confirmation on the next turn. That particular misclassification was not reproduced in the final run and its cause is unresolved. |
| Recovery and save rerun | EN + ES / 14 | Corrected driver timing, failed lookup, explicit retry, no-save request, save/readback/confirmation | Both languages retrieved the old visit and persisted the confirmed next step. Both then gave a fresh greeting rather than maintaining conversational continuity. |

The fixture included a parent and two students, 35 newer summaries ahead of an older campus visit, uncertain college preferences, unpublished/private-note sentinels, and separate published teaching and coordinator-guidance records. The parent and student scenarios used their respective application roles. English and Spanish within a scenario shared its fixture; saved-state assertions therefore inspect titles and changes, not merely total row counts.

Full provider transcripts: `tmp/exhaustive-cap7-transcripts.md`. Per-run requests, tool calls, sent messages, diagnostics, saved-state snapshots and provider events are in `tmp/exhaustive-<scenario>/report.json`. Generated audio was received and recorded, but I did not independently listen to all recordings or rate vocal warmth/prosody. Empathy observations below concern transcript wording.

## Fixed and verified locally

The guarded save path rejected “Yes, save that next step” after presenting the exact proposed step. Its confirmation recognizer accepted shorter replies such as “yes, save that,” but not the explicit named-step form.

Changes in `server/live-memory-intent.mjs` and `server/live-memory.mjs` accept narrowly defined English and Spanish next-step confirmations **only for next-step proposals**. The existing exact proposal hash, presentation requirement, adjacent-turn requirement, account/session checks and expiry remain in force. Questions, extra clauses and negations do not gain permission to write.

All **16 focused tests** in `server/live-memory.test.mjs` passed, including database persistence and consent guards. The final live rerun then saved:

- “Ask my counselor about environmental studies transfer options.”
- “Preguntarle a mi consejero sobre las opciones de transferencia en estudios ambientales.”

These were recorded as active plans, not completed actions. Test log: `tmp/exhaustive-confirmation-tests.log`.

## Remaining issues, in priority order

### 1. Successful save breaks the ongoing conversation

After confirmation, the next step is actually in the database, but Origen starts again:

> Hi Morgan! What's on your mind about Aiden right now?

The Spanish rerun similarly said:

> Hola Morgan. Me alegra que hablemos hoy de Aiden. ¿Qué te gustaría conversar primero?

The `onSaved` callback in `src/ProfileVoice.tsx` clears current turns and ends/restarts the call before `src/voiceMemoryTools.mjs` returns the tool result. The retired channel therefore cannot deliver its normal saved-result acknowledgment. The new session receives refreshed context but does not preserve the immediate conversational exchange. Existing “do not greet again” instructions did not prevent the observed restart greeting.

Next change: preserve a verified save receipt and the minimal current exchange through the refresh, deliver the acknowledgment in a defined lifecycle order, and retain revision/privacy checks. Acceptance: one saved row, one truthful spoken acknowledgment, no greeting or name request, and a relevant answer to the very next follow-up. This lifecycle fix was **not** made in this testing campaign.

### 2. Switching to essays did not retrieve the essay teaching

Both support conversations moved from planning to essay concerns. A published, language-matched essay teaching with tone/conversational guidance existed in the fixture. The subsequent delivered configuration did not include it. The English call highlighted the applications topic, but that UI operation did not refresh the voice guide's teaching context.

The model's supportive wording is therefore **not evidence that it followed that teaching**. Teaching retrieval currently runs with voice negotiation/guide updates; a conversational topic change can be answered directly without either.

Next change: coordinate meaningful topic changes with bounded teaching retrieval and context delivery independently of divider highlighting. Keep ordinary follow-ups fast. Acceptance must verify the selected teaching ID/revision and delivery before judging whether the spoken response follows its approach. Do not count generic empathy or a matching phrase alone as proof.

### 3. Useful answers remain slower than acknowledgments

The initial English recovery run began its substantive failed-lookup explanation about **10.5 seconds** after the input audio clip ended. The successful older-history retry began its useful answer about **6.5 seconds** after clip end. A pre-fix save failure explanation took about **17.6 seconds**. These are transcript-onset measurements relative to the test audio's end, not exact human microphone-to-speaker latency.

For contrast, first detected assistant audio in the coordinator-guidance scenario was approximately **1.08–2.36 seconds** after clip end, including acknowledgments. That is a different metric and does not establish equally fast useful answers. Sample database reads were tens of milliseconds; model/delegation/continuation waits remained material.

Next change: measure and optimize time to the **useful** answer, avoid redundant delegations for already supplied information, and preserve one clear failure response. Do not add filler or treat “Let me check” as a successful latency result.

### Additional behavior to retain in regression cases

- Parent/student address confusion: one English retest addressed the parent as “Aiden” after the parent selected Aiden's record.
- In the final Spanish injected read failure, Origen said it could not find the visit in available notes rather than clearly stating that retrieval failed. It did retrieve the record on explicit retry. Unavailable and absent must remain distinct.
- The Spanish save-request misclassification in the first retest needs targeted event/turn-boundary reproduction. The final rerun logged full request transcripts and saved correctly, so there is insufficient evidence to claim a general fix for the earlier misclassification.
- Some acknowledgments and scope changes sounded repetitive in the transcript despite the target being known.

## Cost and limitations

| Item | Recorded estimate, USD |
| --- | ---: |
| Earlier approved tests, carried forward | 0.598432 |
| Expanded history tests | 0.226630 |
| Support/topic-switch tests | 0.276289 |
| Coordinator-guidance tests | 0.241292 |
| Initial recovery tests | 0.257533, incomplete backend usage |
| Save retest | 0.237499 |
| Final recovery/save rerun | 0.293229 |
| Synthetic input audio generation | 0.051330 |
| **Recorded cumulative estimate** | **2.182234** |

One initial recovery run had incomplete backend usage reporting. Its full reservation was retained rather than treating missing usage as zero. Conservative cumulative reservation accounting is **$3.773371**, within the approved **$7** cap. These estimates use the application's 2026-10-28 rate card and are not an invoice. Voice usage sums distinct closed provider sessions, including reconnects; the browser's aggregate counter alone undercounts those reconnects. See `tmp/exhaustive-cap7-results.json` and `tmp/exhaustive-cap7-budget.json`.

The tests ran against a local isolated database, so they do not measure production database/network latency. Synthetic input was generated speech, not a human microphone in a noisy room. Some peripheral endpoints were fixture-backed; the intentionally unimplemented summary endpoint returned 404 on teardown. Terminal connection-lost events from forced test teardown are not counted as spontaneous production disconnects. This campaign does not certify onboarding, summary generation, every sharing flow, or production authentication.

The driver was tightened after it was found to advance after acknowledgments before some delegated answers completed. It now waits for tool completion and continuation and ignores outstanding work from retired provider sessions. The final recovery rerun is the cleaner recovery/save evidence; the original artifacts remain intact.

## Recommended next work

Fix post-save continuity first, then topic-aware teaching delivery, then measure substantive-answer latency with the same scripted inputs and comparable data/network conditions. Retain the bilingual save, student-switch, private-family, decline-guidance, injected-failure and interruption cases as regression checks. A background worker is not needed to fix the demonstrated lifecycle and delivery problems.
