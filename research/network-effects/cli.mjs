import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore, localDirectory } from './store.mjs';
import { demoSources } from './fixtures.mjs';
import { createSyntheticExtractor } from './extractor.mjs';
import { drainJobs } from './worker.mjs';
import { startReviewServer } from './service.mjs';
import { demoEvaluation, evaluatePredictions } from './evaluation.mjs';

function argumentsFor(args) {
  const [command = 'help', ...rest] = args;
  const values = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!['--database', '--input', '--port', '--output'].includes(flag) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('invalid_cli_arguments');
    values[flag.slice(2)] = rest[i + 1];
  }
  return values;
}

export async function main(args = process.argv.slice(2)) {
  const options = argumentsFor(args);
  if (options.command === 'help') {
    console.log(`Network Effect Architecture — isolated local workspace

  node research/network-effects/cli.mjs demo
  node research/network-effects/cli.mjs serve --port 8791
  node research/network-effects/cli.mjs import --input snapshots.json
  node research/network-effects/cli.mjs export --output review.json
  node research/network-effects/cli.mjs status
  node research/network-effects/cli.mjs evaluate
  node research/network-effects/cli.mjs evaluate --input predictions.json --output evaluation.json

The demo loads fictional reference cases and processes them through the job queue.
Import accepts local JSON { records: [{ source, extraction }] }. Extractions are
previously prepared observations; the command verifies and stores their evidence.
It does not fetch account data. No command reads .env or calls a paid provider.
Database files must be beneath research/network-effects/.local/.
The review service binds only to 127.0.0.1 and has no application integration.`);
    return;
  }
  if (options.command === 'evaluate') {
    let report;
    if (options.input) {
      const bytes = await readFile(resolve(options.input));
      if (bytes.length > 8_000_000) throw new Error('import_too_large');
      const bundle = JSON.parse(bytes);
      if (!Array.isArray(bundle.records) || bundle.records.length > 1000) throw new Error('invalid_import');
      report = evaluatePredictions(bundle.records);
    } else {
      report = demoEvaluation();
    }
    const json = JSON.stringify(report, null, 2);
    if (options.output) await writeFile(resolve(options.output), json, { flag: 'wx' });
    else console.log(json);
    return;
  }
  if (!['demo', 'serve', 'import', 'export', 'status'].includes(options.command)) throw new Error('unknown_command');
  const store = openStore({ path: options.database || resolve(localDirectory, 'review.sqlite') });
  let service;
  try {
    if (options.command === 'demo') {
      for (const source of demoSources()) store.ingest(source);
      const results = await drainJobs(store, createSyntheticExtractor(), { maxJobs: 100, retryDelayMs: 0 });
      const failures = store.state().jobs.filter(job => job.status === 'failed');
      console.log(JSON.stringify({ mode: 'synthetic-reference-replay', ...store.state().metrics, processed: results.length }, null, 2));
      if (failures.length) throw new Error('demo_extraction_failed');
    }
    if (options.command === 'import') {
      if (!options.input) throw new Error('input_file_required');
      const bytes = await readFile(resolve(options.input));
      if (bytes.length > 8_000_000) throw new Error('import_too_large');
      const bundle = JSON.parse(bytes);
      if (!Array.isArray(bundle.records) || bundle.records.length > 1000) throw new Error('invalid_import');
      const metrics = store.importRecords(bundle.records);
      console.log(JSON.stringify({ imported: bundle.records.length, ...metrics }, null, 2));
    }
    if (options.command === 'status') console.log(JSON.stringify(store.state().metrics, null, 2));
    if (options.command === 'export') {
      if (!options.output) throw new Error('output_file_required');
      await writeFile(resolve(options.output), JSON.stringify(store.state(), null, 2), { flag: 'wx' });
      console.log('Local review snapshot exported. It contains source text and is for authorized local review.');
    }
    if (options.command === 'serve') {
      service = await startReviewServer(store, { port: options.port ? Number(options.port) : 8791 });
      console.log(`Local network-effect review workspace: ${service.url}`);
      await new Promise(resolve => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
    }
  } finally {
    if (service) await service.close();
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const code = /^[a-z_]+$/.test(error.message) ? error.message : 'local_command_failed';
    console.error(code);
    process.exitCode = 1;
  });
}
