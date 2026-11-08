import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createBudgetLedger } from './budget.mjs';

function fixture(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'origen-decisions-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { path: join(dir, 'budget.sqlite'), capUsd: 0.1, reservationUsd: 0.05, maxRequests: 20, ...extra };
}
const usage = (input = 1000, output = 10) => ({ input_tokens: input, output_tokens: output, total_tokens: input + output,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
const code = (expected) => (error) => error.code === expected;

test('reservations persist through restart, immutable limits cannot reset cap', (t) => {
  const options = fixture(t);
  let ledger = createBudgetLedger(options);
  const { id } = ledger.reserve({ operationId: 'first', metadata: { fixtureId: 'fictional-en', inputRevision: 1 } });
  ledger.markUnknown(id, 'timeout');
  ledger.close();
  assert.throws(() => createBudgetLedger({ ...options, capUsd: 2 }), code('config_mismatch'));
  assert.throws(() => createBudgetLedger({ ...options, reservationUsd: 0.01 }), code('config_mismatch'));
  assert.throws(() => createBudgetLedger({ ...options, maxRequests: 30 }), code('config_mismatch'));
  ledger = createBudgetLedger(options);
  try {
    assert.equal(ledger.summary().reservedUsd, 0.05);
    assert.equal(ledger.summary().unknownCount, 1);
    ledger.reserve({ operationId: 'second' });
    assert.throws(() => ledger.reserve({ operationId: 'third' }), code('budget_exhausted'));
    assert.throws(() => ledger.reserve({ operationId: 'first' }), code('operation_exists'));
    const db = new DatabaseSync(options.path, { readOnly: true });
    const row = db.prepare('SELECT * FROM decisions_budget_reservations WHERE id=?').get(id);
    assert.ok(Date.parse(row.created_at)); assert.ok(Date.parse(row.updated_at));
    assert.equal(row.reason, 'timeout');
    db.close();
  } finally { ledger.close(); }
});

test('settlement uses input rate, free output, and idempotent usage', (t) => {
  const ledger = createBudgetLedger(fixture(t));
  try {
    const { id } = ledger.reserve({ operationId: 'priced' });
    const result = ledger.settle(id, usage(10000, 6000));
    assert.equal(result.costUsd, 0.001); assert.equal(result.outputCostUsd, 0);
    assert.deepEqual(ledger.settle(id, usage(10000, 6000)), result);
    assert.throws(() => ledger.settle(id, usage(20000)), code('usage_conflict'));
    assert.equal(ledger.summary().spentUsd, 0.001);
    assert.equal(ledger.summary().reservedUsd, 0);
    assert.equal(ledger.summary().availableUsd, 0.099);
    assert.throws(() => ledger.markUnknown(id, 'timeout'), code('already_settled'));
  } finally { ledger.close(); }
});

test('missing, negative, fractional, nonfinite, and inconsistent usage keep reservations', (t) => {
  const malformed = [undefined, {}, { ...usage(), input_tokens: -1 }, { ...usage(), output_tokens: Infinity },
    { ...usage(), total_tokens: 12 }, { ...usage(), input_tokens: 1.5 },
    { ...usage(), input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 } },
    { ...usage(), input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 } },
    { ...usage(), output_tokens_details: { reasoning_tokens: 11 } },
    { ...usage(), input_tokens: '1000' }];
  const ledger = createBudgetLedger(fixture(t, { capUsd: 2 }));
  try {
    malformed.forEach((item, i) => {
      const { id } = ledger.reserve({ operationId: `bad-${i}` });
      assert.throws(() => ledger.settle(id, item), code('invalid_usage'));
      ledger.markUnknown(id, 'invalid_usage'); // Observer failure handler may repeat this.
    });
    assert.equal(ledger.summary().reservedUsd, malformed.length * 0.05);
    assert.equal(ledger.summary().spentUsd, 0);
    assert.equal(ledger.summary().unknownCount, malformed.length);
  } finally { ledger.close(); }
});

test('request cap remains binding after inexpensive settlement', (t) => {
  const ledger = createBudgetLedger(fixture(t, { maxRequests: 1 }));
  try {
    const { id } = ledger.reserve({ operationId: 'one' });
    ledger.settle(id, usage(0, 0));
    assert.throws(() => ledger.reserve({ operationId: 'two' }), code('budget_exhausted'));
  } finally { ledger.close(); }
});

test('actual cost beyond reservation is retained and blocks further work', (t) => {
  const ledger = createBudgetLedger(fixture(t));
  try {
    const { id } = ledger.reserve({ operationId: 'unexpected-usage' });
    assert.equal(ledger.settle(id, usage(2_000_000)).exceededReservation, true);
    assert.equal(ledger.summary().spentUsd, 0.2);
    assert.equal(ledger.summary().overspentUsd, 0.1);
    assert.throws(() => ledger.reserve({ operationId: 'blocked' }), code('budget_exhausted'));
  } finally { ledger.close(); }
});

test('rejects remote/memory databases and raw content metadata', (t) => {
  for (const path of [undefined, '', ':memory:', 'postgres://example/db', 'file:remote.db', '\\\\host\\share\\x.db', '//host/share/x.db']) {
    assert.throws(() => createBudgetLedger({ path }), code('invalid_path'));
  }
  const ledger = createBudgetLedger(fixture(t));
  try {
    assert.throws(() => ledger.reserve({ operationId: 'metadata', metadata: { input: 'student transcript' } }), code('invalid_metadata'));
    assert.throws(() => ledger.reserve({ operationId: 'metadata', metadata: { callId: 'email@example.com' } }), code('invalid_metadata'));
    assert.equal(ledger.summary().requestCount, 0);
  } finally { ledger.close(); }
});

test('will not initialize in an existing application SQLite database', (t) => {
  const options = fixture(t);
  const db = new DatabaseSync(options.path);
  db.exec('CREATE TABLE students (id TEXT)'); db.close();
  assert.throws(() => createBudgetLedger(options), code('invalid_path'));
  const check = new DatabaseSync(options.path);
  assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name), ['students']);
  check.close();
});

test('independent concurrent connections cannot oversubscribe the durable cap', async (t) => {
  const options = fixture(t, { capUsd: 0.2 });
  createBudgetLedger(options).close();
  const moduleUrl = new URL('./budget.mjs', import.meta.url).href;
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => new Promise((resolve, reject) => {
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      import(workerData.moduleUrl).then(({createBudgetLedger})=>{
        let ledger;
        try { ledger=createBudgetLedger(workerData.options); ledger.reserve({operationId:'worker-'+workerData.index}); parentPort.postMessage('reserved'); }
        catch(error) { parentPort.postMessage(error.code||error.message); }
        finally { ledger?.close(); }
      }).catch(error=>{throw error;});`, { eval: true, workerData: { moduleUrl, options, index } });
    worker.on('message', resolve); worker.on('error', reject);
  })));
  assert.equal(results.filter((value) => value === 'reserved').length, 4);
  assert.ok(results.every((value) => ['reserved', 'budget_exhausted'].includes(value)), JSON.stringify(results));
  const ledger = createBudgetLedger(options);
  try { assert.equal(ledger.summary().reservedUsd, 0.2); } finally { ledger.close(); }
});
