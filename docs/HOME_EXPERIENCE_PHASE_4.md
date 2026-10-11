# Home experience — phase 4: voice connected to saved work

Implemented locally on October 10, 2026. This phase connects the topic notebook and accepted actions from phases 2–3 to the shared live conversation.

## User experience

- **Talk about this** uses the Origen circle button on each topic, saved notebook entry, and saved action in an active plan. It is available in English and Spanish. Unaccepted suggestions do not have this control.
- Starting from a saved item explicitly selects its student or family scope. Origen is instructed to begin with Hola (silent h), connect briefly to the selected work, and ask at most one useful question. It skips a generic introduction or repeated scope confirmation.
- During an active call, a selection waits for the current reply's audio playback to finish. It updates instructions and tools through the existing connection without cancelling the reply, changing the audio configuration, or repeating Hola. The current spoken language is preserved.
- The selected work remains available when the guide changes specialties. The latest spoken question takes priority, so retaining context does not force the conversation back to an earlier task.
- A screen selection for a different student or family scope does not inject that person's saved work into a confirmed call. A visible message asks the user to end the current call before starting from the other scope. The existing spoken student-confirmation workflow remains available.
- Changed or deleted selections show a recoverable message while an existing call stays connected. The user refreshes the notebook or plan before selecting the updated item. A background specialty refresh can fall back to current general context when the old selected item is no longer valid.

The conversation details panel can now open correctly; its existing CSS previously hid it even when expanded. Pending-selection and recovery messages are visible in the compact voice bar. The idle button follows the app's interface language after a call ends.

## Context and conversational meaning

The authenticated backend loads context from the database. Client-provided workspace text is discarded. A selection contains identifiers, topic, target, and the saved version; ownership, student/family scope, status, and version are checked again when loading it.

The context is a partial snapshot, not a complete account history:

- Up to six saved notes, prioritizing the selected entry and confirmed decisions or unresolved questions.
- Up to five actions from active plans, prioritizing the selected action and unfinished work.
- The owned source summary of a selected conversation-derived note, when available, plus the existing conversation-memory mechanism.
- At most 10,000 characters of serialized workspace context. Long entries are explicitly excerpted. Automatic retrieval considers the 120 most recently updated notes and 120 action rows within the account and scope. An explicitly selected older item is fetched separately so it is not lost to that limit.

The instructions distinguish explanations from evidence of learning, questions from preferences, and saved decisions from immutable facts. Action completion is user-reported. Personal target dates are not official deadlines. Origen should check whether an older decision still applies, ask one focused question when context conflicts, and follow current spoken corrections within the call.

Voice does not silently edit notes or actions. Lasting corrections still require the user to edit the notebook or plan. Saved text is treated as data rather than instructions; private notes must not be copied into research queries. Current requirements still need official-source verification. The model is instructed to reference at most one useful contextual detail instead of reciting the notebook or repeatedly asking about unfinished tasks.

## Privacy, storage, and cost

The UI explains that talking about a saved item shares relevant saved notes, actions, and summaries with Origen. Unsaved drafts and suggestions that have not been accepted are excluded. Student and family contexts remain separate and private to the owning account. Screen selections are supplied as control messages, not fabricated user transcriptions. Guidance configuration fingerprints omit personal workspace content.

No new migration is added. Topic notebooks depend on migration 031 and phase 3 decisions/actions depend on migration 032. Existing generic voice can still use legacy plans if the notebook table is absent; an explicit notebook selection reports that saved work is unavailable.

There are no added extraction or search calls solely to load this context, and no extra Realtime connection for a topic change. Context is read at call setup or guide/focus updates, not every home render. The additional input text still contributes to model usage; the bounded snapshot limits that cost but does not make it free.

## Verification and rollout

- TypeScript and the Vite production build passed. Existing Auth0 directive and large-bundle warnings remain.
- Full server suite: **387 passed, 10 skipped, 0 failed**. Tests cover authorization and scope, unaccepted suggestions, version conflicts, edits/deletion, source ownership and deletion, action status and personal dates, bounded context, background refresh recovery, unchanged audio configuration, and waiting for actual playback completion.
- The synthetic Playwright workflow passed at desktop, 390px, and 320px widths. It covers note and action launches, topic switching during playback, one connection across topics, Spanish continuity, stale-item recovery, student/family isolation, and the Spanish family launch. Desktop and mobile screenshots were visually reviewed.
- Browser requests, WebRTC, and audio events were simulated. No production data, microphone recordings, or paid model calls were used. The fixture's intentional API errors and browser-blocked Vite hot-reload socket are distinct from application exceptions; no page exceptions occurred. Actual spoken warmth, pronunciation, and acoustic continuity still need a human listening test.

Evidence: `output/home-voice-phase4-tests.txt` and `output/playwright/home-voice-phase4-*`.

This phase has not been committed, pushed, or deployed. Production requires the backend and frontend updates together, with the earlier migrations already applied.
