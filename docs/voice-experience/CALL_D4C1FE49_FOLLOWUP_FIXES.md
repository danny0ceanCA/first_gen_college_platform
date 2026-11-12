# Follow-up fixes for call d4c1fe49

Local branch: `v1.3-decisions-integration`. November 12, 2026.

## Guidance and scope

The completed 45-page Responses library review from this work was retained. The saved Responses reference and relevant Live prompting, delegation, conversation/transcript, and delivery guidance were revisited before these edits and checked against the code. Current official Live guidance was also consulted. Repeated generated schemas use the previously approved unique-content review method. There are no newly missing library documents; this follow-up does not claim a new literal reread of every duplicate schema.

- [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#personality-during-tool-calls): answer the actual question, avoid repeated acknowledgments and status padding, and let Live choose ordinary wording.
- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#keep-the-conversation-context-in-your-application): partial transcript fragments are not complete turns; use current context rather than treating a fragment as a new request.
- [Managing Live sessions](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas): transcript intervals are approximate and separate from physical playback.

Managed Responses delegation remains distinct from the standalone Responses API and client delegation. No provider event or tool contract was changed.

## Changes

1. The completed-caveat observer recognizes “That's not the bill; it's a planning figure” and its Spanish equivalent. The existing prior-explanation hint can therefore carry the general distinction into later research. It still requires completed audible speech evidence and does not claim understanding. Later estimates retain their labels, year, scenario, new limitations, and any explanation the caller actually requests.
2. Live's listening policy now treats unfinished “What about…” / “¿Y qué tal…?” as the caller's ongoing thought. It asks for clarification only after an actually unclear finished request. No fixed silence interval, audio muting, or mandatory acknowledgment was added. This part is a prompt-level improvement and still needs a microphone call.
3. A structured budget total already spoken can retire an optional repeat without requiring the entire component list. The total must match exactly, the statement must be complete and affirmative, and supplied year/scenario conflicts reject it. An implicit campus requires one current subject explicitly present in the original question, no later question, and conservative vocabulary matching. Other campuses and unsupported wording are rejected. This path applies to a total-only presentation; explicit breakdowns or requests for additional components do not take this shortcut.

The source finding, full budget, qualifications, table rows, and report remain intact. Retiring an optional announcement is not a claim that every source fact was delivered. General research and interruption behavior continue through the existing controller.

## Verification

- 259 local tests passed across research delivery/discussion, speech policies, intro, handoff, and table state.
- After the final guard adjustment, all 194 research tests passed again, including English and Spanish cases modeled on the saved call's wording.
- Negative cases cover different amounts, years, housing scenarios, another campus, uncertainty, and unfinished speech.
- The existing serialized-session size guard passed without raising its limit.
- The minimized table, quiet-update badge, history, column visibility, and drag controls were not edited in this task.
- The idle isolated local app and research worker were restarted to load server instructions. Decisions conversational cues and reply recovery remain off.

No paid voice tests were run. Deterministic tests prove application behavior and instruction assembly, not that the provider will always avoid a premature spoken reply. The next microphone test must verify actual wording, timing, warmth, and naturalness. No commit, push, or deployment.
