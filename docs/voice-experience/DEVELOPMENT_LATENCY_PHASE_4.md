# Phase 4 — Bounded Live follow-ups

**Branch:** `Origen-Development`  
**Status:** implemented and locally validated; off by default. No production deployment or paid Live calls in this phase.  
**Date:** November 3, 2026

## What changes

With the development flag enabled, GPT-Live can restate its immediately preceding completed, backend-supported explanation without starting another delegated reasoning response. This covers requests such as “Can you say that more simply?” or “¿Puedes decirlo más sencillo?” It does not enable answering new college questions from general model knowledge.

The server still supplies the same authorized context and teaching references. The delegated model, its reasoning setting, tools, action validation, backend instructions and response budget remain unchanged. The existing warmth, empathy and conversational teaching instructions remain present.

This uses Live's documented delegation prompt, not an extra classifier, a new worker, or a bypass around application authorization. The model decides whether a turn qualifies; prompt tests cannot establish that every live decision will be correct. OpenAI documents the delegation conditions and recommends testing conversational replies, backend requests and corrections: [Prompting GPT-Live](https://developers.openai.com/api/docs/guides/live-prompting#delegation).

## Boundaries

| Situation | Expected behavior |
| --- | --- |
| Repeat, shorten or simplify the last completed explanation, with no new facts or pending workflow | Live may restate the same meaning, attribution, uncertainty and teaching tone. |
| New question, example, comparison, individual advice, financial calculation or fresh source | Delegate before answering. |
| Recall saved details, earlier conversations, or coordinator guidance | Delegate, even if the information sounds familiar. |
| New student information, a correction or changed goal | Delegate; do not claim an update has saved without a successful application result. |
| Answer to an onboarding question, consent question, approval readback, or check-in | Delegate. A short “yes” does not qualify as a simple follow-up. |
| Saving, notes, next steps, sharing, coordinator connections or ending | Existing application workflows and consent checks still apply. |
| Interrupted, partial, failed, cancelled or timed-out work | Delegate recovery; do not reuse an abandoned answer. |
| Mixed/ambiguous request | Delegate the entire request. |

The server excludes onboarding/profile setup, unconfirmed scope, general family scope, focused work, claimed openings, recovered conversation turns, student switches from the experiment. A confirmed parent's conversation about one selected student can qualify. A verified ordinary guide update, including the first parent/student confirmation, can enable the exception after loading that student’s authorized context. Focused evidence workflows and recovered calls remain excluded. The frontend preserves the server policy through the acknowledged session update.

## Enable for local testing

On the **local API process**, set:

```powershell
$env:NODE_ENV='development'
$env:ORIGEN_LIVE_FOLLOWUPS='true'
npm run dev
```

Use the existing local setup and available port. Stop any server you own before restarting it; do not interrupt someone else's process. Start a new call after changing the flag.

For the baseline comparison, omit the flag or set it to `false`, restart the local API, and start a fresh call. Do not change the model or other flags between comparison runs.

- This is a server-only variable, never a `VITE_` variable or browser request option.
- `NODE_ENV=production`, missing/non-development environment, or Render service markers always disable it.
- If `DEV_API_PROXY_TARGET` points at production, voice requests still use production's policy. A local client flag cannot enable this feature on that remote API.
- The preparation cache contains evidence only. Policy is recomputed when the actual session or guide update is built, so an old preparation cannot carry an enabled experiment into production.

## Measurement

Phase 1 timing now records bounded metadata:

| Field | Meaning |
| --- | --- |
| `routingPolicy` | `backend-first`, `bounded-follow-up-v1`, `mixed`, or `unavailable`. |
| `observedDelegations` | Distinct delegated model response starts correlated with this user turn, observed before its completion marker. |
| `routingObservation` | Backend model observed, none observed, or unavailable. This is an observation, not the model's reason or a correctness verdict. |

`scripts/voice-timing-report.mjs` emits schema version 2 with `routingGroups`, separated by policy, observed routing, language and speech-boundary method. It retains failures and interruptions, and excludes estimated-boundary overlaps from success latency percentiles. Legacy and Realtime captures without routing metadata remain unavailable, not assumed direct. Changes while a turn is in progress are marked mixed. Uncorrelated backend work is not treated as a proven direct answer.

```powershell
node scripts/voice-timing-report.mjs <existing-capture.json-or-timing.jsonl>
```

Only enums and bounded numbers enter operational logs. No new transcript recording, student identities, tool arguments or capture permissions are added. Existing consent/evidence HTTP requests can still run during a direct speech turn. The optimization targets an unnecessary **delegated model cycle**, not all backend traffic.

## Local validation

- 104 policy, prompt-contract, adapter, timing and report checks passed.
- 45 integration/workflow checks passed against an isolated local PostgreSQL fixture, using synthetic data and a mocked voice provider. These include prepared English/Spanish session wiring, preserved history, confirmed guide-update activation, production fallback, scope, onboarding and profile-save consent.
- 30 additional language, prompt-structure, preparation and context-timing checks passed.
- Production build, logging policy and whitespace checks passed. Existing bundle-size/Auth0 bundler warnings remain.

These checks validate configuration, contracts, scope/consent machinery and instrumentation. They do **not** measure the real model's routing compliance, response speed, speech quality, empathy, or actual successful writes during a spoken conversation. No latency improvement is claimed yet.

## Phase 5 acceptance experiment

Use fictional student data first and an explicitly approved API budget. Compare baseline versus enabled policy with the same model, scenario and language. Capture actual generated audio, transcript and timing; listen to the responses rather than treating a matching phrase as proof of empathy.

1. Ask a new college question, then ask for the explanation more simply. First answer must delegate; restatement should preserve meaning and avoid another delegated cycle.
2. Ask a similar-looking request that adds new information: “Say that more simply, and check the current deadline.” It must delegate.
3. Ask for a remembered school, change the preferred school, then request a save. Check the actual saved record and attribution.
4. Give a short “yes” to a pending profile review or coordinator-sharing readback. Verify the consent workflow completes through the tools, without unauthorized sharing or dropped content.
5. Interrupt an answer and switch students, topic or language. Verify stale work is not reused, and the server's guide reset is applied.
6. Inject tool failure/recovery, then repeat a request. Verify no invented success and no automatic retry of a write.
7. Run onboarding through form updates, correction, review and save; confirm the experiment remains disabled for the entire setup flow.

Run the paired scenarios in English and Spanish. Evaluate actual end-of-speech to audible useful answer, delegated cycles per turn, factual fidelity, retrieval accuracy, warmth, and successful application actions. Do not combine direct follow-ups with new substantive questions when reporting latency. Start with a small pilot; expand before making percentile or reliability claims. Keep the flag off if correctness or interaction quality regresses.

## Follow-up from the November 3 live trial

The trial never confirmed Aiden because the client abandoned context updates at 10 seconds while local context assembly took longer. Context-update requests now allow up to 35 seconds, remain cancellable, and can consume an already-ready matching preparation without starting another speculative load. Cache scope/revision/permissions are still validated by the server. This is tolerance for a slow local connection, not a measured speed improvement. Failed loads now explicitly distinguish an understood student choice from a technical loading failure; they prohibit asking for the same name again, permit a caller-requested retry for that choice, and require silence when the caller asks for time. No new private context is authorized on failure.


## Conversation-first extension (uncommitted development work)

The local `ORIGEN_LIVE_FOLLOWUPS=true` experiment now permits grounded conversation, not just restatements. The existing `bounded-follow-up-v1` routing label identifies the experimental path; use the source revision and test artifacts to distinguish this policy from earlier runs.

- **Starting brief:** reuse the authorized profile, attributed memory entries and dated recent summaries. Add up to two unresolved questions and one current, permission-checked coordinator suggestion, separately from student decisions. Exclude advice from parent, family, unconfirmed and retrieval-disabled scopes. Oversized entries are omitted rather than silently presented as complete.
- **Retrieval:** answer supplied-history recaps, simplification and supportive counselor-question formulation directly when the evidence suffices. Delegate missing/older/conflicting evidence, current requirements, corrections, scope changes, recovery and every action. This is a model instruction, not a deterministic guarantee of tool choice; existing server authorization and mutation controls remain in force.
- **Delivery:** acknowledge explicitly expressed concerns before offering one manageable idea; retain named options, dates, source attribution and uncertainty. Avoid routine internal-work narration and repeated introductions after student selection.

Onboarding, selected-work workflows, pending opening claims, recovered continuity and production retain the backend-first policy. No new worker, migration or deployment is part of this change. EN/ES browser voice checks use fictional students in an isolated local database. See `tmp/conversation-first-final-cap2/report.json` for raw transcript/event/cost evidence; do not treat local transcript timing as production audible latency or these short tests as exhaustive certification.
