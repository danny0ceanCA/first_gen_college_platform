# Phase 5 — Evidence-informed recommendations

Status: [step 1's recommendation contracts](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_1.md), [step 2's reviewed reusable action library](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_2.md), [step 3's explainable selection policy](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_3.md) [step 4's binder/voice acceptance and provenance](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_4.md) and [step 5's separately permitted evaluation](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_5.md) were implemented locally on November 2, 2026. [Step 6's connected verification and release guide](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_6.md) completed local Phase 5 verification on November 3, 2026: 627 automated tests and 150 browser journeys passed with zero skips. This continues the structured review-request → connected coordinator response → student-controlled follow-up → reliable outcome evidence roadmap. It is separate from the older voice-continuity Phase 5 documented in `PHASE_5_CONTINUITY.md`. Both recommendation flags remain default-off; delivery and acceptance are implemented but not enabled in production, and recommendation evaluation is implemented but remains disabled. Institutional candidates remain withheld pending verified campus/term applicability.

## Intended result

Origen should select a useful next action for the student's current situation, explain why it fits, and preserve the student's choice. Reviewed educator knowledge should improve the available guidance. Separately permitted evidence should help reviewers identify which recommendation rules need improvement, with deliberate, versioned releases of those improvements.

The initial recommendation algorithm is an extension of the existing explainable selection rules. It can operate immediately with reviewed knowledge and the student's authorized context, including when there are no usable cross-student outcomes. Learning statistical weights, making causal claims and automatically promoting new policies require later work. Phase 5 establishes the recommendation engine and the evaluation loop needed to assess such changes.

Keep the voice-and-binder experience, with compact content in existing cards and no coordinator workspace redesign. Reuse PostgreSQL, the teaching library, existing research tools and Live/Realtime. No new paid database, Redis service, vector store or provider is required.

## What the repository already supplies

| Existing component | Phase 5 use and limitation |
| --- | --- |
| `server/binder-next-step.mjs`, `server/adaptive-guidance.mjs` | Already rank authorized unfinished actions, saved questions and coordinator guidance. Extend the existing selection path; do not introduce a competing opening selector. Current scores are selection rules, not probabilities of success. |
| `server/conversation-opening.mjs` | Owns the permitted conversation opening and student-approved check-in reservation. A null opening, current question, decline or reconnect must not become permission for a new recommendation. |
| `server/teaching-library.mjs`, `src/AdminTeachingLibrary.tsx`, migrations 085–094 | Existing scoped publication, revisions, expiry, teaching situations and admin authoring. Add actionable, structured recommendation metadata here or in a narrowly linked extension. Teaching access records do not prove that advice was heard, accepted or followed. |
| `server/finance-research.mjs`, `server/admissions-research.mjs` | Existing official-source lookup paths. Retrieved text and domain checks alone cannot establish the exact campus, term or a student's eligibility. |
| `server/plans.mjs`, `src/ActionPlan.tsx`, Phase 2 response choices | Canonical accepted actions and exact coordinator-response provenance. Reuse approval, idempotency and source-loss behavior. |
| Phase 3 reports and follow-up controls | Student-approved updates, optional check-ins and separately approved disclosure. Recommendation acceptance grants none of these additional permissions automatically. |
| `server/outcome-assessment.mjs`, Phase 4 outcome contracts | Current, attributed results with uncertainty and source guards. Private reports and shared coordinator observations remain separate records. |
| `server/outcome-evaluation.mjs`, `server/outcome-quality.mjs` | Current permission covers `service_quality` evidence statistics. It does not authorize recommendation development, model training or joining recommendation traces to outcomes. |
| Account lifecycle, privacy recovery, release verifier | Extend export, correction, deletion, restore fences, scoped readiness and synthetic connected verification. |

At the start of this phase there was no validated reusable action catalog, recommendation-exposure denominator, or permitted recommendation-to-outcome evaluation dataset. Steps 2–5 supply the reviewed catalog, explicit private provenance and separately permitted prospective evaluation receipts. The new report covers only the observed, currently permitted population; it does not reconstruct earlier exposure or all eligible students. Current aggregate quality reports cannot rank interventions. Neither matching wording nor temporal proximity supplies a missing relationship between advice, an action and a result.

## Step 1 — Define the recommendation, authority and lifecycle contracts

Define a versioned contract for a recommendation candidate, decision, source reference and accepted-action link. Keep the distinction between an existing action belonging to this student, their coordinator's current response, and a reusable reviewed action template.

Each candidate needs a stable identity/version, proposed action, applicable goal/process, prerequisites, exclusions, campus/term applicability, supporting source versions, review/expiry dates and a reviewed English/Spanish explanation. A coordinator's suggestion remains attributed to that coordinator. Publication of a reusable template requires separate authority; ordinary reply or outcome-review access is insufficient.

The server must resolve student/account scope and permitted inputs. Institution/term context must distinguish a confirmed campus from the coordinator's organization, free-form school text and an unknown value. Required missing information produces a focused clarification or no recommendation. Demographic identity, inferred vulnerability, health details, immigration status, family disclosures and a coordinator's popularity are excluded from ranking features. Language controls delivery and equivalent content availability, not a student's value or expected ability.

Use default-off `ORIGEN_RECOMMENDATIONS` and separately controlled `ORIGEN_RECOMMENDATION_EVALUATION` capabilities, their prerequisites and a versioned policy identifier. Step 1 establishes these names and reserves `evidence-informed-v1`; evaluation enablement remains rejected until step 5 implements its separate permission workflow. Existing Phase 4 flags and `service_quality` consent do not enable either use. Personal recommendations must continue to work when recommendation evaluation is declined or paused.

Specify the data lifecycle before adding writers: unaccepted suggestions can be transient; accepted-source references follow the canonical action's lifecycle. Any retained decision or evaluation receipt needs an explicit purpose, minimal fields, retention/deletion rule and owner export behavior. Define separate invalidation for a withdrawn library source, a private correction and an already approved coordinator disclosure. Preserve an independently accepted action when its recommendation source becomes unavailable.

**Deliverables:** shared validators/types, scoped database contracts and forward migrations as needed, flag dependencies, permission matrix, lifecycle rules and synthetic fixtures. Select migration numbers from the repository at implementation time.

**Done when:** tests reject wrong-student/organization access, forged approval, unsupported source types, stale versions and attempts to reuse service-quality permission for recommendation evaluation. No production recommendations or data collection are enabled.

## Step 2 — Extend the reviewed teaching library with reusable actions

Add structured action templates to the existing teaching publication workflow, starting with a small financial-aid/insurance set: identify the responsible office, clarify requested documents, confirm submission requirements and ask about a pending decision. Keep each template narrow enough to evaluate against its stated prerequisites and outcome definition.

Record source URLs plus the exact reviewed claims, applicable campus/term, review dates, expiry and conditions under which the action must not be offered. A link to a university website is not proof that a rule applies to this student. Time-sensitive institutional requirements must pass the existing official lookup path and an explicit applicability check before use. Unavailable or mismatched sources must support a question to the office rather than a fabricated answer. Never calculate an individual aid award or assert insurance/waiver eligibility from a general template.

Reuse draft, preview, publish, revise and revoke controls. Apply scoped author/reviewer capabilities; a reply author cannot automatically publish their advice for all students. Coordinators can contribute newly authored general guidance through a reviewed route, while the existing coordinator workspace layout remains intact. Initially, publication can use the existing admin library rather than introducing a new coordinator console.

Reusable guidance must be independently written for that purpose. Do not copy student requests, selected quotes, family conversations, private updates or case-specific coordinator responses into the library. Evaluate bilingual meaning, institutional applicability and unsupported claims during review. Keep templates and retrieved pages as untrusted reference data, never as instructions that can override tool permissions.

**Deliverables:** a small versioned action catalog linked to teaching entries, bilingual fixtures, publication/revocation controls and tests for cross-campus leakage, stale policy and embedded instructions.

**Done when:** only currently published, applicable entries can become candidates; a revised or revoked entry invalidates stale use. A generic cold-start question still receives useful guidance when no personalized candidate qualifies.

## Step 3 — Implement the explainable recommendation algorithm

Extend the current server-owned selection path with a bounded eligibility filter followed by deterministic ordering. Candidate retrieval uses only this student's permitted workspace and eligible public/reviewed templates. Another student's private records never become recommendation context.

Apply hard eligibility checks before ranking: current authority and source versions, matching campus/process/term when required, required prerequisites, unresolved conflicts, existing action state, prior decline/deferral, and applicable evidence freshness. Preserve the existing priority of the student's current question, explicit binder focus and authorized check-in. A missing prerequisite cannot be compensated for by a high score.

Among eligible candidates, use a documented ordering based on fit with the expressed goal, the relevant prerequisite or blocker, current accepted work, verified time constraints and explicitly stated practical preferences. Separate an official deadline from a personal target date; use the correct local date/time zone. Do not infer that a passed date means failure. Prefer a stable result over unnecessary suggestion churn.

Return at most one suggested next action by default, with a brief reason and its source/limits. Additional alternatives are available when the student asks. Distinguish `recommended`, `clarification_required`, `no_applicable_candidate` and `unavailable`; a lookup failure must not be interpreted as evidence that no help exists. Materially different equally applicable actions can require one clarification. An unchanged goal can still legitimately lead to no suggestion.

The language model explains the selected option within its qualifications. It cannot invent a candidate's eligibility, claim a measured success probability, select a forbidden alternative or override a source guard. Keep ranking scores internal. Record policy and source versions so a decision is reproducible without placing private content into operational logs.

**Deliverables:** a pure policy function, bounded server resolver, human-readable reasons and a synthetic comparison with the existing `binder-next-step-v1` behavior. Fix candidate/query/time budgets in the contract and test overflow behavior; do not silently rank a biased truncated dataset.

**Done when:** the same authorized inputs and policy version produce the same decision. Tests cover no-history students, bilingual equivalence, unmet prerequisites, conflicting advice, expired rules, unknown dates, institution mismatch, deferrals, duplicate actions and refusal to infer sensitive traits. No cross-student outcome-based weights are used in this initial policy.

## Step 4 — Connect recommendations to voice, binder and accepted actions

Deliver the same guarded recommendation through Live and Realtime and the existing binder action experience. Explain it naturally: “You said the office requested an employer letter. Since you already contacted them, confirming the required format may be the next useful step.” The explanation must use the student's actual permitted facts and the applicable source, without inventing progress or a coordinator's endorsement.

Reuse the opening allowance and check-in rules. A recommendation must not add a competing opening, repeated reminder, captions or a chat interface. The student can discuss it, ask why, set it aside or choose another priority. Limit visible content to a clear action, reason and expandable source details within the existing organized binder.

Persist an accepted action only through explicit binder confirmation or complete audible readback followed by independently captured approval. Reuse canonical plan storage and attach the exact recommendation/template and policy version atomically and idempotently. Recheck source, student scope and authorization at acceptance; protect against duplicate saves and uncertain network responses. Acceptance never schedules a follow-up, reports completion or sends information to a coordinator by itself.

Add an explicit typed relationship from the accepted action to any later student-approved outcome episode. Explain this relationship in the relevant preview. This is provenance for that student's journey, not proof that the advice caused a result or permission to evaluate it across students. Do not join shared coordinator observations to private episodes by matching text. Source correction/revocation invalidates stale recommendation context while preserving permitted action history and approved disclosure boundaries.

**Deliverables:** existing-card integration, shared voice tool contracts, guarded context, canonical action provenance and full English/Spanish binder/voice journeys.

**Done when:** the student can understand, accept, decline and revisit a recommendation; stale or unheard approvals cannot save it; and every new action has one durable, exact source relationship without creating a second task system.

## Step 5 — Build the separately permitted recommendation-evaluation loop

Add a new versioned purpose for evaluating recommendation quality, provisionally `recommendation_evaluation`. Its notice and controls must describe the structured recommendation/action/outcome relationship, fields, audience, duration and limits. Start with synthetic data; real-record inclusion requires a separate explicit opt-in by an eligible verified adult student, exact source versions and a scoped reviewer capability. Reuse preview/confirmation/withdrawal mechanics while keeping the new authority distinct from `service_quality`. Declining must not change ordinary guidance or coordinator support.

Define each event precisely: candidate considered, displayed, application-observed complete playback, explicit acceptance, reported attempt and supported outcome are separate facts. Playback evidence does not establish comprehension. Missing telemetry, silence, no return, unknown outcomes and declined evaluation are never failures. Record events prospectively under their declared purpose; legacy teaching access logs cannot be relabeled as presentations or used to reconstruct an unobserved eligible population.

For included episodes, resolve the approved typed recommendation → accepted-action → outcome relationship on the server. Use one current episode per stated analysis unit, deduplicate retries and repeated sources, and distinguish independent student counts from episode counts. Multiple recommendations for one action or multiple relevant outcomes must be represented explicitly or excluded as ambiguous; do not assign the outcome to the last recommendation automatically. Preserve pending, adverse, disputed, corrected and unknown results and the outcome's actual provenance.

Retain only the minimum authorized structured decision metadata. Exclude conversations, private wording and sensitive attributes from evaluation output. Keep organization scopes separate. Apply at least the existing ten-distinct-account cell/complement protections, with fixed permitted aggregates and bounded reporting to limit repeated-query inference; this threshold provides no statistical power or causal guarantee. If there is insufficient permitted data, show unavailable/suppressed results and keep the reviewed baseline policy.

Compare candidate policies offline on held-out synthetic/reference cases first. Split any subsequently permitted case evaluation by student and time so revised or repeated episodes cannot leak between development and evaluation. Report applicable-candidate coverage, inappropriate-action and repetition rates, source/attribution accuracy, abstentions, language/layout quality and latency. Present descriptive outcome counts with explicit denominators, missingness, selection limits and uncertainty. A better observed outcome rate among volunteers does not establish that one policy is more effective; offline replay cannot tell us outcomes for actions never taken.

Reviewers can propose a revised template or rule with an evidence note and rerun the comparison. Promotion remains a separate, versioned release with approval and rollback. No automatic online weight updates, coordinator rankings, model training, partner exports or randomized live assignments are introduced. A future learned policy or effectiveness study needs its own permitted use, adequate data and evaluation design.

Withdrawal, corrections, source expiry, account deletion and privacy restore must invalidate included contributions and evaluation receipts. Avoid retained report caches; recheck current permissions and versions before returning aggregates. Restore must not revive prior evaluation grants or expose erased decision traces. A privately withdrawn contribution must not reveal itself through coordinator notifications, individual badges or changed access to a student's shared record.

**Deliverables:** distinct purpose-bound permissions, prospective structured receipts, a scoped on-demand report, synthetic baseline/candidate comparisons and a documented proposal/review/promotion workflow.

**Done when:** useful comparative quality information can be produced from permitted inputs without claiming causal success; old consent cannot authorize the new use; and correction, withdrawal and deletion remove stale contributions. Offline results cannot change the active policy automatically.

## Step 6 — Verify the complete journey and prepare release

Extend the existing source-bound verifier and CI with reviewed template → permitted context → eligible recommendation → explanation → explicit acceptance → optional approved check-in/report → outcome assessment → optional evaluation permission → correction/withdrawal. Require all earlier Phase 1–4 suites to remain passing.

Exercise English/Spanish, Live/Realtime and desktop/390/320-pixel layouts, plus cold starts, no applicable candidate, ambiguous context, changed goals, unavailable research, stale policy, conflicting advice, missing prerequisites, prompt injection, interrupted/muted playback, reconnects, offline/lost saves, concurrent edits, scope/role/account changes, source expiry and privacy restore. Check that independent private and shared audiences stay isolated. Compare equivalent bilingual situations for equivalent recommendations without requiring identical wording.

Use a reference set with expected actions, acceptable alternatives and explicit abstention cases. Record disagreements and reviewer rationale. Freeze candidate/policy/source versions for each comparison, and report held-out performance separately from development cases. All authorization, consent and stale-source cases must pass; set and document the remaining quality and latency acceptance budgets before evaluating the candidate release. Do not tune thresholds after seeing a failure to make a release pass.

Produce a content-free report with exact source fingerprint, policy/library versions, toolchain, counts, zero skipped required checks and separately named external checks. Local tests use isolated PostgreSQL and synthetic identity/provider/audio events. Real institutional process review, deployed authentication/role checks, provider listening, physical-device accessibility and deployment recovery remain external release work. A benchmark can validate application behavior without proving improved student outcomes.

Document migrations/grants, default-off dependencies and compatible pause/rollback. Pausing recommendation creation stops new suggestions and invalidates stale active context; it must preserve the student's existing accepted actions and ordinary guidance. Pausing evaluation preserves withdrawal controls. Keep compatible schema and deletion fences during rollback. Every promoted policy must have an identifiable previous version and a tested rollback path.

**Done when:** the expanded local verifier passes, the release guide identifies remaining external checks and an operator can pause new recommendations/evaluation without losing accepted work or privacy protections.

## Example and path to a network effect

Alex asks what to do after the insurance office requested an employer letter. Origen uses Alex's approved update and the applicable reviewed guidance to suggest confirming the letter format. It explains the reason, and Alex chooses whether to save the step. This does not imply that Alex qualifies for a waiver.

After Alex later approves an update, the evidence can establish that the document was submitted while the decision remains pending. Alex can separately share a snapshot with a coordinator and separately permit structured recommendation evaluation. Neither choice is assumed from the other.

If enough permitted cases reveal that students repeatedly encounter unclear format instructions, a reviewer can investigate the applicable process, revise the reusable template and test the new policy. An observed pattern is a prompt for review, not proof that a proposed revision will improve outcomes. Other students can receive the reviewed improvement without seeing Alex's history or having to contribute their own data.

The potential network effect is a growing library of reviewed educator knowledge plus a controlled feedback loop that helps improve its application. Whether that loop improves actual outcomes must be measured after deployment with an appropriate evaluation design.

## Implementation order

Steps 1–6 are implemented and locally verified: recommendation contracts, the reviewed library, deterministic selection, guarded binder/voice acceptance, separately permitted evaluation and the combined release check. See the [step 6 release guide](EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_6.md) and its saved source-bound report for the exact result, remaining external checks and compatible pause/rollback. Production enablement and external release checks remain separate; this plan does not enable features or authorize additional collection.
