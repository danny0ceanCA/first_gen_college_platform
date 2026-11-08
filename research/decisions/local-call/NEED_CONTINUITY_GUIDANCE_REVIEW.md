# Decisions need continuity — preparation and contracts

Prepared November 8, 2026 (UTC) on `v1.3-decisions-integration`.
Scope: isolated local support only; no production runtime, intro, briefing,
research routing, voice configuration, or call-indicator changes.

## Reading coverage before edits

The review covered all manifest entries in the 45-page Responses library,
30-page Decisions library, and 35-page conversation-state library. It used
Daniel's previously approved unique-content method: exact repeated schemas and
equivalent language examples were compared, with distinct fields, values,
comments, error handling, and version differences read separately.

- The complete Decisions review immediately preceding this implementation was
  retained; its relevant classification and Live contracts were revisited.
- A guide reviewer covered the Responses and conversation-state guides,
  reusing exact previously read Decisions duplicates and reading all new
  content and the function-calling, conversation-state, and reasoning variants.
- A contract reviewer covered 19 Responses and 17 conversation-state API/SDK
  entries: 1,888 additional unique blocks, 153,746 content characters.
- A second reviewer read the Python Responses reference's 2,662 additional
  unique blocks, 270,280 characters, and intact relevant nested schemas.
- The primary agent read all three saved references, quickstart, models, and
  current relevant official guidance. The local audit and measurement plan
  were included in the guide review.
- All source hashes matched, with CRLF-to-LF normalization for the older
  Responses snapshots. No saved page was unavailable. This is not a claim of
  recursively rereading every external link or two new complete passes.

## Guidance applied

| Official guidance | Application here |
| --- | --- |
| [Decisions: independent observable questions and application-specific thresholds](https://developers.openai.com/api/docs/guides/decisions#ask-multiple-questions) | Separate support need, changes to that need, and observed assistant handling. Choice confidence and predicate probability remain different quantities. Code decides whether any result is eligible. Thresholds are experimental application policy, not OpenAI guarantees. |
| [Live transcript fragments and conversation state](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas) | Retain exact event IDs, text spans, and revisions. A retained prefix is only an observation; current words must be reclassified before delivery. Transcript boundaries remain application estimates. |
| [Live context delivery](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update) | Only short application-authored thinking notes; no classifier prose, raw transcript instructions, forced commentary, or instruction append. Acknowledgment is separate from spoken use and playback. |
| [Background work and stale tasks](https://developers.openai.com/api/docs/guides/live-delegation#keep-updates-accurate-and-useful) | Retained need has scope, connection, origin evidence, version and expiry. Corrections suspend it; resolution clears it; ordinary elaboration can be revalidated. No old result alone reopens a finished answer. |
| [Server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live) | Existing audio, transcript, playback, intro, and pending-context fences stay authoritative. No audio buffering, waiting, cancellation, or playback-control change. |
| [Voice evaluation](https://developers.openai.com/cookbook/examples/audio/voice_agent_evaluation) | Separate offline races, authored development cases, frozen bilingual holdout, and continuous real audio. Compare shadow-only versus enabled early delivery with other local support settings held constant. Small synthetic calls do not establish human warmth or statistical improvement. |

Application-owned temporary support is not a provider Conversation, Responses
continuation state, model reasoning, or permanent student preference. Research
classifications remain observe-only. Native Decisions triggers and additional
worker services are outside this change.

## Budget and isolation

The original $5 approval remains the combined cap. An additional immutable
local allocation is permitted only after the old 80-request early ledger is
fully settled and exhausted. It counts that ledger's actual charges, both
older exhausted Decisions ledgers, and both full voice allocations, including
unknown holds. The conservative maximum is $4.9635401. No ledger is reset.

`verify-isolation.mjs` must continue matching the 3,163-file baseline, including
the two pre-existing reviewed local hooks. Paid tests use fictional data,
local accounting, and no application database or real research tools.
