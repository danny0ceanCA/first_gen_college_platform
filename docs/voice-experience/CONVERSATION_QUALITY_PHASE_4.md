# Phase 4: administrative review workflow

The Voice quality dashboard provides a paginated review queue with topic, language, date window and human-decision filters. Automated signal trends remain separate from confirmed issues, false positives, insufficient evidence and pending counts. Metrics cover at most the latest 5,000 analyses in the selected window; the dashboard explicitly reports truncation.

Authorized administrators can record or reopen each finding's decision. Migration 026 adds an opaque review identifier and review metadata to the existing quality record. The API requires existing server-authorized admin access, validates finding indexes and decisions, locks the row during updates and rejects stale report revisions with HTTP 409. Decisions for an older report revision are not applied to changed findings. Latest decisions are preserved alongside up to 200 recent review events per current revision. Reviewer identity is hashed; admin responses expose neither account IDs nor reviewer identities.

Raw transcript text is not retained or displayed. The queue shows derived reasons and turn/event ordinals, and prominently explains this limitation. Administrators must use insufficient evidence when they cannot substantiate a signal; the interface does not imply that an automated finding has been independently verified. This phase does not introduce transcript capture or grant institutional users access.

Review metadata lives with its quality record and follows the existing summary/account deletion cascades and retention cleanup. No additional paid model calls are made by the review workflow. No automatic summary edits, prompt updates or training occur. Migration 026 must run before deployment; testing locally does not deploy it to production.
