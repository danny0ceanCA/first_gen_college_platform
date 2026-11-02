# Structured review requests — Phase 1, step 4

Implemented: students can prepare a coordinator review request during a voice conversation, hear the exact proposed disclosure, and explicitly approve it. The existing binder records the private draft and approved request. Coordinator delivery remains held for step 5.

## Student experience

For example, the student says, “Ask my coordinator if I might qualify for an insurance waiver.” Origen finds the student's accepted coordinator connection and can search eligible written notes in the confirmed student profile. It prepares a private draft with the independently captured student request as the original wording and its proposed question as a separate clarification.

Origen reads the entire application-generated confirmation: coordinator, organization, student, question, every selected note, access end date, withdrawal option, and the disclosure that delivery is still queued. It then asks whether the student approves that exact selection. A complete English or Spanish approval such as “Yes, please” or “Sí, por favor” in the immediately following student turn can record approval. It does not record coordinator receipt, review, resolution, or a successful outcome.

The binder refreshes when the private draft or approval is saved, using the existing **My requests** history and note annotations. Students can inspect the original words, choose another preview, withdraw, or delete through the notebook controls. This adds no captions, chat interface, or coordinator layout changes.

## Consent and scope

The model receives three tools: discover choices, prepare a private request, and confirm the current request. It cannot supply a student identity, consent boolean, approval transcript, presentation evidence, or a different request ID through tool arguments. The browser registers the independently observed student transcript with the API; the server binds it to an authenticated, server-issued voice session, current permission revision, and turn sequence.

The server creates the same exact preview used by notebook approval. A hash binds the complete expected readback. Browser evidence requires matching response creation, output playback starting, completed generation, full output transcript, and audio drain while playback is available. Comparison tolerates case, punctuation, spacing, and accents; it does not accept semantic paraphrases or omitted content. The immediately next independently registered turn must contain an allowlisted affirmative, within two minutes of presentation and before the ten-minute preview expires. The canonical submission transaction rechecks recipient, source versions, permissions and expiry before writing the publication and queued notification together.

Incomplete playback, interruption, inaudible playback, corrections, a later “yes,” changed source notes, superseded previews, revoked permission, changed student/session, and end-of-call forced flush cannot provide approval. A new user turn fences late tool results. Repeated delivery of one tool call shares one operation; the database prevents a second preparation in the same turn and repeated approval returns the existing receipt. An uncertain write result directs the student to the binder rather than claiming success or retrying automatically.

This is application-observed confirmation, not proof of comprehension or an independently authenticated audio recording. Realtime supplies output events; Live has continuous audio, so its adapter uses local audio idleness plus the complete expected transcript. A forced flush is separately labeled and rejected. Both paths still depend on provider transcription and browser playback signals. Live-provider speech accuracy and real-device audibility remain release-validation work.

## Boundaries

- Available only for authenticated eligible student accounts in a confirmed student scope. Parent, unresolved, and onboarding contexts do not receive these capabilities.
- Preparation requires an explicit request in the current transcript. If recipient or question clarification takes another turn, Origen asks for a complete restated request. Mentioning a coordinator or expressing uncertainty alone does not start a request.
- Voice selections allow at most three eligible manual notes and a readback of at most 6,000 characters. Longer selections roll back preparation and use the notebook. Original request and proposed question each retain the existing 2,000-character limit.
- Voice sessions expire after 15 minutes. Closing/replacing a session clears pending evidence; an expired session falls back to notebook controls. New preparation, selection, or wording requires a new readback and approval.
- No full conversation, family material, unselected notes, recommendation score, or claimed outcome is added to the coordinator publication.

## Persistence and rollout

Migration `098_review_request_voice.sql` adds the restricted `origen_review_voice_sessions` table and `origen_review_voice_command(jsonb)`. Runtime access is limited to the scoped command; the table has RLS and no direct runtime grant. Session records contain identifiers, hashes, sequence numbers and timestamps, without additional stored audio or whole-turn transcript copies. The existing request intentionally retains the student's original request wording.

Publication receipts add `approvalMethod` and `readbackAt`, including in existing owner export. Temporary consent expires through coordinator maintenance, is discarded on restore, and cascades with student/account deletion. Existing request withdrawal, deletion, source invalidation and durable notification behavior are reused. The new API endpoint follows authenticated account isolation, bounded input, strict fields and no-store responses; prose is not added to telemetry.

`ORIGEN_REVIEW_REQUEST_VOICE=false` and `ORIGEN_REVIEW_REQUESTS=false` remain the deployment defaults. Development enablement requires migrations through 098, refreshed restricted runtime grants, and both flags plus coordinator accounts, linking and binder sharing. Startup checks migration and command access when voice requests are enabled. Existing notebook history and withdrawal remain available when voice creation is paused. No new paid service or database is required.

Step 5 integrates the existing coordinator destination and enables delivery. Step 6 completes the overall end-to-end release verification. These are still outstanding; this implementation has not been deployed or applied to production.

## Verification

- **142 selected automated tests passed**, with no failures or skipped tests: request records, previews/submission/notebook discovery, voice tools and client bridge, both voice-provider configurations/adapters, live memory, coordinator lifecycle, account lifecycle, sharing policy and production configuration. After the final bilingual request-recognition adjustment, all **21 voice-specific tests** passed again.
- The real client bridge was exercised against the HTTP handler and isolated PostgreSQL, including exact approval, negative cases, duplicate confirmation, withdrawal, stale notes, account isolation, oversized-readback rollback, permission changes, paused rollout and restore cleanup. Authenticated provider negotiation and guide updates use synthetic provider responses.
- `scripts/review-request-voice-smoke.cjs` passed two Chromium journeys using actual `ProfileVoice` and binder components against scoped PostgreSQL APIs: desktop English at 1280px and mobile Spanish at 390px. Each tests an interrupted private request followed by a fully played approval, then checks the binder history. Auth, microphone, provider negotiation and speech are synthetic.
- TypeScript/Vite production build, logging policy check and `git diff --check` passed. Existing bundle-size warnings remain. One old onboarding test assertion was aligned with the already-existing prompt wording; a comparison against HEAD confirmed that onboarding instructions themselves are unchanged.

Verification used the isolated local PostgreSQL wrapper, which excludes application credentials. No live model call, external notification, production migration, deployment, commit, push or pull request was performed.
