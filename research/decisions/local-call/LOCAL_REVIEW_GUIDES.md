# Local conversational support: guidance review

Review date: November 8, 2026 UTC (November 7 Pacific).
Scope: the isolated v1.3 trial; no production enablement is authorized here.

## Coverage and method

The three manifests contain 57 guide entries. Normalizing line endings leaves
37 distinct guide snapshots, including three newer variants of older Responses
guides. Exact duplicate bodies are reviewed once per pass; differences are read
in full. Code examples are included. The first pass follows the whole document;
the second revisits the same complete text for event contracts, limits, edge
cases, and applicability. Re-fetching identical bytes is not treated as an
additional semantic review.

This record covers the guide review assigned to the continuation-guides
reviewer. The broader Responses guides and generated API references have
separate reviewers. **The overall pre-edit review gate is complete.** The
broad-guide reviewer confirmed both full passes through 19 assigned pages;
the contract reviewer completed the remaining reasoning guide, both passes
through the unique API/reference content, and current verification of those
40 official pages. The parent reviewer also completed both passes through the
saved references, library indexes, audit, measurement, and logging documents.
No runtime edits preceded that confirmation.

Completed here, with both passes:

| Guide | Contract and application check from the second pass |
| --- | --- |
| Live delegation | Application task state, transcript evidence, and spoken delivery are separate. Quiet context uses `session.thinking.append`; appends are limited to 500 tokens. An append acknowledgment does not establish playback. |
| Live prompting | Keep the conversation prompt small; use supplied task state and verified findings. A conversational acknowledgment is not a research-start receipt. A brief clarification does not need delegation. |
| Live conversations | Transcript fragments do not identify completed turns; gaps alone do not establish silence. Startup history, quiet updates, and backend items are different state surfaces. |
| Voice server controls | The existing sideband can observe without moving microphone audio. Assign one writer per action. Reflected audio timing is not browser playback. Avoid output buffering for optional conversational support. |
| Decisions | Use typed classifications, distinct choices, observable criteria and calibrated thresholds. Keep confidence separate from choice probability. Refusal/unknown is not permission to act. Independent questions may share one request. |
| Decisions voice | Results can arrive out of order or combine transcript deltas. Apply only the newest relevant result. Native delegation and transcript triggers are different mechanisms; changing delegation mode requires a new session. |
| Latency optimization | Avoid unnecessary model calls and sequential classification. Run optional interpretation alongside the conversation. Measure useful answers separately from acknowledgments. |
| Getting started with Live | Keep speaking behavior in Live and workflow state in the application. No migration of the existing delegation mode is needed for this local trial. |
| Private Link | Networking controls do not improve turn interpretation or conversation state. No networking change is warranted by these defects. |
| Voice agents | Measure task outcomes, conversational timing, language, and connection reliability independently; human listening remains necessary. |
| Voice WebRTC | Media stays on WebRTC; control data is separate. Wait for `session.started`; do not send another startup event on a WebRTC data channel. |
| Compaction | Standalone Responses compaction is not a Live-session state mechanism. Preserve the complete returned window and do not introduce compaction into this trial. |
| Preserved reasoning | Preserve original input/output prefixes and append corrections rather than rewriting prior evidence. Do not expose private reasoning. |
| Function calling, both saved variants | Match call outputs to calls, continue only with required results, and keep application execution separate from model requests. The newer variant adds preserved-history guidance. |
| Conversation-state and reasoning variant differences | Current guidance explicitly preserves the history that produced reasoning items. All unchanged content is covered by the broad-guide reviewer. |

All three saved reference documents were read and revisited. The guides above
include their complete prose and examples, not merely section headings.

## Current official source verification

Every distinct guide URL in the manifests was fetched from OpenAI as Markdown.
All 37 fetches succeeded. Every current body exactly matches a known saved
snapshot after line-ending normalization. Three older Responses copies differ
from the current versions; the newer Decisions/conversation-state copies match:

- Function calling adds the preserved-reasoning link and requirement.
- Conversation state adds the requirement to retain the history behind replayed reasoning.
- Reasoning replaces older truncation guidance with original-order history and
  append-only updates, plus the warning that edited prefixes can drop reasoning.

The original eight `/docs/...` guide links in
`OPENAI_RESPONSES_REFERENCE.md` returned HTTP 404 when requested as Markdown.
Their canonical `/api/docs/...` equivalents are present in the manifests and
were fetched successfully. The old `images` link is covered by the canonical
`images-vision` guide. Thus the original URLs are stale; the corresponding
guidance content is available. The web tool also rejected Markdown content
type, so the verification used read-only HTTPS retrieval instead.

Reproducible local retrieval records (ignored task artifacts):

- `research/decisions/.local/continuation-guide-review-index.json`
- `research/decisions/.local/current-guides-check.json`
- `research/decisions/.local/current-reference-guide-check.json`

The scope is the explicit saved-reference and manifest documentation links,
not a recursive crawl of every navigation, image, audio, external example, or
unrelated link inside the documentation.

## Application to the reported call

The local call showed three separate issues: short positive replies were not
always interpreted as accepting a previously offered explanation; research
with incomplete evidence was treated conversationally as still running after
its job had completed; and observer checks consumed their evaluation limit
before the later research follow-ups.

The guidance supports the following boundaries:

1. Classify confusion and readiness from the caller's words **and the immediately
   preceding offer/explanation**. A bare acknowledgment without such an offer is
   not permission to invent a new activity. Reject new-scope and stale results.
2. Deliver an optional, application-authored support fact at an existing safe
   gap. Never interrupt an intro or an unfinished thought merely to win a race
   against Live. Do not start research, add a greeting, or force a canned reply.
3. Treat the application job status as authoritative. `completed` plus
   `researchPending: false` means this check ended even if verification remains
   partial. Preserve source qualifications; missing facts are not proof that
   more results are coming.
4. Keep research routing observe-only. A local terminal-state clarification may
   strengthen the existing result packet, but must not add another announcement,
   replace verified facts, or invent a search.
5. Evaluate meaningful new caller evidence and required state changes rather
   than repeatedly paying to classify the same answer. Keep bounded queue,
   stale-result, budget, and durable diagnostic safeguards.

## Relevant official links

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting)
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations)
- [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)
- [Decisions](https://developers.openai.com/api/docs/guides/decisions)
- [Decisions voice](https://developers.openai.com/api/docs/guides/decisions-voice)
- [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
- [Voice evaluation](https://developers.openai.com/api/docs/guides/voice-agents)

No documentation content is added to runtime model context by this review.

## Isolated terminal-state implementation check

`research-terminal-state.mjs` rewrites only the interpretation of an existing
quiet, application-owned terminal-state packet. It distinguishes the ended
research job from partial verification. It leaves finding/source packets,
qualifications, job identities, revisions, event IDs, delegation IDs, and packet
counts intact. It creates no command, timer, model request, lookup, or spoken
announcement. The local session must enable it only for the support trial;
observe-only sessions retain their exact original commands.

The regression tests use the actual `researchStateContext`, `liveContextPackets`,
and `researchContextPackets` serializers with fictional English and Spanish
reports. The normal UUID task-state packet and structured partial-result state
both fit the existing 480-byte budget. Fragmented or oversized state remains
unchanged and emits a bounded diagnostic instead of silently claiming coverage.
Running/cancelled states, unrelated commands, intro instructions, and spoken
announcements are unchanged. Eight tests and a syntax check passed.

These checks establish packet preservation and terminal-state clarity; they do
not establish that the voice model used the update or that the caller heard it.
That requires the live validation and separate transcript/playback diagnostics.

## Independent conversational-delivery review

The review of the local delivery controller and typed candidate bridge found
and covered stale offer reuse, Spanish action-offer exclusions, malformed
provenance, and temporary-note expiry. The implementation now consumes an offer
on the next caller turn, rejects old offers, distinguishes a conversational
explanation from a research or record-changing action, and expires temporary
confusion locally. Publishing a clear waits for a fresh current classification
and a safe opportunity before the next ordinary reply.

The 32 English/Spanish regression cases in `conversation-delivery.test.mjs`
cover those checks plus partial speech, reflected audio, stale or busy playback,
intro/context fences, a substantive native answer arriving before the Decisions
result, uncertain writes without resending, low confidence, changed scope,
typed-only payloads, and all reachable note combinations under 480 UTF-8 bytes.

The continuation recovery deliberately uses `session.instructions.append`,
which the OpenAI guide says can interrupt model behavior. The application waits
for a completed acknowledgment or an unanswered accepted offer, fresh idle
playback, no active speech, and a quiet gap; it suppresses the direction when a
substantive answer has already appeared. Those are conservative application
estimates, not a guarantee against provider scheduling races or proof of what
the caller heard. No claim of 100% naturalness or interruption-free delivery is
made by these tests.

The final local audio audit also motivated two narrow refinements. Up to three
adjacent affirmative caller spans may share the preceding offer only within a
four-second, chronological provider-timestamp window, with no intervening
assistant speech or substantive caller turn. The latest caller ID remains the
required classification anchor; an earlier result stays stale. The classifier
and delivery controller share the same acknowledgment predicate.

The local audio audit showed that even a future-only thinking note could prompt
an extra voice turn after a completed answer. Quiet confusion and clear notes
therefore now apply only in the narrow pre-answer window: the current caller
must be complete, the prior assistant thought complete, browser playback fresh
and idle, and no assistant text or non-silent audio begun for this caller.
Output seen before the adapter emits caller-completed is retained too. A late
note remains local until a later caller's classification revalidates relevance.
Nothing delays the ordinary reply; a fast model may leave every optional note
unsent. The templates add no new request and ask for no extra speech.

The accepted-offer recovery path retains its separate safe-gap rules. The 11
integration cases also verify that fast answers, intro protection, research
continuity, and output arriving before caller completion survive this split.
The combined 51 delivery, integration, and terminal-state tests passed. These
checks do not substitute for the final live retest or prove audible behavior.
