import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createNetworkEffectsRepository, migrateNetworkEffects } from './repository.mjs';
import { createPGlitePool } from './pglite-test-pool.mjs';
import { correctionSafetyTests } from '../../research/network-effects/correction-safety-suite.mjs';

const runtime = process.env.NETWORK_EFFECTS_TEST_PGLITE_MODULE ? pathToFileURL(process.env.NETWORK_EFFECTS_TEST_PGLITE_MODULE)
  : new URL('../../research/network-effects/.local/pg-test-runtime/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url);
const available = existsSync(runtime), PGlite = available ? (await import(runtime.href)).PGlite : null;
const register = (name, fn) => test(`PostgreSQL correction safety: ${name}`, { skip: !available && 'Isolated PGlite runtime is unavailable.' }, fn);
async function setup(t, options = {}) {
  const db = new PGlite(), pool = createPGlitePool(db); await migrateNetworkEffects(pool);
  const store = createNetworkEffectsRepository(pool, options); t.after(() => db.close());
  // Exercise Admin materialized records on every read, not only dynamic state().
  const originalState = store.state;
  store.state = async (...args) => {
    const state = await originalState(...args);
    for (const episode of state.episodes) assert.deepEqual((await store.getEpisode(episode.id)).episode, episode);
    return state;
  };
  return { store, pool };
}
correctionSafetyTests(register, setup);

register('processing gap metadata uses only the separate shadow roles and retains no source text', async t => {
  const { store, pool } = await setup(t);
  await pool.query(await readFile(new URL('../../research/network-effects/postgres/002_roles.sql', import.meta.url), 'utf8'));
  await pool.query('SET ROLE origen_network_worker');
  const input = { id: 'role-deleted-gap', version: 1, accountId: 'role-family', studentId: 'role-student', reporter: 'student',
    language: 'en', kind: 'note', recordedAt: '2026-11-05T12:00:00.000Z', text: 'Deleted source prose must not remain.', synthetic: true };
  await store.ingest(input); await store.deleteSource(input.id);
  await pool.query('RESET ROLE'); await pool.query('SET ROLE origen_network_admin');
  const gaps = (await pool.query('SELECT * FROM origen_network_effects.processing_gaps')).rows;
  assert.deepEqual(gaps, [{ source_id: input.id, source_version: 1, account_id: input.accountId, student_id: input.studentId,
    reporter: input.reporter, recorded_at: input.recordedAt }]);
  await assert.rejects(() => pool.query('DELETE FROM origen_network_effects.processing_gaps'), { code: '42501' });
  await pool.query('RESET ROLE');
});
