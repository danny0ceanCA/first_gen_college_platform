# v1.2 research delivery and conversation review

## Scope and evidence

- Working branch: `v1.2`, base `6a5ee7f45888a8c203c5db7cad0c297bf833cced`.
- Candidate adapter revision: `research-portions-qualified-updates-2026-11-06`.
- Local implementation only. No commit, push, deploy, production setting change, or paid API test.
- Reviewed the requested November 6 diagnostic call against the code and guidance. Raw transcripts and private logs remain outside the repository.
- Preserved opening/selection delivery, voice configuration, playback controls, and native delegation ownership. Network effect extraction and storage are unchanged.

## Documentation review

The review team completed two passes over all unique content in the 45 official snapshots listed in [the manifest](../manifest.json): four Live guides, 21 other guides, and 20 API/reference documents. Repeated generated schema content was deduplicated with the user's approval; differences between copies were checked. The second pass focused on contracts, event ordering, limitations, and edge cases. All 45 saved snapshots matched their recorded hashes after normalizing Windows line endings.

The [saved Responses reference](../../OPENAI_RESPONSES_REFERENCE.md), library README, [configuration audit](../LIVE_CONFIGURATION_AUDIT.md), [measurement plan](../LIVE_MEASUREMENT_PLAN.md), and review instructions were also read twice. No requested local document was unavailable. This was a unique-content review, not a literal reread of every repeated generated schema token.

The third pass compared applicable guidance with the diagnostic timeline and current implementation. Current official [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations), [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), and [Live prompting](https://developers.openai.com/api/docs/guides/live-prompting) guidance was checked. The saved library covers the broader Responses/tool contracts; the implementation changes below concern continuous Live speech and research delivery.

## Diagnostic findings

Two research windows showed initial findings reaching context before optional recovery completed. In both, a caller fragment arrived while an output segment remained open; the same output later continued. The old adapter marked the entire segment interrupted on any caller fragment. This could discard evidence of a finished answer and allow another announcement.

In the first window, initial context was acknowledged at approximately 91.43 seconds from the call start, an amount appeared in the output transcript at 97.61 seconds, and another announcement was requested at 116.71 seconds. In the second window, context was acknowledged at 192.29 seconds, an amount appeared at 197.68 seconds, and a further announcement was requested at 226.84 seconds. A direct comparison question in that second window received a vague similarity statement before a longer explanation.

These are diagnostic event offsets, not measured user-perceived response latency. The archive reported 108 dropped diagnostic events. Native transcripts, application-generated completion boundaries, append acknowledgments, and playback activity are different evidence. No word-level playback or new audio review was performed.

## Changes and guidance connection

| Improvement | Implementation | Guidance applied |
| --- | --- | --- |
| Retain completed answer portions | Research-only speech observation recognizes narrow English/Spanish acknowledgments, uses native time intervals when present, keeps completed portions, and rejects clauses stitched across an interruption. | Transcript fragments and quiet gaps are not semantic turn completion or proof of playback. |
| Answer the latest question first | The conversation policy prioritizes the latest request, supported comparisons, and the qualifications that affect the answer. Existing verified findings stay usable after an interruption. | Give Live useful facts and let it phrase the conversation; delegate only work that needs backend help. |
| Send complete, focused updates | Each finding carries its subject/scenario, answer/year, qualification, status and citation IDs. Oversized units have explicit multipart groups and version identities; never truncate a caveat. Unchanged acknowledged facts are reused through connected references. | Use quiet context for facts, keep appends bounded, and forward complete useful updates. |
| Remain responsive during research | Ordinary concerns and follow-ups receive immediate supported explanations; ask one relevant clarification only when useful. No repeated promises to check and no requirement to fill every pause. | Live speech and backend work proceed independently; prompts should distinguish direct conversation from delegation. |
| Distinguish observations | Preserve raw input transcript intervals; record overlap classification, completed portion count, unfinished tail, and playback activity separately. Record repeated-version/unchanged-context suppression and interrupted-tail deferral. | Context acknowledgment is not spoken delivery; verify backend work and spoken playback separately. |

Context reuse also preserves updated verification status, changed source URLs/citation numbering, and reference chains across topic selections. Only findings actually selected for delivery enter the reusable-context ledger. A previous unacknowledged update is resent rather than assumed available.

No extra model, worker round trip, research call, playback interruption command, or automatic speech retry was added. These changes aim to reduce unnecessary announcements and let Live use available facts naturally; they do not make external research finish faster.

## Verification and remaining work

All **374 tests passed** in the final combined run (48.96 seconds). Offline English/Spanish tests cover brief acknowledgments, short questions that resemble acknowledgments, genuine interruptions, completed prefixes, unfinished clauses, forced flushes, sequential versus overlapping native intervals, changed questions, partial/final research updates, mid-answer arrival, changed provenance, and failed context acknowledgments. Intro/selection, session, consent, research continuation, and server control regressions are included. Production logging policy checks and whitespace validation also passed. Test execution duration is not conversation latency.

The TypeScript/Vite production build passed after retrying outside the Windows filesystem sandbox. Existing dependency directive and bundle-size warnings are nonfatal.

Still required: fresh English and Spanish calls to confirm model adherence, warm phrasing, pacing, usefulness of comparisons, and result insertion during real audio overlap. Compare output transcripts with browser playback diagnostics and native intervals; do not classify a context acknowledgment or commentary request as a heard answer. No new latency percentiles or naturalness percentages are claimed.

This is an implementation candidate with offline verification. It does not close unrelated architecture audit findings or establish a production conversation-quality improvement by itself. LC-006 now has native input interval preservation in the candidate; the broader audit remains subject to live verification and its original scope.
