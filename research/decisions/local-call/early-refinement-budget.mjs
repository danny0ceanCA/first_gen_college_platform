// Reallocate only the unused portion of an exhausted request allowance. All
// original ledgers and unknown voice holds remain intact and are read-only.
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBudgetLedger } from '../budget.mjs';
import { inspectEarlyBudgetAllocation, EARLY_DECISIONS_BUDGET_FILE, EARLY_DECISIONS_CAP_USD } from './early-budget.mjs';

export const EARLY_REFINEMENT_BUDGET_FILE = 'approved-early-refinement-decisions-budget.sqlite';
const CAP = .30;
const fail = () => { throw Error('early_refinement_budget_unavailable'); };
export function inspectEarlyRefinementAllocation(options = {}) {
  if (options.conversationEnabled !== true || options.earlyEnabled !== true || typeof options.budgetPath !== 'string'
    || /^[\\/]{2}/.test(options.budgetPath) || /^[a-z][a-z0-9+.-]*:\/\//i.test(options.budgetPath)
    || basename(resolve(options.budgetPath)) !== EARLY_REFINEMENT_BUDGET_FILE) throw Error('early_refinement_authorization_missing');
  const priorPath = resolve(dirname(options.budgetPath), EARLY_DECISIONS_BUDGET_FILE);
  const allocation = inspectEarlyBudgetAllocation({ ...options, budgetPath: priorPath });
  if (!existsSync(priorPath)) throw Error('early_refinement_authorization_missing');
  let db, spentUnits;
  try {
    db = new DatabaseSync(priorPath, { readOnly: true });
    const config = db.prepare('SELECT * FROM decisions_budget_config WHERE singleton=1').get();
    if (config?.version !== 1 || config.cap_units !== 300_000_000 || config.reservation_units !== 50_000_000
      || config.max_requests !== 80) fail();
    const rows = db.prepare('SELECT status, reserved_units, actual_units FROM decisions_budget_reservations').all();
    if (rows.length !== 80 || rows.some(row => row.status !== 'settled' || row.reserved_units !== 50_000_000
      || !Number.isSafeInteger(row.actual_units) || row.actual_units < 0)) fail();
    spentUnits = rows.reduce((sum, row) => sum + row.actual_units, 0);
    if (!Number.isSafeInteger(spentUnits) || spentUnits > config.cap_units) fail();
  } catch { fail(); } finally { db?.close(); }
  const maximumExposureUsd = Math.round((allocation.maximumExposureUsd - EARLY_DECISIONS_CAP_USD + CAP) * 1e9 + spentUnits) / 1e9;
  if (maximumExposureUsd > 5) fail();
  return Object.freeze({ ...allocation, decisionsCapUsd: CAP, maximumExposureUsd,
    exhaustedEarly: Object.freeze({ file: EARLY_DECISIONS_BUDGET_FILE, requests: 80, spentUsd: spentUnits / 1e9, reservedUsd: 0 }),
    refinementMaximumRequests: 200 });
}
export function createEarlyRefinementBudget(options = {}) {
  const allocation = inspectEarlyRefinementAllocation(options);
  const ledger = createBudgetLedger({ path: options.budgetPath, capUsd: CAP, reservationUsd: .025, maxRequests: 200 });
  return { ...ledger, allocation, reserve(request) {
    inspectEarlyRefinementAllocation(options);
    return ledger.reserve(request);
  } };
}
