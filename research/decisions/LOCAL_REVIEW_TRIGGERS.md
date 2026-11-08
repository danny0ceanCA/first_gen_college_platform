# Decisions trigger review — 2026-11-07

Review scope: isolated local observation and request eligibility on `v1.3-decisions-integration`. No production or Live provider configuration changes are authorized by this review.

## Full-content coverage

The assigned guide snapshots were read in full for understanding and reread for contracts and edge cases. All prose and code examples were included. Repeated whitespace padding was collapsed in large outputs; no non-whitespace content was removed. Truncated output was recovered with bounded chunks before marking a document complete.

Completed twice: `quickstart`, `text`, `structured-outputs`, `conversation-state`, `websocket-mode`, `tools`, `background`, `images-vision`, `tools-file-search`, `tools-computer-use`, `tools-web-search`, `tools-connectors-mcp`, `prompt-caching`, `safety-best-practices`, `flex-processing`, `fast-mode`, `file-inputs`, `your-data`, and `streaming-responses` (19 guide snapshots; IDs 4–6, 8–16, 18–24 in the local review index).

The saved Responses and Decisions reference documents were also read. Function-calling (ID 7) and reasoning (ID 17) were assigned to the other review agents. Their coverage belongs in the combined review, not this checklist.

Current official guide retrieval and comparison are recorded in `.local/current-guides-check.json`. The shared review verified 37 current canonical guide paths against known library snapshots. Older function-calling, conversation-state, and reasoning variants require the separately assigned current variant review. Eight legacy `/docs/` reference URLs returned 404; their canonical `/api/docs/` replacements were retrieved. This is not a claim that those legacy URLs work.

## Requirements applied to trigger design

- Keep application-owned student and task state distinct from Live session state, standalone Responses continuation, and Conversations API storage.
- A transcript delta is incomplete evidence. Accumulate caller context and use estimated application boundaries without claiming provider turn completion or playback completion.
- Capture assistant boundaries for context and diagnostics without automatically spending a classification request on each boundary.
- Reevaluate complete caller contributions, including a short reply accepting an actual conversational offer. Deduplicate repeated event/span IDs, but retain separate acknowledgment spans so a newer caller stamp cannot silently lose an in-flight acceptance.
- Record research lifecycle changes, but reserve inference for changed findings or terminal status. A revision number alone is not new semantic evidence.
- Validate classification against current application revisions before use. Decisions chooses bounded application-defined options; it does not authorize actions, research, or data writes.
- Retain hard request and cost bounds. Coalescing and a research allowance redistribute existing capacity rather than enlarging the call budget.
- Preserve facts with their year, scenario, and limitations; a completed tool call, completed request, generated transcript, delivered context, and heard speech are distinct outcomes.
- Handle unavailable, refused, incomplete, malformed, and stale classification separately. Structured output conformance does not establish semantic correctness.
- Keep stable classifier configuration separate from changing transcript data. Provider prompt caching can reduce input work but does not cache answers or justify repeated requests.
- Keep append-only local diagnostics and separate transcript evidence from playback evidence. Do not log credentials or claim access to private model reasoning.

## Existing implementation finding

The projector previously offered inference at every estimated assistant boundary and for queued/running research transitions. The reviewed call reached its 32-request ceiling before later research findings arrived. The proposed correction separates complete snapshot capture from paid inference eligibility, coalesces genuine pending evidence, and retains a bounded allowance for research changes.
