# Phase 4, step 5 — Evidence quality and permitted evaluation

Implemented locally on November 2, 2026. This step adds a separate, voluntary evaluation permission and a bounded service-quality report. It prepares inputs for future evaluation; it does not rank coordinators, train a model, estimate effectiveness or recommend another student's next action. `ORIGEN_OUTCOME_EVALUATION` defaults to **false**. No production environment, database, grants or deployment were changed.

## Student choice

Within an existing private outcome card, **Optional quality evaluation** explains the purpose, fields, audience and limits in English or Spanish. A student can decline, review the exact outcome/window/organization, and approve with an initially unchecked checkbox and a separate confirmation button. Preparing the preview does not grant permission. Existing save, share and personal-assistance permissions do not grant evaluation use.

Permission is bound to the episode's exact version and source fingerprint, `service_quality` purpose, contract version 1 and `outcome-assessment-v1` rules. It expires at the earlier of 90 days or the underlying evidence permission. Source corrections, new evidence, access loss or expiry remove the old contribution; renewed use requires a new preview and approval. The first release allows new evaluation opt-ins only for existing verified adult student accounts. Guardian permission for ordinary guidance is not reused as evaluation permission for minors.

Withdrawal remains available when new opt-ins are paused. Declining has no effect on the accepted action, follow-up schedule, guidance or coordinator support. Interrupted writes recover by reading current permission; the browser never automatically repeats an approval. Private permissions are included in the owner's account export. Account/episode deletion cascades through evaluation permissions and previews. Backup export stays read-only; restore revokes all evaluation permissions and reviewer capabilities, even with a legacy manifest.

## Evaluation contract and scope

Migration `113_outcome_evaluation_permissions.sql` adds three tables for permission, exact previews and scoped reviewer capabilities. Raw access is denied to application and maintenance roles. Server commands resolve the owner, current sources and organization; clients cannot supply rows, owner IDs, cutoff dates, arbitrary filters or authorization flags.

`POST /api/outcome-evaluation` manages the owner's permission. `POST /api/outcome-evaluation-report` accepts only:

```json
{
  "action": "report",
  "organizationId": "<authorized organization UUID>",
  "definitionId": "document_submitted",
  "purpose": "service_quality",
  "contractVersion": 1
}
```

The reviewer must have fresh staff authentication and MFA, provider-verified email, current membership in an active verified organization, and a separate operator-issued evaluation capability for that organization. Ordinary coordinator response and outcome-observation permissions are insufficient. The coordinator workspace layout remains unchanged; there is no general analytics panel or automatic delivery to partners.

The server chooses the previous completed UTC calendar month based on episode recording time. It resolves only currently permitted episodes for the requested public definition and organization associated with the review request. It does not infer campus identity from free-form institution text. The assessment cutoff is explicit. A second source/permission revision check discards the result if a contribution changes during calculation. A five-second statement budget and limits of 1,000 episodes and 100 evidence links per episode bound the report; overflow suppresses the entire result instead of returning a biased subset.

The internal evaluation contract contains hashed episode/account keys for deduplication and group thresholds, exact versions, definition/rule/purpose, recording time, approved observation window, assessment state, fixed reason/status enums, date completeness and prospectively recorded correction counts. It excludes written reports, conversations, names, contacts, free-form institution/term/process fields and private record UUIDs. Only group statistics leave the report endpoint; internal rows and keys do not. Responses use `Cache-Control: no-store`; there is no retained evaluation dataset or report cache to rebuild after withdrawal.

## What the report measures

The unit is **one current assessment per permitted outcome episode**, not a message, observation or retry. Each report identifies the definition and criterion, rules, cutoff, observation-window semantics and source basis.

| Measure | Interpretation |
| --- | --- |
| Required structured fields | Episodes that passed the definition, scope, window and version contract. |
| Answers, explicit outcome declines, unknown results | Recorded categories only. Declining evaluation excludes the episode and is not an outcome failure. |
| Pending, changed goal, adverse decision | Retained in the denominator where the episode has evaluation permission. |
| Complete/missing event dates | Date availability, not accuracy or independent verification. |
| Unresolved/conflicting/stale assessments | Current deterministic assessment state and reasons. |
| Episodes corrected since opt-in | Linked private-report corrections observed while permission was active; not historical correction frequency. Withdrawal clears this tracking. |
| Observation-window duration bands | Inclusive local-date windows, not elapsed time to an outcome. |

A report requires at least ten distinct student accounts. Every released metric cell also requires ten distinct accounts in both its numerator and complement. Suppressed cells return null counts, denominators and rates. Counts and denominators precede rates. Multiple episodes from one account cannot satisfy the minimum-participant requirement. These rules reduce small-cell disclosure; they are not a differential-privacy guarantee and do not authorize public or partner distribution.

The present private-episode data model does **not** link coordinator observations to private episodes. The report therefore labels student-account provenance and explicitly marks coordinator corroboration as unavailable. It never joins records by similar wording or scope. No result is institution-verified. Presentation, silence and the total eligible population were not recorded for this purpose, so the report labels them unmeasured. Unknown event dates cannot support time-to-outcome estimates.

The voluntary group is selected by return behavior, reporting and permission. It cannot represent all students or establish that a coordinator's advice caused an outcome. Recommendations, causal evaluation, research, training and partner export require subsequent work and their own permission.

## Reproducible synthetic artifact

[Read the synthetic report](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_5_SYNTHETIC.md) or inspect its [JSON](RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_5_SYNTHETIC.json). Forty invented episodes run through the same deterministic assessment and aggregation rules with a fixed cutoff. Regenerate without connecting to a database or AI provider:

```bash
node scripts/outcome-quality-report.mjs docs/student-first/RELIABLE_OUTCOME_EVIDENCE_PHASE_4_STEP_5_SYNTHETIC.json
```

## Rollout and verification

Apply migrations through 113 and refresh runtime/maintenance grants with the compatible backend/web release. Readiness verifies migration, scoped command and raw/helper isolation. Keep the evaluation flag false until operational access and student permission flows are ready. The flag is independent of ordinary evidence storage and guidance; switching it on does not authorize any existing record.

An operator can provision or revoke a service-quality reviewer using the operator database credential:

```bash
node scripts/provision-outcome-evaluation.mjs <organization-uuid> <authorized-reviewer-coordinator-uuid> <ISO-expiry-or-revoke>
```

Capabilities last at most 90 days. Provisioning an evaluation reviewer does not create student consent. No capability was provisioned outside disposable fixtures during this implementation.

Local verification covers exact opt-in and idempotency, decline/withdrawal, flag-off controls, owner/purpose/version isolation, adult eligibility, staff MFA/email/token/membership checks, private-input exclusion, group/complement suppression, duplicate episodes, correct denominators, correction/removal/expiry, withdrawal during aggregation, read-only export, restore and account erasure. Chromium exercises real binder controls and HTTP/PostgreSQL handlers in English and Spanish at 1280, 390 and 320 pixels. Auth/provider identities and all records are synthetic; real provider/device checks remain part of step 6.

Verification result: **201 automated tests passed** across the affected outcome, permission, follow-up, lifecycle and configuration suites, plus **12 Chromium journeys** (six evaluation journeys and six existing outcome-recording journeys). TypeScript, the production build and logging-policy checks passed. The build retains its existing large-chunk advisory. No production identity/provider, institutional integration or deployment was exercised.
