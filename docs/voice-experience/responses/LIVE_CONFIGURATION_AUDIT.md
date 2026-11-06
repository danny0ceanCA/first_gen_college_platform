# Live Configuration Audit

Living audit of Origen's GPT-Live configuration, Responses delegation, context delivery, and natural conversation behavior against official OpenAI documentation.

## Review record

- Reviewed: November 6, 2026.
- Branch: `v1.2`.
- Base commit: `c8f5fc2d7eb26afce374cda6c92665b42c39da4c`; the documentation library and AGENTS.md changes are uncommitted additions to that base.
- Official evidence set: all 45 snapshots in [manifest.json](manifest.json). The local audit and README are not official snapshots and are not counted among those 45 pages.
- Method: full-library contract review with repeated generated schema definitions deduplicated, followed by source tracing and focused in-memory adapter probes. The conversation-focused pass revisited the library's applicable guidance and rechecked every snapshot checksum.
- Freshness: the online Live delegation, session-management, server-controls, and web-search guides matched the saved snapshots during the initial audit. Current official Live primary and sideband event references were additionally consulted for supported commands.
- Scope: source-backed configuration and architecture findings. Production feature-flag values, real-call failures, comparative latency, and spoken behavior were not verified.
- Application changes: none. Only documentation is being added.

## Classification and maintenance

**Contract mismatch** means implementation conflicts with an explicit supported interface or requirement. **Guidance departure** means implementation differs from a documented handling or recovery instruction. **Evaluation hypothesis** means there is a plausible conversation-quality concern but no established contract violation or observed spoken failure.

All findings below are **open**. Confidence refers to the source evidence, not the frequency of production impact. Keep IDs stable as this document grows. For each update, record evidence, affected paths, status, verification, and remaining uncertainty. Do not mark a finding resolved based only on changing a prompt or passing a mock test.

## Initial architecture review

### LC-001 — Unsupported Live cancellation commands

- Classification: contract mismatch; high confidence against the current published event references.
- Evidence: [adapter timeout and cancellation](../../../src/studentLiveChannel.mjs), particularly `expireBackend`, the `response.cancel` translation, and `prepareClose`.
- OpenAI contract: Live has its own client-event schema; standalone Responses and Realtime commands are not interchangeable with Live commands. Neither the current [primary WebSocket reference](https://developers.openai.com/api/reference/resources/live/primary-websocket) nor [sideband reference](https://developers.openai.com/api/reference/resources/live/sideband-websocket) defines `response.cancel`. See also [Live delegation](pages/api/docs/guides/live-delegation.md), which explains the subset supported through Live.
- Observed implementation: directly sends `response.cancel` with a response ID to the provider. The timeout commentary states that the application cancelled the pending backend response.
- Why it matters: suppressing late results locally does not confirm provider cancellation. The adapter must not rely on an undocumented event to stop provider work or describe that work as confirmed cancelled.
- Verification: an in-memory adapter probe reproduced the outgoing command and the cancellation assertion. No authenticated real-provider rejection was tested.
- Direction: preserve local stale-result protection; distinguish abandonment from confirmed cancellation and use only documented Live controls.

### LC-002 — Web-derived answers lack required inline citations

- Classification: explicit presentation-contract mismatch; high confidence for the current voice answer display.
- OpenAI requirement: [Web search, Output and citations](pages/api/docs/guides/tools-web-search.md#output-and-citations): “When your interface displays web results or information from them, you must show inline citations as prominent, clickable links.”
- Evidence: [ProfileVoice.tsx](../../../src/ProfileVoice.tsx), the `Latest answer` plain-text paragraph and separate collapsed `Official sources` panel.
- Observed implementation: source links are collected and displayed, but are not clickable inline references attached to the displayed answer's claims.
- Why it matters: a reader cannot readily map a statement about costs, dates, or rules to its supporting source. A separate source list is useful but does not meet the quoted inline requirement.
- Verification: source tracing of research-result handling and JSX rendering; no browser inspection in this review.
- Direction: preserve claim-to-source associations and render linked citations alongside displayed research claims. This finding does not require speaking URLs aloud.

### LC-003 — Normal shutdown releases transports before finalization

- Classification: documented lifecycle departure; high confidence.
- OpenAI guidance: [Managing sessions, Usage and graceful close](pages/api/docs/guides/live-conversations.md#usage-and-graceful-close) and [Voice server controls, Finish cleanly](pages/api/docs/guides/voice-server-controls.md#finish-cleanly) require keeping receivers/transports open until `session.closed`, or recording incomplete finalization after an application timeout.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), its proxy `close`; [studentVoiceChannel.mjs](../../../src/studentVoiceChannel.mjs), `close`; [voice-control.mjs](../../../server/voice-control.mjs), `dispose` and closure-only sideband handling.
- Observed implementation: sends `session.close`, then immediately closes the channel or provider connection.
- Why it matters: finishing local farewell playback is different from confirming provider finalization. Final usage and close reason can be missed.
- Verification: an in-memory probe confirmed immediate transport closure after sending `session.close`.
- Direction: introduce a bounded finalization phase for normal shutdown. Privacy, permission loss, and transport failures may still require immediate teardown; record those outcomes accurately.

### LC-004 — Voice usage, delegated usage, and final close details are dropped

- Classification: documented accounting/lifecycle departure; high confidence for the traced adapter path.
- OpenAI guidance: [Usage and graceful close](pages/api/docs/guides/live-conversations.md#usage-and-graceful-close) says to track cumulative `usage.seconds`, preserve delegated usage from `response.event`, and read final usage, reason, and session snapshot from `session.closed`.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), `receive`, nested terminal-response translation, and the `session.closed` branch.
- Observed implementation: `session.usage.updated` is not forwarded; translated backend events omit `response.usage`; `session.closed` becomes a close callback without its original usage, reason, or snapshot.
- Why it matters: application activity heartbeats are not authoritative provider usage. Losing those values limits cost reconciliation and diagnosis of incomplete finalization.
- Verification: synthetic usage, backend-completion, and close events confirmed that the values do not reach application events.
- Direction: retain native usage and finalization records separately from UI turn events and activity telemetry.

### LC-005 — Late Responses validation failures leave an applied configuration uncorrected

- Classification: documented recovery gap, not an invalid request schema; high confidence for the reproduced event ordering.
- OpenAI guidance: [Live delegation, Handle configuration errors](pages/api/docs/guides/live-delegation.md#handle-configuration-errors): `session.started` and `session.updated` do not wait for validation; `responses_validation_failed` leaves the session open and does not roll settings back; correct invalid settings through `session.update`.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), `finishConfiguration`, `session.updated`, and generic error handling; [ProfileVoice.tsx](../../../src/ProfileVoice.tsx), generic nonterminal error notices.
- Observed implementation: the application can announce configuration applied and retire its tracking record before a later validation error. The late error is forwarded, but does not invalidate that applied state or initiate corrective configuration.
- Why it matters: speech can remain connected while delegated work remains misconfigured. Early validation errors are handled differently; this finding specifically concerns late failures.
- Verification: an in-memory probe supplied update acknowledgment followed by a correlated validation error. Applied state was emitted and no corrective provider command followed.
- Direction: retain enough configuration identity to mark late failure, block affected work, and recover with a known valid configuration. Do not automatically repeat uncertain writes.

### LC-006 — Caller transcript timing is discarded

- Classification: transcript-handling guidance departure; high confidence for metadata loss, unverified impact on real conversations.
- OpenAI guidance: [Managing sessions, Transcript deltas](pages/api/docs/guides/live-conversations.md#transcript-deltas) says to retain `start_ms` and `end_ms` and use those intervals instead of packet arrival times to organize transcripts. Transcript gaps are not reliable completed-turn signals.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), input transcript handling and `flushInput`.
- Observed implementation: concatenates caller text, discards native input-fragment timing in translated events, and uses local arrival-time windows for grouping. Output deltas retain timing, so the loss is not symmetrical.
- Why it matters: network delivery can change apparent caller-turn boundaries and the relationship between an initial statement and its correction.
- Verification: source tracing; delayed/reordered real audio was not tested. The adapter labels its synthesized boundaries as estimates, which is a useful existing safeguard.
- Direction: preserve native fragments and timing while keeping display grouping and action authorization distinct. Do not treat a timestamp as proof of consent or a semantically finished request.

## Natural conversation configuration review

This pass focuses on who controls ordinary wording, when delegation occurs, how context enters speech, and how interruptions are handled. The findings below distinguish explicit documentation mismatches from product choices that require evaluation.

### NC-001 — The conversational delegation policy changes a label OpenAI says to retain

- Classification: explicit prompt-structure guidance departure; high confidence. This is not an API-schema violation.
- OpenAI guidance: [Prompting GPT-Live, Delegation](pages/api/docs/guides/live-prompting.md#delegation) says to keep all three labels: `Backend tools`, `Generate <|SpawnThinking|> when`, and `Do not generate <|SpawnThinking|> when`.
- Evidence: [live-delegation-policy.mjs](../../../server/live-delegation-policy.mjs), `liveDelegationInstructions`.
- Observed implementation: the baseline retains the third label, but the bounded conversational policy replaces it with `Answer directly without <|SpawnThinking|> when`.
- Possible effect: the intended meaning is similar, but the configuration departs from the recommended structure. No measured degradation or special parser dependency is established.
- Direction: preserve the documented label while retaining the useful direct-answer and context-reuse rules. Compare delegation choices on representative calls before claiming a behavior improvement.

### NC-002 — The generic message adapter routes user data into instruction appends

- Classification: documented routing/separation mismatch in a supported adapter path; high confidence for translation, production reachability depends on the caller.
- OpenAI guidance: [Live delegation, Accept typed input](pages/api/docs/guides/live-delegation.md#accept-typed-input) directs Responses-backed sessions to queue user-provided values as a backend user message using `response.item.create`. [Managing sessions](pages/api/docs/guides/live-conversations.md#add-context-during-the-conversation) separates trusted behavior instructions from factual context.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), `conversation.item.create` message handling; [studentLiveChannel.test.mjs](../../../src/studentLiveChannel.test.mjs), the user-message translation fixture.
- Observed implementation: every message item is converted to `session.instructions.append`; user messages are quoted and labeled reference data but are still sent on the instruction channel. No corresponding backend user-message item is queued by that branch. Longer content is split into multiple instruction appends.
- Why it matters for conversation: instruction appends can interrupt current speech. The backend may also lack the exact user message it needs to act on. Quoting the data is a useful safeguard, but does not implement the documented routing.
- Limitation: this is not evidence that every live utterance or research result takes this path. Spoken audio and the dedicated quiet-research path are separate.
- Direction: distinguish user data, factual/UI context, trusted steering, and required speech; use their documented channels and preserve backend context where needed. Do not move genuine corrective instructions blindly into quiet context.

### NC-003 — A request to clear output is implemented only as a prompt instruction

- Classification: control-semantics gap against documented playback guidance; high confidence for the adapter behavior. Immediate-stop guarantees are not established.
- OpenAI guidance: [Prompting GPT-Live, Interruptions](pages/api/docs/guides/live-prompting.md#interruptions) says prompts do not provide precise control over stopping speech. [Voice server controls, Control playback when needed](pages/api/docs/guides/voice-server-controls.md#control-playback-when-needed) directs applications needing guaranteed output blocking to mute/drop playback and discard queued audio.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), translation of `output_audio_buffer.clear`; [student-live-session.mjs](../../../server/student-live-session.mjs), interruption policy; [voiceClosing.mjs](../../../src/voiceClosing.mjs), closing commands.
- Observed implementation: the adapter maps clear-output requests to `session.instructions.append` asking the model to stop. That branch does not clear a player queue, mute the playback element, or drop the media stream.
- Why it matters for conversation: a prompt can encourage yielding but cannot implement deterministic clearing of already generated audio. This is especially relevant where application code expects clear-output semantics during an intervention or closing sequence.
- Limitation: instructing the model to yield is itself valid and recommended. This finding does not mean every overlap is a defect, or that ordinary conversation should be buffered or forcibly muted.
- Direction: define which flows require a hard audio stop and verify application-controlled playback for those flows. Keep ordinary conversational yielding natural.

### NC-004 — Backend-first modes have broad triggers for otherwise simple conversation

- Classification: evaluation hypothesis / tension with the recommended delegation template; not a demonstrated violation.
- OpenAI guidance: [Prompting GPT-Live](pages/api/docs/guides/live-prompting.md#recommended-prompt-structure) permits answering from conversation or a still-current result, and asking a brief clarification without delegation. It recommends backend handoff when a capability or careful reasoning is needed.
- Evidence: [live-delegation-policy.mjs](../../../server/live-delegation-policy.mjs), baseline policy and routing; [student-live-session.mjs](../../../server/student-live-session.mjs), conversational-mode policy selection.
- Observed implementation: outside the bounded conversational branch, the policy delegates substantive guidance and a complete question/profile answer/action/correction advancing a workflow. Its nondelegation examples are limited to greetings, acknowledgments, and approved farewells.
- Possible effect: a simple clarification or explanation during family/setup flows may take an unnecessary backend round trip. That behavior was not demonstrated in this review.
- Counterevidence: onboarding legitimately requires backend draft updates and guarded receipts; the bounded branch already permits direct answers, care, clarifications, and reuse. Do not remove necessary workflow delegation.
- Next evaluation: test known-result recaps, ordinary explanations, and brief clarification separately from profile mutations, scope selection, permissions, and saving.

### NC-005 — Broad anti-repetition wording may conflict with required readbacks

- Classification: evaluation hypothesis / prompt-conflict risk; not a proven spoken failure or API violation.
- OpenAI guidance: [Prompting GPT-Live](pages/api/docs/guides/live-prompting.md) recommends letting the model choose ordinary wording and checking optional controls for conflicts. [Deliver a disclosure](pages/api/docs/guides/live-conversations.md#deliver-a-disclosure) supports specific wording where it is required.
- Evidence: [student-live-session.mjs](../../../server/student-live-session.mjs) says “Never speak or role-play caller words, quotes or history,” while its speech contracts require complete verbatim readbacks. [student-live-prompts.mjs](../../../server/student-live-prompts.mjs) also requires preserving exact selected words in disclosures. [voiceHandoff.mjs](../../../src/voiceHandoff.mjs) adds a broad prohibition on speaking or paraphrasing the caller request.
- Possible effect: the intended ban on accidental role-play/replay may also discourage legitimate confirmation or required repetition of selected user text. Explicit readback instructions may successfully resolve the conflict; that has not been measured here.
- Direction: distinguish unwanted replay from authorized quotation and mandatory disclosure. Preserve all consent checks and exact-readback requirements.

## Further audit: highest-impact conversation candidates

### NC-006 — Missing transcript punctuation can strand a research contribution

- Classification: reproduced application scheduling defect; not an unsupported API request. High confidence in the branch behavior, real-call frequency unmeasured.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), `deliveryTracker.canAnnounce` and legacy `checkResearch`, both requiring the last assistant text to end in sentence punctuation; [researchDelivery.mjs](../../../src/researchDelivery.mjs), the two-minute optional-announcement opportunity.
- OpenAI guidance: [Transcript deltas](pages/api/docs/guides/live-conversations.md#transcript-deltas) distinguishes uneven text fragments from semantic turns and playback. [Live delegation](pages/api/docs/guides/live-delegation.md) recommends coherent, useful verified updates while keeping speech, task state, and playback distinct.
- Reproduction: with V2 enabled, idle playback, acknowledged research context, and identical last text except a trailing period, the adapter requested one research commentary within ten seconds for the punctuated version and zero for the unpunctuated version. The punctuation check is a hard gate, so further idle time does not itself satisfy it. V2 can eventually expire the unsolicited opportunity; the evidence remains available quietly.
- Likely experience: “Origen said it would check, but never came back with the answer,” despite a completed lookup. A subsequent native reply or caller question may still use the supplied evidence; this is not proof of total result loss.
- Direction: retain protection against interrupting real unfinished speech, but do not make a punctuation character indispensable. Evaluate a bounded fallback using playback, native fragment timing, current caller activity, and whether the requested finding was already explained. Silence alone must not force a recap or manufacture a turn.
- Priority: first conversation-quality candidate to evaluate.

### NC-007 — A long early profile field can crowd out more useful basic context

- Classification: reproduced selection-budget behavior and prioritization opportunity; not a privacy or token-limit violation.
- Evidence: [liveSelectionBrief.mjs](../../../src/liveSelectionBrief.mjs), fixed field order `name, goals, school, interest, stage, institutions, entryTerm`, one 480-byte snapshot, and at most one fitting record.
- OpenAI guidance: [Live delegation](pages/api/docs/guides/live-delegation.md) recommends concise, relevant facts and keeping large records in the backend. It does not prescribe this byte budget or this field order.
- Reproduction: a synthetic profile with a 280-character goals field retained name/goals/school but omitted the short education-stage field and institution. With no goals text, both were retained. Whole fields and qualifications are preserved rather than cut, which is an important safeguard.
- Likely experience: Origen has a long goal but lacks a simple fact needed to avoid asking a repeated question. The full context is still available to the managed backend through the selection receipt, so this is specifically about what Live can answer directly without delegation.
- Direction: select whole facts by relevance to the current request and reserve room for basic scope/stage where useful. Consider a measured token budget or additional coherent quiet updates. Do not inject full dossiers, expand student access, or strip attribution to fit more facts.
- Priority: high candidate for fewer repeated questions and smoother continuity; actual repeats require audio evaluation.

### NC-008 — Completed read-only tool calls wait for the terminal backend event

- Classification: reproduced dispatch delay; latency opportunity, not a protocol violation.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), `response.output_item.done` collection and dispatch inside the terminal-response branch.
- OpenAI guidance: [Return tool results and approvals](pages/api/docs/guides/live-delegation.md#return-tool-results-and-approvals) allows supplying completed tool results and requesting continuation before the current backend response completes. Its latency guidance recommends starting authorized work when inputs are ready.
- Reproduction: an in-memory complete `lookup_financial_aid` function-call item produced zero application tool dispatches until a later `response.completed`, then one. The actual elapsed gap on the provider was not measured.
- Likely experience: research starts later than necessary when a finished call arrives before the terminal event. No meaningful improvement is established if that event gap is negligible in real calls.
- Direction: measure the item-done-to-dispatch gap first. Explore early execution only for eligible, independently authorized read-only operations, with call-ID deduplication, current scope/revision checks, and correct continuation ownership. Keep writes, consent, dependent operations, and incomplete arguments guarded.
- Priority: high if measured event gaps materially affect first useful spoken answers.

### NC-009 — Legacy research follow-through can be retired by unrelated conversation

- Classification: source-backed, feature-dependent evaluation hypothesis; no real-call reproduction in this pass.
- Evidence: [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs), legacy `researchReady.quietOnly` changes on caller fragments and on a new native assistant reply, and `checkResearch` clearing quiet-only work. The newer [researchDelivery.mjs](../../../src/researchDelivery.mjs) distinguishes unrelated replies from evidence overlap.
- Configuration: `ORIGEN_RESEARCH_DELIVERY_V2` is opt-in at server-control construction; its source default is off. The deployed value was not inspected. Browser-local construction also needs its actual options traced before assuming V2 applies.
- OpenAI guidance: [Keep updates accurate and useful](pages/api/docs/guides/live-delegation.md#keep-updates-accurate-and-useful) and result reuse guidance support returning relevant verified findings without duplicate announcements. Conversation continuing is not the same as explaining a requested finding.
- Possible experience: a short side comment suppresses the optional follow-up to an earlier requested check. Conversely, suppression is appropriate when the user moves on or already received the answer. Quiet evidence is retained, so neither branch should be described as deleting the report.
- Direction: establish which delivery policy is active and evaluate “research question → unrelated short exchange → result arrives.” Use V2's existing overlap/portion coverage behavior as counterevidence to a blanket claim that all paths lose follow-through. Do not simply force every result to be announced.
- Priority: high investigation priority if production uses the legacy policy.

## Conversation improvement priorities

These priorities concern likely user experience, not API-contract severity. All changes remain proposals.

| Order | Candidate | Expected benefit | Evidence / next decision |
| --- | --- | --- | --- |
| 1 | NC-006: punctuation-independent follow-through | Fewer completed checks that never get explained | Reproduced scheduling difference; test with natural audio and interruptions |
| 2 | NC-007: relevance-based brief selection | Fewer repeated questions and avoidable recall calls | Reproduced omitted stage/institution; evaluate real questions |
| 3 | NC-009: establish active delivery policy | Keep ordinary conversation from suppressing useful research | Source/flag dependent; verify deployment and run both policies |
| 4 | NC-008: earlier eligible lookup dispatch | Shorter waits for useful findings | Dispatch behavior reproduced; measure actual provider event gap |
| 5 | NC-002 / NC-003: context channels and playback semantics | Fewer app-induced interruptions and more reliable hard stops | Trace active message callers; verify rendered audio |
| 6 | NC-004 / NC-005: delegation breadth and conflicting wording | More direct replies and fewer awkward readbacks | Hypotheses; representative English/Spanish calls needed |
| 7 | NC-001: retain documented heading | Better alignment with the recommended prompt structure | Low-cost alignment; no demonstrated quality gain |

Protect existing useful behavior: quiet context, no duplicate announcements, current caller priority, source qualifications, student isolation, mandatory readbacks, and application-confirmed writes. Faster speech or shorter waits are not improvements if these regress. Do not globally shorten listening windows: deliberate pauses and slow speech need space.

## Responses guidance comparison

This pass distinguishes standalone HTTP Responses research from Live-managed Responses delegation. Reusing the earlier full-library review, it traces the research request builders, worker, structured-result parser, recovery diagnostics, and Live tool configuration. No new unsupported-request finding was established in this pass.

| OpenAI guidance | Current implementation | Assessment |
| --- | --- | --- |
| Use Responses for reasoning and tool-backed work | Worker calls `/v1/responses`; Live uses managed Responses delegation | Aligned |
| Use Structured Outputs for machine-readable results | `researchBriefRequest` uses `json_schema`, `strict: true`, required fields and closed object schemas | Aligned for output shape; factual correctness still needs evidence checks |
| Keep speech-ready results concise and retain detailed evidence in the backend | Brief, findings, qualifications, and report generated together | Aligned in intent; inspect shared output budget, RS-002 |
| Preserve uncertainty and handle incomplete outputs | Finance/admissions parsers reject `incomplete`; unverified fallback requires `completed` | Useful safeguard; failure diagnosis remains weak, RS-001 |
| Track citations and display linked attribution | Parser maps URL annotations to source IDs; recovery remaps citation IDs by URL | Backend mapping is useful; displayed inline links remain LC-002 |
| Enable strict function schemas where feasible | Live forcibly replaces each tool's strict setting with `false` | Supported opt-out, but departs from recommendation, RS-003 |
| Reuse current context and avoid redundant tool work | Existing-result coverage, cache checks, bounded targeted recovery | Aligned; validity depends on scope/year checks, not merely cache presence |
| Handle tools using the appropriate transport contract | Live queues `response.item.create` results and sends a separate `response.create` continuation | Aligned; unsupported cancellation remains LC-001 |
| Keep private input out of public search | Dedicated public input shaping and separate research requests | Aligned in structure; this comparison is not a security validation of every privacy boundary |
| Use caching and transport options appropriate to the workload | HTTP requests for independent research; persistent managed backend through Live | Valid choices. Separate standalone WebSockets, `previous_response_id`, durable Conversations, or API background mode are not universally required |

### RS-001 — Responses failure reasons are lost in worker diagnostics

- Classification: documented error-handling/observability gap; high confidence in discarded fields, not proof of incorrect factual delivery.
- Guidance: [Reasoning models](pages/api/docs/guides/reasoning.md) explains `incomplete_details.reason = max_output_tokens`, including exhaustion before visible output; [Structured Outputs](pages/api/docs/guides/structured-outputs.md) explicitly discusses refusals and incomplete responses.
- Evidence: [voice-research-worker.mjs](../../../server/voice-research-worker.mjs), `run`; [research-recovery.mjs](../../../server/research-recovery.mjs), `researchAttemptDiagnostics`; finance/admissions parsers.
- Observation: parsers appropriately reject incomplete results, but retained attempt diagnostics omit provider response status, incomplete reason, refusal classification, provider error code, reasoning-token counts, and request ID. HTTP status is retained when available. An uncitable result, token exhaustion, or refusal can end up as a generic failed attempt rather than an actionable cause.
- Verification: a synthetic response with status `incomplete` and reason `max_output_tokens` produced a diagnostic with only pass/outcome/duration/tool actions and consulted sources; the incomplete reason was absent.
- Conversation impact: Origen can report an unavailable check without the application distinguishing an evidence gap from an output-budget or provider failure. That makes targeted recovery and diagnosis harder.
- Direction: retain safe structured failure categories and provider correlation, then choose recovery accordingly. Do not log private reasoning or blindly retry refusals or uncertain writes.

### RS-002 — Brief and detailed report compete with reasoning inside a small shared cap

- Classification: source-backed budget risk / evaluation hypothesis; not a proven violation or established production truncation rate.
- Guidance: [Reasoning models](pages/api/docs/guides/reasoning.md) explains that `max_output_tokens` covers reasoning and visible output. Incomplete output is possible even before visible text. Its initial experimentation buffer is guidance, not a requirement to set every call to 25,000 tokens.
- Evidence: [admissions-research.mjs](../../../server/admissions-research.mjs) sets 1,800 output tokens; [finance-research.mjs](../../../server/finance-research.mjs) sets 3,000; [research-brief.mjs](../../../server/research-brief.mjs) adds the brief, up to eight findings, and detailed report without adjusting the inherited cap.
- Verification: calling the brief wrapper with an 1,800-token request retained that cap while requiring both `brief` and `report`. This proves shared configuration, not that the model exhausts it.
- Conversation impact: a useful narrow answer could be unavailable if reasoning and supporting report consume the available budget before valid JSON completes.
- Direction: measure actual incomplete reasons, reasoning/visible usage, question complexity, and first useful result time. Adjust output obligations and budget together. Do not simply enlarge every request or drop essential qualifications to fit.

### RS-003 — Live discards tool-specific strict-schema settings

- Classification: explicit recommendation departure with a supported API setting; high confidence from source, effect on invalid-call frequency unmeasured.
- Guidance: [Function calling, Strict mode](pages/api/docs/guides/function-calling.md#strict-mode) recommends strict mode but explicitly permits `strict: false`. Strict schemas require closed objects and all properties required, using nullable values for optional fields.
- Evidence: [student-live-session.mjs](../../../server/student-live-session.mjs) maps every tool to `{...tool, strict:false}`; [studentLiveChannel.mjs](../../../src/studentLiveChannel.mjs) does the same for updates. Other tool definitions, such as [opportunities.mjs](../../../server/opportunities.mjs), explicitly declare `strict:true`.
- Observation: a schema-compatible tool cannot preserve its declared strict setting through these builders. Conversely, existing schemas with optional properties cannot safely become strict through a blind switch.
- Conversation impact: invalid/missing arguments may cause failed tool attempts or follow-up questions that stricter generation could avoid. Server-side validation and consent checks remain necessary either way.
- Direction: classify tools by strict compatibility, preserve validated tool intent, and evaluate argument-error rates before any migration. This is not evidence that non-strict calls bypass application authorization.

### Verification limits for this pass

The brief-wrapper and failure-diagnostic probes ran without provider calls. A broader import-based probe could not run because the current checkout lacks the `pg` dependency. No dependencies were installed, no live calls were placed, and no application code was edited. The strict-setting comparison therefore rests on the explicit configuration mappings, not a successful end-to-end execution.

## Choices that are not established violations

- **No backchannels:** explicitly supported by the prompting guide's “None” recipe. Warmth does not require mm-hmm or overlapping speech.
- **A warm, unhurried Marin voice:** supported configuration; quality needs English/Spanish listening tests, not a different voice by assumption.
- **Default brevity with expansion on request:** allowed. One-to-three-sentence defaults are not inherently unnatural or forbidden.
- **480-byte context packets:** conservatively below the documented 500-token append ceiling. Efficiency and coherence are evaluation questions, not size-limit violations.
- **Quiet research context followed by useful commentary:** aligned with documented thinking/commentary roles; do not replace it with mandatory spoken progress updates.
- **Sequential tools, low reasoning effort, default tier, and `strict: false`:** supported choices. Strict mode is recommended, not universally required; model/tool compatibility and server validation still matter.
- **Application-managed background jobs:** not a requirement to enable standalone Responses `background: true`; these are different mechanisms.
- **Keeping Live speech and the Responses backend separate:** correct architecture. Managed delegation owns its backend context; standalone Responses replay requirements must not be imposed on it indiscriminately.
- **Long prompts:** complexity may hurt consistency, but length alone is not a proven violation. Check actual token limits and representative audio before making performance claims.
- **MCP, computer use, image/file inputs, hosted file search, durable Conversations, and fork storage:** library coverage does not make these features mandatory. No violation is inferred from not enabling them in the traced Live session.

## Suggested evaluation scenarios

Compare the same English and Spanish scenarios before and after any future change. Measure the first useful spoken answer, unnecessary delegations, repeated questions, interruptions, correct reuse, and task success separately.

1. Explain or recap an already supplied fact without research.
2. Ask one brief clarification when the request is ambiguous.
3. Express worry while research runs; receive a relevant response without invented progress.
4. Correct a request while a lookup is running; supersede only the affected work.
5. Say “stop” or “wait” during speech; distinguish prompt yielding from hard playback interruption.
6. Change student scope while a result arrives; preserve authorization and discard stale context.
7. Supply a typed value through the adapter; verify exact backend input and uninterrupted speech.
8. Complete and interrupt mandatory readbacks; verify wording, playback, and separate consent.
9. Trigger a late Responses configuration error; verify invalid state is recognized and recovered.
10. End a normal call; verify farewell playback, provider finalization, and voice/backend usage independently.

## Change log

- November 6, 2026: created the living audit; recorded LC-001 through LC-006 from the initial architecture review and NC-001 through NC-005 from the natural conversation configuration pass. No application fixes applied.

- November 6, 2026: continued the conversation-impact audit; added NC-006 through NC-009 and ranked improvement candidates. In-memory probes reproduced punctuation gating, brief-field crowding, and terminal-event dispatch buffering. No application code changed.

- November 6, 2026: added the standalone/managed Responses comparison and RS-001 through RS-003. Distinguished existing safeguards from recommendation gaps and output-budget hypotheses; documented probe limitations.

- November 6, 2026: added [Live Measurement Plan](LIVE_MEASUREMENT_PLAN.md), metadata-only API/worker observations and an offline summary report. Instrumentation is implemented but not deployed; findings remain open. RS-001 now has classified worker diagnostics, while real-call verification and finer provider correlation remain pending.
