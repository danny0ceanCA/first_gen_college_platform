# Bounded initial student-selection recovery

## Scope and evidence

- Branch: `v1.2`; base: `433ae23347159c93da6e8e4e2d37154c0ad66ecc`.
- Adapter revision: `bounded-student-selection-recovery-2026-11-07`.
- Local changes only; no commit, push, deployment, production setting change, or paid API call.
- The preceding diagnostic review found a caller's student choice and a brief acknowledgment, followed by no native delegation, backend response, selection tool, or student context. The approximately 22-second interval before farewell is an observed diagnostic interval, not a measured Render outage.
- The existing backend deadline starts on nested `response.created`. It cannot recover work that was never delegated. This change covers that missing initial handoff.

## Library and current guidance review

All 45 official snapshots in the manifest are present and match their recorded SHA-256 hashes after line-ending normalization. This work reuses the completed two-pass review of all unique content documented in [the previous review](2026-11-06-live-conversation-improvements.md), including the user's approval to deduplicate repeated generated schemas. It does not claim a new literal reread of all repeated schema text. No library document was unavailable or changed.

The saved [Responses reference](../../OPENAI_RESPONSES_REFERENCE.md), relevant Live prose and event contracts were revisited against the current implementation. Current official [delegation](https://developers.openai.com/api/docs/guides/live-delegation), [prompting](https://developers.openai.com/api/docs/guides/live-prompting), and [conversation](https://developers.openai.com/api/docs/guides/live-conversations) guidance was checked. These contracts shaped the fix:

| OpenAI guidance | Applied behavior |
| --- | --- |
| Managed Responses delegation supplies conversation context and uses the session's backend configuration. | Recovery sends one bare Live `response.create` with an event ID. It does not send a standalone Responses request body, replay the transcript, force a tool, or start a separate model. |
| Native delegation metadata and nested Responses events have different meanings. | Observe `session.delegation.created` before nested `response.created`, so normal native work suppresses recovery even while its backend start is pending. |
| Applications own permissions, task state, and duplicate-action prevention. | Candidate detection cannot select a student. The existing tool handler and authorized configuration callback remain responsible for selection. Native/recovery races share one selection operation while returning a result for every call ID. |
| Return all required tool results before continuing the backend. | Duplicate selection calls receive the original operation's actual result; aliases are returned before continuation. A superseded scope gets a non-success receipt without reopening the old selection. |
| Transcript fragments are not complete user turns; context acknowledgment is not playback. | Preserve the existing estimated quiet window and invalidate a waiting candidate on new input. Recovery logs show transport/tool stages, not proof that the user heard the recap. |
| Quiet context and spoken updates serve different purposes; instructions can interrupt speech. | Recovery adds no speech, instruction append, audio cancellation, or mute. The existing brief-delivery flow preserves a quick acknowledgment and prioritizes the caller's question. |

## Implementation

Server-authorized adapter metadata identifies whether the initial selection is pending and which roster names are available. It contains no brief facts and is omitted from the provider session payload. Onboarding, a confirmed scope, absent metadata, and sessions without the selection tool are ineligible.

A narrow name/family-choice candidate starts a timer only after the existing 1.1-second transcript quiet estimate. Native delegation gets another 1.2 seconds to arrive. If no native work or newer input exists, the adapter requests the configured backend once. In deterministic tests, that is 2.3 seconds after the final input fragment. This is fallback scheduling, not a promised response or recap latency; the normal intro receives no additional delay.

The attempt is limited to one request per physical adapter. It observes backend start for six seconds, then logs an unconfirmed outcome without retrying or announcing a loading problem. Once the backend starts, existing backend deadlines and guarded tools apply. New input, call ending, configuration changes, and active work suppress a waiting attempt.

The delivery receipt preserves the short acknowledgment, including a caller who answers before the opening question finishes. A name plus a substantive question uses `caller_first`. A prior invitation leaves the floor with the caller. Otherwise, the existing conditional short recap remains available. This does not change the model voice, warmth instructions, or normal opening script.

Three race conditions were covered during review: simultaneous native and recovery selection calls; a new acknowledgment after an interrupted opening question with no remaining old-question tail; and a late duplicate after the active scope changed without another input transcript. The last case cannot replay an old successful selection receipt.

## Diagnostics

`origen.selection.recovery` records scheduled, suppressed, requested, backend-started, selection-dispatched, selection-completed, and unconfirmed stages. Reasons distinguish native delegation, newer input, configuration changes, call ending, provider errors, missing backend start, and actual tool outcomes.

Private diagnostic capture retains validated random correlation IDs. Operational logging keeps fixed stage/reason categories, bounded durations, and existing run/turn/configuration metadata. Names, transcripts, and brief facts are excluded from these operational events. Selection completion, context acknowledgment, transcript evidence, and audible playback remain separate observations.

## Call indicator

The user also requested a steady call-presence animation. The stationary O now has a slow opacity-only halo while connected. Its motion and status text do not change with speaking, listening, or thinking. Reduced-motion preferences disable the animation. Connecting, ending, microphone-muted, and blocked-playback messages remain meaningful; audio diagnostics are unchanged.

## Verification and limits

- The combined adapter, brief delivery, research, consent/scope, profile handler, server control, and logging suite passed **446 tests**, with no failures or skips.
- After the final unchanged-scope safeguard, **68 targeted selection/handoff tests** passed, including four configuration-change cases. These overlap the combined suite and must not be added to its count. A language-only update inheriting the pending scope does not invalidate the handoff.
- The new server integration file contains **16 passing English/Spanish scenarios**, using the actual server control, adapter, guarded callbacks, staged context, and continuation path with synthetic provider events.
- Scenarios include absent and normal delegation, quick acknowledgments, old-question overlap and interruption, caller-first questions, failed callbacks, duplicate races, changed students, call closure, and provider errors. No private context is delivered before the guarded selection succeeds.
- Production logging policy and whitespace checks pass. The TypeScript/Vite production build passed after retrying outside the Windows filesystem sandbox; existing dependency-directive and bundle-size warnings are nonfatal.
- The separate prompt-budget suite has **18 pre-existing failing size checks** and four passing checks. Comparison against the base commit confirmed all 18 were already over their configured speech-character caps (17,222–32,493 characters at the base). This patch changes measured prompt lengths by zero or minus eight characters; the limits were not raised and unrelated prompts were not rewritten.

No real provider conversation or audio playback was run. The tests establish bounded scheduling, event ordering, permissions, and delivery decisions; they do not establish audible warmth, live latency, or a percentage improvement in naturalness. The next live check should compare a normal opening and an opening with continued caller speech in English and Spanish, correlating recovery stages, context receipt, native transcripts, and browser playback diagnostics.
