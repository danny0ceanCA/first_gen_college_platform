# Conversation improvement phase 2: Production conversation analysis

Phase 2 operates without the separate phase 1 collection/preferences workflow.
Signed-in conversations are analyzed from the transcript already submitted to
`/api/conversation-summary`. No additional model call is required. The analyzer
supports real conversations and synthetic test examples.

## End-to-end flow

1. The voice client annotates turns with topic and user language or expected response
   language. Progress audio stays outside the transcript. Ended calls are marked
   complete; browser-recovery checkpoints remain incomplete captures.
2. The summary endpoint uses existing authentication and ownership checks. After
   saving a summary, or finding it on retry, it analyzes the submitted transcript.
   Technical events are joined only for the authenticated account and call.
3. Migration `025_conversation_quality.sql` stores derived findings, evidence
   ordinals, coverage, counts, topic/language and analyzer version. Transcript text,
   summary prose, audio and personal names are not copied into the quality table.
4. Deferred onboarding analyses attach when summaries save. One record per account
   and discussion prevents duplicate counts. Shorter/incomplete retries cannot
   replace richer completed evidence. Analysis errors are logged safely and do not
   block a successful summary save; resubmitting retries analysis without another
   summary model call.
5. The admin Voice quality page loads the server-authorized `conversation-quality`
   action: coverage, topic/language trends, conversations flagged, occurrences,
   recent signals, confidence, reasons and ordinal evidence references.

## Findings and limits

The deterministic analyzer identifies normalized repeated questions, explicit
English/Spanish clarification requests, possible response-language drift and
potential unanswered questions in ended captures. It also reports source-check,
reply, transcription, connection, language-update and topic-update failures.
Normal topic changes are not failures. Clarification can be normal learning.

Every finding requires review. Exact repetition misses paraphrases. Language
heuristics can be wrong; unanswered-question signals have low confidence. A later
assistant turn does not establish correctness. Pronunciation, volume and audible
cutoffs require listening evidence. There is no overall quality score, inferred
emotion, automatic prompt rewrite or academic-outcome claim.

Summary-only historical discussions appear in the saved-discussion coverage count
but cannot be analyzed for spoken sequence. Discarded transcripts cannot be
backfilled. Recoverable summary requests acquire analysis when replayed. Summary
accuracy comparison remains phase 3. This service-improvement feature does not
enroll users in institutional research or model training.

## Access and lifecycle

Admin access uses the existing server allowlist or Auth0 `read:activity` permission.
Admin responses contain derived findings and no transcript text or user identities.
Account exports include their own quality records. Foreign keys remove attached
findings when their summary or account is deleted. Startup/hourly cleanup removes
findings after 90 days and unattached onboarding analyses after one day. The landing
privacy page explains this feature in English and Spanish.

Normal API deployment installs migration 025 before startup. No new secret,
provider, paid model call or worker is required. Reporting begins after deployment
and successful summary requests. Transcripts are processed transiently alongside
existing summary generation; quality storage retains only the derived report.

Reports filter 7/30/90-day windows and topic/language. Aggregation is bounded to the
latest 5,000 matching analyses and explicitly marks truncation. Saved discussion
count includes both languages because older summary rows have no language field.
Browser technical events remain best effort, including events arriving after analysis.

## Validation

Tests cover real inputs, heuristic limits, text/identity omission, language
preferences, incomplete captures, database persistence, account isolation,
technical-event ownership, retries, deferred onboarding, summary/account deletion,
summary endpoint integration, admin access, filters, coverage and retention policy.
PostgreSQL-compatible in-memory tests cover the migration/repository; production
deployment still needs verification on Render.

`node scripts/conversation-quality-demo.mjs` generates an invented sample report
at `output/conversation-quality-phase-2.json`. Production does not use that file.
