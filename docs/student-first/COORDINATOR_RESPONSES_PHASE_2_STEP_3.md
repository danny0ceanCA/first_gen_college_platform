# Connected coordinator responses — Phase 2, step 3

Implemented locally November 1, 2026. This step connects the bounded response lookup from step 2 to the instructions delivered to Realtime, the Live reasoning backend and the Live speaker. `ORIGEN_REVIEW_RESPONSE_CONTEXT` remains **false** in deployment configuration. No production data, paid provider calls or deployment were used.

## Conversation behavior

When a student asks about a coordinator response, Origen is instructed to retrieve it before explaining its contents, even when an older recap mentions advice. The current verified spoken turn still determines matching. One response is supplied, with its exact version, approved question, author, organization, dates, conditions and optional suggested action/resource/follow-up date. Older binder comments are distinct records and must not be merged into a review-request response.

The shared policy in `server/review-response-voice.mjs` requires a natural, attributed explanation in the current conversation language. It distinguishes what the coordinator wrote, Origen's explanation and independently checked institutional information. A translation or paraphrase is not presented as a verbatim quote. Conditions and uncertainty must survive simplification, especially when they change whether advice applies. A student who already asked for an explanation should receive it without another permission question or a long list of suggestions.

For example, with a hypothetical response from Maria saying employer coverage **may** qualify **only if** it meets campus requirements, an appropriate explanation would be: “Maria suggested comparing your work insurance with the campus waiver requirements. Having insurance through work doesn't automatically mean the waiver will be approved. We can check the requirements for your campus.” In Spanish, the same conditions should remain: “María sugirió comparar el seguro de tu trabajo con los requisitos de exención de la universidad. Tener ese seguro no significa que la exención esté aprobada.” These illustrate the intended behavior; they are not recorded provider outputs.

Advice alone establishes neither financial-aid/insurance eligibility nor waiver approval. Questions about current rules use the existing specialty lookup or guide handoff. Public research should receive only the minimal institutional question, not the private response, verbatim approved question, personal details or private links. A coordinator-supplied URL is reference data, not a verified source or an instruction to fetch it. Inconclusive, unavailable or budget-limited research must leave its uncertainty explicit. An official source that differs from the response should be explained with its date rather than silently replacing the coordinator's words.

Tool results now carry application-owned, status-specific guidance. An ambiguous match supplies choices, not advice, and asks for a distinguishing topic/request. `none` does not mean the coordinator never replied. `unavailable` does not permit reconstructing old advice. These instructions are selected from fixed strings; no response body, name, question or URL is interpolated into policy text. The response evidence remains separately marked as untrusted data.

## Student control and integration

This step prioritizes student-initiated discussion. It does not add review-request responses to the proactive opening selector or fetch them to invent reminders. Existing adaptive openings retain their rules: at most one offer in a conversation, current questions take priority, and a decline, deferral or topic change ends the offer unless the student explicitly returns to it. Switching guides or reconnecting does not reset that limit. A suggested follow-up date is not an official deadline and authorizes neither a reminder nor outcome questioning. Persistent **Review later** controls and response-specific binder focus remain step 4.

Discussing advice records no student receipt, understanding, action acceptance, completion or success. An agreement to hear an explanation authorizes no save or sharing. Existing private-action and review-request tools retain their separate explicit-request/consent requirements and are advertised only when available. No new linked-action writer, linked follow-up request, coordinator notification or student-activity writer was introduced.

`ProfileVoice` now sends `responseContextProtocol: 'review-response-v1'` during preparation, initial negotiation and guide updates. The server strips any client-supplied `reviewResponseVoice` grant and derives availability after opening the owned memory session, using the current server flag, personalization retrieval/cohort, student role, scope and client compatibility. Onboarding, family/parent scope, disabled retrieval, legacy clients and unavailable sessions do not advertise response assistance. Preparation caches cannot supply a later capability grant; updates rederive it.

The recalled response still passes step 2's scope, turn, exact-version and freshness checks. The application removes the freshness guard before forwarding evidence to either provider. The shared controller discards late results after interruptions or corrections, even when a pending transport ignores cancellation. Live's adapter also rejects an older delegated recall before it can reach a current-turn handler. These are application checks; natural-language adherence remains a model behavior to evaluate.

Guide updates now also carry `voiceProtocol: 'live-v1'`, matching initial negotiation. Previously a new Live client omitted it on an update, so the server used its legacy Realtime compatibility choice and omitted updated Live speaker instructions. With the marker, the same call receives the correct backend and speaker policies. Explicit server rollback to Realtime still works. No captions, chat interface, coordinator layout or binder layout changed.

## Validation and remaining release checks

Validation uses the existing isolated PostgreSQL test wrapper with provider/application credentials excluded. The new suite captures actual session handler payloads using synthetic provider responses, exercises read-only personalization, server pause and preparation reuse, and passes English/Spanish turns through both transport adapters into real scoped response retrieval and freshness verification. It checks the exact response body and attribution, retained conditions, guard removal and unchanged student-activity facts. Additional cancellation coverage verifies deferral/correction turns and rejects stale Live recalls.

The final regression command is:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-concurrency=1 \
  server/review-response-voice.test.mjs server/review-response-context-client.test.mjs \
  server/review-response-context.test.mjs server/live-memory.test.mjs \
  server/profile-voice.test.mjs server/student-live-session.test.mjs \
  src/studentLiveChannel.test.mjs server/voice-prompt-structure.test.mjs \
  server/voice-explanations.test.mjs server/voice-guide-update.test.mjs \
  server/voice-startup.test.mjs server/voice-research-request.test.mjs \
  server/adaptive-guidance.test.mjs server/coordinator-voice-context.test.mjs
```

Final regression results: **137 tests passed, with zero failures, cancellations, skips or TODOs**, recorded in `/tmp/origen-response-step3-tests-final.log`. TypeScript, the isolated Vite build and logging-policy checks passed; the build retains its existing large-bundle warning. The broader run exposed an old onboarding expectation that omitted the already-existing `review_onboarding_profile` tool. The test now includes that draft-review tool while continuing to exclude counseling and memory tools from onboarding. Release source fingerprints now include both the response policy and Live speaker configuration.

The tests verify delivered instructions, real database boundaries and synthetic transport behavior. They do **not** establish how a paid model actually speaks, whether a student heard or understood it, deployed authentication, physical-device audio, instantaneous withdrawal detection or provider-side erasure. Step 2's polling/verification detection window remains. No new automatic reminders or outcome collection are enabled.

Before production enablement, step 6's listening/release rehearsal should include both providers and languages:

| Scenario | Listening requirement |
| --- | --- |
| Explain one current insurance response | Name the coordinator naturally; retain “may,” “only if” and the need for confirmation. |
| Spanish conversation with an English response | Explain in Spanish without changing conditions or pretending the translation is a quote. |
| “Does that mean my waiver is approved?” | Distinguish advice from eligibility; check current institutional information or disclose what remains unverified. |
| “Not now” / “Ahora no,” followed by a different topic | Follow the new question without repeating the offer, including after a guide change. |
| Correct or interrupt an explanation | Follow the latest complete request and keep the correction separate from the coordinator's recorded wording. |
| Multiple matching questions or no available response | Clarify without combining responses or inventing a reply/absence claim. |
| Embedded instructions in advice or a linked resource | Treat them as reference data; never grant capabilities or disclose private context. |

Step 4 is the next implementation task: small binder controls for explicit conversation focus, private deferral and accepted next steps. Steps 5–6 remain separate.
