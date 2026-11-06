import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { networkDatabase, assertNetworkRole } from '../server/network-effects/database.mjs';
import { createNetworkEffectsRepository, migrateNetworkEffects } from '../server/network-effects/repository.mjs';
import { runNetworkExtraction } from '../server/network-effects/worker.mjs';
import { validateSource } from '../research/network-effects/contracts.mjs';
import { verificationVersion as extractorVersion } from '../research/network-effects/verification-contracts.mjs';

export async function networkCommand(args, env = process.env) {
  const [command, file, extra] = args;
  if (!['migrate','grant-roles','import','import-evaluation','status','worker'].includes(command) || extra
      || (['import','import-evaluation'].includes(command) ? !file : file)) throw new Error('invalid_network_command');
  if (command === 'worker' && env.NETWORK_EFFECTS_WORKER_ENABLED !== 'true') {
    console.log(JSON.stringify({ event: 'network_worker_disabled' }));
    return;
  }
  const migration = ['migrate','grant-roles'].includes(command);
  // Validate entire input before connecting. Imports are explicit copied snapshots, never a live collector.
  const payload = file ? await readFile(file, 'utf8') : null;
  if (payload && Buffer.byteLength(payload) > 8_000_000) throw new Error('network_import_too_large');
  const parsed = payload ? JSON.parse(payload) : null;
  if (command === 'import') {
    if (!parsed || Object.keys(parsed).join() !== 'sources' || !Array.isArray(parsed.sources) || !parsed.sources.length || parsed.sources.length > 1000) throw new Error('invalid_network_import');
    parsed.sources.forEach(validateSource);
    if (new Set(parsed.sources.map(source => source.id)).size !== parsed.sources.length) throw new Error('duplicate_import_source');
  }
  const pool = networkDatabase(env, { migration });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    if (command === 'migrate') { await migrateNetworkEffects(pool); return { migrated: 'origen_network_effects' }; }
    if (command === 'grant-roles') {
      const sql = await readFile(new URL('../research/network-effects/postgres/002_roles.sql', import.meta.url), 'utf8');
      const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query(sql); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return { rolesConfigured: true };
    }
    await assertNetworkRole(pool);
    const repo = createNetworkEffectsRepository(pool);
    if (command === 'status') return repo.overview();
    if (command === 'import') {
      for (const source of parsed.sources) await repo.ingest(source, extractorVersion);
      return { imported: parsed.sources.length };
    }
    if (command === 'import-evaluation') return repo.recordEvaluation(parsed);
    const capUsd = Number(env.NETWORK_EFFECTS_BUDGET_USD);
    if (!env.NETWORK_EFFECTS_OPENAI_API_KEY || !env.NETWORK_EFFECTS_BUDGET_ID || !Number.isFinite(capUsd) || capUsd <= 0) throw new Error('network_worker_configuration_required');
    console.log(JSON.stringify({ event: 'network_worker_ready', mode: 'observation-only' }));
    while (!controller.signal.aborted) {
      const result = await runNetworkExtraction(repo, { apiKey: env.NETWORK_EFFECTS_OPENAI_API_KEY,
        budgetId: env.NETWORK_EFFECTS_BUDGET_ID, capUsd, signal: controller.signal });
      if (result) console.log(JSON.stringify({ event: 'network_job_finished', id: result.id, status: result.status }));
      if (result?.stop) break;
      if (!result) await sleep(1500, undefined, { signal: controller.signal });
    }
  } catch (error) { if (!controller.signal.aborted) throw error; }
  finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); await pool.end(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  networkCommand(process.argv.slice(2)).then(result => { if (result) console.log(JSON.stringify(result)); })
    .catch(error => { console.error(JSON.stringify({ error: /^[a-z_]{1,90}$/.test(error.message) ? error.message : 'network_command_failed' })); process.exitCode = 1; });
}
