# Recap timing and browser audio diagnostics

Branch: `v1.1`. Diagnostic revision: `natural-conversation-recap-timing-audio-2026-11-05`.

## Why this changed

The review of call `24270d36-d098-49ce-8375-9b7bf6a7d683` found a better introduction but an unresolved report of an audio glitch. Transcript timing alone cannot identify a playback defect or assign responsibility to Render, OpenAI, or the browser.

The implementation exposed the full selected-student brief through multiple quiet context appends before returning the successful selection receipt. The voice model could react to those early fragments even though its prompt told it to wait. Waiting for all acknowledgments afterward did not undo that exposure.

## Current behavior

1. Keep the existing quick acknowledgment, relaxed pace, one short recap and one question. Caller questions take priority; do not restart an opening after an invitation.
2. Stage selected student facts while configuring the authorized Responses backend. Keep audio and caller input running.
3. Release voice facts only when the matching selection result succeeds and its latest backend configuration is acknowledged. The voice receives one complete snapshot, at most 480 UTF-8 bytes. Whole fields or qualified records that do not fit are omitted rather than cut mid-sentence.
4. Keep the full authorized context in the backend and in the original selection tool result. Continue the existing native Responses tool loop exactly once. There is no additional model call, lookup, spoken announcement, audio mute, or playback clear.
5. Discard staged facts for failed, superseded or closed selections. Language changes retain the newest pending configuration. Ordinary same-scope refreshes keep their existing full-context acknowledgment behavior.

The compact voice snapshot is intentionally partial. The fuller backend context is preserved; this is not a deletion of student memory. The native backend can supply relevant detail in its reply. Neither prompt instructions nor context acknowledgments guarantee a particular spoken performance.

## Documentation review

Read [OPENAI_RESPONSES_REFERENCE.md](OPENAI_RESPONSES_REFERENCE.md) in full before editing. Retrieved fresh Markdown from every linked guide; reviewed their explanatory content and the applicable JavaScript/JSON event contracts. Equivalent SDK examples were not required for this implementation. Revisited the relevant Live sections before choosing the change.

| Official reference | Application to this change |
| --- | --- |
| [Responses overview](https://developers.openai.com/api/reference/responses/overview) | Keep Responses backend work distinct from Live speech. |
| [Quickstart](https://developers.openai.com/api/docs/quickstart) | Keep credentials and backend execution on the server. |
| [Text generation](https://developers.openai.com/api/docs/guides/text) | Version prompts in code and test representative behavior. |
| [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) | Reviewed; image processing is unrelated to this text-brief/audio change. |
| [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | A valid schema does not establish factual correctness or speech delivery; no added classifier or schema-generation call. |
| [Function calling](https://developers.openai.com/api/docs/guides/function-calling) | Return application-known state with the original call ID; do not ask a second model to reconstruct it. |
| [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | Preserve the ongoing exchange and caller corrections when adding context. |
| [Responses WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode) | Standalone Responses requests are not interchangeable with Live continuation events. No new connection or pipeline. |
| [Using tools](https://developers.openai.com/api/docs/guides/tools) | Retain existing tool permissions and backend ownership. |
| [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#return-tool-results-and-approvals) | Keep the matching tool output and native continuation; retain long records backend-side and return concise voice context. |
| [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#personality) | Preserve warm vocal delivery, brief wording, caller-first interruptions and no repeated loading narration. Actual voice needs auditioning. |
| [Managing Live sessions](https://developers.openai.com/api/docs/guides/live-conversations#understand-when-context-reaches-the-model) | Context appends arrive over time. Their acknowledgments are not speech/playback completion, and the model may react before consuming an entire update. |
| [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live#assign-one-owner-for-each-action) | Keep one control owner and browser WebRTC playback. Avoid introducing output buffering or muting that would change conversation flow. |
| [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/) | Measure interval packet loss, concealment and jitter-buffer delay using cumulative counter differences and documented units. |

## Diagnostic interpretation

The existing opt-in private archive records the following without audio recordings, device names, IP addresses, ICE candidates or SDP:

| Event | What it establishes |
| --- | --- |
| `origen.configuration.applied`, `contextDelivery: staged_for_selection` | Backend configuration is acknowledged; voice facts are still staged. |
| `origen.selection.context`, `stage: supplied` | One complete brief was sent at the successful selection receipt. |
| `origen.selection.context`, `stage: acknowledged` | Provider acknowledged estimated context injection; includes provider timeline bounds when supplied. It does not establish speech or playback. |
| `origen.selection.delivery` | Whether continuation should recap, answer caller speech first, or leave the floor after an earlier question. |
| Assistant transcript `startMs` / `endMs` | Approximate provider speech timeline, separate from event arrival time. |
| `audio_transport_sample` | Two-second browser observations of packets, jitter, concealment, jitter-buffer delay, audio energy, media state and scheduling delay. |
| `audio_playback_event`, `audio_track_event`, `audio_browser_state` | Playback waiting/errors, track mute/end, connection/visibility or analyser AudioContext state changes. |

Transport polling is non-overlapping and limited to 450 samples per physical connection; other event observations are bounded. Unsupported metrics remain absent, rather than being reported as healthy. Observations use the existing batched archive and stop before playback teardown. The existing diagnostic account restriction and retention policy remain in force.

For the next reported glitch, compare the session's selection milestones, speech timeline and browser samples. Increased concealment or jitter supports a transport/playback explanation. A browser stall or suspended context supports a browser explanation. Speech changes near context delivery with otherwise healthy transport support further investigation of model/context behavior. None of these correlations alone proves the root cause, and a healthy sample does not exclude a short glitch between samples.

## Verification

Deterministic English/Spanish regression tests exercise caller-first delivery, a name-only selection, early invitations, failed configuration, stale acknowledgments, superseded students, language changes during loading, native continuation and later same-scope refreshes. Audio tests cover counter resets, missing metrics, failure/timeout handling, bounded polling, privacy filtering, batching and cleanup.

Validation completed:

- Broader focused suite: 307 tests, 306 passed, one pre-existing database-dependent integration test skipped, zero failures.
- After the final configuration-order fix: 125 channel/private-capture tests passed, and all 34 server control tests passed. These overlap the broader suite and are not an additional unique-test total.
- TypeScript and Vite production build passed. The existing large-bundle warning remains.
- Real Chromium loopback passed using synthetic oscillator audio and two local WebRTC peers: three inbound RTP samples archived, two positive packet intervals, media `playing` and track attachment observed, zero callbacks after cleanup. Run with `node scripts/audio-diagnostics-browser-smoke.mjs`; the result is saved to `output/playwright/audio-diagnostics-loopback/result.json`.
- The loopback used no microphone, OpenAI calls, account data or external services. Physical speaker quality was not auditioned.

No paid voice validation or production changes were made. Actual model pacing, warmth and recap wording remain to be checked in the next voice conversation. Changes are local and uncommitted on `v1.1`; `v1` is unchanged.
