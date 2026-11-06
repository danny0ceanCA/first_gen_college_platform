import test from 'node:test';
import { openStore } from './store.mjs';
import { verificationStorageSuite } from './verification-storage-suite.mjs';

verificationStorageSuite((name, fn) => test('SQLite verification: ' + name, fn), async t => {
  let time = Date.parse('2026-11-05T14:00:00.000Z');
  const store = openStore({ path: ':memory:', clock: () => time });
  t.after(() => store.close());
  return { store, advance: milliseconds => { time += milliseconds; } };
});
