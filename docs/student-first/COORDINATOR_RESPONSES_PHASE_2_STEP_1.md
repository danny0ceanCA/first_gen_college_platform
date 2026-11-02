# Connected coordinator responses — Phase 2, step 1

Implemented November 1, 2026. This step establishes response identity, attribution and lifecycle semantics for the later conversation, private-choice and clarification features. It adds no conversation UI, voice tool, automatic reminder, plan acceptance or sharing action. The coordinator layout is unchanged.

## Delivered foundation

Migration `100_review_response_connections.sql` extends the existing response row with historical author and organization names. Existing rows are backfilled from the request's validated recipient snapshot, including after directory changes or connection loss. New responses capture the same provenance; edits and withdrawal cannot relabel their author. IDs and dates remain distinct from names and response content. There is still one current response body per request, with no archive of superseded prose.

`src/reviewResponseConnection.mjs` and its TypeScript declaration define an identity-only source:

```json
{
  "kind": "review-response",
  "requestId": "0e94d492-5c3e-4c8a-a103-2dd9264a641a",
  "responseVersion": 2
}
```

The supported prospective link purposes are `conversation-focus`, `private-choice` and `related-request`, each wrapping this source. The discriminator prevents conflating older coordinator feedback with review-request responses. Validation rejects copied advice, account identity, consent, activity and capability fields. A valid reference is not permission to read, accept, or share anything. This step does not persist focus, choices, plans or related requests; their writers belong to steps 2–5.

The internal repository in `server/review-response-connections.mjs` accepts `{action: 'inspect', studentId, source}` and returns `{connection}` through one scoped, read-only database command. It is not mounted as an HTTP endpoint or registered as a model tool. The existing owner request receipt and account export also include `coordinatorReview.connection` for the latest response. Coordinator reads do not receive this student-private projection.

Available metadata includes the exact source version, original question, separately identified approved question, request status/dates, response author/organization/dates, coordinator opening/review facts, version-specific notification delivery, and current scope facts. It excludes response prose, notes, transcripts, family material and private plan data. The later model retrieval path should select the approved question context explicitly; this owner projection is not a prompt payload.

## Lifecycle contract

| Event | Result for a response reference |
| --- | --- |
| Current response, current request publication | `current`, with its exact version and attribution |
| Coordinator edits response | Old version becomes `unavailable / response_changed`; no substitution of newer advice or retention of the old body |
| Coordinator withdraws response | `unavailable / response_withdrawn`; body/action/link/date are scrubbed, including for stale references |
| No response yet | `unavailable / no_response`; no invented receipt or advice |
| Student withdraws request | Retained response becomes `historical / withdrawn`; coordinator access ends |
| Supporting note changes, publication expires, connection or recipient access changes | Retained response becomes historical with the corresponding reason; no fresh coordinator access is granted |
| AI permission expires or is revoked, account role changes, or family scope becomes ineligible | Receipt remains available through owner privacy controls; `scope.aiEligible` is false |
| Permission is granted again | Available history can be explicitly revisited in the newly authorized student scope; the old publication stays historical |
| Request, student or account deletion | Response and new provenance are deleted by the existing cascades; old references return unavailable/404 |
| Restore with matching response version evidence | Retained receipt is private history; recipient access is invalidated and notification evidence is not invented |
| Restore with mismatched, withdrawn or missing response-version evidence | Existing recovery scrubs the body; connection is unavailable. Request deletion receipts are replayed |

Historical receipts set `historicalRequiresExplicitFocus: true`. They are eligible only for student-initiated discussion when the student's current AI scope permits it, never proactive reminders. Source presence alone does not authorize AI processing. Scope fields are point-in-time server-derived facts, not rollout switches, permission tokens or proof of consent. `requestPublicationCurrent` describes source validity; separate server rollout and authentication gates still apply. `current` does not certify that advice is correct or institutional policies are up to date. Step 2 must recheck authorization, version and availability when loading context; subsequent writers must recheck them inside their own transactions. Reading this contract cannot guarantee that a later operation still has access.

The inspection command rejects all client/model capability flags. It runs under authenticated account scope, requires the exact owned student and request, and returns no data to another account, sibling student, parent-linked account, coordinator or unauthenticated caller. Internal helpers have pinned search paths and no runtime/PUBLIC execution grant. The runtime has only the scoped command, with no direct response-table privileges. No new AI capability is enabled in this step.

## Facts are not outcomes

Notification `delivered` means the application created an in-app notice for that response version. It is not proof the student heard or read the response. An older version's delivery never establishes the newer version's delivery. If retention or restore removes that evidence, the status is `not_recorded`.

`request.coordinatorOpenedAt` and `coordinatorReviewedAt` describe the coordinator's activity on the student's request. They do not describe the student's response consumption. Student opening, discussion and action acceptance are separate `studentActivity` fields, each explicitly `not_recorded` until its own instrumentation exists. This means unknown, not that the student did nothing. Opening a notification, inspecting metadata, reading a receipt, or explaining advice cannot infer understanding, agreement, completion, resolution or a successful outcome.

Both the SQL helper and scoped inspection command are `STABLE` and perform no writes. Tests execute inspection in a read-only transaction and verify that delivery, coordinator activity and notification opening leave student activity unrecorded.

## Boundaries for the next implementations

Step 2 adds bounded response-body retrieval and current authorization checks; step 3 connects it to Live and Realtime. Step 4 adds actual private choice and plan records, with separately verified acceptance. An accepted plan must retain its accepted wording/version when the coordinator edits advice; source loss must remove cached quotations/access while preserving the independently accepted private plan. No plan is created or modified here.

Step 5 stores a related request only through Phase 1's exact preview/readback and explicit sharing approval, rechecking the source and recipient before approval and delivery. A `related-request` reference alone neither creates a request nor reveals the earlier question or response to a coordinator. Step 6 adds the integrated release workflow and dedicated default-off AI capability. Outcome follow-up and the recommendation algorithm remain later work.

## Validation and deployment

Final local verification: **86 tests passed, zero failures, cancellations, skips or todos**, including 13 tests in the new response-connection suite. TypeScript, production logging checks and the isolated Vite production build passed. Vite still reports the existing large-bundle warning. Validation used Node 24 and PostgreSQL 17; deployed authentication, actual voice providers and physical devices were not exercised.

The tests used the isolated local PostgreSQL database with synthetic identities and application/provider credentials excluded. The new suite covers fresh migrations, upgrades with existing responses, schema replay, scoped access, exact versions, side-effect-free inspection, attribution after directory changes, permission loss/restoration, withdrawal, deletion and restore. Existing request/voice/delivery/privacy/readiness suites cover the affected integration paths. The final test invocation, run through the environment's credential-stripping local test wrapper, was:

```sh
node --test --test-concurrency=1 \
  server/review-response-connections.test.mjs \
  server/review-requests.test.mjs \
  server/review-request-submission.test.mjs \
  server/review-request-notebook.test.mjs \
  server/review-request-voice.test.mjs \
  server/review-request-delivery.test.mjs \
  server/review-request-release.test.mjs \
  server/account-lifecycle.test.mjs \
  ops/coordinator-readiness.test.mjs
```

The first upgrade-test attempt used a filesystem path where the migration fixture requires a directory URL. That fixture input was corrected; the complete final run above passed against the finalized migration and contract.

Deployment requires applying migration 100 after the Phase 1 migrations and reprovisioning the scoped runtime grant. No production migration, deployment, commit, push or pull request was performed. The Phase 1 step 6 report remains evidence for its earlier source snapshot, not a release certification for these Phase 2 changes. No browser, deployed authentication or real-provider voice verification is claimed for this backend foundation.
