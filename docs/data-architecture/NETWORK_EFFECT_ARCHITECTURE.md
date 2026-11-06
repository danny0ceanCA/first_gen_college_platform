# Network Effect Architecture

The v1.2 branch adds a separate, observation-only evidence pipeline and Admin workspace for broad first-generation college navigation. See [v1.2 implementation details](../../research/network-effects/V1_2_IMPLEMENTATION.md). It is not deployed and supplies nothing to the live conversation. This experimental path is distinct from the existing recommendation/outcome features described below.

Origen's Network Effect Architecture connects the guidance students receive with the outcomes they later report. As participation grows, reviewers can use patterns in those outcomes to improve guidance for students facing similar decisions.

1. **Record what happened.** Link a recommendation to the action a student explicitly accepts. A later check-in can record an outcome and link it back to that recommendation.
2. **Evaluate across students.** Students can opt in to prospective evaluation within an organization. Authorized reviewers see aggregate results, with small groups suppressed. A reported outcome is evidence of what followed a recommendation and does not establish that the recommendation caused it.
3. **Improve reusable guidance.** Reviewers can use that evidence to revise guidance and publish approved updates to the shared library. The current recommendation policy uses reviewed rules, and evaluation results do not automatically change it.

Personal continuity uses a student's own context, such as the brief that helps Origen pick up a prior conversation. The network effect comes from using approved aggregate evidence to improve guidance available to other students.

The outcome and recommendation paths are implemented in the repository. Production availability depends on the release configuration and permissions. See the [outcome evidence plan](../student-first/RELIABLE_OUTCOME_EVIDENCE_PHASE_4_PLAN.md) and the [recommendation evaluation and release guide](../student-first/EVIDENCE_INFORMED_RECOMMENDATIONS_PHASE_5_STEP_6.md).
