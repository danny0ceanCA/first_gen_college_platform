# Connected coordinator responses — Phase 2, step 5

Implemented locally November 1, 2026. A student can prepare a separately approved clarification request about an exact coordinator response. The request uses Phase 1's private draft, preview/readback, explicit approval, durable queue and withdrawal controls. `ORIGEN_REVIEW_RESPONSE_CONTEXT` remains **false** in deployment configuration; no production deployment or enablement is part of this work.

## Experience and disclosure

The response section offers **Ask my coordinator a follow-up** while the response and original recipient connection are current. It opens the existing request composer with that coordinator selected. The recipient is fixed for this linked request: changing coordinators requires a separate, explicitly prepared request. The question starts empty, and no notes are preselected. The student writes their question, optionally selects eligible written notes and reviews the exact disclosure before approving.

The preview includes the new question, every selected note, recipient, organization, student and access expiry. Its **About an earlier response** card contains only:

- The earlier **approved** question, including approved clarification wording when that was the original disclosure.
- The response author's name, response date and exact version.
- An identity reference to that request and response version.

It does not copy the response's guidance, suggested action, resources, entire thread, private conversation, plan choices or progress. The reference provides enough context to find the original response through existing authorized request access. Both the approval checkbox and spoken readback explicitly cover the reference as well as the new material. Previously approving the original request is not approval of the follow-up.

For example, after Maria responds to an insurance question, Alex can write “Which document should I ask my employer for?” The preview shows that question and the earlier approved insurance question, identifying Maria's response date/version. Alex can keep the new draft private or approve that exact disclosure. Maria receives a separate request with a small source card in the existing coordinator detail view. **View original request** uses the existing authorized read path; it does not grant access to another record.

The student binder displays the same relationship in request history. There is no chat layout or recursively expanded conversation. Opening, discussing or approving a clarification makes no claim about understanding, completed actions or successful outcomes. No private progress update is shared automatically.

## Database and lifecycle

Migration `103_review_response_followups.sql` adds an immutable source request/version reference and a detached flag to the existing request record. No second response store is introduced. The source must belong to the same account, student, accepted connection, coordinator and organization; its publication and exact response version must still be current. Historical receipts remain available for authorized private discussion but cannot authorize a new linked disclosure.

The existing creation fingerprint includes the optional reference. A repeated creation returns the same private record; changing or dropping its reference under the same operation key conflicts. The existing preview digest now includes the reference card, so it cannot be changed between preview and approval. Source locks share the approval transaction and serialize it with coordinator edits. A stale reference cannot be silently upgraded to the latest response or retargeted to another coordinator.

Staff reads and queue delivery use the same current-access check, including source dependencies. Ordinary unlinked requests retain the original authorization query; dependency checks run only for linked requests. Follow-up ancestry is bounded at eight references, and views expose one source card rather than expanding ancestors. Creating a deeper chain is rejected without retaining an orphan draft.

| Change | Behavior |
| --- | --- |
| Source edited or response withdrawn | Related requests detach, previews are removed, shared payloads are scrubbed, pending delivery is suppressed and notification links are removed. A fresh source version needs a new draft and approval. |
| Original request withdrawn/deleted, recipient access revoked or source publication invalidated | Dependent access ends, including further linked descendants. Independently written private follow-up questions remain in the student's history. |
| Source expires before delivery/read | Current-access checks reject it; maintenance invalidates expired publications and removes dependent disclosure. |
| Retry after source loss | An existing receipt can be returned, with unavailable access; retry does not renew approval or duplicate delivery. |
| Follow-up withdrawn or deleted | Existing Phase 1 controls apply. Withdrawal/deletion remain available while new response assistance is paused. |
| Account/student deletion | Existing cascades remove the student's request records and related consent/publication records. |
| Export | Existing request exports include the source card while current, or unavailable-source metadata after detachment. No response body is duplicated in the card. |
| Restore | Existing sharing/consent invalidation runs, all linked requests detach and their previews are removed. Old approvals cannot revive the relationship. |

The binder rechecks an open linked preview every five seconds. A source change or failed verification clears the preview and approval; hidden/offline/privacy boundaries clear it as well. The submit transaction remains authoritative even before polling detects a change. Coordinator content retains its existing access rechecks. These are bounded detection windows, not instantaneous removal of already displayed or provider-held information.

The server gates new linked drafts/previews/approvals on the existing response capability, review requests and delivery capability. Pausing response assistance does not erase private history or revoke a separately approved, still-current queued disclosure by itself; the existing delivery pause stops queue delivery. Source and recipient checks still apply at delivery. No new notification transport, paid storage service or worker is added.

## Live and Realtime

The existing `prepare_coordinator_review_request` tool accepts an optional identity-only `relatedResponse` when current server-derived response/voice capabilities allow it. Session handlers discard client-supplied capability claims. Both reasoning instructions and Live speaker instructions require an explicit request to ask the coordinator a related question, the verified current response, the original accepted connection and the complete readback. A historical or changed source must not be replaced silently or converted to an unrelated request.

The readback includes the earlier approved question, coordinator, response date/version, new question, selected notes, expiry, withdrawal and delivery disclosure. Unlike ordinary conversation, reading the version is required here because it identifies the disclosure being approved. Long selections that exceed the existing spoken readback limit use the notebook instead.

The shared controller still registers student speech independently, requires completed audible playback and accepts only an explicit approval in the immediately following turn. Partial readback, interruption, muting, forced Live flush, silence, an unrelated acknowledgment or a model-provided confirmation cannot grant approval. Source edits after readback invalidate the preview before confirmation. A private action, deferral or outcome is not automatically converted into a coordinator update.

Release source fingerprints now include the review-request tool policy, readback implementation and client consent controller, so changes to this behavior are captured in release evidence.

## Validation and remaining release work

Validation uses disposable schemas in the existing local PostgreSQL environment and synthetic auth, provider and delivery transport. Production credentials are excluded. Database coverage includes exact approved wording, selected notes, cross-account/student/recipient denial, source version changes at preview/queue/read, duplicate operations, concurrency with coordinator edits, withdrawal/deletion, nested invalidation, export, restore and server pause. Voice checks cover English/Spanish readback and server-derived tool availability for both Live and Realtime.

Six browser journeys passed at widths **1280, 390 and 320**, in **English and Spanish**. Real student and coordinator components verify the locked recipient, identity-only creation, exact reference preview, explicit approval, existing coordinator card, navigation to the original request, invalidation of a subsequent preview and removal of staff access. They assert no automatic voice/plan call, no horizontal overflow and no page errors. Local font fallbacks are used.

The final regression suite passed **185 tests**, with zero failures, cancellations, skips or TODOs. TypeScript, the isolated Vite build and logging-policy checks passed. The build retains its existing large-chunk warning. Final regression results are recorded in `/tmp/origen-response-step5-regression-final.log`; browser results/screenshots are under `/tmp/origen-response-step5-browser`.

Run the related regression suite with:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-concurrency=1 \
  server/review-response-followups.test.mjs server/review-requests.test.mjs \
  server/review-request-submission.test.mjs server/review-request-notebook.test.mjs \
  server/review-request-voice.test.mjs server/review-request-voice-client.test.mjs \
  server/review-request-delivery.test.mjs server/review-request-release.test.mjs \
  server/review-response-choices.test.mjs server/review-response-context.test.mjs \
  server/review-response-context-client.test.mjs server/review-response-voice.test.mjs \
  server/profile-voice.test.mjs server/student-live-session.test.mjs \
  src/studentLiveChannel.test.mjs server/voice-prompt-structure.test.mjs \
  server/account-lifecycle.test.mjs server/personalization-release.test.mjs \
  ops/coordinator-readiness.test.mjs
```

For browser checks, start an isolated preview from the repository root in one terminal:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --input-type=module -e 'import{createServer}from"vite";const server=await createServer({configFile:false,envDir:false,cacheDir:"node_modules/.vite-response-step5",esbuild:{jsx:"automatic"},optimizeDeps:{include:["react","react-dom/client","@auth0/auth0-react"]},server:{host:"127.0.0.1",port:5185,strictPort:true,hmr:false}});await server.listen();'
```

Then run `node /workspace/.local-postgres/bin/run-tests.cjs node scripts/review-response-followups-smoke.cjs` in another terminal. The fixture defaults to `/usr/bin/chromium`, with `ORIGEN_BROWSER_EXECUTABLE` available as an override.

Before future enablement, apply migrations through **103**, refresh the existing runtime grants and run coordinator readiness. The feature remains paused in deployment configuration. Step 6 remains the integrated release rehearsal, including deployed authentication, real-provider speech and physical-device audio checks. Local synthetic tests do not establish actual listening quality, student comprehension or provider-side erasure.
