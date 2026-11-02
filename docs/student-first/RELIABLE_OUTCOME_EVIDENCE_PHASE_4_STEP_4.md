# Phase 4, step 4 — Deterministic assessment and current voice context

Implemented locally on November 2, 2026. Origen can now explain what the permitted evidence supports, its attribution and its limitations. The existing binder cards show a short assessment with expandable reasons. Live and Realtime receive the same assessment rules through the existing guarded coordinator-response context. `ORIGEN_OUTCOME_EVIDENCE` remains **false by default**; production was not changed.

## What the rules establish

`server/outcome-assessment.mjs` evaluates server-resolved, versioned records using `outcome-assessment-v1`. It returns the exact definition and scope, observation window, source versions, event/recorded/reviewed dates, attributed claims, evidence basis, state, reasons and explicit limits. There is no confidence score, majority vote, newest-record winner or inferred success label.

| Situation | Assessment behavior |
| --- | --- |
| Student approves a specific claim | Preserve the student-reported claim, including pending, not occurred, changed goal or adverse decision. |
| Missing, declined or unknown report | Keep each condition distinct; no outcome is invented. |
| Coordinator repeats a student's statement | Preserve the coordinator's authorship of the observation and the student origin of the claim; repetition adds no independent confirmation. |
| Coordinator reports direct observation | Attribute that declared basis; do not authenticate it automatically. |
| Coordinator reports checking a record | Require a record type relevant to the exact definition; a submission receipt cannot establish document acceptance or waiver approval. The record check remains unauthenticated. |
| Same-scope/date mutually inconsistent accounts | Leave the result disputed; do not select an author as the truth. |
| Different dates or uncertain timing | Preserve separate dated events, or return ambiguity when their temporal relationship is unknown. Pending followed by occurrence within one date needs timing clarification, not an assumed contradiction. |
| Student disagrees, including about an earlier revision | Preserve unresolved disagreement; a coordinator correction does not establish student agreement. |
| Source expires, changes or loses permission | Recompute without retaining a stronger stale conclusion. |
| Definition contract changes without a supported version | Return unavailable instead of silently applying changed semantics. |

Submission, acceptance, receipt of a decision and waiver approval remain separate definitions. A denial is a received decision, not an approval. A known event within its original observation period remains attributed to that period; an undated event cannot establish a result outside that period. Save/review dates never substitute for the event date. A reviewer who authored the advice is identified, but no observed result establishes that the advice caused it. Institutional verification, independent authentication and evaluation/training authorization remain false or not established.

## Private episodes and approved shared copies

The existing disclosure contract carries approved wording and an exact related response, **not a private report ID or approved private-episode relationship**. This implementation does not invent that missing relationship.

Private episodes are assessed from their exact approved report/evidence versions. Coordinator observations are assessed against their separately approved publication and explicit claim/scope. Student voice context may present both under an exactly referenced response, with `relationship: separate_records_not_linked`. It cannot describe a coordinator's receipt as corroborating a particular private report or assume the same document/event from matching words, scope or dates. An explicit approved relationship would be required for future combined assessment.

For example, Origen may say, “You reported submitting it; your coordinator reports checking a receipt in the shared request.” It must retain that attribution and cannot infer acceptance or approval. Ambiguous relationships permit one useful clarification during an authorized discussion, subject to the existing decline and opening limits.

Coordinator assessments use only their authorized publication, observation and explicitly shared disagreements. Student-private reports, corrections and disagreements do not change coordinator assessment state, counts, badges or freshness notices. Student assessments may show a private disagreement while the coordinator's projection remains unchanged. No report, task status, check-in, notification or sharing operation is written by assessment.

## Current-source checks and bounded retrieval

Migration `112_outcome_assessment_context.sql` adds a restricted source resolver and extends the existing projections and response-context guard. It adds **no stored assessment table, evaluation dataset or inferred relationship**. Assessments are derived on read, so correction, erasure and recovery apply through the canonical sources rather than a second store of conclusions.

The resolver loads at most eight private episodes, eighty exact report links and ten coordinator observations for the selected response. It fetches one additional row to detect each overflow. A bounded result marked incomplete cannot yield an overall supported claim. Voice assessment output is bounded to 24,000 characters; if necessary, complete evidence prose is omitted and the assessment marked insufficient rather than silently truncating a qualification. The current-source guard still covers the selected inputs.

The existing response revision hash now includes the exact source snapshot, definition contracts, rule version, permissions, capability validity, expiry state and local calendar dates. It catches new evidence as well as corrections, deletion, withdrawal, membership/role loss, source expiry, restored data and feature changes. Final reads recheck the guard in a second statement. The existing voice client verifies before using context and polls its loaded guards; a changed or unverifiable guard ends use of that call's context. Tests also verify natural expiry with no intervening database write.

Only current, student-permitted assessment context enters voice retrieval. Unavailable or expired evidence prose is omitted from that context; permitted binder history keeps its separate history behavior. The raw source bundle is removed before the application returns context. Family/other-student scope, unverified model queries and client capability fields cannot select evidence. Ordinary runtime roles cannot call the source helper directly.

Migration readiness now requires outcome migrations **109–112**, existing scoped command grants and denied helper/raw access. Pausing outcome evidence stops assessment injection and invalidates active guards while preserving permitted owner history and erasure. Personalization retrieval pause stops voice lookup. Restore uses existing episode/observation/disagreement fences, revoked capabilities and response generations; no separately persisted conclusion can survive them.

## Voice and binder behavior

The shared application policy is included in Realtime's instructions, Live's speaking instructions and its delegated backend instructions. Verified spoken recall returns the same assessment as explicit response focus. The policy preserves author, claim, basis, dates, disagreements and uncertainty in English and Spanish. It treats every saved name, quote and observation as untrusted reference data and prohibits sending private evidence to public research tools.

The change creates no proactive outcome interview or additional opening. It does not require evidence before helping, repeat declined questions, write reports, complete tasks, change follow-up scheduling, notify coordinators or infer evaluation consent. If no current assessment is supplied, the models are instructed not to reconstruct one from recaps or older turns.

Existing private-outcome and coordinator-observation cards show a concise explanation with an optional “Why this assessment / Por qué se evalúa así” disclosure. There is no new chat/caption interface or coordinator workspace redesign.

## Verification

All checks used the isolated local PostgreSQL database and synthetic identities; no production services or paid models were called.

| Check group | Result |
| --- | --- |
| Assessment rules, real database lifecycle/privacy, voice context, guard invalidation, size limits and natural expiry | 25 passed, zero skipped |
| Affected storage, permissions, voice, context, opening and readiness regressions | 171 passed, zero skipped |
| Private-outcome and coordinator-observation browser journeys, English/Spanish at 1280, 390 and 320 pixels | 12 passed |
| TypeScript, isolated Vite build, logging policy and patch whitespace | Passed |

Screenshots/results are under `/tmp/origen-outcome-step2-browser` and `/tmp/origen-outcome-step3-browser`. The build retained the existing large-chunk advisory. Tests inspect actual provider configurations and application guard behavior; they do not establish real-model listening quality or physical-device behavior.

The integrated release verifier includes the assessment tests and strengthened existing browser journeys. The complete Phase 6 verifier and deployed identity/provider/device/infrastructure checks remain rollout prerequisites. Apply migrations through **112**, refresh runtime grants, run readiness and the complete verifier with the compatible backend/web release before enabling the existing feature switch. No additional hosted database, Redis service or evaluation permission is required for this implementation.

Steps 5–6 remain planned: permission-filtered evidence-quality/evaluation preparation, then full integrated release verification.
