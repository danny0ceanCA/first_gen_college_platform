# Home experience — phase 3: From ideas to action

Implemented locally on October 10, 2026, building on the phase 2 topic notebooks.

## User experience

Home now includes **My next steps**, an account-backed plan. A person can add an action directly or choose **Make an action** on a notebook entry. That opens an editable draft; it does not automatically commit a suggestion to their plan. The person supplies a title, reviews the action, optionally sets a personal target date and notes, and explicitly accepts it before saving. Actions can join an existing active plan or a new plan.

Saved actions support editing, progress states, completion/reopening, removal, and plan archiving/restoration. Dates are described as personal targets rather than official deadlines. Completion is explicitly labeled as reported by the user, not verified achievement. Saved source links are available with a reminder that they have not been checked again for the action.

Topic notebooks distinguish **Decisions I made** from **Questions to revisit**. Saving a decision requires confirmation that it is an actual decision, not an option being considered. Existing AI suggestion extraction cannot create decisions. A notebook entry can be changed back into a question. Converting an entry to an action preserves the original entry; the accepted action is a separate copy.

Parents can choose the selected student's plan or the family plan. Ownership is visible and every plan remains private to the signed-in account. Plans and notes are not automatically shared with family-linked accounts, institutions, or research datasets. Interface labels, errors, and controls support English and Spanish; user-written plan content is preserved as written.

Planning now has a shortcut to saved actions. The existing guidance-chat action shortcut opens the same review flow on Home instead of routing to a profile page that did not consume the action draft.

## Persistence and recovery

The home planner uses the existing authenticated `POST /api/plans` endpoint and normalized plan/step/source tables. The unused browser-local plan state in App is no longer the authority for plans. Existing browser-only steps are offered for review in the matching account and student scope; preview data is excluded. Import preserves tentative wording, progress, and original deadline text. Invalid dates are left unset, unsafe source URLs remain plain text, and batches contain at most 30 actions. Import requires explicit acceptance and leaves the browser copy intact.

Drafts remain in component memory by account and student/family scope, including ordinary app navigation. Reloading with an unfinished draft invokes the browser's unsaved-change warning. Failed saves keep drafts. Version conflicts require refreshing and explicitly reviewing the latest saved actions before applying the draft. Ambiguous create retries use receipts, and a previously saved addition can be recognized rather than appended twice.

Migration `032_home_actions.sql`:

- Allows the explicitly confirmed `decision` notebook kind.
- Adds account-scoped `origen_plan_creations` receipts. A receipt survives plan deletion so a delayed retry cannot resurrect a deleted plan. It is removed on account deletion.
- Adds `origen_plan_note_links`, recording the original note ID/version for an accepted action. Deleting a note removes the reference, not the separately accepted action. Deleting the action or plan removes its links.

Create receipts are fingerprinted against the validated draft. Reusing the same request ID with a changed payload fails with a conflict. New plans are capped at 200 per account, with 30 actions per plan. Scope, account ownership, note version, and source-summary ownership are checked server-side. A plan's student/family target remains immutable. Migration availability is returned explicitly; the new UI does not silently fall back to local storage if the backend is not ready.

Deleting a source conversation removes its linked notebook entries as described in phase 2, but independently accepted actions remain. The confirmation explains this distinction. Account export includes plan receipts and note links; account deletion cascades them. Progress reporting continues to record existing plan revisions and user-reported completions.

## Voice and cost

This phase adds no model, transcription, or web-search calls. Existing planning voice context can already read saved plans within its confirmed student/family scope. Automatically incorporating the new structured notebook decisions and questions into voice context remains phase 4 work; this phase does not restart or change live voice sessions.

## Validation and rollout

- TypeScript and the Vite production build pass. Existing large-bundle and Auth0 directive warnings remain.
- Full server suite: **380 passed, 10 skipped, 0 failed**. New tests cover idempotent creation, deleted-plan retries, note scope/version checks, source lifecycle, decision confirmation, account export/deletion, and legacy import handling using the actual migrations and repositories in pg-mem.
- The synthetic Playwright workflow passes: explicit acceptance, note preservation, dates, progress, conflict recovery, student/family isolation, legacy review and retry, reload persistence, archive/restore, deletion, failed-load recovery, decisions/questions, English/Spanish, and 390px/320px layouts. Screenshots were visually reviewed. Browser API responses are synthetic; no production data or paid model calls were used.
- Scripts and screenshots: `output/playwright/home-actions-phase3-*`. Server test log: `output/home-actions-phase3-tests.txt`.

Migration 032 must be applied after 031 through the numbered migration runner when deploying the backend. This phase has not been committed, pushed, migrated in production, or deployed.
