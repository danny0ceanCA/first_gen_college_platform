# Structured review requests — Phase 1, step 3

Implemented November 1, 2026 on top of [step 2](REVIEW_REQUESTS_STEP_2.md). This step connects the existing approval backend to the student notebook. It does not change the coordinator layout or register a voice tool.

## Student experience

The student can select **Ask my coordinator** on a saved manual note, or **Write a request** beside the binder. The note entry point selects that exact note version; the student supplies their own question. They choose an accepted coordinator connection and a question, concern, or review request. Supporting notes are optional, grouped by topic, and limited to 20 selected versions. Notes from conversations, family sources, and other ineligible sources are not offered by this initial review-request contract.

**Save private draft** stores the question without sharing it. **Preview request** first saves a private draft, then displays the server's exact question, coordinator and organization, student name, selected original-language notes, and access expiry. The approval button stays disabled until the student checks the explicit approval box. A fresh or expired preview requires a fresh check. Where an existing draft has proposed clarification, the student can preview that wording or the original words before approval.

**My requests** shows five entries at a time, with older history available on demand. The questions use the binder's locally served handwritten font; recipient, dates and state remain in readable interface type. First-person entries distinguish a private draft, approval awaiting delivery, delivered notice, withdrawn request, and ended access. A delivered notice never implies review or success. Each associated note has a current request annotation that opens that exact request, including requests outside the first history page.

Students can cancel private drafts, withdraw submitted requests, or explicitly confirm deletion. Original notebook notes remain. **Write revised draft** creates a new private request from the previous question, preserving the earlier record. It rechecks the supporting note versions and asks the student to choose again if any changed; it does not substitute revised note text or alter an approved request. A student without an accepted connection can open the existing coordinator connection controls.

The experience is available in English and Spanish and uses the existing accessible dialog surface: focus containment/restoration, Escape dismissal, scroll locking, touch-sized controls and reduced-motion support. Unsaved composition prompts before dismissal. The provider is scoped to the signed-in account and selected student; parent views do not mount it.

## Reliability and privacy

- A lost draft-save response retains the same creation retry key and locks the submitted form until the student retries or leaves. A failed preview after a successful save returns to the saved draft rather than creating another request.
- An uncertain approval response exposes **Check saved request**. It reads the existing receipt before offering another approval. Changed or revoked previews cannot be approved locally, and the backend independently revalidates every submission.
- Browser copies of requests and previews are kept in component memory. Closing clears the composer and preview; account/session changes clear all private state. Scope guards reject late responses after switching student or signing out. Connection/sharing changes and cross-tab request updates invalidate stale previews.
- New-request rollout can be disabled while history, withdrawal and deletion remain available. All ownership and sharing checks from steps 1–2 still apply.

## Backend additions

Migration `097_review_request_notebook.sql` extends the existing scoped command with two owner-only actions. There are no direct runtime table grants or new externally callable helpers.

| Action | Input | Result |
| --- | --- | --- |
| `list` | `studentId`, optional `before` request UUID | Up to 30 owner/student records in stable creation order, next cursor, capability flags, and content-free current note annotations |
| `options` | `studentId` | Current eligible manual note IDs, versions and original text, plus accepted active coordinator connections |

Cursors must belong to the same account and student. Annotation metadata covers retained history independently of pagination and includes no question or note prose. Note options use the existing 2,000-note account capacity and sharing eligibility function with derived sharing disabled. Discovery does not create previews, approvals or notices. Submission still calls the step 2 transactional implementation.

Startup now requires migration 097 when `ORIGEN_REVIEW_REQUESTS=true`. Enable coordinator accounts, linking and binder sharing as prerequisites, and refresh restricted runtime grants using the existing operator process. No additional credentials or paid service are needed for this step.

## Stage boundary

`ORIGEN_REVIEW_REQUESTS` remains **false** in `render.yaml`. This work has not been deployed or applied to production. Coordinator delivery remains held until step 5; the notebook explicitly says approval queues the request and the coordinator has not received it yet. Keep production rollout disabled until that integrated destination and delivery workflow are ready.

Step 4 adds spoken requests and explicit readback approval. Step 5 connects the existing coordinator interface and enables delivery. Follow-up outcomes and a recommendation algorithm are later work.

## Verification

The selected real-PostgreSQL regression run passed **96 tests with no failures or skipped tests**, covering the new notebook discovery contract, existing draft and submission workflows, sharing stop controls, coordinator lifecycle, account isolation/deletion/export, privacy recovery and the API gateway. The notebook contract suite was also rerun after the final annotation metadata change. Databases and identities were synthetic and disposable; the wrapper excluded production credentials.

`scripts/review-request-notebook-smoke.cjs` exercises the real React components against deterministic synthetic transport at 1280, 390 and 320 pixels in English and Spanish. The six journeys cover note selection, explicit approval, reload, paused withdrawal, confirmed deletion, lost save/approval responses, preview expiry, stale-source rejection, profile switching and privacy cleanup. Desktop English and narrow-screen Spanish additionally exercise the actual `TopicNotebook` integration and parent-role exclusion. Screenshots are inspected for wrapping and horizontal overflow. The browser checks do not claim live Auth0, provider, coordinator-delivery or production coverage.

The TypeScript/Vite production build and logging policy check passed. Existing bundle-size and Auth0 module-directive warnings remain. Local verification used Node 24, PostgreSQL 17 and Chromium; CI uses Node 22 and PostgreSQL 18. No live model call, external notification, production migration, deployment, commit, push or pull request was performed.
