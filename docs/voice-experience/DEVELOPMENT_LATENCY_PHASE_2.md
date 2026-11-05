# Development voice latency — Phase 2

Implemented locally on `Origen-Development`, November 3, 2026.

## Purpose

Prepare the existing compact student context before the user clicks Talk, then
reuse it if its dependencies still match. This moves eligible database work out
of call startup. It does not change Live's delegation policy or prove that model
responses or audible replies are faster.

## Behavior

- After the signed-in family and conversation history load, the visible, idle
  workspace waits 600 ms before preparing its selected student and guide.
- Preparation is database-only: no model call, microphone, opening reservation,
  or new live session. It uses the existing `ORIGEN_VOICE_PREPARATION` flag.
- A parent gets separate selected-child and neutral-opening handles. A neutral
  parent call cannot consume the selected child's context before confirmation.
- Clicking Talk joins compatible preparation already in progress. After creating
  the audio offer, startup waits at most another 250 ms for preparation, then
  proceeds with normal context assembly if necessary.
- Failed, expired, mismatched, evicted, or unavailable preparation falls back to
  normal assembly. Onboarding uses its existing path.
- While the workspace remains visible and idle, successful preparation can renew
  after 46 seconds. It stops scheduling when a call starts or the page is hidden.
  This trades additional idle database work for faster eligible startup; measure
  its hit rate before expanding deployment.

## Freshness and isolation

The browser keeps opaque handles in memory for up to 45 seconds. The server keeps
evidence snapshots for up to 60 seconds. Both caches permit three scopes per
account; the server also caps the total at 32. Handles are single-use and checked
against account, student, role, language, guide, routing state, focus/source
versions, continuity query, current account revision, and personalization policy.

Account or student switches, relevant local context changes, privacy changes,
and provider unmount invalidate browser handles. The server remains responsible
for authorization and revision checks; client invalidation is not an access gate.
No context or credentials are written to browser storage.

Only authoritative profile, selected memory, plans, brief, workspace, history,
and return-context evidence are reusable. Current request protocols, live session
controls, consent, prompts, tokens, and opening claims are not cached.
Teaching retrieval, related coordinator guidance, current session guards, and
opening decisions still run on the actual call.

Two cases deliberately bypass preparation:

1. Linked student profiles: owner edits do not currently propagate to the member
   account's context revision. These contexts must be assembled fresh.
2. Focused coordinator comments or review responses: another account can edit or
   withdraw them. Their existing source guards must run fresh.

The cache is process-local. A request served by another instance, a restart, or
eviction safely becomes a cache miss. No shared cache or worker is introduced.

## Validation and limits

- Synthetic PostgreSQL coverage checks reuse, account/scope isolation, profile
  and history changes, linked-profile bypass, focused-source bypass, and fresh
  teaching publication/withdrawal. English and Spanish Live negotiation tests
  use a fake provider and preserve the current request's Live controls.
- In one controlled fixture, context/startup database operations fell from
  **60 cold to 7 with prepared context**. These counts include transaction and
  metadata operations; they are not milliseconds or a production speed estimate.
- Four browser checks cover student/parent and English/Spanish at desktop/mobile
  sizes. They verify preparation before Talk, no microphone request before the
  click, and reuse of the correct scope with the current Live protocol.
- Startup cancellation, preparation expiry, bounded waiting, and late replies
  have focused regression coverage. Phase 1 timing tests remain in the suite.
- The build and production logging-policy check pass. The build retains its
  existing large-chunk advisory.

The response's `Server-Timing` header exposes a fixed preparation description:
`hit`, `miss`, `cold`, or `preparing`, alongside Phase 1's numeric stage timings.
It contains no student details or handle IDs. The existing numeric timing parser
ignores this descriptive marker.

Run the browser harness against a local development server:

```powershell
$env:ORIGEN_PREVIEW_URL = 'http://127.0.0.1:5198'
# If needed, set ORIGEN_BROWSER_MODULE_ROOT and ORIGEN_BROWSER_EXECUTABLE.
node scripts/voice-preparation-smoke.cjs
```

No production deployment, paid voice calls, migration, new permission, or worker
service is part of this phase. Real end-to-end latency still needs measured live
validation; this change does not address time spent inside a delegated model turn.
