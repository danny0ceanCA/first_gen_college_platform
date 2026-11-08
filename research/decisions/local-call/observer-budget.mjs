import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createBudgetLedger } from '../budget.mjs';

const OLD_CONTINUATION_FILE = 'approved-continuation-decisions-budget.sqlite';
const REFINEMENT_FILE = 'approved-continuation-refinement-decisions-budget.sqlite';

// Local test allocation only. The caller chooses the already-isolated directory;
// fixed filenames and immutable ledger limits prevent accidental allocation
// resets between worker restarts. No API or application database is opened.
export function createLocalObserverBudget({ budgetPath, conversationEnabled = false,
  supportEnabled = false, continuationRefinement = false } = {}) {
  let prior = null;
  if (continuationRefinement === true) {
    if (conversationEnabled !== true || typeof budgetPath !== 'string'
      || basename(resolve(budgetPath)) !== REFINEMENT_FILE) throw Error('refinement_authorization_missing');
    const previousPath = resolve(dirname(budgetPath), OLD_CONTINUATION_FILE);
    if (!existsSync(previousPath)) throw Error('refinement_authorization_missing');
    const previous = createBudgetLedger({ path: previousPath, capUsd: 0.5, reservationUsd: 0.05, maxRequests: 80 });
    try { prior = previous.summary(); } finally { previous.close(); }
    // Eighty settled requests permanently exhaust the old request allowance.
    // Old spend <= .40 + this .10 cap + fixed 2.50 voice cap stays <= $3.
    if (prior.requestCount !== 80 || prior.reservedUsd !== 0 || prior.spentUsd > 0.4)
      throw Error('refinement_budget_unavailable');
  }
  const capUsd = continuationRefinement === true ? 0.1 : conversationEnabled === true ? 0.5 : supportEnabled === true ? 1.5 : 5;
  const maxRequests = continuationRefinement === true ? 20 : conversationEnabled === true ? 80 : supportEnabled === true ? 200 : 60;
  const ledger = createBudgetLedger({ path: budgetPath, capUsd, reservationUsd: 0.05, maxRequests });
  return { ...ledger, allocation: Object.freeze({ refinement: continuationRefinement === true,
    priorRequestCount: prior?.requestCount ?? null, priorSpentUsd: prior?.spentUsd ?? null,
    priorReservedUsd: prior?.reservedUsd ?? null, refinementCapUsd: prior ? capUsd : null,
    fixedVoiceCapUsd: prior ? 2.5 : null, combinedAuthorizedCapUsd: prior ? 3 : null }) };
}
