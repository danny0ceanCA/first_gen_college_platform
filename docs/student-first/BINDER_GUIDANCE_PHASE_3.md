# Binder guidance loop — Phase 3

Implemented locally on October 31, 2026. This is the new binder guidance-loop workstream following the evidence projection and coordinator-context phases, not the older student-first Phase 3 correction workflow.

## Behavior

For a new returning conversation, Origen receives at most one optional starting point selected from the already authorized workspace. The student can choose another subject. A current spoken turn, explicit binder selection, onboarding, scope restart, reconnection or context refresh suppresses this opening.

The implementation replaces “take the first unfinished action” in `adaptive-guidance.mjs` with the pure selector in `binder-next-step.mjs`. The same resulting instructions reach Realtime and Live's delegated backend. It adds no database queries, model calls, browser controls or persistent records.

## Inspectable ranking rules

| Evidence | Base score |
| --- | ---: |
| Accepted unfinished plan step | 60 |
| Saved unresolved binder question | 50 |
| Permitted coordinator suggestion | 40 |

Modifiers: +15 for matching a confirmed goal; +5 for context updated within 30 days; −15 for context older than 180 days. An accepted step's personal target adds +25 within seven days, +10 within a month, or +15 if it passed within the last month. Invalid dates receive no date boost. Date buckets use UTC calendar days and are not deadline notifications. Stable ties retain the server's existing selection order. Duplicate wording is removed.

The candidate carries its original evidence and a policy version, score and reason codes. These describe why it was selected, not confidence, urgency, verified completion or learning. The model must not read the scores aloud. Personal target dates remain distinct from official deadlines.

Goal matching uses small English/Spanish topic vocabularies and exact lexical overlap. Proposed goals and parent-reported goals do not establish a student's preferences. This is not semantic matching and will miss some paraphrases.

## Boundaries

- Candidates come only from the existing bounded workspace: up to five actions, six saved notes and one freshly authorized coordinator suggestion. This is not an exhaustive search of every plan or comment.
- Completed and deferred steps are excluded. Unreviewed conversation recap questions are not promoted to accepted next steps.
- Coordinator advice remains attributed optional advice even if read. It is never added to family or parent conversation openings by this selector. Hidden, withdrawn and ended-sharing comments remain excluded by Phase 2 and are checked defensively here.
- The shared opening policy arbitrates between task and coordinator suggestions, preventing two competing proactive prompts. Supplied recent discussion takes precedence if a task was declined, answered, completed or replaced.
- Ranking makes no changes to tasks, notes, sharing, replies or read markers. Existing explicit authorization is still required for writes.
- No new missing-information questionnaire: the existing `get_guidance_question` tool retains its focused questions, skip handling and separate permission checks.
- No production migration or permission update is required. Existing personalization/adaptive controls gate these instructions.

## Validation and limits

Unit cases cover priority, valid/invalid dates, English/Spanish goals, parent attribution, unknown certainty, unrelated topics, stale context, deduplication, privacy exclusions, and suppression during active conversations. A real isolated PostgreSQL integration case exercises the voice endpoint, forged browser context, another account's records, current task versions and deferral without creating new plans. Provider requests are simulated. Both voice protocols receive the same tested backend policy; actual spoken behavior has not been evaluated under this change.

Decline/answer recognition from recent natural conversation remains an instruction to the model, not a new persistent follow-through state machine. Further follow-through work should link explicit student choices and subsequent discussion without treating a mention, a read marker or a completed conversation as acceptance or comprehension.
