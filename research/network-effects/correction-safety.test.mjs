import test from 'node:test';
import { openStore } from './store.mjs';
import { correctionSafetyTests } from './correction-safety-suite.mjs';

correctionSafetyTests((name, fn) => test(`SQLite correction safety: ${name}`, fn), async (t, options = {}) => {
  const store = openStore({ path: ':memory:', ...options }); t.after(() => store.close());
  return { store };
});
