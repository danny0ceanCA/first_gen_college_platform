# Decisions integration: supporting guidance review

Reviewed on 2026-11-07 (America/Los_Angeles). Scope: proposal preparation on `v1.3-decisions-integration`; no runtime integration, provider requests, migrations, production access, or paid tests performed by this review.

## Read coverage

The following eight saved documents were read in full twice. The first pass covered purpose and behavior; the second checked requirements, edge cases, data handling, measurement, and relevance to Origen. All prose, tables, footnotes, and SDK examples were included. Long files were read in bounded chunks; repeated whitespace was normalized in some reads, but content was not summarized or omitted. Initial truncated reads were repaired with explicit reads of the missing ranges. There are no remaining read-coverage gaps within this assigned set.

| Saved document | Pass 1 | Pass 2 |
| --- | --- | --- |
| [Function calling](../pages/api/docs/guides/function-calling.md) | Complete | Complete |
| [Latency optimization](../pages/api/docs/guides/latency-optimization.md) | Complete | Complete |
| [PrivateLink](../pages/api/docs/guides/private-link.md) | Complete | Complete |
| [Prompt caching](../pages/api/docs/guides/prompt-caching.md) | Complete | Complete |
| [Safety best practices](../pages/api/docs/guides/safety-best-practices.md) | Complete | Complete |
| [Structured outputs](../pages/api/docs/guides/structured-outputs.md) | Complete | Complete |
| [Your data](../pages/api/docs/guides/your-data.md) | Complete | Complete |
| [Pricing](../pages/api/docs/pricing.md) | Complete | Complete |

This note does not claim that this reviewer read the rest of the Decisions library, the separate Responses library, or every newly linked page twice. Other review groups cover those assigned contracts. Current official Decisions pricing and endpoint details require the core Decisions review; the saved general pricing page alone is not a complete Decisions pricing reference.

## What the supporting guidance changes about the proposal

| Guidance | Implication for Origen |
| --- | --- |
| Function calling separates a model's proposed tool call from application execution. | Decisions should initially return an observation. The application still owns account scope, selected student, active request revision, permission checks, deduplication, and whether anything may be delivered. A positive classification is not permission to run research or change a record. |
| Latency optimization favors fewer requests, smaller appropriate models, concise outputs, parallel independent work, and ordinary code where sufficient. | Do not insert a classifier before every spoken answer. Let Live continue normally while an optional observer runs independently. Coalesce meaningful transcript changes, bound work, and discard stale observations. A timeout should mean no intervention, not a stalled conversation. |
| Prompt caching reuses prefix processing; it does not supply memory or guarantee an identical answer. | Keep reusable rubrics and schemas stable, with changing conversation evidence afterward. Do not pad requests with documentation or unrelated student data. Measure actual cache usage and cost; do not assume standalone Responses cache fields apply to Decisions. |
| Structured output constrains shape but does not guarantee correct interpretation. | Explicitly support uncertainty and no-action outcomes. A valid label is not proof of confusion, an unresolved question, successful playback, or a completed student action. Handle refusal, incomplete output, timeout, and unsupported configuration separately. |
| Safety guidance emphasizes adversarial testing and human review of limitations. | Evaluate transcript mistakes, negation, interruptions, bilingual speech, and misleading source text. Use bounded evidence and neutral signals such as a request for clarification, rather than inferring enduring ability or personal traits. |
| Data handling differs by endpoint and configuration. | Maintain an endpoint-specific retention inventory. Live settings do not automatically apply to Decisions, Responses, external tools, or Origen's database. A separate worker process is not the same thing as Responses `background: true`. |
| PrivateLink is an enterprise networking option with Azure requirements. | It is not a prerequisite for this integration and is not a conversational improvement. Introducing it into the initial Render proposal would add unrelated operational work. |
| Live, backend models, tools, and cache operations can be billed separately. | Measure additional cost per call and how often a decision causes unnecessary follow-on work. Budget for the full path, not just the classification. No naturalness percentage, latency improvement, or cost saving is established by documentation alone. |

## Contract and source caveats

- Standalone Responses function-call continuation is distinct from Live delegation. A standalone response may contain zero, one, or multiple calls; application code must associate results with their calls. Do not transplant this loop into Live without its specific event contract.
- The saved function-calling guide contains ambiguous prose saying the arguments-done event contains the entire item, while its examples show the complete function item at `response.output_item.done`. Implementation should follow the relevant current event reference and completed-item contract, not infer the function name and call ID from an arguments fragment.
- Structured-output schemas and Decisions' classification contracts are different interfaces. General JSON-schema examples are not permission to send unsupported fields to Decisions. Strict schemas also require explicit handling of missing or incompatible evidence; forcing a field can otherwise encourage a plausible but incorrect answer.
- Some supporting guides contain historical model and fine-tuning examples. The general pricing page describes changes to fine-tuning availability. Those examples are not a recommendation to add fine-tuning for this work.
- The saved general pricing page does not itself give the complete Decisions-specific formula. The current [Decisions pricing and availability section](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability) is the appropriate additional source, as verified by the coordinating review. No paid measurement was performed in this review.
- Caching reduces repeated computation, not semantic uncertainty. Cache writes and prewarming can cost money; a cache TTL is not a promise of immediate deletion at that instant. Do not treat cache keys as an authorization boundary.

## Data handling and permissions

The saved data guide says API data is not used for model training by default unless the customer opts in. That is separate from abuse-monitoring retention, application state, prompt-cache retention, and Origen's own storage. Decisions has its own row in the endpoint table. Zero Data Retention or Modified Abuse Monitoring depends on approved account configuration; `store: false` alone is not equivalent to either.

The guide also distinguishes Responses storage, background polling state, Conversations objects retained until deleted, and Live session recording. Adding a server-side Conversation object would therefore be a separate state and retention decision, not an automatic prerequisite for an optional classifier. Do not assume the absence of provider application state means there are no retained logs anywhere.

For the proposed observer, derive student and account identity from authenticated application state. Send only the conversation evidence needed for a narrow decision. Keep institution documents and transcript text as reference data, never as executable instructions. Preserve existing eligibility, staff permissions, deletion behavior, and separation of network-effects research. Classification confidence must not be used as authorization or as evidence that a student achieved an outcome.

## Read-only comparison with the current repository

The following inspection was limited to the files listed; it was not a full-system or production audit.

| Current implementation | Evidence | Relevance to a future observer |
| --- | --- | --- |
| Durable research diagnostics are independent of the short-lived job queue. The archive keeps bounded request/result projections and cascades account deletion. | [Migration 124](../../../../server/migrations/124_voice_research_traces.sql) | A decision audit should likewise survive its transient processing task while respecting account deletion. The existing research archive is not a justification to copy whole transcripts into every new event. |
| Research traces use allowlisted metadata, bounded asynchronous writes, explicit gap reporting, and account-scoped observers. | [Research trace implementation](../../../../server/research-trace.mjs) | Reuse these design principles for classification events. Do not silently place Decisions events into a research-specific schema without an explicit schema and access review. Diagnostics must not become a blocking voice dependency. |
| Research events explicitly distinguish `server_observed`, `transcript_observed`, and `browser_reported`. | [Research trace implementation](../../../../server/research-trace.mjs) | A classifier's belief that something was said or understood is a further observation, not playback proof. Continue measuring actual output and browser playback separately. |
| Network-effects extraction uses its own database configuration, restricted role checks, independent extraction/verification work, and persistent budget reservation. | [Database](../../../../server/network-effects/database.mjs), [worker](../../../../server/network-effects/worker.mjs) | Keep this research infrastructure isolated. A live classification must not automatically write outcomes, alter operational profiles, or route data into cross-user learning. Budget reservation and unknown-usage handling are useful patterns for future paid validation. |
| Network-effects administration is feature gated, permission checked, and reported as observation-only. | [Admin integration](../../../../server/network-effects/admin.mjs) | A future observation dashboard can follow existing capability gates, but needs its own explicit access and data contract. It should not imply Decisions is already integrated. |
| Provider-voice diagnostics have a bounded, non-gating probe and distinguish requested from provider-confirmed voice. | [Voice diagnostics](../../../../server/live-voice-diagnostics.mjs) | Preserve the same discipline: independent diagnostics, no retry storm, no prompt additions, and no restart of a working conversation merely to obtain an observation. |

## Topic-general first-generation family use cases

The best initial candidates are narrow signals whose value can be judged against the current conversation:

- The caller explicitly says they do not know where to start: “I don't know where to begin” or “No sé por dónde empezar.” A useful eventual response might offer one manageable starting point after the current thought finishes.
- The caller asks for a simpler explanation of an unfamiliar college term. This should support a brief plain-language explanation, without classifying the student as less capable.
- A family requests an explanation in Spanish, English, or both. Context matters: quoting another person's Spanish words should not automatically switch the call's language.
- The user corrects the active question or asks to add a college or scenario. The application should identify what changed and retain still-relevant evidence; the classifier does not itself authorize a new lookup.
- The caller expresses a concern while research runs. The useful intervention, if any, is acknowledgment or one relevant clarification, not repeated status announcements or a compulsory questionnaire.

These signals apply across exploring college, choosing a path, admissions, paying for college, family concerns, deadlines, and understanding institutional language. They should be evaluated on whether Live already handled them; duplicate support can be worse than no added observer.

## Evaluation and rollout gates

Start with offline labeled examples and then an optional shadow observer that produces no Live append, speech instruction, research request, or operational write. Record a stable policy/schema version, decision category, input evidence references, selected-student/request revision, latency, provider usage, and why a candidate would have been used or ignored. Prefer bounded codes and evidence references over private reasoning or copied transcripts in general service logs.

Evaluate English, Spanish, and mixed-language conversations separately, with held-out conversations. Include brief “yes”/“ajá” acknowledgments, genuine interruptions, negation, transcription mistakes, a changed question, a changed student, partial research, research arriving mid-answer, and a need already answered by Live. Assess respectful language and usefulness for both students and family members.

Measure:

1. Precision and recall for each agreed signal, with explicit no-action cases.
2. Useful additional detections beyond what Live already handled, alongside unnecessary-intervention rate.
3. Classification latency, age of evidence when the result arrives, and stale-result rejection.
4. Additional provider cost per call, repeated classifications, and any unnecessary research they would cause.
5. Response timing, repeated announcements, interruptions, and human-rated warmth and clarity, keeping transcript and playback evidence separate.

Only after useful incremental value is demonstrated should a separately approved phase allow a small number of candidates through the existing delivery policy. That phase must preserve the liked intro, current voice, and normal turn-taking. An observation that is late, uncertain, already addressed, or based on a superseded request should do nothing. A service failure must leave the ordinary conversation working.

A second worker service is not automatically needed for a lightweight observer. It becomes an operational choice if measured concurrency, resource isolation, or after-call evaluation work warrants it. Moving logic into a second process does not by itself make the conversation more natural; keeping optional work off the speech path and suppressing unnecessary interventions is what matters.

## Verification status

All eight assigned supporting documents were reviewed twice. The listed code files were inspected read-only. This review added only this note; it did not implement Decisions, alter Live inputs, run paid tests, or establish measured improvements. The final proposal must combine this note with the core Decisions/Live contract review and current official verification.
