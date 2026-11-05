# Caller-first recap timing and provider voice diagnostics

Branch: `v1.1`. Diagnostic revision: `natural-conversation-caller-first-recap-2026-11-05`.

## Problem and change

The selection helper stopped observing the conversation as soon as it returned a successful selection receipt. A caller who began a question immediately afterward could leave the earlier `conditional_recap` instruction active while the brief reached Live or its backend continuation finished.

The helper now retains one bounded delivery observer for the current selection. Subsequent meaningful caller speech changes its mode to `caller_first`, once. A small factual update goes quietly to Live and a matching application-state message goes to managed Responses. The authorized brief remains available. Neither update starts another response, performs a lookup, cancels audio, or inserts a spoken announcement.

The shared speaking policy also treats the original recap permission as provisional: current caller speech takes precedence even before the application update arrives. Once the caller moves on, Origen should answer their question and use relevant facts quietly, without resuming a separate recap later unless asked. A name-only selection still allows the existing short recap and one question.

The observer clears on a new selection, a different authorized scope, or session close. A late context acknowledgment and an ordinary same-student refresh cannot restore the abandoned recap. The delivery event records `stage: caller_after_receipt`, its outgoing event ID, call ID, and elapsed time. It does not claim the caller heard anything.

## Provider-confirmed voice

The session creation response supplies an ID, not confirmation of the resolved voice. The request's `marin` setting is therefore recorded separately from provider evidence.

Each server connection makes one nonblocking sparse `session.update` request. The corresponding provider `session.updated` resource identifies `session.audio.output.voice`. A sideband does not replay the original `session.started`, so merely attaching cannot establish the voice. Ordinary genuine session resources can also establish it.

`origen.provider.voice` records bounded metadata:

- Requested and provider-confirmed voice, including built-in/custom type.
- Provider session, model and event ID.
- `pending`, `confirmed`, `mismatch`, or `unconfirmed`, plus timing and reason.

Missing, rejected, timed-out, or mismatched-session evidence never defaults to the requested voice. A reconnect starts fresh and does not inherit the previous confirmation. Diagnostics do not delay readiness, alter voice settings, retry the call, or request speech. The diagnostic probe's acknowledgment cannot satisfy an unrelated configuration update.

These events use the existing private archive and its capture controls. Full provider session objects, prompts, credentials, SDP and raw audio are excluded. A confirmed configuration identifies the provider's selected voice; it cannot prove how the audio sounded to the listener.

## Guidance review

Read [OPENAI_RESPONSES_REFERENCE.md](OPENAI_RESPONSES_REFERENCE.md) fully before implementation. Reviewed the explanatory content and JavaScript/JSON contracts of each linked guide; equivalent examples in other SDK languages were not needed. Fresh official downloads of the general Responses guides matched the same-day local reference copies. The four Live guides were also reviewed in full and independently checked against the proposed fix.

| Reference | Application to this change |
| --- | --- |
| [Responses overview](https://developers.openai.com/api/reference/responses/overview), [Quickstart](https://developers.openai.com/api/docs/quickstart) | Distinguish backend Responses work from Live speech and provider voice configuration. |
| [Text generation](https://developers.openai.com/api/docs/guides/text) | Keep conversational rules stable and test interruption scenarios. |
| [Image inputs](https://developers.openai.com/api/docs/guides/images-vision) | Reviewed; image processing does not apply to this fix. |
| [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | Use explicit application delivery states; no extra model classifier is needed. |
| [Function calling](https://developers.openai.com/api/docs/guides/function-calling) | Return successful results with the original call ID and preserve the normal continuation. |
| [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | New caller context and corrections take precedence over older observations. |
| [WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode) | Standalone Responses and Live continuation contracts differ; no transport migration is required. |
| [Using tools](https://developers.openai.com/api/docs/guides/tools) | Preserve tool availability without forcing work for ordinary conversation. |
| [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation) | Quiet context uses thinking appends with a null delegation ID in Responses mode; backend state updates do not trigger new generation. |
| [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting) | Yield to the caller, do not resume replaced answers, and retain warm, unhurried delivery. |
| [Live sessions](https://developers.openai.com/api/docs/guides/live-conversations) | Context acknowledgments estimate injection, not completed speech or playback. Voice is chosen at startup. |
| [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live) | Keep one provider writer; do not add audio buffering or another speech controller for this fix. |

Rechecked the relevant context, interruption and continuation sections before editing. For voice diagnostics, additionally checked [Live session creation](https://developers.openai.com/api/reference/resources/live/methods/create), [primary events](https://developers.openai.com/api/reference/resources/live/primary-websocket), [sideband events](https://developers.openai.com/api/reference/resources/live/sideband-websocket), and the official SDK's optional session-update fields.

## Validation and limits

- Combined local regression: 297 tests passed, including English/Spanish late-question cases before/after context acknowledgment and during/after backend continuation.
- Authenticated local WebSocket tests cover connect/reconnect, confirmed and differing voices, speech before confirmation, and isolation of the diagnostic acknowledgment.
- Existing research delivery, scope, playback and private-capture tests passed.
- Additional profile API, archive, conversation-flow and orientation checks: 35 passed (332 total across the two runs). Corrected one pre-existing case-sensitive test expectation for "Never read headings"; the existing spoken policy itself was unchanged.
- TypeScript and Vite production build passed after rerunning with filesystem access required by Vite. The existing bundle-size warning remains.
- No paid voice calls were run. These checks validate state, transport and prompt contracts; actual conversational warmth, overlap and vocal timbre still require listening to a new call.

A quiet context update cannot retract audio already generated, and queuing a backend message cannot rewrite a response already running. The standing caller-first policy is therefore essential. This change deliberately adds no playback buffer or waiting gate.
