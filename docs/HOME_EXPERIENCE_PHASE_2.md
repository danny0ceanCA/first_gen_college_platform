# Home experience — phase 2: My topics and notes

Implemented locally on October 10, 2026. This replaces phase 1's topic shortcuts with an account-backed notebook.

## User experience

Home offers four notebooks: College options, Transfer & courses, Paying for college (including loans), and Applications. Users can add, edit, move between topics, and delete notes. Entries are grouped as My notes, Things we covered, and Questions to revisit; these labels do not claim mastery, task completion, or agreement.

Parents can explicitly select family notes or the selected student's notes. Each notebook identifies its owner. Notes remain private to the signed-in account, including when that account has a family link. They are not automatically shared with another family member, an institution, or a research dataset.

The existing cohesive conversation summary remains visible above the notebooks. A user may choose a saved conversation to request up to six proposed entries across topics. Suggestions remain separate until the user keeps or edits them; dismissal does not delete the conversation. Each suggestion includes an exact excerpt from the saved summary and any original source links with their recorded check dates. These links are not advertised as newly verified. No suggestions are generated just by opening Home.

The interface supports English and Spanish. A user can request a translation of an individual entry. Translations are cached, the original remains available, and editing always opens the original text. An edit clears translations so outdated wording is not reused.

Drafts are held in component memory by account, student/family scope, and topic, and survive topic/student switches and ordinary app-section navigation (Home remains mounted). They are not written to browser storage. Closing or reloading a page with a nonempty draft invokes the browser's unsaved-change guard. Saved notes persist across sessions and devices. Optimistic versions protect against another window overwriting a note; a conflicting draft remains available, with an explicit review of the latest saved text before retrying.

## Storage and lifecycle

- Migration `031_topic_notebooks.sql` adds `origen_topic_notes` and `origen_topic_note_batches`.
- Notes have an account, explicit student or family scope, topic, kind, language, status, origin, version, timestamps, optional source-summary reference, exact source quote, and cached translations.
- A generation receipt prevents the same conversation from repopulating dismissed suggestions or overwriting edited notes. A successfully reviewed conversation with no suggestions also gets a receipt. Failed requests remain retryable.
- Deleting a source conversation deletes notes derived from it, including any edits of those linked notes, and its receipt. The interface discloses this before conversation deletion. Separately written notes remain. Deleting a student or account cascades its notes. Account export includes notes and receipts.
- The authenticated `POST /api/topic-notes` endpoint permits load/create/update/delete/suggest/translate. Client ownership fields and internal repository actions are never accepted. Every read and write checks the verified subject and exact scope. Account guards coordinate writes with account deletion; source/version checks are repeated after AI calls before committing results.
- Maximums: 2,000 notes per account, 2,000 characters per original entry, six suggestions per conversation, and 16 KB request bodies.

## Model use and cost

Suggestions use only the server-loaded saved summary. They do not send full transcripts or another student's history. Translation sends the selected original note. Both use the existing `OPENAI_MODEL_SUMMARY` setting, defaulting to `gpt-4.1-mini`, with `store: false`, a bounded output, and a 30-second model timeout. There are no new web-search calls. Suggestions require valid topics/kinds and an exact supporting quote, but still require user review because an exact quote does not guarantee a faithful interpretation.

Identical concurrent requests in one API process share a request. Persisted receipts and translations prevent subsequent duplicate generation. New suggestion/translation requests are capped at 20 per account per hour per API process. This budget resets on process restart and is not a global spend ceiling across multiple API instances. Cached results and manual note editing remain available after the AI limit. Missing model credentials do not block manual notes.

This phase does not automatically feed notebook entries into the live voice model or turn questions into plan commitments. Existing scoped conversation-summary memory remains in use; notebook-aware voice context and durable plan integration are later work.

## Validation and rollout

Backend tests use the actual migration and repositories against pg-mem: ownership and scope isolation, CRUD and idempotent creation, stale edits, suggestion validation and receipts, source deletion, cached translation, concurrent requests, editing/deletion during AI requests, hourly limits, account export/deletion, request validation, sanitized errors, and transaction rollback/release. AI requests are mocked.

Playwright uses synthetic accounts with intercepted APIs to check desktop and 390px/320px phones, English/Spanish, draft retention, edit conflicts, source disclosure, suggestion acceptance, translated/original text, reload persistence, deletion, error recovery, and empty notebooks for new users. Scripts and screenshots are in `output/playwright/topic-phase2-*`. No live user data or paid model calls were used for these checks.

The TypeScript/Vite production build passes. The full server suite finishes with 375 passing, 10 skipped, and no failures. Two stale voice-tour assertions were updated to expect the circle control introduced in phase 1. The complete synthetic browser workflow passes on a fresh session.

Migration 031 is included in the normal numbered migration runner and must be applied to each deployed backend database. Production migration, commit, push, and deployment have not been performed as part of this phase.
