// Local validation allocation only. Prior ledgers are opened read-only and never
// reset: the $5 approval includes their charges and all earlier voice holds.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBudgetLedger } from '../budget.mjs';

export const EARLY_DECISIONS_BUDGET_FILE = 'approved-early-decisions-budget.sqlite';
export const EARLY_VOICE_BUDGET_FILE = 'early-voice-budget.json';
export const EARLY_VOICE_CAP_USD = 2.1;
export const EARLY_DECISIONS_CAP_USD = 0.3;
const PRIOR_VOICE_CAP_USD = 2.5;
const TOTAL_CAP_USD = 5;
const UNITS = 1_000_000_000;
const priors = [
  { file: 'approved-continuation-decisions-budget.sqlite', cap: 500_000_000, count: 80 },
  { file: 'approved-continuation-refinement-decisions-budget.sqlite', cap: 100_000_000, count: 20 },
];
const fail = () => { throw Error('early_budget_unavailable'); };
const nonnegative = value => Number.isFinite(value) && value >= 0;

function priorDecisions(directory, expected) {
  const filename = resolve(directory, expected.file);
  if (!existsSync(filename)) throw Error('early_authorization_missing');
  let db;
  try {
    db = new DatabaseSync(filename, { readOnly: true });
    const config = db.prepare('SELECT * FROM decisions_budget_config WHERE singleton=1').get();
    if (!config || config.version !== 1 || config.cap_units !== expected.cap
      || config.reservation_units !== 50_000_000 || config.max_requests !== expected.count) fail();
    const rows = db.prepare('SELECT status, reserved_units, actual_units FROM decisions_budget_reservations').all();
    if (rows.length !== expected.count || rows.some(row => row.status !== 'settled'
      || row.reserved_units !== 50_000_000 || !Number.isSafeInteger(row.actual_units) || row.actual_units < 0)) fail();
    const spentUnits = rows.reduce((sum, row) => sum + row.actual_units, 0);
    if (!Number.isSafeInteger(spentUnits) || spentUnits > expected.cap) fail();
    return Object.freeze({ file: expected.file, requestCount: rows.length, spentUsd: spentUnits / UNITS,
      spentUnits, reservedUsd: 0 });
  } catch (error) {
    if (error.message === 'early_budget_unavailable') throw error;
    throw Error('early_budget_unavailable');
  } finally { db?.close(); }
}

function voiceAllocation(filename, expectedCap, required) {
  if (!existsSync(filename)) {
    if (required) throw Error('early_authorization_missing');
    return Object.freeze({ capUsd: expectedCap, spentUsd: 0, reservedUsd: 0, accountedUsd: 0 });
  }
  let value;
  try { value = JSON.parse(readFileSync(filename, 'utf8')); } catch { fail(); }
  if (value?.capUsd !== expectedCap || !Array.isArray(value.reservations)) fail();
  let spentUsd = 0; let reservedUsd = 0;
  for (const item of value.reservations) {
    if (!item || !nonnegative(item.reservedUsd) || item.reservedUsd === 0
      || ![true, false, undefined].includes(item.usageComplete)) fail();
    if (item.usageComplete === true) {
      if (!nonnegative(item.settledUsd)) fail();
      spentUsd += item.settledUsd;
    } else reservedUsd += item.reservedUsd;
  }
  const accountedUsd = spentUsd + reservedUsd;
  if (!nonnegative(accountedUsd) || accountedUsd > expectedCap + 1e-9) fail();
  return Object.freeze({ capUsd: expectedCap, spentUsd, reservedUsd, accountedUsd });
}

export function inspectEarlyBudgetAllocation({ budgetPath, conversationEnabled = false, earlyEnabled = false } = {}) {
  if (conversationEnabled !== true || earlyEnabled !== true || typeof budgetPath !== 'string'
    || /^[\\/]{2}/.test(budgetPath) || /^[a-z][a-z0-9+.-]*:\/\//i.test(budgetPath)
    || basename(resolve(budgetPath)) !== EARLY_DECISIONS_BUDGET_FILE) throw Error('early_authorization_missing');
  const directory = dirname(resolve(budgetPath));
  const previous = priors.map(expected => priorDecisions(directory, expected));
  const priorSpentUnits = previous.reduce((sum, item) => sum + item.spentUnits, 0);
  // Both old request counts are permanently exhausted. Count the entire old
  // voice allocation, even if its remaining allowance is used later.
  if (priorSpentUnits > 100_000_000) fail();
  const oldVoice = voiceAllocation(resolve(directory, 'continuation-voice-budget.json'), PRIOR_VOICE_CAP_USD, true);
  const newVoice = voiceAllocation(resolve(directory, EARLY_VOICE_BUDGET_FILE), EARLY_VOICE_CAP_USD, false);
  const maximumExposureUsd = (priorSpentUnits + 2_500_000_000 + 2_100_000_000 + 300_000_000) / UNITS;
  if (maximumExposureUsd > TOTAL_CAP_USD) fail();
  return Object.freeze({ combinedAuthorizedCapUsd: TOTAL_CAP_USD,
    decisionsCapUsd: EARLY_DECISIONS_CAP_USD, fixedVoiceCapUsd: EARLY_VOICE_CAP_USD,
    fixedPriorVoiceCapUsd: PRIOR_VOICE_CAP_USD, maximumExposureUsd,
    priorDecisions: Object.freeze(previous), priorDecisionsSpentUsd: priorSpentUnits / UNITS,
    priorVoice: oldVoice, voice: newVoice });
}

export function createEarlyObserverBudget(options = {}) {
  const allocation = inspectEarlyBudgetAllocation(options);
  const ledger = createBudgetLedger({ path: options.budgetPath, capUsd: EARLY_DECISIONS_CAP_USD,
    reservationUsd: 0.05, maxRequests: 80 });
  return { ...ledger, allocation,
    reserve(request) {
      // Recheck prior configurations and unknown voice holds before spending.
      inspectEarlyBudgetAllocation(options);
      return ledger.reserve(request);
    },
  };
}
