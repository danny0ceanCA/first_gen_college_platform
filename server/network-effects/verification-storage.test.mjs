import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createNetworkEffectsRepository, migrateNetworkEffects } from './repository.mjs';
import { createPGlitePool } from './pglite-test-pool.mjs';
import { verificationStorageSuite } from '../../research/network-effects/verification-storage-suite.mjs';

const runtime = process.env.NETWORK_EFFECTS_TEST_PGLITE_MODULE
  ? pathToFileURL(process.env.NETWORK_EFFECTS_TEST_PGLITE_MODULE)
  : new URL('../../research/network-effects/.local/pg-test-runtime/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url);
const available = existsSync(runtime);
const PGlite = available ? (await import(runtime.href)).PGlite : null;
const register = (name, fn) => test('PostgreSQL verification: ' + name,
  { skip: !available && 'Isolated PGlite runtime is unavailable.' }, fn);
async function setup(t) {
  let time = Date.parse('2026-11-05T14:00:00.000Z');
  const db = new PGlite(), pool = createPGlitePool(db);
  t.after(() => db.close());
  await migrateNetworkEffects(pool);
  return { store: createNetworkEffectsRepository(pool, { clock: () => time }), pool,
    advance: milliseconds => { time += milliseconds; } };
}
verificationStorageSuite(register, setup);

register('the audit table is private; existing restricted roles receive only their scoped privileges', async t => {
  const { pool } = await setup(t);
  await pool.query(await readFile(new URL('../../research/network-effects/postgres/002_roles.sql', import.meta.url), 'utf8'));
  await pool.query('SET ROLE origen_network_worker');
  assert.equal((await pool.query("SELECT has_table_privilege(current_user,'origen_network_effects.verification_audits','INSERT') AS allowed")).rows[0].allowed, true);
  await pool.query('RESET ROLE');
  await pool.query('SET ROLE origen_network_admin');
  await pool.query('SELECT * FROM origen_network_effects.verification_audits');
  await assert.rejects(() => pool.query('DELETE FROM origen_network_effects.verification_audits'), /permission denied/);
  await assert.rejects(() => pool.query("UPDATE origen_network_effects.verification_audits SET attempt=2"), /permission denied/);
  await pool.query('RESET ROLE');
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM information_schema.role_table_grants WHERE table_schema='origen_network_effects' AND table_name='verification_audits' AND grantee='PUBLIC'")).rows[0].n, 0);
});
