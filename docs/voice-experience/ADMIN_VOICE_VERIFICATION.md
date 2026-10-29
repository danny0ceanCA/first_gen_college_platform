# Verifying teaching use in administrator voice tests

Keep Realtime 2.1 as the student production default. This verification option affects administrator comparisons only.

The comparison screen defaults to **Verify teaching wording**. When relevant, the model is asked to naturally include a short exact phrase from a supplied teaching explanation. Administrators can disable this request to compare unconstrained phrasing.

Each result distinguishes:

- **References supplied:** published teaching IDs and revisions loaded initially or returned by the library tool. This is availability, not proof of use.
- **Spoken transcript received:** provider output transcript events, excluding user input and backend reasoning/text.
- **Matching wording observed:** at least eight consecutive words from an explanation occur in the spoken output transcript. The matched teaching revision and phrase are retained with the run.
- **Audio:** provider audio events when available, and a separate browser playback report based on nonzero inbound audio energy while the audio element is playing. Browser reporting is not proof that a person heard the sound.

These are observable checks, not a guarantee that every future answer follows every teaching or that a paraphrase did not use one. No matching wording means **unconfirmed**, even if references were loaded. A media-ready session with no provider output stops after 20 seconds and is marked as a failed silent test. Raw transcripts and recordings are not persisted by this feature; only matched library wording is retained.

## Live startup

Live has a developer input seed for the greeting. After its media channel opens, the browser sends an authenticated, owner-scoped `ready` request. The server sends greeting commentary once over the attached sideband. It does not depend on receiving the initial `session.started` event again on the browser channel. Repeated ready requests do not repeat the greeting.

## Actual provider check — October 29, 2026

Two English synthetic-microphone conversations used the real React component, WebRTC, provider sideband, and current published teaching content. Authentication, audit writes, and run storage were isolated test fixtures; production student data was not used or modified. Responses were capped at 500 output tokens, calls had a 55-second watchdog and six-response limit, and $1.90 was reserved under the approved $2 ceiling.

Both GPT-Live-1 and Realtime 2.1 produced spoken transcript matches against **Student background - Essays, revision 8**, with browser audio playback reported. Live also performed a library tool lookup. Its matching phrase was “even when they don't appear on a transcript.” Final usage accounting was complete for both: Live approximately $0.016884; Realtime approximately $0.038640; combined approximately $0.055524. These are API list-rate estimates, not invoices.

The two actual calls were English. English/Spanish prompt and delivery contracts also have automated regression coverage; this check does not claim a new Spanish live call.

Regression tests cover late/missed startup events, greeting idempotency, silent sessions, streamed wording matching, backend text exclusion, account boundaries, and the separation of output from playback evidence. No additional migration or runtime database grant is required beyond migration 089.
