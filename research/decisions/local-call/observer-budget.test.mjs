import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createBudgetLedger } from '../budget.mjs';
import { createLocalObserverBudget } from './observer-budget.mjs';

const usage = (input = 100) => ({ input_tokens: input, output_tokens: 0, total_tokens: input,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
function temporary(run) {
  const directory = mkdtempSync(join(tmpdir(), 'origen-decisions-budget-'));
  try { return run(directory); } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('origen-decisions-budget-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
const options = directory => ({ budgetPath: join(directory, 'approved-continuation-refinement-decisions-budget.sqlite'),
  conversationEnabled: true, supportEnabled: true, continuationRefinement: true });
function previous(directory, { count = 80, input = 100, unsettled = false } = {}) {
  const ledger = createBudgetLedger({ path: join(directory, 'approved-continuation-decisions-budget.sqlite'),
    capUsd: 0.5, reservationUsd: 0.05, maxRequests: 80 });
  try {
    for (let index = 0; index < count; index++) {
      const reservation = ledger.reserve({ operationId: `old-${index}` });
      if (unsettled && index === count - 1) ledger.markUnknown(reservation.id, 'offline_unknown');
      else ledger.settle(reservation.id, usage(input));
    }
  } finally { ledger.close(); }
}

test('refinement requires the authorized conversation mode, fixed path and existing immutable prior ledger', () => temporary(directory => {
  const config = options(directory);
  assert.throws(() => createLocalObserverBudget(config), /refinement_authorization_missing/);
  assert.equal(existsSync(config.budgetPath), false);
  previous(directory);
  assert.throws(() => createLocalObserverBudget({ ...config, conversationEnabled: false }), /refinement_authorization_missing/);
  assert.throws(() => createLocalObserverBudget({ ...config, budgetPath: join(directory, 'another-refinement.sqlite') }), /refinement_authorization_missing/);
  assert.equal(existsSync(config.budgetPath), false);
}));

for (const [name, config] of [['old request allowance not exhausted', { count: 79 }],
  ['unsettled prior charge', { unsettled: true }], ['old spend exceeds remaining allocation', { input: 50001 }]]) {
  test(`refinement rejects ${name} without opening a new allocation`, () => temporary(directory => {
    previous(directory, config);
    assert.throws(() => createLocalObserverBudget(options(directory)), /refinement_budget_unavailable/);
    assert.equal(existsSync(options(directory).budgetPath), false);
  }));
}

test('exact $0.40 old spend plus $0.10 new cap and $2.50 voice cap stays within approval, and old ledger cannot restart', () => temporary(directory => {
  previous(directory, { input: 50000 });
  const ledger = createLocalObserverBudget(options(directory));
  try {
    assert.equal(ledger.allocation.priorSpentUsd, 0.4);
    assert.equal(ledger.allocation.priorReservedUsd, 0);
    assert.equal(ledger.allocation.priorSpentUsd + ledger.summary().capUsd + ledger.allocation.fixedVoiceCapUsd, 3);
    assert.equal(ledger.summary().maxRequests, 20);
  } finally { ledger.close(); }
  const old = createBudgetLedger({ path: join(directory, 'approved-continuation-decisions-budget.sqlite'), capUsd: 0.5, reservationUsd: 0.05, maxRequests: 80 });
  try { assert.throws(() => old.reserve({ operationId: 'restart-old' }), /exhausted/); } finally { old.close(); }
}));

test('refinement has one durable twenty-request allocation across restarts', () => temporary(directory => {
  previous(directory);
  let ledger = createLocalObserverBudget(options(directory));
  try {
    for (let index = 0; index < 20; index++) {
      const reservation = ledger.reserve({ operationId: `refinement-${index}` });
      ledger.settle(reservation.id, usage());
    }
    assert.throws(() => ledger.reserve({ operationId: 'extra' }), /exhausted/);
  } finally { ledger.close(); }
  ledger = createLocalObserverBudget(options(directory));
  try {
    assert.equal(ledger.summary().requestCount, 20);
    assert.throws(() => ledger.reserve({ operationId: 'restart' }), /exhausted/);
  } finally { ledger.close(); }
}));

test('unknown refinement outcomes retain reservations and cannot overspend the ten-cent cap', () => temporary(directory => {
  previous(directory);
  const ledger = createLocalObserverBudget(options(directory));
  try {
    for (let index = 0; index < 2; index++) ledger.markUnknown(ledger.reserve({ operationId: `unknown-${index}` }).id, 'offline_unknown');
    assert.equal(ledger.summary().reservedUsd, 0.1);
    assert.throws(() => ledger.reserve({ operationId: 'over-cap' }), /exhausted/);
  } finally { ledger.close(); }
}));

test('ordinary conversation budget keeps its original immutable limits', () => temporary(directory => {
  const budgetPath = join(directory, 'approved-continuation-decisions-budget.sqlite');
  const ledger = createLocalObserverBudget({ budgetPath, conversationEnabled: true, supportEnabled: true });
  try { assert.equal(ledger.summary().capUsd, 0.5); assert.equal(ledger.summary().maxRequests, 80); }
  finally { ledger.close(); }
  assert.throws(() => createLocalObserverBudget({ budgetPath, supportEnabled: true }), /immutable/);
}));
