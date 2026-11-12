# Decisions conversation enhancements

- Date: 2026-11-08
- Release branch: `v1.3-decisions-integration`
- Rollback baseline: `v1.2` at `0f6a067`

## Goal

Help Origen notice what the caller needs and choose a useful next explanation without making the caller wait for Decisions. Preserve the existing intro, voice, research flow and steady call indicator. These changes do not add another background service or make Decisions responsible for research.

## What changed

| Requested improvement | Before | Implemented | Expected benefit and limit |
| --- | --- | --- | --- |
| 1. Recognize needs reliably | The early path distinguished examples, but completed classifications had fewer support choices. | Both paths distinguish simpler explanations, concrete examples and starting points. Questions anchor on the latest caller evidence, corrections and earlier attempts. Added 24 independent English/Spanish holdout scenarios. | The provider matched 22 of 24 expected needs. It misclassified the missing-topic example request in both languages. |
| 2. Check at meaningful moments | Distributed early checks used a 350 ms quiet gap, including recognizable requests. | A recognizable request can start a check after a 160 ms accumulation window. Later fragments update the same pending evidence. A third bounded attempt is reserved for fresh post-output revalidation when enabled. | A 190 ms earlier start in the controlled initial-request scenario, not a promise of 190 ms faster speech. Voice never waits. Existing call/request limits remain. |
| 3. Remember explanations | Bounded history existed, but completed requests lacked the same explanation evidence. | Preserve the caller's request, adjacent explanation attempt and subsequent reaction, with source references. Feed validated bounded history into completed requests without modifying their immutable freshness fingerprints. | A different example can be selected when an earlier explanation failed. An explanation or a bare “okay” is not recorded as proven understanding. |
| 4. Preserve relevant observations | New fragments could invalidate a pending cue without retaining a useful observation for rechecking. | Retain an unsent observation provisionally, then classify the full current evidence again. Corrections, changed students/languages/connections and expiry still invalidate delivery. | Harmless elaboration does not automatically lose the opportunity to help. Retention is not permission to inject stale context. |
| 5. Apply support between thoughts | An answer starting usually blocked temporary support; the separate late experiment was disabled. | Added an independently gated mode requiring matched input/output boundary evidence, fresh idle playback, quiet audio, complete output evidence and a new classification. Send only a short fixed optional thinking note. | Can help the next relevant point without requesting speech, interrupting an answer or reopening a finished answer. The new mode stays off until an explicit trial; a boundary estimate is not proof of semantic thought completion. |
| 6. Evaluate native triggers | No detached contract/evidence comparison for native checks. | Added an isolated, off-by-default configuration builder and replay observer for native trigger envelopes, per-direction ordering, coalescing uncertainty, stale scopes, refusals and bounds. | Makes a future native comparison reviewable. No native session was opened or enabled. This evaluates contracts, not provider accuracy or conversational quality. |
| 7. Measure helpfulness | A legacy `supportNeed: none` could obscure other classifications; receipt could be confused with success. | Retain typed answers/distributions, scheduling reasons, precise stale dimensions and correlated stage timings. Add an offline diagnostic report plus separate reviewed need-addressed, transcript flow, audible flow and caller-clarity measures. | We can distinguish a missed need, late result, blocked delivery and a received-but-unhelpful cue. Observations remain associations; they do not establish causation or verified comprehension. |

## Library review and OpenAI alignment

Before edits, the review covered every page in the 45-page Responses manifest and the 30-page Decisions manifest, the saved Responses/Decisions/conversation-state references, the local configuration audit and measurement plan, and relevant conversation-state supporting guidance. Repeated generated schemas were reviewed as unique contracts, with language-specific differences checked. No library document was unavailable. This was a distributed review of the full library, not just the indexes.

Relevant current official guides were also checked against the saved snapshots; the reviewed Decisions, Decisions voice, Live, delegation, conversation, prompting, voice-agent and WebRTC guides matched the saved copies. The implementation follows these distinctions:

- **Typed observations, not generated behavioral instructions.** Decisions returns classifications. Application-authored, fixed bilingual support notes are the only new Live context. No raw transcript or classifier prose becomes an instruction. [Decisions guide](https://developers.openai.com/api/docs/guides/decisions).
- **Quiet context, independent speech.** Support uses `session.thinking.append` with `delegation_id: null`; it does not pause audio, call `response.create`, or issue an interrupting instruction. Pending delegations and context remain fenced because thinking appends can cancel automatic acknowledgments. [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation).
- **Receipt is not playback.** Source intervals and exact IDs remain attached to evidence. Application transcript boundaries are labeled estimates. Provider acknowledgments, reviewed transcript changes and browser/audio observations stay separate. [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations), [voice server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live).
- **Native and standalone contracts remain distinct.** The native evaluator correlates `source_event_id` and direction, permits coalescing, rejects outdated results and observes native configuration limits. It does not replace delegation or the delivery guards. [Decisions for voice](https://developers.openai.com/api/docs/guides/decisions-voice).
- **Warmth does not require artificial waiting.** These changes improve when context is available. They do not script extra acknowledgments, filler sounds, forced questions or delays into the voice prompt. [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting).

The 160 ms accumulation interval, 900 ms audio-quiet fence, 2-second classification freshness bound and confidence thresholds are application policies, not OpenAI guarantees. They must be judged against actual bilingual calls.

## Boundaries and rollout

- The requested production rollout sets `ORIGEN_DECISIONS_BETWEEN_THOUGHTS=true` on the Origen Edu API. The application default remains off, and the flag can be switched back independently of the other Decisions improvements.
- Intro, voice configuration, playback behavior, research tools and UI animation code were not edited.
- Scheduling and evidence improvements use the existing Decisions helper; no new Render service or migration is required.
- New quiet post-output delivery is opt-in: `ORIGEN_LOCAL_BETWEEN_THOUGHTS=true` for the isolated local launcher, or `ORIGEN_DECISIONS_BETWEEN_THOUGHTS=true` for a future explicitly configured server trial. Existing Decisions/early support prerequisites still apply.
- Native triggers remain a detached experiment with no runtime imports or automatic activation. Their provider-initiated execution cannot honestly reuse a pre-request application budget guarantee. A paid native trial requires its own bounded runner and accounting plan.
- Account-scoped durable diagnostic storage and its existing retention policy remain in use. The added diagnostic fields are structured metadata, not transcripts, prompts, keys or private reasoning.

## Verification

The final complete Decisions/local-call suite and relevant server diagnostics/integration suites passed: **629 passed, zero failed, one skipped**. The skipped test requires an explicitly configured PostgreSQL test database. This final run includes corrections found during independent review: local export deduplication uses the worker's sequence, and omitted transcript rows break historical adjacency. The TAP artifact is `output/decisions-enhancements-tests.tap`.

The production build (`tsc -b && vite build`) passed. The initial restricted build failed on filesystem access while resolving Vite configuration; the authorized local build retry passed. Existing third-party directive and bundle-size warnings remain.

Tests cover English and Spanish recognition inputs, correction handling, explanation evidence, fresh revalidation, an already answered need, context arriving during research, resumed speech while classification is pending, input/output boundary mismatches, duplicate suppression, intro/selection protection, reconnect/scope changes, native trigger ordering, diagnostic sanitization and outcome-evidence separation. Mocked provider responses verify code behavior; they are not a substitute for real API accuracy or listening to audio.

## Live validation on November 8, 2026

All four fictional WebRTC calls completed all four turns. Each language used the same voice configuration and caller audio with between-thought delivery off and on. The test covered confusion about grants and loans, an explicit request for a concrete example, a topic change and an ordinary follow-up. Browser sampling detected no assistant audio overlapping the prerecorded caller turns. Research tools were disabled in these calls.

| Language | Between-thought delivery | Intro to first audio | Median caller audio end to reply audio | Post-output checks | Cues sent |
| --- | --- | --- | --- | --- | --- |
| English | Off | 0.91 s | 1.33 s | 0 | 0 |
| English | On | 0.83 s | 1.40 s | 2 | 0 |
| Spanish | Off | 0.83 s | 1.34 s | 0 | 0 |
| Spanish | On | 0.89 s | 1.31 s | 3 | 0 |

Of the five post-output checks, two found the need already addressed, two withheld a cue because the answer might address it, and one failed the fresh output boundary check. In the Spanish example turn, Origen supplied the requested example in the same reply after the cue was withheld. The calls show how the delivery safeguards behaved. With zero cues sent, they cannot establish the effect of a delivered cue or a latency improvement.

The separate completed-classifier trial matched 11 of 12 expected support needs in each language and all 24 already-addressed labels. Both misses were requests for an example whose topic was missing. The classifier chose a concrete example instead of marking the need unclear.

Estimated cost was **$0.56** for voice, known Decisions usage and generated test audio. Accounting including the full test audio hold and one unresolved Decisions reservation was **$0.66**, within the separately approved $5 cap. The runner used the production helper's request limits with fictional data and a local diagnostic sink. Rates were checked against the official [GPT-Live pricing](https://developers.openai.com/api/docs/models/gpt-live-1), [Decisions pricing](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability) and [TTS pricing](https://developers.openai.com/api/docs/models/tts-1).

Local evidence is in `research/decisions/.local/need-continuity-live-1794181731955.json` and `research/decisions/.local/between-thoughts-20261108-holdout.json`.

## Diagnostic report

```powershell
node scripts/decisions-diagnostic-report.mjs events.jsonl --output decisions-report.json
node scripts/decisions-diagnostic-report.mjs events.jsonl --reviews reviewed-cases.json --output decisions-reviewed.json
```

This reads an existing export only; it does not connect to production. See [diagnostic evidence report](../../research/decisions/local-call/DIAGNOSTIC_EVIDENCE_REPORT.md) for schemas and limits, and [native trigger evaluation](../../research/decisions/local-call/NATIVE_TRIGGER_EVALUATION.md) for the separate experiment.
