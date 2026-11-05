# Development voice latency — Phase 3

Status: implemented locally on `Origen-Development`, November 3, 2026. This phase reduces duplicated instructions. It does not change production or begin Phase 4's direct-answer experiment.

## What changed

Live now receives speaking guidance instead of a second copy of several backend procedures. The delegated backend retains the complete workflow instructions, authorized tool schemas, validation, consent and persistence rules.

- Onboarding keeps the same English/Spanish introduction, Daniel's accurate story, warm pacing, concrete questions and shared-form references. Its shorter speech contract still requires a backend draft update after every supplied detail, a successful final review, explicit save consent and a confirmed save before the binder handoff.
- Adaptive guidance delivers the **same selected context data** with concise speaking rules. Ranking implementation details remain in the backend. Caller/student attribution, clarification, source uncertainty, declined steps and the student's freedom to choose remain explicit.
- Outcome and coordinator follow-up instructions keep complete readbacks and separate private-save/sharing approvals. Detailed execution procedures stay with the backend.
- Speech contracts are included only when the actual session tools support them. Feature flags alone no longer advertise coordinator-sharing workflows during onboarding or an unconfirmed student scope.
- Live's backend gets a compact wording guide. Live itself keeps the full pronunciation, warmth, empathy, pacing and conversational-style guidance. Both retain the concept-first teaching approach. Published teaching tone and conversational approach still reach the speech model and backend.
- One duplicated binder-evidence policy is omitted from Live's memory brief when the workspace already supplies it. This is a generated-instruction decision, not string replacement over student content. The default memory policy and the complete student data remain intact.

The same capability selection applies at connection time and when changing the conversation guide. The new speech prompt module is included in the prompt release fingerprint.

## Measured payload reduction

The comparison uses fictional English fixtures with all eligible features enabled, identical student context and unchanged tool schemas. Counts are characters, **not tokens**, and do not predict voice latency or billable cost. The baseline was captured from the local Phase 2 implementation immediately before these edits.

| Scenario | Speech instructions before → after | Backend instructions before → after | Complete session JSON bytes before → after | Tools, unchanged |
| --- | ---: | ---: | ---: | ---: |
| Planning | 28,213 → 24,032 | 58,699 → 56,090 | 105,600 → 98,774 | 25 |
| Financial aid | 28,213 → 24,032 | 60,919 → 58,310 | 107,920 → 101,094 | 25 |
| Applications | 28,213 → 24,032 | 56,737 → 54,128 | 103,785 → 96,959 | 25 |
| Account onboarding | 27,620 → 21,065 | 27,321 → 25,782 | 59,567 → 51,385 | 6 |

Speech instructions are about **15% smaller for regular conversations** and **24% smaller for onboarding**. The complete session payload falls by roughly **6–7%** and **14%**, respectively. These are smaller, more clearly assigned instructions; this is not evidence of a corresponding percentage improvement in response speed.

Generate current measurements without a database, provider call or credentials:

```powershell
node scripts/voice-payload-report.mjs
```

The report covers English and Spanish planning, financial aid, loans, applications, first-account onboarding, adding a student, unconfirmed parent scope, family scope and read-only calls. Tests enforce fixture budgets; production instructions are never blindly truncated to satisfy a size limit. Actual payloads vary with permitted context and published teachings.

## What remains unchanged

- GPT-Live-1, delegated model, reasoning effort, service tier and output budget.
- When substantive questions delegate to the backend; no new direct-answer routing.
- Tool implementations, schemas, available operations and authorization boundaries.
- Account/student/family separation, current corrections, source attribution and uncertainty.
- Teaching retrieval, its content and tone, explicit action consent and app-confirmed saving.
- Phase 1 timing instrumentation and Phase 2 preparation/cache validation.

No worker, new database table, migration or feature flag is required.

## Validation and remaining limits

`server/student-live-prompt-budget.test.mjs` checks both languages, exact context preservation, authorized capabilities, teaching delivery at connection/guide update, model configuration and frontend/backend responsibilities. Existing onboarding, scope, consent, preparation, recovery and tool-routing regressions were also run against disposable local PostgreSQL with provider calls mocked.

Validation results:

- The broad run passed 229 checks. Its remaining failures were in the existing outcome-assessment fixture: one returned a temporary 503 under the concurrent run, and its 12-case invalidation matrix exceeded its explicit 90-second timeout, cancelling subsequent cases.
- The first case passed independently. Both affected top-level tests were then rerun in isolation, preserving every assertion and increasing only the temporary test copy's timeout to eight minutes. All 14 checks passed; the matrix itself took about five minutes. No checked-in test assertions or timeouts were weakened. Together the runs verified the 240 distinct checks in the selected regression set.
- `npm run build`, `npm run check:logging` and `git diff --check` passed. The build still reports the existing large-bundle warning.
- A direct comparison against HEAD confirmed that the full `collegeVoiceStyle` output is byte-for-byte unchanged.

Local evidence is in `tmp/phase3-regression-tests.log`, `tmp/phase3-outcome-extended.log`, `tmp/phase3-build.log` and `tmp/phase3-payload-comparison.json`. These temporary files contain fictional fixtures; no production records were queried. The disposable PostgreSQL instance was stopped after validation.

No paid live calls or production changes were made. This phase does not prove that the speech model follows every instruction or that the previously observed delays are resolved. The full-feature backend still has substantial instructions and 25 tools. Further pruning should follow measured usage and representative voice tests, rather than hiding capabilities or dropping privacy and consent rules to achieve a smaller number.

The separation follows the official [Live prompting guidance](https://developers.openai.com/api/docs/guides/live-prompting): keep conversation guidance with the speech model and detailed procedures with the backend. Application code remains responsible for permissions, validation and confirmations.
