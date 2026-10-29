# Verifying teaching use in administrator voice tests

Keep Realtime 2.1 as the student production default. This verification option affects administrator comparisons only.

The comparison screen defaults to natural conversation with **Verify teaching wording** off. Administrators can enable it as an optional diagnostic that requests a short exact phrase from a relevant teaching. Wording matching does not evaluate empathy or warmth and should not be used as a quality score.

Teaching authors can separately enter **Tone**, **Conversational approach**, and **Example in my voice**. Tone uses the existing `deliveryStyle` field, approach uses the optional `conversationApproach` field, and the example uses the existing `example` field. Legacy text stays intact. Teach Origen draft capture follows the same structure. Saving remains separate from publishing; no existing teaching is rewritten or republished by the upgrade.

Live receives complete relevant delivery preferences at startup. Newly retrieved revisions are sent as complete, topic-scoped parts, each below a conservative 480 UTF-8-byte bound for the provider's 500-token append limit. The receiver gets the entire field, including Unicode and trailing directions; already supplied revisions are not appended again. Realtime and research references include the same structured fields, subject to their existing topic and publication filters. Examples illustrate the educator's approach and are not scripts or facts about the student.

Migration 090 adds optional-field validation and rejects new oversized publications explicitly. The editor warns before publishing, while still allowing a draft to be saved. Existing publications and revision history are not changed. No new runtime grants are needed.

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

Regression tests cover late/missed startup events, greeting idempotency, silent sessions, streamed wording matching, backend text exclusion, account boundaries, and the separation of output from playback evidence. Structured teaching delivery also covers legacy compatibility, draft/publication isolation, complete long and multilingual delivery fields, explicit capacity errors, and natural-comparison defaults.

## Structured delivery release — October 29, 2026

Thirty focused checks passed with the real local PostgreSQL fixture, including migration 090, unchanged legacy documents, published/draft separation, runtime isolation, and both voice test modes. Additional student-handler checks confirm the approach and example reach regular admissions voice startup and topic handoff. Desktop/mobile browser checks cover editing, preview, save payloads, publication capacity warnings, and phrase verification defaulting off. The production build passed.

Three additional capped English provider calls exercised natural phrasing against the existing published revision 10, without changing the teaching or enabling phrase forcing. Both models produced audio and supportive language. Realtime initially stacked reflection questions, prompting the instruction to choose at most one rather than recite the example list. The final short rerun observed only the beginning of its response before the test cutoff; it is not a complete-turn empathy or adherence evaluation. No new structured content was published by these tests. All five provider calls together, including the earlier verification checks, had complete usage accounting and an approximately $0.191 list-rate estimate under the approved $2 ceiling.
