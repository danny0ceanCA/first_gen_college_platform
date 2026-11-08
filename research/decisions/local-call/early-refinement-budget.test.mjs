import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBudgetLedger } from '../budget.mjs';
import { EARLY_DECISIONS_BUDGET_FILE, EARLY_VOICE_BUDGET_FILE } from './early-budget.mjs';
import { EARLY_REFINEMENT_BUDGET_FILE, inspectEarlyRefinementAllocation, createEarlyRefinementBudget } from './early-refinement-budget.mjs';

const priors = [
  { file: 'approved-continuation-decisions-budget.sqlite', capUsd: .5, count: 80 },
  { file: 'approved-continuation-refinement-decisions-budget.sqlite', capUsd: .1, count: 20 },
  { file: EARLY_DECISIONS_BUDGET_FILE, capUsd: .3, count: 80 },
];
const usage = input => ({ input_tokens: input, output_tokens: 0, total_tokens: input,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
const config = directory => ({ budgetPath: join(directory, EARLY_REFINEMENT_BUDGET_FILE), conversationEnabled: true, earlyEnabled: true });
const hash = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
function temporary(run) {
  const directory = mkdtempSync(join(tmpdir(), 'origen-early-refinement-budget-'));
  try { return run(directory); } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('origen-early-refinement-budget-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
function seed(directory, { counts = [80, 20, 80], unknown = -1, inputs = () => 100 } = {}) {
  for (const [index, prior] of priors.entries()) {
    const ledger = createBudgetLedger({ path: join(directory, prior.file), capUsd: prior.capUsd,
      reservationUsd: .05, maxRequests: prior.count });
    try {
      for (let row = 0; row < counts[index]; row++) {
        const reservation = ledger.reserve({ operationId: `seed-${index}-${row}` });
        if (unknown === index && row === counts[index] - 1) ledger.markUnknown(reservation.id, 'unknown');
        else ledger.settle(reservation.id, usage(inputs(index, row)));
      }
    } finally { ledger.close(); }
  }
  writeFileSync(join(directory, 'continuation-voice-budget.json'), JSON.stringify({ capUsd: 2.5,
    reservations: [{ reservedUsd: .75, usageComplete: true, settledUsd: .1 }, { reservedUsd: .75, usageComplete: false }] }));
  writeFileSync(join(directory, EARLY_VOICE_BUDGET_FILE), JSON.stringify({ capUsd: 2.1,
    reservations: [{ reservedUsd: .7, usageComplete: false }] }));
}
function mutate(filename, statement) {
  const db = new DatabaseSync(filename);
  try { db.exec(statement); } finally { db.close(); }
}

test('refinement requires explicit local authorization and all three exhausted prior request allowances', () => temporary(directory => {
  assert.throws(() => createEarlyRefinementBudget(config(directory)), /authorization_missing/);
  assert.equal(existsSync(config(directory).budgetPath), false);
  seed(directory);
  for (const changes of [{ earlyEnabled: false }, { conversationEnabled: false },
    { budgetPath: join(directory, EARLY_DECISIONS_BUDGET_FILE) }, { budgetPath: `https://host/${EARLY_REFINEMENT_BUDGET_FILE}` }]) {
    assert.throws(() => createEarlyRefinementBudget({ ...config(directory), ...changes }), /authorization_missing/);
  }
  assert.equal(existsSync(config(directory).budgetPath), false);
}));

for (let index = 0; index < 3; index++) {
  test(`prior ledger ${index + 1} must have its full fixed request count`, () => temporary(directory => {
    const counts = [80, 20, 80]; counts[index]--;
    seed(directory, { counts });
    assert.throws(() => createEarlyRefinementBudget(config(directory)), /budget_unavailable/);
    assert.equal(existsSync(config(directory).budgetPath), false);
  }));
  test(`prior ledger ${index + 1} cannot contain an unknown charge`, () => temporary(directory => {
    seed(directory, { unknown: index });
    assert.throws(() => createEarlyRefinementBudget(config(directory)), /budget_unavailable/);
    assert.equal(existsSync(config(directory).budgetPath), false);
  }));
}

test('known prior costs plus full voice allocations and new cap total exactly 4.9635401 without modifying prior files', () => temporary(directory => {
  seed(directory, { inputs: (index, row) => index < 2 ? 5277 + (index === 0 && row === 0 ? 33 : 0) : 1345 + (row === 0 ? 68 : 0) });
  const files = [...priors.map(prior => prior.file), 'continuation-voice-budget.json', EARLY_VOICE_BUDGET_FILE].map(file => join(directory, file));
  const before = files.map(hash);
  const allocation = inspectEarlyRefinementAllocation(config(directory));
  assert.equal(existsSync(config(directory).budgetPath), false);
  assert.equal(allocation.maximumExposureUsd, 4.9635401);
  assert.equal(allocation.priorDecisionsSpentUsd, .0527733);
  assert.equal(allocation.exhaustedEarly.spentUsd, .0107668);
  assert.equal(allocation.fixedPriorVoiceCapUsd, 2.5); assert.equal(allocation.fixedVoiceCapUsd, 2.1);
  assert.equal(allocation.priorVoice.reservedUsd, .75); assert.equal(allocation.voice.reservedUsd, .7);
  const budget = createEarlyRefinementBudget(config(directory));
  try {
    assert.equal(budget.summary().capUsd, .3); assert.equal(budget.summary().reservationUsd, .025);
    assert.equal(budget.summary().maxRequests, 200);
    budget.settle(budget.reserve({ operationId: 'new-development-case' }).id, usage(100));
  } finally { budget.close(); }
  assert.deepEqual(files.map(hash), before);
}));

test('five-dollar maximum includes exhausted early spend and rejects one token beyond it', () => temporary(directory => {
  seed(directory, { inputs: index => index < 2 ? 5000 : 6250 });
  assert.equal(inspectEarlyRefinementAllocation(config(directory)).maximumExposureUsd, 5);
  mutate(join(directory, EARLY_DECISIONS_BUDGET_FILE), 'UPDATE decisions_budget_reservations SET actual_units=actual_units+100 WHERE rowid=1');
  assert.throws(() => inspectEarlyRefinementAllocation(config(directory)), /early_refinement_budget_unavailable/);
  assert.equal(existsSync(config(directory).budgetPath), false);
}));

test('changed prior early configuration or malformed accounting stops allocation', () => temporary(directory => {
  seed(directory);
  const filename = join(directory, EARLY_DECISIONS_BUDGET_FILE);
  mutate(filename, 'UPDATE decisions_budget_config SET max_requests=81');
  assert.throws(() => inspectEarlyRefinementAllocation(config(directory)), /early_refinement_budget_unavailable/);
  mutate(filename, 'UPDATE decisions_budget_config SET max_requests=80; UPDATE decisions_budget_reservations SET actual_units=-1 WHERE rowid=1');
  assert.throws(() => inspectEarlyRefinementAllocation(config(directory)), /early_refinement_budget_unavailable/);
}));

test('each reservation rechecks prior voice holds and completed early accounting', () => temporary(directory => {
  seed(directory);
  const budget = createEarlyRefinementBudget(config(directory));
  try {
    const voicePath = join(directory, EARLY_VOICE_BUDGET_FILE), original = readFileSync(voicePath, 'utf8');
    writeFileSync(voicePath, JSON.stringify({ capUsd: 2.1, reservations: [{ reservedUsd: 2.2, usageComplete: false }] }));
    assert.throws(() => budget.reserve({ operationId: 'invalid-voice' }), /budget_unavailable/);
    writeFileSync(voicePath, original);
    mutate(join(directory, EARLY_DECISIONS_BUDGET_FILE), "UPDATE decisions_budget_reservations SET status='unknown' WHERE rowid=1");
    assert.throws(() => budget.reserve({ operationId: 'invalid-early' }), /early_refinement_budget_unavailable/);
    assert.equal(budget.summary().requestCount, 0);
  } finally { budget.close(); }
}));

test('unknown refinement requests retain their full reservation across restarts', () => temporary(directory => {
  seed(directory);
  let budget = createEarlyRefinementBudget(config(directory));
  try {
    for (let i = 0; i < 12; i++) budget.markUnknown(budget.reserve({ operationId: `unknown-${i}` }).id, 'unconfirmed');
    assert.equal(budget.summary().reservedUsd, .3);
    assert.throws(() => budget.reserve({ operationId: 'beyond-cap' }), /exhausted/);
  } finally { budget.close(); }
  budget = createEarlyRefinementBudget(config(directory));
  try {
    assert.equal(budget.summary().reservedUsd, .3);
    assert.throws(() => budget.reserve({ operationId: 'restart-over-cap' }), /exhausted/);
  } finally { budget.close(); }
}));

test('refinement request limit survives restarts and cannot reset exhausted prior allowances', () => temporary(directory => {
  seed(directory);
  let budget = createEarlyRefinementBudget(config(directory));
  try {
    for (let i = 0; i < 200; i++) budget.settle(budget.reserve({ operationId: `new-${i}` }).id, usage(100));
    assert.throws(() => budget.reserve({ operationId: 'request-201' }), /exhausted/);
  } finally { budget.close(); }
  budget = createEarlyRefinementBudget(config(directory));
  try {
    assert.equal(budget.summary().requestCount, 200);
    assert.throws(() => budget.reserve({ operationId: 'restart' }), /exhausted/);
  } finally { budget.close(); }
  for (const prior of priors) {
    const ledger = createBudgetLedger({ path: join(directory, prior.file), capUsd: prior.capUsd, reservationUsd: .05, maxRequests: prior.count });
    try { assert.throws(() => ledger.reserve({ operationId: 'reset-old' }), /exhausted/); } finally { ledger.close(); }
  }
}));

test('an existing refinement ledger with other limits cannot be silently reset', () => temporary(directory => {
  seed(directory);
  const existing = createBudgetLedger({ path: config(directory).budgetPath, capUsd: .4, reservationUsd: .025, maxRequests: 200 });
  existing.close();
  assert.throws(() => createEarlyRefinementBudget(config(directory)), /immutable/);
}));
