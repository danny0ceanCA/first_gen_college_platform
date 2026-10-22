# Phase 8: coordinator follow-through

Implementation in progress, 2026-10-21, on baseline `d0fe03e80b6b106d4ff57f9ec005efc122ede891` with the earlier student-first phases preserved. Application changes and synthetic verification are complete; PostgreSQL verification and measured pilot capacity remain blocked. **The Phase 8 completion gate is not met.** No commit, push, deployment, production migration or production setting change occurred.

## Experience and scope

The student still talks to Origen, reviews any information they choose to share, and optionally asks for help with that published selection. A connection alone shares nothing. A coordinator sees whether the current publication needs review, how many entries are currently accessible, and whether help was requested. This is current-publication context, not a historical diff that could expose withdrawn information.

When enabled, the existing help toggle creates a generic in-app notification: “A student asked for help with their shared selection.” Opening it rechecks access and opens the existing binder view. The coordinator can add attributed guidance or a suggested step, including guidance attached to an eligible conversation-derived entry. The existing guidance panel shows suggested-step and reply counts from the accessible selection only.

The student can turn a suggestion into an action, change its wording and explicitly accept it. That action remains in the student's private plan. Acceptance does not send a reply, expose completion progress, or promise a deadline to the coordinator. A student sends a separate reply if they want the coordinator to know something. Existing edit, hide, remove, report and withdrawal controls remain available.

Example: Alex shares “I need help comparing college costs” and requests help. Jordan opens the generic notice and suggests comparing two aid estimates. Alex changes the action to “Compare one estimate with Jordan on Tuesday” and accepts it. Jordan cannot see that private change or its progress. Alex separately replies “Could we review this together?” and Jordan sees that reply in the existing thread.

## Implementation and reasoning

| Area | Change | Reason and boundary |
| --- | --- | --- |
| `src/CoordinatorBinders.tsx` | Current publication review/help context and entry count | Make the next coordinator action clear using only already-authorized content. Do not fetch private history or compare against revoked snapshots. |
| `src/CoordinatorGuidance.tsx` | Suggested-step/reply summary; request privacy lease spanning token acquisition and JSON parsing | Reuse existing attributed guidance and student action acceptance. Prevent late responses from crossing account/privacy changes. Counts describe guidance, not student plan completion. |
| `src/CoordinatorNotifications.tsx` | Generic bilingual help label and equivalent request privacy lease | Reuse the in-app notification path; avoid student prose or names in notification payloads. No email, SMS or new delivery service. |
| `server/binder-sharing.mjs`, `server/coordinator-feedback.mjs` | Trusted server-owned enablement fields and migration readiness checks | Client/model input cannot activate sharing or notifications. Feedback must pass the derived-sharing gate through to nested binder reads. |
| Migration `068_coordinator_follow_through.sql` | Help notification kind, existing trigger/liveness extensions, derived-feedback gate propagation, private notification eligibility helper | Reuse the transactional outbox, delivery worker, current-grant checks and feedback receipts. No new table, queue or permission system. |
| `server/coordinator-review-admission.mjs`, `server/coordinator-access.mjs` | Two simultaneous expensive organization/application review reads per handler instance; immediate 429 for excess | Bound backend work implicated in REVIEW-BURST-001 without an unbounded in-memory queue or blocking revocation/write endpoints. Root cause is not established. |
| `src/CoordinatorRegistration.tsx` | Bilingual busy/retry message; failed organization lookup is not presented as an empty result | Let reviewers retry deliberately without a retry storm or a misleading “no eligible organizations” message. |

### Database behavior

Migration 068 extends the existing notification/outbox kind checks with `help`. It changes existing functions forward-only; applied migration files are not edited. Existing runtime entry points remain the same, and the new internal helper has no PUBLIC execution grant. Search paths remain pinned to the migration schema and `pg_temp`.

Help creation requires an explicit request for the current live publication and the trusted transaction-local follow-through gate. Its unique event key is `help:<publication-id>`. Repeated requests and toggling off/on do not produce repeated events for the same publication. If delivery is already suppressed or removed, another toggle does not guarantee a fresh notice; the current help indicator remains available in the workspace. Notifications are not an emergency or response-time guarantee.

Opening/listing a help notification checks the exact current publication, active help request, recipient, membership and grant. Cancelling help, invalidating the publication, revoking access or losing membership makes it unavailable. Existing publication and reply events retain their own behavior and retention. Notifications contain identifiers internally; their list response exposes only `id`, `kind`, `createdAt` and `read`.

The current-source eligibility helper is separated from the HTTP rollout gate so the maintenance worker can validate derived-item reply notifications without an HTTP request setting. Content returned to users still goes through the gated binder eligibility adapter. Maintenance validates the current granted publication and source digest; it does not return private source text. The publication trigger also uses the underlying source validity check. The helper does not create grants, select entries or publish content.

Feedback sets the derived gate transaction-locally and passes it to nested binder reads. Its retry fingerprint excludes the server-owned enable fields, preserving existing receipt identity across flag changes. The existing tombstone wrapper, version checks, source withdrawal behavior and private plan linkage remain in place.

### Review burst boundary

Historical REVIEW-BURST-001 involved intermittent 503s during 150 concurrent organization-review reads with a five-connection pool. Pool pressure remains a hypothesis. The new admission limit applies to `applications` and `application-organizations` after authentication/input validation and before this handler's database audit/control checks and identity-provider request. Excess requests receive `429 coordinator_review_busy`, `Retry-After: 2` and `Cache-Control: no-store`.

Slots release in `finally`, including failures. They stay held while the underlying operation is pending even if the client disconnects. Other reads and writes are outside this limit. It is **per process/handler**, not a distributed fleet quota, fairness guarantee or general denial-of-service defense. Two slots is a conservative initial bound, not measured pilot throughput. Multiple processes multiply the bound; stalled underlying operations can keep both slots occupied until their existing timeouts settle.

`ops/coordinator-registration-stress.mjs` now runs the affected successful-pagination scenario at two concurrent requests. Its permission-rejection scenario also uses two so overload does not obscure the expected 403 assertions. No unexpected 503 is accepted as success. A separate deterministic handler test exercises the 150-request overload case. The real database stress script was not run in this phase; lowering scenario concurrency is a workload-contract change, not evidence that the historical root cause was fixed.

## Verification

Completed locally:

- Targeted Node suites: **25 passed, 14 skipped, zero failed** across coordinator admission, follow-through, feedback, lifecycle, access, sharing policy, production configuration, applications, binder viewing and plans. PostgreSQL cases were skipped; plan repository cases use pg-mem and do not validate migration 068.
- A deterministic 150-request handler test: two admitted; 148 immediate 429 responses before database/provider work; bounded active work; slots recovered after simulated provider failures.
- Six synthetic browser journeys: English and Spanish at 1280, 390 and 320 pixels. Real components exercised generic notification opening, current publication, coordinator suggestion, student correction/explicit acceptance, private plan isolation and explicit reply. No uncaught browser errors or horizontal overflow. The narrow Spanish coordinator screenshot was visually inspected.
- TypeScript, production Vite build with native config loader, production logging policy, stress-script syntax and whitespace checks. Existing Auth0 directive and bundle-size warnings remain.

Browser verification used a separate local headless Chrome profile, synthetic identity/API responses and an isolated Vite preview. It did not use the user's signed-in browser profile, real accounts, real provider services or a PostgreSQL server. `scripts/coordinator-follow-through-smoke.cjs` is the reproducible harness; screenshots are in `output/playwright/student-first-phase8/`. Earlier `*-failure.png` files reflect harness selector/token setup failures before the final six-case pass, not final acceptance evidence.

Database integration cases are written in `server/coordinator-follow-through.test.mjs`: explicit/deduplicated help, generic notice shape, cancellation, derived-item guidance and replies, maintenance notification validity, idempotent private action creation and withdrawal. They remain unexecuted, along with Phase 7's source/publication race and restricted-role regression gates. SQL review alone is not PostgreSQL verification.

The existing blocker is unchanged: the authorized Phase 7 retry to start the disposable PostgreSQL cluster at `tmp/student-first-phase1-pg-20261021`, loopback port 55487, reached PostgreSQL but Windows denied binding both `::1` and `127.0.0.1`. The log ended with shutdown and readiness reported no response. This was an OS socket-bind denial, not automatic approval-review rejection. No retry or alternate-port workaround was attempted in Phase 8. No PostgreSQL cluster remains running from that failed attempt.

## Rollout, rollback and remaining gates

**Phase 9 follow-up (2026-10-21):** real PostgreSQL integration, notification/privacy and concurrency tests now ran against the authorized disposable cluster, with forward fixes through 071. Bounded registration load and a 150-request controlled-overload check passed; these do not establish production capacity or resolve the historical burst's root cause. See [PHASE_9_VALIDATION.md](PHASE_9_VALIDATION.md) for current results and remaining voice/release gates. The original Phase 8 verification limits remain historical evidence. Any future release rehearsal must include the complete ordered migrations through 071, rather than stop at 068.

`ORIGEN_COORDINATOR_FOLLOW_THROUGH` defaults to **false** in `render.yaml`. Configuration validation requires coordinator feedback and its existing sharing prerequisites. This flag controls creation of new help notifications only; existing help controls and the coordinator presentation improvements are not newly gated. `ORIGEN_DERIVED_BINDER_SHARING` remains the separate content gate and also defaults to false.

Before any approved release:

1. Run migrations through 068 against a permitted disposable PostgreSQL instance and complete Phase 7 and Phase 8 restricted-role integration/regression tests. Verify runtime and maintenance grants, rollback behavior and current-source invalidation. No production execution is authorized here.
2. Run the real organization-review stress workload at the admitted concurrency with production-like pool size/timeouts. Record p50/p95, 429/503 counts, recovery after failures and unrelated endpoint responsiveness. Retain REVIEW-BURST-001 as unresolved until this evidence exists.
3. Rehearse the existing coordinator maintenance delivery and suppression path, including removed content, membership loss and permission changes. Verify notifications remain generic and private plan edits never appear in staff views.
4. In Phase 9/10, choose the pilot cohort, coordinator response expectations and named operator. Start with at most two simultaneous organization-review operations per process. Expansion depends on measured capacity, not this synthetic admission test alone.

Disabling follow-through stops new help events; it does not erase already queued/delivered valid events or reset help requests. Existing access checks continue to govern them. Disabling derived sharing hides derived content and attached coordinator content through the normal read gate; metadata-only validity maintenance can preserve an otherwise valid generic reply notice. Its destination still reauthorizes content. Use revoke/withdraw for permanent access removal. Keep forward schema changes in place during application rollback; do not destructively downgrade tables or rewrite receipts.

Observability uses existing finite response codes (now including `coordinator_review_busy`), operation outcomes and outbox delivery/suppression/failure counts. No student prose, action text, tokens or source excerpts are added to logs. Monitor 429 frequency and duration, 503s, notification failures and permission denials using those existing signals. Automated escalation, coordinator assignments, student completion dashboards, response SLAs and new communication channels are outside Phase 8.
