# Connected coordinator responses — Phase 2, step 4

Implemented locally November 1, 2026. Students can take a versioned coordinator response into a voice conversation, set it aside privately, or review and accept a suggested action into their private next steps. The existing coordinator layout, binder and voice interface are retained. `ORIGEN_REVIEW_RESPONSE_CONTEXT` remains **false** in deployment configuration; this work does not deploy or enable it.

## Student experience

The existing response section now offers:

- **Talk about this**: clears the private deferral, closes the request sheet and passes the exact request ID and response version to the shared voice controller. The topic is a routing hint, not an access grant. Live and Realtime load the owned response and return a freshness guard before the browser applies the session instructions. Available historical receipts can be explicitly selected and are described as historical.
- **Review later**: persists an indefinite deferral or an optional student-selected calendar date. This choice is private and creates no reminder, notification or outcome question. Deferral survives coordinator edits. The suggested date in the coordinator response is not automatically adopted as the student's date or an official deadline.
- **Add to my next steps**: appears when a suggested action and the existing plan editor are available. Navigation carries only the response identity, not a cached quotation. The editor fetches the current exact-version suggestion, lets the student rewrite it and requires the existing acceptance checkbox. Editing any field resets acceptance. Saving creates a new private plan through the existing plan API; this version does not offer appending a response-linked suggestion to another plan.

The accepted wording is the student's own action. The editor does not copy the coordinator's guidance, resource URL, author label or suggested follow-up date into that action. The student can choose a personal target date and notes. A saved action has a separate **Discuss source response** control while the source is available; ordinary action discussion and editing still work independently.

For example, Maria's suggestion to ask which insurance documents are accepted can become Alex's own action: “Ask the insurance office about the proof from my employer.” Saving records acceptance, not whether Alex contacted the office or whether the waiver was approved. Neither discussion, deferral nor private plan progress is shared with Maria.

## Versioning, private state and source loss

Migration `102_review_response_choices.sql` adds two private metadata tables and a versioned focus reference on live memory sessions. The tables store no response prose. Access uses a narrowly scoped, owner-derived database function with a pinned search path; the runtime role receives function execution, not raw table access. The authenticated choice endpoint accepts only load, defer and revisit operations. Revisions and operation IDs protect deferrals against stale edits and duplicate requests.

The choice projection exposes a `shouldOffer` suppression fact: an indefinite/future deferral suppresses an offer; a student-selected date becomes eligible when due; accepted actions and historical responses suppress offers. **This step does not add responses to the proactive opening selector.** No scheduled jobs or unsolicited follow-up are enabled. Existing response discussion remains student-initiated.

Source validation and plan creation share one transaction. Request and response row locks serialize creation with coordinator edits or withdrawal. The plan creation receipt includes the source reference and acceptance in its fingerprint, so retrying the same accepted operation does not duplicate it. A source edit after preview requires a fresh preview before a new action can be saved. A previously successful save can still be retried after its source becomes unavailable without creating another action.

| Event | Result |
| --- | --- |
| Coordinator edits the response | Existing accepted wording and accepted version remain; the old version's source access becomes unavailable. Deferral persists. |
| Coordinator withdraws the response | Unaccepted previews and source access are removed; accepted private actions remain. |
| Student withdraws the request | An available retained receipt can be discussed as historical within the student's current AI permission. Coordinator access is not restored. |
| Student deletes the request | Deferral is deleted with the request; independently accepted actions remain with unavailable-source status. |
| Student removes an action or plan | Its response link is pruned or cascaded. Normal edits preserve the link to the accepted version. |
| Student/account deletion | The student's choices, links and plans are removed through existing lifecycle cascades. |
| Export | Private choices and source/version link metadata are included alongside the existing plan/step export. |
| Restore | Choices become deferred indefinitely, revisions change and source links detach. Accepted plan wording remains; stale permissions and offers are not revived. |
| Response assistance paused | New choices/focus/linked saves are rejected. Saved plans and history remain, and the plan API withholds response-discussion references. |

Unaccepted previews verify their guard every five seconds while visible and discard their content on failed verification, offline/hidden state or privacy invalidation. Saved plans refresh source availability without rewriting accepted text. Logout/account privacy invalidation clears loaded plans and drafts. Voice retains step 2's current-version checks and stops when its response guards cannot be verified. Withdrawal detection has a polling/network window; this does not claim instantaneous detection or erasure of context already held by a provider.

## Spoken acceptance

The existing `save_next_step` tool can carry an exact `responseSource` only when response assistance is available. The server requires that source/version to have been retrieved or explicitly focused in the current owned memory session, and revalidates it before presentation and creation.

A direct spoken save request starts a proposal rather than immediately creating a linked action. The server supplies a complete English or Spanish readback naming the action, its source and that it will remain private. The shared playback controller must verify that the complete readback was audible and finished. Muting, interruption, playback/transcription errors, cleared output or Live's forced end-of-call flush do not count as delivery.

Only an immediately following explicit student confirmation, independently registered as the current spoken turn, can accept the identical proposal within its validity window. A model's `confirmed` argument, a bare “yes” without a delivered proposal, or an agreement to hear an explanation cannot authorize a save. A source change after the readback invalidates acceptance. Existing private memory/plan tools keep their prior behavior for actions without a response link.

## Validation

Tests used the existing isolated local PostgreSQL environment, disposable schemas and synthetic provider/API transport. No production database or paid provider calls were used.

- The broad regression run passed **155 tests**, with zero failures, cancellations or skips. It covered choices, response context and connections, both voice adapters, private plans, workspace focus, account lifecycle, binder sharing and coordinator readiness. After the final schema/pause refinements, **21 affected plan, choice and client-controller tests passed** with no skips.
- **Six browser journeys passed**, in English and Spanish at widths 1280, 390 and 320. Real React components exercise private deferral, exact voice focus, identity-only navigation, editable preview, resetting acceptance after edits, one accepted save, source withdrawal, preserved accepted wording and logout cleanup. They assert no coordinator-sharing request or horizontal overflow. The fixture uses local font fallbacks and synthetic auth/API/voice transport.
- TypeScript, the isolated Vite build and logging-policy checks passed. Vite retains its existing large-chunk warning.
- Database tests also cover cross-account/student/coordinator denial, runtime table restrictions, optional dates, idempotency/revisions, concurrent source changes, pause rollback, exports, student/account deletion and restore. Voice tests cover both languages/providers, historical focus, stale/legacy/parent scope, exact readback, forged sources and partial/interrupted/muted/forced playback.

Reproduce the broad regression with:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --test --test-concurrency=1 \
  server/review-response-choices.test.mjs server/review-response-voice.test.mjs \
  server/review-response-context-client.test.mjs server/review-response-context.test.mjs \
  server/review-response-connections.test.mjs server/plans.test.mjs \
  server/live-memory.test.mjs server/voice-workspace.test.mjs \
  server/profile-voice.test.mjs server/student-live-session.test.mjs \
  src/studentLiveChannel.test.mjs server/account-lifecycle.test.mjs \
  server/binder-sharing-policy.test.mjs server/binder-next-step.test.mjs \
  server/voice-prompt-structure.test.mjs ops/coordinator-readiness.test.mjs
```

For the browser fixture, start a credential-isolated preview from the repository root in one terminal:

```sh
node /workspace/.local-postgres/bin/run-tests.cjs node --input-type=module -e 'import{createServer}from"vite";const server=await createServer({configFile:false,envDir:false,cacheDir:"node_modules/.vite-response-step4",esbuild:{jsx:"automatic"},optimizeDeps:{include:["react","react-dom/client","@auth0/auth0-react"]},server:{host:"127.0.0.1",port:5183,strictPort:true,hmr:false}});await server.listen();'
```

Then run `node /workspace/.local-postgres/bin/run-tests.cjs node scripts/review-response-choices-smoke.cjs` in another terminal. The fixture defaults to local Chromium at `/usr/bin/chromium` (override with `ORIGEN_BROWSER_EXECUTABLE`). It writes results and screenshots under `/tmp/origen-response-step4-browser`; no production credentials or external fonts are loaded. Regression/build logs are `/tmp/origen-response-step4-*.log` in this environment.

Before future enablement, apply migrations through 102, refresh runtime grants and run coordinator readiness with the existing response capability still paused. There is no new storage service or worker. Step 5 adds an explicitly approved connected clarification request; step 6 integrates release rehearsal and deployed authentication/provider/physical-device listening checks. Those checks, actual model speech quality and student comprehension are not established by these local tests.
