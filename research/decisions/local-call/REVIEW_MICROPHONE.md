# Local microphone observation review

Reviewed on November 7, 2026, on `v1.3-decisions-integration`. This document
records development preparation and contract findings; it does not enable any
runtime feature or claim that a human microphone call has been verified.

## Coverage

The complete prior library review is recorded in [REVIEW.md](../REVIEW.md),
including the user's approved exact unique-content method. This review reused
that completed coverage rather than claiming another literal reread of repeated
generated schemas.

All manifest entries were rechecked from disk after removing a leading BOM and
normalizing CRLF to LF:

| Library | Manifest pages | Missing or changed content |
| --- | ---: | --- |
| Responses | 45 | None |
| Decisions | 30 | None |
| Conversation state | 35 | None |

The three saved references were reread. The full saved Live conversations,
Live delegation, server controls, Decisions voice, and standalone Decisions
create-contract pages were reread for the local bridge. Truncated output was
recovered in bounded chunks. No unavailable assigned documents remain.

Current official guidance was checked for the relevant contracts:

- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas)
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#react-to-transcript-fragments)
- [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live#assign-one-owner-for-each-action)
- [Decisions voice](https://developers.openai.com/api/docs/guides/decisions-voice#react-to-transcripts)
- [Standalone Decisions create](https://developers.openai.com/api/reference/resources/decisions/methods/create)

The relevant current contracts agree with the saved snapshots. The server
controls document includes both Live and legacy Realtime sections; their event
contracts must remain separate.

## Requirements for the microphone bridge

| Contract or requirement | Consequence for this observe-only integration |
| --- | --- |
| Native transcript fragments carry approximate session intervals; they have no completed-turn event or item ID. | Preserve original event IDs, exact fragments and start/end times. Treat grouped completed events as application estimates. A fragment can invalidate an earlier decision before a new grouped turn is ready. |
| Caller and assistant can speak concurrently. | Keep independent input/output evidence. An assistant acknowledgment must not split or finalize the caller's meaning by itself. |
| Transcript generation and browser playback are different evidence. | Keep them separate. Neither an application output boundary nor browser idle proves the whole answer was heard or understood. |
| Later input can supersede an earlier request. | Check current scope and input revision before accepting a result. A reconnect or dropped observation packet invalidates pending observations and records an evidence gap. |
| The application owns permissions and task state. | Bind observation to the authorized local account, call and student. Same-scope configuration refreshes should not silently end useful observation. Changed scope must be revoked or explicitly reauthorized. |
| A sideband shares the running session and actions need one owner. | Copy events from the existing controller; do not add a competing writer, duplicate tool executor or second microphone path. |
| Even quiet context affects Live; an empty thinking append cancels pending automatic acknowledgments. | The observer must emit no Live append, update, trigger, mute, continuation or close commands. Logs and standalone classifications are its only outputs. |
| Standalone Decisions is distinct from native Live Decisions delegation. | Keep the existing voice delegation unchanged. Do not enable native triggers or replace session delegation for this experiment. |
| Decisions returns named, typed answers and may refuse. | Retain validation, refusal handling, budget reservations and stale-result accounting. A classifier outcome is observation, never authorization. |

## Pre-hookup bridge findings

The code reviewed initially logged native transcript intervals but did not
invalidate an in-flight classification on a new native input delta. It also
closed observation on every `configure` call, including ordinary configuration
refreshes. These need explicit handling before relying on microphone results.

The existing guard only admitted fictional seeds. An isolated copy of real
account records must not be relabeled fictional to bypass that guard. Data
origin and local account/database authorization should be represented separately.

The worker-thread boundary, bounded queue, lack of a provider writer in the
projector, and existing observation-only result path are suitable foundations.
Worker errors must remain optional failures: log them and stop observation while
leaving the conversation and its original control flow running.

Validation should compare the provider commands, client events and intro
behavior with and without observation, then exercise English/Spanish input,
partial utterances, changed student scope, normal configuration refreshes,
reconnects, duplicate packets, queue overflow and observer failure. A successful
local replay verifies the bridge contract; only an actual microphone call can
verify the resulting device/audio experience.

No paid API calls, production access, commits, pushes or deployment were made by
this library review.

## Independent implementation checkpoint

A later read-only review of the in-progress microphone integration checked the
root state, rubric, observer and server factory wiring. The reviewer found that
deduplication still used the full snapshot hash even though playback evidence
was deliberately excluded from classification relevance. The implementation
was updated by the primary agent to deduplicate by the relevance hash, and its
new regression test passed.

The complete-body hash still checks snapshot integrity; only playback evidence
is excluded from relevance. Native input invalidation, context changes, scope
changes and reconnects change the relevant state. Copied records are explicitly
marked `isolated-copy`, with `fictional: false`. Server defaults still choose
the existing session factory, and both the app review-options guard and the
voice-controller guard reject custom production factory wiring.

Independent offline verification passed 27 state/rubric/observer tests and six
launcher/authenticated-control integration tests, including English and Spanish
event forwarding with one provider connection and no observer-originated
commands. No paid API calls ran. The bridge scope guard and local launch were
still being completed at this checkpoint; page readiness alone is not proof
that observation has attached. Confirm active observation and captured evidence
when the human starts the microphone call.
