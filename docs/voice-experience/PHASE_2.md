# Phase 2: Scoped, topic-aware conversation memory

## Loading memory

The authenticated backend loads summaries belonging to the signed-in account and
the confirmed student ID, or the explicit general-family scope (`null`). An
unresolved parent session receives no student profile or prior summary content.
An internal context request with no target is rejected instead of reading all
students together. Client-supplied history is replaced by server-owned records.

From at most 24 recent summaries in that scope, the selector retains six:
two newest for recent corrections, up to three additional summaries matching
the current topic, then another topic and remaining newest records as space allows.
They enter the prompt in chronological order with their dates and topics.
Topic changes rebuild the selection for the new topic in the existing call.
The browser uses the same selector for its available history; the backend remains
authoritative for authenticated calls.

Each prompt summary is bounded to approximately 1,500 characters. Long summaries
retain the beginning and ending with an explicit omission marker so final
corrections and next steps are less likely to disappear. The guide must ask for
missing details rather than treating an excerpt as complete history.

## Using and saving memory

The guide connects relevant prior discussions naturally without routine recaps,
assumed understanding or repeated questions. Current explicit corrections take
priority over saved profile fields and older history. Older user decisions,
guide suggestions, unresolved questions and completed actions remain distinct.
Historical policy explanations still need current official verification.

New summaries preserve the latest correction, unresolved questions, actual agreed
next steps, who will act and stated time frames. A suggestion, polite agreement
or silence must not become a completed action or commitment. Summaries remain
one natural narrative in the current language, using the existing persistence,
translation and student-attribution workflow.

## Boundaries and verification

This phase adds no model call, vector database or schema migration. It uses
topic-based selection, not semantic search across the entire archive; relevant
discussions older than the latest 24 candidates may be absent. On-demand deeper
archive retrieval remains an extension to evaluate rather than a claimed feature.
Existing summaries are not regenerated automatically.

Tests cover older topic relevance, recent updates, ordering, deduplication,
malformed dates, cross-account/student isolation, family scope, unresolved scope
and bounded prompt excerpts. Prompt tests establish delivered instructions, not
guaranteed live-model behavior. Listening tests should confirm that returning
users feel recognized without hearing a scripted recap.
