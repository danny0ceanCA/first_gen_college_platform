# Implementation backlog and acceptance gates

Phase 1 design completed October 6, 2026. Phases 2�4 now have source implementations and phase 5 has a separate synthetic sandbox; see PHASE_2.md, PHASE_3.md and PHASE_4.md for rollout and acceptance status. Later phases remain future implementation. Do not edit migrations 001–014; add numbered migrations when implementation begins. No SQL migration is delivered in phase 1.

## Phase 2 — reliable conversation history

| Priority / dependency | Work | Acceptance evidence |
| --- | --- | --- |
| P0 / first | Adopt collection notice, operational retention and accountable owner; separate preview/test | No raw audio/transcript collection added; representative payloads reviewed; preview cannot pollute production statistics |
| P0 / first | Add verified issuer/subject mapping while retaining existing account IDs | Known-issuer backfill; no email-based merges; token from another issuer cannot access the account; family and institution identity behavior both covered |
| P0 / identity | Add sessions, segments and summary attribution | Family/null target, confirmed student, late tool results and target changes cannot cross scope; topic changes keep the existing call; unresolved target cannot save into student history |
| P0 / sessions | Add atomic event/outbox writes and authenticated allowlisted ingestion | Rollback emits no saved event; retry/reorder deduplicate; unknown/oversized payloads rejected; missing observations visible |
| P1 / sessions | Persist immutable model/prompt/tool/language-policy versions and minimal tool/source provenance | An execution can be traced to its exact configuration; unknown usage/academic periods remain null; secrets/content absent from telemetry |
| P0 / every new table | Extend export, closure, student removal, permission checks and retention cleanup | Cross-account denial, linked-family boundaries, cleanup restart, deletion concurrency and export tests; closure exceptions documented |
| P1 / events | Internal reliability report with coverage indicators | Known synthetic failed/connected attempts reconcile; failed attempts included; preview excluded; timings distinguish playback from server events |

Migration sequence: additive identity references, configurations, sessions, segments, provenance, attribution, then events/outbox and lifecycle indexes. Assign migration numbers only when final SQL is reviewed. Introduce producer writes behind a server feature flag, deploy compatible readers first, validate synthetic traffic, then enable limited production metadata. Keep old summary reads compatible throughout. Rollback disables collection while preserving valid existing records.

Do not reconstruct old sessions from summary dates or operational log fragments. Mark legacy attribution/configuration as unknown. Backfills require documented provenance and sampled verification. Consider indexes on account/time, session/ordinal, pending outbox and retention time; measure query plans before adding materialized views. Set payload/volume budgets and monitor the small database's storage and connection limits.

## Phase 3 — progress and outcomes

1. Preserve accepted profile observations and plan revisions/transitions atomically with current writes. Keep stable history references even when current steps are replaced.
2. Add optional, versioned feedback and measurement definitions. Store declined/not-asked/unknown explicitly. Agree what a useful conversation means rather than equating voice use with success.
3. Add reported milestones, then verified outcomes only where a legitimate evidence source and permission exist. Normalize school/academic-period/GPA scale only with actual evidence.
4. Build internal reports with cohorts, denominators, missingness and provenance. Keep family data out of ordinary institution reports.

Gate: reopen/delete/reorder steps, concurrent plan updates, bilingual summary translations and linked private histories remain correct. Historical snapshots are private and covered by lifecycle controls. No retrospective fabricated before/after measurements.

## Phase 4 — evaluate and improve models

Create synthetic English/Spanish cases for first-use introduction, simple explanations, switching language, English key terms explained in Spanish, topic transitions, student confirmation, ambiguous scope, prior-summary corrections, tool errors and changing official requirements. Evaluate correctness, source relevance/effective period, privacy, attribution, conversational continuity, latency and cost with a versioned rubric.

Compare a baseline against prompt/tool/retrieval changes before release. Record sample size, failure cases, human/automatic evaluator identity and disagreements. Exercise uncertain answers and escalation instead of rewarding confident unsupported detail. Use source caching with expiry appropriate to changing rules and bounded tool budgets; measure savings without substituting stale answers.

Gate: regression suite and human review meet explicit thresholds adopted for the release. Do not claim improved learning from benchmark scores. Production examples require separate approved handling; permission for research is not automatically permission for model training.

## Phase 5 — study permissions and governed datasets

Agree with the partner: research question, population, roles/age considerations, protocol/version, instruments, recipient list, review requirements, fields, retention, withdrawal and permitted model-improvement uses. Implement studies/enrollments, versioned permission events, restricted identity mappings, dataset manifests and access audits only after those decisions.

Gate: refusal does not prevent ordinary service access where research is optional; linked subjects/minors are handled under approved rules; withdrawal blocks subsequent releases; revoked access denies researchers; exports exclude unauthorized fields and small-cell risks are reviewed. Audit a complete synthetic export and withdrawal exercise. No researcher access through institution membership.

## Phases 6–8 — operations and paid partnership

Complete provider-region/retention evidence, database restore and deletion replay, administrative access review, accessibility evaluation, security review, incident ownership and realistic contractual commitments. Draft the pilot scope and budget with a sponsor; define approved deliverables and measurement limits. Launch only after required approvals, then use actual value/cost evidence to develop a recurring offering.

A discovery conversation can happen during phase 1. No outreach or institutional submission is performed by this documentation task. Procurement/security approval and research review remain separate; a public institution page does not authorize student-record sharing.

## Definition of done for phase 1

- Existing schema inventory covers all tables created by migrations 001–014 plus migration bookkeeping.
- New records are clearly proposed; purposes, scope, provenance, retention and access rules are defined.
- Events have minimal payloads, trustworthy attribution and retry/coverage contracts.
- Later phases have dependencies, rollout strategy and meaningful acceptance gates.
- Readiness documents link this architecture and no longer describe implemented metrics as absent.
- No runtime collection, database deployment or migration changes are made.

Remaining decisions belong to their later gates: adopted retention/owner, minor and multi-person permissions, partner protocol, approved reviewers/recipients and provider evidence. Those decisions are not represented as already approved.
