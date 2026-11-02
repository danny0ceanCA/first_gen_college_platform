# Structured review requests — Phase 1, step 5

Implemented: approved requests reach the selected coordinator's existing workspace. Coordinators can explicitly mark a request reviewed and share a structured response. Students see the response and accurate request status in their existing binder. This completes coordinator delivery integration; production enablement and overall release verification remain step 6.

## Experience

An approved question about a health insurance waiver creates a durable, content-free in-app update for the selected coordinator. Opening that update loads only the student's approved question and selected notes. Drafts, unapproved original wording, other notes, conversations and family summaries remain private. The request card is added to Overview and Shared binders; the existing navigation, organization controls and shared-binder interface remain intact.

The coordinator can mark the request reviewed independently of sending a response. The response contains required guidance and optional suggested action, HTTPS resource link and suggested follow-up date. The date does not create a reminder. Responses can be edited with version checks or withdrawn; withdrawal scrubs the prose and prevents an old retry from republishing it.

The student receives an in-app update that opens the request in **My requests**. Their binder shows the coordinator's response with separate sections for guidance, action and resource. The student's journal distinguishes pending delivery, delivered, opened, reviewed, responded and withdrawn/access-ended states. None of these records a completed student action, resolution or successful outcome. Collecting outcomes and recommending successful interventions remain later work.

The notebook and voice approval paths use the same publication and delivery queue. Voice readback describes the current delivery capability, and confirmation describes the actual receipt. Voice still requires the complete exact readback and explicit next-turn approval from step 4. No captions or chat interface are introduced.

## Access and reliability

- Staff access requires authenticated and verified identity, active organization membership and coordinator status, a current student permission/connection, an unexpired publication and the exact selected recipient. Colleagues and organization owners gain no additional access to a request.
- A request becomes visible to the coordinator after its durable notification is delivered. Listing returns bounded metadata pages; reading loads the approved content after fresh access checks. Notifications contain identifiers and status metadata, without student or coordinator prose.
- Approval, response and notification writes are transactional. Response retries use an operation identifier, payload fingerprint and expected version. A lost browser save confirmation offers **Check saved response**, which reloads the saved record before further submission.
- Source changes, student withdrawal, expiry, deletion and permission changes end coordinator access through the existing canonical invalidation rules. Pending notifications recheck access during maintenance. Invalid links cannot expose the request.
- A student who withdraws a request retains the previously received response privately. Deleting the request removes its response as well. Coordinator response withdrawal scrubs that response. Existing owner export includes the structured response.
- Restore manifests contain only response version/withdrawal markers. Restoring older, withdrawn or unlisted responses scrubs their prose. Restored request access is revoked and requires fresh authorization through the existing restore procedure.
- Private coordinator content and drafts clear on account/organization changes, blur, offline and privacy lifecycle events. Active views recheck access periodically and have a bounded failed-verification window. Long publication lifetimes use a timeout that respects the browser's maximum timer duration.

## Storage and rollout

Migration `099_review_request_delivery.sql` adds publication opened/reviewed timestamps, the restricted response table and the scoped coordinator command. Responses have one current version, not an indefinite collection of old prose. Runtime grants permit only the scoped command; the raw response table has RLS and no direct runtime access. The authenticated endpoint is `/api/coordinator-review-requests` and returns no-store responses.

The existing coordinator maintenance worker checks the queue at startup and every 30 seconds. Delivery means the update is available in the authenticated workspace; it does not mean the coordinator has opened it. Student update polling and ordinary refresh reveal the durable notification. No email, SMS, Redis service or additional database is added.

All three request flags remain **false** in `render.yaml`. Development activation requires migrations through 099, refreshed restricted runtime grants, the existing maintenance credential, coordinator viewing and its prerequisites, `ORIGEN_REVIEW_REQUESTS=true` and `ORIGEN_REVIEW_REQUEST_DELIVERY=true`. Spoken approval additionally requires `ORIGEN_REVIEW_REQUEST_VOICE=true`. Startup checks reject enabled delivery when migration or command access is missing.

Pausing delivery holds new request/response notices and blocks coordinator request reads and responses. Student history and withdrawal remain available. Existing delivered receipts retain their actual status; the UI does not falsely claim earlier deliveries never happened. A coordinator can withdraw their response through the scoped command while delivery is paused, subject to their identity and recipient authorization.

## Verification

- The selected backend regression run passed **114 tests**, with no failures or skips: request records, previews/submission, notebook, voice tools/client bridge, coordinator lifecycle/feedback, account lifecycle, sharing policy and production configuration.
- A subsequent focused run passed **50 tests**, including overlapping delivery tests plus pagination and both voice-provider configurations/adapters. Delivery tests cover private drafts, held queues, exact recipient isolation, allowlisted content, opened/reviewed distinction, response retry/version conflicts, failed-notification rollback, source changes, withdrawal/expiry/deletion, delivery pause, concurrent withdrawal and restore scrubbing.
- `scripts/review-request-delivery-smoke.cjs` passed **six Chromium journeys** against actual coordinator/student components, HTTP handlers and isolated PostgreSQL: English and Spanish at 1280px, 390px and 320px. Each follows notification opening, exact approved content, explicit review, structured response, a deliberately lost successful-save response, recovery without duplication, the student's response receipt and withdrawal. Viewport overflow checks passed; desktop and mobile screenshots were inspected.
- The delivery smoke also verifies recovery when another session saves the response being edited, including repeated refreshes. The existing coordinator navigation smoke passed **seven viewport/language/motion combinations** with delivery disabled, covering profile/team/connection/shared-binder views, draft guards, focus, mobile menus, loading and denied access.
- TypeScript/Vite production build, production logging policy check and `git diff --check` passed. Existing bundle-size warnings remain.

Tests used disposable schemas and restricted roles in local PostgreSQL with application credentials excluded. Browser identities and provider responses were synthetic. Production data was not accessed. No live model call, external message, production migration, deployment, commit, push or pull request was performed. Step 6 should validate the complete notebook/voice-to-coordinator journey and release configuration, including real-device voice behavior, before production enablement.
