import { basename } from 'node:path';
import { createBudgetLedger } from '../budget.mjs';

export const MICROPHONE_BUDGET_FILE = 'approved-microphone-20261108-five-dollar.sqlite';
export function createMicrophoneBudget(options = {}) {
  if (options.microphoneBudgetApproved !== true || basename(options.budgetPath ?? '') !== MICROPHONE_BUDGET_FILE)
    throw Error('microphone_budget_authorization_missing');
  const ledger = createBudgetLedger({ path: options.budgetPath, capUsd: 5, reservationUsd: .05, maxRequests: 1000 });
  return { ...ledger, allocation: Object.freeze({ authorization: 'Daniel approved up to $5 for local Decisions on November 8, 2026',
    decisionsCapUsd: 5, separateFromPreviousAllocations: true, previousLedgersUnchanged: true }) };
}
