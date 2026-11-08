import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createBudgetLedger } from '../budget.mjs';
import { createEarlyObserverBudget, inspectEarlyBudgetAllocation,
  EARLY_DECISIONS_BUDGET_FILE, EARLY_VOICE_BUDGET_FILE } from './early-budget.mjs';

const usage = (input = 100) => ({ input_tokens: input, output_tokens: 0, total_tokens: input,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
const priorFiles = ['approved-continuation-decisions-budget.sqlite', 'approved-continuation-refinement-decisions-budget.sqlite'];
const config = directory => ({ budgetPath: join(directory, EARLY_DECISIONS_BUDGET_FILE),
  conversationEnabled: true, earlyEnabled: true });
const hash = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
function temporary(run) {
  const directory = mkdtempSync(join(tmpdir(), 'origen-early-budget-'));
  try { return run(directory); } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('origen-early-budget-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
function seed(directory, { oldCount = 80, refinementCount = 20, input = 100,
  unknown = false, oldVoiceCap = 2.5, newVoiceCap = null } = {}) {
  for (const [index, count] of [oldCount, refinementCount].entries()) {
    const ledger = createBudgetLedger({ path: join(directory, priorFiles[index]),
      capUsd: index ? 0.1 : 0.5, reservationUsd: 0.05, maxRequests: index ? 20 : 80 });
    try {
      for (let n = 0; n < count; n++) {
        const r = ledger.reserve({ operationId: `seed-${n}` });
        if (unknown && !index && n === count - 1) ledger.markUnknown(r.id, 'unknown');
        else ledger.settle(r.id, usage(input));
      }
    } finally { ledger.close(); }
  }
  writeFileSync(join(directory, 'continuation-voice-budget.json'), JSON.stringify({ capUsd: oldVoiceCap,
    reservations: [{ reservedUsd: 0.75, usageComplete: true, settledUsd: 0.1 },
      { reservedUsd: 0.75, usageComplete: false }, { reservedUsd: 0.75, usageComplete: false }] }));
  if (newVoiceCap !== null) writeFileSync(join(directory, EARLY_VOICE_BUDGET_FILE), JSON.stringify({ capUsd: newVoiceCap, reservations: [] }));
}

test('new allocation requires explicit local support and both existing exhausted ledgers', () => temporary(directory => {
  assert.throws(() => createEarlyObserverBudget(config(directory)), /early_authorization_missing/);
  assert.equal(existsSync(config(directory).budgetPath), false);
  seed(directory);
  for (const changes of [{ earlyEnabled: false }, { conversationEnabled: false },
    { budgetPath: join(directory, 'different-ledger.sqlite') }, { budgetPath: `https://host/${EARLY_DECISIONS_BUDGET_FILE}` }]) {
    assert.throws(() => createEarlyObserverBudget({ ...config(directory), ...changes }), /early_authorization_missing/);
  }
  assert.equal(existsSync(config(directory).budgetPath), false);
}));

for (const [name, options] of [
  ['old allowance still open', { oldCount: 79 }], ['refinement allowance still open', { refinementCount: 19 }],
  ['unknown prior Decisions charge', { unknown: true }], ['old spend over ten cents', { input: 10001 }],
  ['changed old voice allocation', { oldVoiceCap: 3 }], ['changed new voice allocation', { newVoiceCap: 2.5 }],
]) test(`new allocation rejects ${name}`, () => temporary(directory => {
  seed(directory, options);
  assert.throws(() => createEarlyObserverBudget(config(directory)), /early_budget_unavailable/);
  assert.equal(existsSync(config(directory).budgetPath), false);
}));

test('exact combined five dollars includes full previous voice cap and never modifies prior ledgers', () => temporary(directory => {
  seed(directory, { input: 10000 });
  const paths = [...priorFiles, 'continuation-voice-budget.json'].map(file => join(directory, file));
  const before = paths.map(hash);
  const allocation = inspectEarlyBudgetAllocation(config(directory));
  assert.equal(existsSync(config(directory).budgetPath), false);
  assert.equal(allocation.maximumExposureUsd, 5);
  assert.equal(allocation.priorDecisionsSpentUsd, 0.1);
  assert.equal(allocation.fixedPriorVoiceCapUsd, 2.5);
  assert.equal(allocation.fixedVoiceCapUsd, 2.1);
  assert.equal(allocation.priorVoice.reservedUsd, 1.5);
  const budget = createEarlyObserverBudget(config(directory));
  try {
    assert.equal(budget.summary().capUsd, 0.3);
    assert.equal(budget.summary().maxRequests, 80);
    const r = budget.reserve({ operationId: 'new-call' });
    budget.settle(r.id, usage());
  } finally { budget.close(); }
  assert.deepEqual(paths.map(hash), before);
}));

test('fixed request limit survives restarts and earlier counts stay exhausted', () => temporary(directory => {
  seed(directory);
  let budget = createEarlyObserverBudget(config(directory));
  try {
    for (let i = 0; i < 80; i++) budget.settle(budget.reserve({ operationId: `new-${i}` }).id, usage());
    assert.throws(() => budget.reserve({ operationId: 'too-many' }), /exhausted/);
  } finally { budget.close(); }
  budget = createEarlyObserverBudget(config(directory));
  try {
    assert.equal(budget.summary().requestCount, 80);
    assert.throws(() => budget.reserve({ operationId: 'restart' }), /exhausted/);
  } finally { budget.close(); }
  for (const [index, file] of priorFiles.entries()) {
    const old = createBudgetLedger({ path: join(directory, file), capUsd: index ? 0.1 : 0.5,
      reservationUsd: 0.05, maxRequests: index ? 20 : 80 });
    try { assert.throws(() => old.reserve({ operationId: 'restart-old' }), /exhausted/); } finally { old.close(); }
  }
}));

test('unknown new charges keep their complete reservation', () => temporary(directory => {
  seed(directory);
  const budget = createEarlyObserverBudget(config(directory));
  try {
    for (let i = 0; i < 6; i++) budget.markUnknown(budget.reserve({ operationId: `unknown-${i}` }).id, 'unconfirmed');
    assert.equal(budget.summary().reservedUsd, 0.3);
    assert.throws(() => budget.reserve({ operationId: 'exceeds-cap' }), /exhausted/);
  } finally { budget.close(); }
}));

test('changed prior configuration or invalid voice charges stop a new reservation', () => temporary(directory => {
  seed(directory);
  const budget = createEarlyObserverBudget(config(directory));
  try {
    const file = join(directory, 'continuation-voice-budget.json');
    for (const reservations of [[{ reservedUsd: -1 }], [{ reservedUsd: 3, usageComplete: false }],
      [{ reservedUsd: 0.75, usageComplete: true }]]) {
      writeFileSync(file, JSON.stringify({ capUsd: 2.5, reservations }));
      assert.throws(() => budget.reserve({ operationId: 'invalid-prior' }), /early_budget_unavailable/);
      assert.equal(budget.summary().requestCount, 0);
    }
  } finally { budget.close(); }
}));

test('a different existing new allocation cannot be reset through the helper', () => temporary(directory => {
  seed(directory);
  const wrong = createBudgetLedger({ path: config(directory).budgetPath, capUsd: 0.5, reservationUsd: 0.05, maxRequests: 80 });
  wrong.close();
  assert.throws(() => createEarlyObserverBudget(config(directory)), /immutable/);
}));
