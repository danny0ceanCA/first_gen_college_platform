# Connected coordinator responses — Phase 2, step 2

Implemented locally November 1, 2026. This step adds bounded response retrieval and freshness controls to the existing voice recall path. `ORIGEN_REVIEW_RESPONSE_CONTEXT` remains **false** in deployment configuration. No production database or provider was used, and no deployment was performed.

## Retrieval behavior

`server/review-response-context.mjs` supplies `loadReviewResponseContext`, single/batched verification, and the authenticated `POST /api/review-response-context` endpoint. Lookup accepts exactly one student ID plus either a typed `focus` reference or a bounded `query`. Verification accepts the same student scope and one guard or up to eight guards. Neither endpoint writes student activity, plans, requests or messages.

An explicit focus identifies the request and exact response version defined in step 1. It never substitutes newer advice. An available historical receipt can be selected explicitly within the currently authorized student's AI scope. A withdrawn response, deleted request, wrong student/account, parent/family scope, or expired/revoked AI permission supplies no body.

Spoken-question matching uses normalized English/Spanish words and a small college-topic vocabulary, such as insurance/seguro and waiver/exención. It matches words in the approved question, not substrings, unrelated note text, unapproved original wording, or arbitrary response prose. Merely sharing a binder divider does not make a response relevant. Generic-only and unrelated queries return `none`. This deterministic approach is deliberately conservative; it does not claim semantic understanding of every paraphrase.

Question lookup considers only current publications and each request's latest response version. Matching happens before the candidate limit, so thirty newer unrelated requests cannot hide an older relevant one. Candidates are ordered by response update time and ID. One match permits one full response. Multiple matches require clarification; more than thirty matches also requires clarification. At most three choices are returned, each containing a versioned reference, a question excerpt of at most 240 characters, attribution and date. Choices never contain response bodies. Historical receipts are excluded from question matching.

A retrieved response includes its approved question, language/kind, author, organization, dates, exact source version, current/historical status, guidance, optional suggested action/resource/follow-up date, and `untrusted: true`. It excludes private original wording, selected or unrelated notes, family material, staff-only data, delivery/opening activity, and plan records. Existing field limits bound the one response body; query length is capped at 1,000 characters. Links are returned as reference data and are not fetched by this lookup. PostgreSQL remains the only required storage service.

## Voice integration and per-turn limits

The existing `/api/live-memory` recall service derives student scope from its owned live session. It uses the independently captured, registered transcript for response matching; a model-generated search query cannot select a different coordinator request. The existing session/turn/transcript checks run before and after retrieval.

New clients send the compatibility marker `responseContextProtocol: 'review-response-v1'`. This only declares support for freshness handling. The server still requires the default-off response capability, review requests/binder sharing, eligible personalization retrieval/cohort, authenticated ownership and current AI permission. Client flags never enable those capabilities. Older open clients receive their existing recall response without new coordinator context, even if a later rollout enables the feature.

Migration 101 adds content-free fields to the existing live-session record that bind one request, response version and context revision to a verified turn sequence. Concurrent or repeated lookups cannot replace that turn's response with a different response/version. The existing session expiry, deletion and restore cleanup apply. These fields contain neither advice nor transcript copies and do not record that the student opened, discussed or accepted anything.

The shared Live/Realtime recall controller checks the response before forwarding it and removes the application's guard metadata from the model tool result. Basic retrieval instructions identify the advice as untrusted attributed data, prohibit outcome/acceptance claims and require clarification rather than guessing. The richer conversational guidance, bilingual explanation evaluation and source-checking behavior remain step 3. Binder controls remain step 4; the focus API is ready for those controls.

## Freshness, interruption and restore

Each loaded response has a content-free revision hash covering its exact version, update timestamp, permission revision/expiry, request/publication state, retrieval mode and a restore generation. Retrieval rechecks this state in a fresh database statement before returning a body. The live service rechecks again after its turn/scope checks. A change during loading discards the result.

`src/reviewResponseContext.mjs` retains only references and revision hashes, with at most eight loaded sources per call. It batches periodic verification into one request every five seconds, verifies before further tool processing, and checks a newly retrieved response before releasing it to the model. Returning online, going offline or changing document visibility also triggers verification. Cancellation, scope changes, late results and conflicting versions cannot reactivate old context. Batching keeps the number of HTTP requests independent of the number of loaded sources.

`ProfileVoice` connects invalidation to the existing `invalidateRememberedContext` path: stop the affected call and playback, discard the stale in-memory conversation and automatic summary attempt, and invite the student to start a new conversation. Failed verification also ends the affected call. Existing acknowledged recovery-checkpoint handling remains in place. A new response version is not quietly swapped into a provider conversation that may still contain the previous version.

Database retrieval/verification operations have a one-second request deadline and a 700 ms statement timeout. Browser verification has a five-second deadline. Checks are point-in-time observations; polling and browser scheduling leave a detection window. Closing a call does not prove that provider-held context was erased. No such erasure claim is made.

Restore now rotates an independent random context generation for every retained response, through an operator-only helper. This invalidates older guards even for already-historical receipts and repeated restores of the same backup. Existing response-version fences still scrub withdrawn, mismatched or unlisted bodies; request deletion receipts still replay. The restore helper has no runtime or PUBLIC execution grant.

There is no linked action writer in this step. A future linked action or clarification writer must revalidate and lock its source inside its own authorization/commit transaction. A freshness guard or client preflight is not consent and is not sufficient authorization for a later write.

## Rollout and validation

Migration `101_review_response_context.sql` follows migration 100. Runtime provisioning grants only the scoped context command; response tables remain inaccessible directly. Startup and the read-only coordinator readiness command check migration/EXECUTE prerequisites when applicable. The new HTTP route uses the normal authentication, current AI permission lease, rate limit, origin checks and no-store response policy. It is not a privacy-control exemption.

The deployment setting stays off. Enabling it later also requires the existing review-request and personalization retrieval prerequisites and a compatible client. Pausing it prevents new retrieval and invalidates active guards while preserving owner binder history and withdrawal/deletion controls. This step does not enable coordinator outcome tracking, automatic reminders, private action acceptance or related-request sharing.

Final local verification: **124 tests passed, zero failures, cancellations, skips or todos**, including 21 new server/client tests. Coverage includes exact focus, English/Spanish relevance, word boundaries, generic/unrelated questions, candidate saturation, ambiguity, cross-account/student/role isolation, stale reads, concurrent per-turn limits, older-client compatibility, batched verification, delayed results, deadlines, server pause, permission loss, withdrawal, deletion, restore, existing Live/Realtime behavior, migration upgrades and readiness checks. TypeScript, production logging checks and the isolated Vite production build passed. The existing large-bundle warning remains. Validation used Node 24 and PostgreSQL 17.

All database tests used disposable schemas and synthetic identities on the isolated local PostgreSQL instance, with application/provider credentials excluded. No new paid database, Redis instance, vector service or dependency was added. Actual provider speech, deployed authentication, physical-device audio and the complete Phase 2 browser journey remain unverified; step 6 covers the integrated release rehearsal. The earlier Phase 1 release report certifies its earlier source snapshot only.
