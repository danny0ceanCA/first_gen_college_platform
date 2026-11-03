# Private voice diagnostics

Requested by Daniel on November 3, 2026 for **danielgojeda.1@gmail.com**. This feature requires migration **122**, runtime and maintenance grants, and a deployment. Its presence in a local checkout does not enable production capture.

Migration 122 and scoped API/maintenance grants were applied to production on November 3, 2026 at 15:57 UTC and independently verified through Render. Row security and all three policies are present. Application deployment remains pending. Production's previously applied migration 121 differs from this checkout; it was left unchanged. Migration 122 was applied alone through the standard runner with its ledger and advisory lock.

The browser requests capture only for this account. The server independently verifies the authenticated subject and verified email through Auth0 UserInfo; a body email or editable profile field cannot enable it. Other accounts receive 403. Reads use the same identity restriction and account scope. Coordinator and reporting policies do not expose this archive.

An operator can instead set `ORIGEN_PRIVATE_VOICE_CAPTURE_SUBJECT` to this account's existing authenticated Auth0 subject. When configured, the exact subject replaces repeated UserInfo checks; no other subject is accepted, even if its email matches. This binding must come from independently confirmed account identity, never a request body. Permanent authorization/payload rejection pauses uploads; transient failures retry with backoff. The displayed diagnostic ID now identifies the conversation session rather than only its initial HTTP request.

## Evidence retained

- Completed and available partial provider transcripts from both speakers.
- Browser diagnostic events, connection/playback transitions, interruptions, errors, tool names, arguments and returned outputs.
- Context instructions received by the browser and subsequent session updates.
- Session, attempt, sequence, browser event time, and server receipt time.

These are observed application/provider events, not the model's private internal reasoning. A supplied teaching is not proof it was applied. A transcript is speech recognition evidence, not a recording of what a person actually heard. Browser context receipts do not prove that every provider-internal input was exposed or used. Raw audio and hidden reasoning are deliberately excluded.

The data is stored separately from operational logs in `origen_private_voice_capture`, with 90-day expiry, account deletion cascade, student deletion cascade for established student references, and a scheduled purge in the diagnostic retention job. Onboarding references not yet saved as student records are retained as client-reported metadata with no student foreign key. They do not grant access to another student's records.

Uploads use bounded batches, retry failures, and reuse event IDs for idempotency. Larger context is fragmented and can be reassembled by `fragmentId`, `index`, and `count` before parsing the joined JSON. Partial transcript events must not be concatenated with their final transcript as separate utterances. A bounded browser queue may emit `capture.gap` when overwhelmed. Tab termination, offline operation, authentication expiry, and rate limits can still cause incomplete capture. The UI reports acknowledgments or pending uploads, not a promise of perfect recording.

## Reviewing evidence

Authenticated POST `/api/private-voice-capture` with `{ "action": "read" }` returns the newest 1,000 unexpired events belonging to the verified caller. Include `sessionId` to narrow to one conversation. If `next` is non-null, send it back as `before` on the next request, retaining the same session filter. Times are ISO timestamps; use browser/client sequence for event order and server receipts to diagnose upload delay. Sequences are browser-reported, not a server proof of speech ordering.

Use source IDs and existing operation/session logs to connect a tool call to retrieval, summary saving, and binder updates. This feature does not capture secret provider reasoning or automatically ask another paid model to explain its decisions. If a brief rationale is added later, label it as a model-reported explanation, distinct from observed events.

## Deployment checks

Apply migration 122 using the established migration runner, update runtime and maintenance grants, then deploy the matching frontend and API together. Confirm one ordinary voice conversation under the verified target account produces transcript, context, tool, and timing events. Check another account cannot append or read; check coordinator/reporting roles cannot read; verify retention and account deletion. Offline unit checks do not establish these production conditions.
