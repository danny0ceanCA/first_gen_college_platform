# Phase 3: summary fidelity review

Completed signed-in conversation captures compare the server-owned summary with the submitted transcript. Deferred onboarding uses the server-generated summary and the existing pending-analysis attachment workflow. No phase 1 preference gate is required.

One bounded request uses the configured summary model, `store:false`, a 12-second timeout and 700 output tokens. Captures above 48,000 serialized characters are explicitly unchecked rather than silently truncated. Incomplete recovery checkpoints do not trigger paid review. The summary and transcript fingerprint reuses previous results for identical completed retries; changed evidence can receive a new review. Failed identical completed reviews remain failed rather than generating retry charges.

Checks cover material corrections, missing goals or unresolved questions, unsupported claims, suggestions confused with commitments or completion, and lost uncertainty. English/Spanish translations and faithful paraphrases are allowed. Missing sensitive details are not omissions. These are model-generated candidates, not certified factual accuracy or institutional eligibility decisions.

Only allowlisted categories, confidence, constant explanations and validated turn ordinals are retained. Provider-generated prose is discarded. No extra transcript copy is stored. Existing account boundaries, summary/account deletion cascades and 90-day retention apply. Admin Voice quality shows discrepancy categories and the number actually checked; older phase 2 reports remain supported. There is no automatic summary rewrite or model training.

The review adds a small model cost and up to 12 seconds to completed summary processing. Failures do not prevent saving the summary. No production deployment or real-provider accuracy evaluation is implied by unit tests. A reviewed bilingual evaluation set remains needed to measure false positives and omissions.
