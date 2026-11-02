# Phase 4 — Reliable outcome evidence

Status: [step 1's foundation](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_1.md), [step 2's student-approved recording](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_2.md), [step 3's coordinator observations](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_3.md), [step 4's deterministic assessments](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_4.md), [step 5's permitted quality evaluation](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_5.md) and [step 6's connected verification and release preparation](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_6.md) are implemented locally, November 2, 2026. The expanded verifier passed 499 automated tests, 111 browser journeys and 26 engineering reference cases with zero skips. Evidence and evaluation remain default-off. The documented deployed identity, provider/device, infrastructure, institutional-process and evaluation-authorization checks remain prerequisites for the corresponding production capabilities.

## Intended result

Origen should be able to explain what the student reported, what a coordinator observed, what evidence supports a specific result, when that evidence applied, and what remains uncertain. This provides dependable inputs for individual guidance and a later recommendation system. An observed result following advice does not establish that the advice caused it.

Keep the voice-and-binder experience and existing coordinator workspace. Use compact additions within current action, update and response cards. Outcome collection stays optional; students can continue receiving help without reporting a result, obtaining verification or allowing evaluation use. Reuse PostgreSQL and the current services.

The first release supports student-approved statements and explicitly attributed coordinator observations, including a coordinator's declaration that they checked a relevant record. Automated institutional record feeds and document uploads are later integrations. Manual review must be described as such; Origen must not imply it independently authenticated a university record.

## Repository foundation and boundaries

| Existing component | Reuse in Phase 4 |
| --- | --- |
| `server/plans.mjs`, `src/ActionPlan.tsx` | Canonical accepted action and task status. Evidence must not create a competing task-status store. |
| `src/studentFollowUp.mjs`, `server/follow-up-conversations.mjs`, migrations 104–107 | Explicitly approved, versioned private reports, separate reported action/outcome/helpfulness, recorded and occurred dates, correction and deletion. Existing reports remain `student_reported`. |
| `server/review-requests.mjs`, migration 108, `src/StudentReviewRequests.tsx` | Exact approved disclosure, publication identity, response version, delivery and withdrawal. A shared update currently carries selected wording, not a report ID or live report relationship. |
| `src/CoordinatorReviewRequests.tsx`, existing coordinator authorization | Current request card and scoped staff access. A coordinator response or “reviewed” receipt currently provides no outcome-verification authority. |
| `server/review-response-context.mjs`, `src/ProfileVoice.tsx` | Current-source guards, attributed context, Live/Realtime and independently checked spoken consent. |
| `server/account-lifecycle.mjs`, `ops/privacy-recovery.mjs` | Export, erasure, revocation and restore fences. Evidence and derived conclusions need the same lifecycle. |
| `server/progress-report.mjs` | Existing voluntary service-feedback aggregates remain a separate dataset. They are not verified student outcomes or a denominator for this feature. |
| `scripts/verify-review-request-release.mjs`, `.github/workflows/checks.yml` | Extend the source-bound local verifier and existing CI checks. |

Do not infer relationships between private reports and shared copies from matching words or timestamps. Do not backfill consent, verification or learning permission from earlier conversations, coordinator responses, task completion or Phase 3 records.

## Step 1 — Define outcome and evidence contracts

Introduce a small, versioned outcome-definition registry. Start with concrete financial-aid support milestones such as contacting an office, submitting a requested document, and receiving a specific decision. Each definition states the exact claim, applicable institution/term when relevant, qualifying evidence, observation period and freshness rule. General campus policies establish requirements, not an individual student's result.

For example, “document submitted,” “document accepted,” “waiver approved,” and “student says the advice helped” are separate claims. A decision being received can be established even when the decision is a denial. Do not map every completed action or `reported_outcome=resolved` to approval or benefit.

Define the evidence record with separate dimensions:

| Dimension | Required meaning |
| --- | --- |
| Subject and claim | Server-resolved student scope, accepted action identity, outcome definition/version, and relevant cycle/term. |
| Statement and origin | Exact approved student statement or exact coordinator-authored observation, with actor and record version. A coordinator quoting a student remains a student-origin claim. |
| Basis | Student account, direct observation, declared record review, or a future authenticated institutional source. Preserve whether accounts derive from the same original source. |
| Timing | Event date, date precision or unknown date, recorded/reviewed time, and applicable validity period. Never substitute save time for event time. |
| Assessment | Supports, contradicts or does not establish this exact claim, plus current, stale, disputed or unavailable state. |
| Access and use | Current owner/recipient scope and separately permitted purposes. Evidence does not grant access by itself. |

Keep missing, declined, pending, unknown, goal changed and adverse results distinct. Define an outcome episode as one accepted action and one applicable goal/cycle; repeated reports, retries and coordinator replies are observations within it. Exact typed references determine identity. Ambiguous relationships require clarification.

Create forward-only migrations, scoped commands, runtime-grant and readiness checks under a proposed default-off `ORIGEN_OUTCOME_EVIDENCE` capability. Choose migration numbers at implementation time. Specify correction, revocation, deletion and restore rules before introducing writers. Existing provenance constraints remain intact; add evidence alongside reports instead of upgrading a report's provenance in place.

**Done when:** contracts and database tests reject forged ownership, verification, permission and dates; distinguish the example claims; and prove existing records confer no new consent. Provide an explicit compatibility map for Phase 3 records and a reviewed set of example cases for each initial definition.

## Step 2 — Connect student-approved evidence to exact records

Add a compact “What happened” and evidence detail within the current private-update area. Students can select or clarify the specific outcome and correct its date/wording through an exact preview and approval. Reuse the current voice confirmation mechanics for Live/Realtime and English/Spanish. A normal answer or model summary cannot create a new structured claim. Existing generic private reports remain useful even when they cannot be mapped to a more specific outcome.

Create owner-only links to the exact private report ID/version and action/definition version when the student explicitly approves that relationship. Reuse the Phase 3 report as the source statement rather than maintaining another independently editable copy. Saving evidence must not silently complete an action, reschedule a check-in or share anything.

For coordinator review, extend the existing disclosure preview to include only the selected outcome statement, relevant date/scope and requested evidence review, along with the named recipient. Bind approval to that publication version. Keep private report IDs, unrelated updates, helpfulness and private plan context out of coordinator payloads. Any owner-side relationship to the publication stays private.

An older shared update can be reviewed only for its already approved wording. Adding a structured claim, private detail or different scope requires a new student-approved disclosure. The shared copy continues to have its own lifecycle: a private correction invalidates private derived conclusions, while the old publication remains an attributed historical statement until separately corrected, withdrawn or invalidated. It cannot be silently relabeled as the student's latest report.

**Done when:** UI, voice and database tests prove exact version linkage, separate save/share decisions, uncertain-save recovery, idempotency and correct handling of private corrections versus shared snapshots. No new questioning loop or outbound reminder is introduced.

## Step 3 — Capture coordinator observations within the current request card

Add a small evidence section to the existing coordinator detail card, separate from the guidance response and “reviewed” receipt. An authorized coordinator can record that they cannot establish the result, that they observed a specific event, or that they checked a relevant record. Require the exact claim, observation, basis, observed date/scope and a minimal safe source reference when applicable.

Resolve organization, membership, staff verification, recipient and permission on the server. Use a scoped outcome-review capability; being able to reply to a request does not automatically grant authority to attest every kind of institutional decision. Limit the visible input to the approved publication. A request to review evidence grants no access to private reports, other systems or university accounts.

Use explicit attribution such as “Maria reports checking the submission receipt on November 4.” Recording a coordinator assertion establishes who made it and its declared basis; it does not prove the assertion's authenticity. Reserve platform claims of institution-verified results for a future source adapter that can authenticate authority, student/term match and the specific fact. A source URL, checked box, staff title or AI extraction is insufficient.

Record whether the reviewer also authored the advice and whether their observation depends on the same student statement. Two people repeating one statement are not independent evidence. When material disagreement cannot be resolved, preserve it and allow authorized human review without expanding access or automatically requesting more disclosures.

Preview the coordinator's exact observation before publication to the student. Return it through the existing binder response experience with clear attribution. Corrections create a new revision; receiving it does not overwrite the student's report, complete their action or imply student agreement.

**Done when:** an authorized coordinator can publish a narrowly scoped observation and the student can see or dispute it. Tests reject unauthorized roles, hidden private-report access, unsupported verification claims, stale approvals and duplicate observations.

## Step 4 — Build deterministic evidence assessment and truthful AI context

Implement an explainable rule-based assessment for each outcome episode. It resolves current permitted evidence, tests it against the applicable definition, and returns the supported claim, provenance, time/scope, limitations and reason codes. Do not collapse these dimensions into an unexplained numeric confidence score.

Assessment must distinguish an uncorroborated student report, a coordinator's direct observation, a coordinator-declared record check, unresolved disagreement and insufficient/currently unavailable evidence. Conflicting statements about different dates, terms or claims should not be treated as a contradiction until their scopes match. A later event may change the outcome without making the earlier report false. “Newest wins,” majority vote and coordinator seniority are not truth rules.

Assessments are derived from exact source versions and a versioned rule set. Recompute or invalidate them after a correction, withdrawal, access loss, source edit, expiry or deletion; never retain a stronger stale conclusion. Preserve permitted historical attribution without using it as current evidence. Account deletion removes content; restore must not revive erased evidence, prior approvals or superseded conclusions. Audit history must respect erasure and retention rules rather than retaining private prose forever.

Build assessments for the requesting audience. A coordinator's assessment can use only the approved snapshot and evidence authorized for that coordinator. A private correction must not leak through changed coordinator badges, counts, freshness notices or notifications. The student's private assessment can reflect the correction while accurately identifying the older shared copy.

Feed only the current, student-permitted assessment to existing Live/Realtime context. Origen can say, “You reported submitting it; Maria says she checked a submission receipt. We still do not have an approval decision.” Ambiguity permits one useful clarification during an authorized interaction, respecting existing declines and opening limits. Assessment does not automatically write a report, notify staff, award a success label or change canonical task status.

**Done when:** deterministic cases cover conflicting and dependent accounts, changed outcomes, stale dates, unsupported institutional claims and all lifecycle changes. Both voice paths preserve the assessment's attribution and uncertainty, and current-source guards invalidate active stale context.

## Step 5 — Measure evidence quality and prepare permitted evaluation data

Build a separate, bounded evidence-quality report and a permission-filtered evaluation contract. Define the unit as one outcome episode at a stated cutoff, with one current assessment; observations and retries do not create additional successes. Include the outcome definition, rule version, observation window and provenance breakdown in every result.

Measure completeness of required fields, available source basis, freshness, contradictions, correction frequency and unresolved/unknown status. Show counts and denominators before rates. Where legitimately recorded, distinguish eligible episodes, presented requests, explicit declines and recorded answers. Do not invent historical “not asked” counts, treat silence as failure, or exclude pending cases merely to improve an apparent success rate. An unknown event date cannot support a time-to-outcome estimate.

Evaluation access needs an explicit purpose and current permission. Provide separate, understandable opt-in controls if real records will be used for service evaluation; refusal must not reduce access to guidance. Permission to save privately, share with a coordinator or use personal AI assistance is not permission for cross-student evaluation, partner export, research or model training. Implement purpose/version checks, withdrawal and removal from retained evaluation datasets. A proposed `ORIGEN_OUTCOME_EVALUATION=false` gate remains independent of ordinary evidence storage and guidance; turning it on cannot substitute for record-level permission.

Use synthetic cases until the relevant real-data permissions and operational access are in place. Real-data outputs require minimum-group disclosure rules, bounded queries, no free-form private text or identifiers, and separate institution scopes. Include only permitted, necessary context such as term, process, language and relevant deadlines; do not collect additional ethnicity, immigration, health or family information to make these reports richer. Keep existing feedback/admin reports unchanged.

Label coverage and selection limits. Students who return, agree to report and have evidence may differ from those who do not. A descriptive association between advice and a result is not an effectiveness estimate. This step prepares a reliable evaluation interface; coordinator rankings, cross-student recommendations, training and causal evaluation require subsequent work with their own permitted use and validation.

**Done when:** tests reject duplicate episodes, incorrect denominators, private/unconsented inputs and suppressed groups; correction/deletion/withdrawal removes stale analytical contributions. A reproducible synthetic report explains its definitions, coverage, missingness and limits without exposing student content.

## Step 6 — Verify the complete evidence journey and prepare release

Extend the existing verifier and CI with accepted action → approved private report → optional exact disclosure → coordinator observation → current evidence assessment → attributed binder/voice guidance → correction or withdrawal. Test the entire sequence across English/Spanish, Live/Realtime, desktop/mobile and 320-pixel layouts.

Include negative and uncertain results, silence/declines, duplicate sources, a coordinator reviewing their own advice, conflicting claims, wrong student/term, edited definitions, unknown dates, time zones, evidence expiry, offline and lost-save responses, concurrent corrections, muted/interrupted readbacks, source/account/role changes, permission withdrawal, export, deletion and restore. Add hand-labeled cases reviewed for consistent application of the initial definitions; report disagreements instead of assuming the rules establish real-world truth.

Require all earlier Phase 1–3 browser and contract checks to continue passing, bounded lookup/query budgets, no unauthorized evidence in notifications/logs, and an evaluation-data exclusion test. Produce a source-bound, content-free verification report with zero skipped automated cases. Record actual provider listening, physical-device use, real staff authorization and institutional process review separately from synthetic application checks.

Document migrations and grants, readiness dependencies, default-off evidence/evaluation switches, pause and compatible rollback. Pausing stops new evidence creation/assessment use as specified while preserving permitted history, correction/removal and withdrawal controls. Holding new work does not retract an already approved publication; reuse existing disclosure controls. Keep compatible schema during rollback and apply privacy recovery fences before any restored data is served.

**Done when:** the expanded local verifier passes, remaining external checks are explicit, and the release guide distinguishes local completion from production enablement. Phase 4 introduces no paid database or new infrastructure service.

## Example of the finished experience

Alex says, “I submitted the employer letter, but I am waiting for the waiver decision,” and explicitly approves a private update. The action is reported complete; the waiver outcome remains pending.

Alex separately approves sharing the submission statement and asking Maria to review it. Maria records that she checked a submission receipt for the relevant campus and term. Origen attributes that observation to Maria and supports only the submission claim. It continues to treat the approval decision as unknown or pending.

Alex later reports a denial. After Alex approves the update, Origen preserves the distinction between a submitted document, a received decision and an unfavorable decision. It offers help with the next question without blaming the student or labeling the earlier guidance effective or ineffective. A different result for another term does not overwrite this episode.

If Alex declines evaluation use, the permitted student/coordinator experience still works and that episode contributes no cross-student evaluation data. If Alex later corrects or removes evidence, affected assessments and permitted evaluation outputs are invalidated according to their source and disclosure boundaries.

## Execution order

Step 1 establishes the shared definitions and authority rules; later steps must not bypass them by inferring verification or consent from prose. Step 2 connects student-approved evidence recording. Step 3 adds explicitly attributed coordinator observations and student-controlled disagreements. Step 4 adds deterministic assessment and guarded voice context while preserving separate private/shared records. Step 5 adds permitted evidence-quality and evaluation preparation. Step 6 completes the connected local verifier and release guide, preserving all earlier regression checks. All six local implementation steps now have implementation notes and validation; production enablement remains separate.
