import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';

test('phase 2 scale — 1,000 fictional families stay isolated during processing and replay', () => {
  const store = openStore({ path: ':memory:' });
  try {
    const base = demoSources()[0];
    const reference = demoExtraction(base);
    const records = Array.from({ length: 1000 }, (_, index) => ({
      source: { ...base, id: `scale-source-${index}`, accountId: `scale-family-${index}`, studentId: `scale-student-${index}` },
      extraction: structuredClone(reference),
    }));
    const metrics = store.importRecords(records);
    assert.equal(metrics.sources, 1000);
    assert.equal(metrics.episodes, 1000);
    assert.equal(metrics.items, 2000);
    const context = store.contextFor(records[417].source);
    assert.equal(context.episodes.length, 1);
    assert.equal(context.existingItems.length, 2);
    assert.ok(context.existingItems.every(item => item.accountId === 'scale-family-417' && item.studentId === 'scale-student-417'));
    assert.deepEqual(store.importRecords(records), metrics);
  } finally {
    store.close();
  }
});
