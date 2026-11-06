import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, localDirectory } from './store.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';
import { createSyntheticExtractor } from './extractor.mjs';
import { runJob, drainJobs } from './worker.mjs';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const first = () => demoSources()[0];
function setup(t, options = {}) {
  const store = openStore({ path: ':memory:', ...options });
  t.after(() => store.close());
  return store;
}

test('phase 2 — duplicate ingestion produces one job and one extraction', async t => {
  const store = setup(t);
  store.ingest(first());
  store.ingest(first());
  const results = await drainJobs(store, createSyntheticExtractor());
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'completed');
  assert.equal(store.state().metrics.items, 2);
  assert.equal(store.state().jobs[0].attempts, 1);
  assert.equal(typeof store.state().jobs[0].durationMs, 'number');
});

test('phase 2 — running leases prevent duplicate work and expired leases recover', t => {
  let time = 1000;
  const store = setup(t, { clock: () => time });
  store.ingest(first());
  const old = store.claim({ leaseMs: 100 });
  assert.equal(store.claim(), null);
  time = 1101;
  const replacement = store.claim();
  assert.equal(replacement.attempts, 2);
  assert.throws(() => store.complete(old, demoExtraction(first())), { code: 'stale_job_lease' });
  store.complete(replacement, demoExtraction(first()));
  assert.equal(store.state().metrics.items, 2);
});

test('phase 2 — failures have bounded retries and never persist provider prose', async t => {
  const store = setup(t);
  store.ingest(first());
  const extract = async () => { throw new Error('PRIVATE_SOURCE_AND_CREDENTIAL_SENTINEL'); };
  const results = await drainJobs(store, extract, { retryDelayMs: 0, maxAttempts: 3 });
  assert.deepEqual(results.map(result => result.status), ['queued', 'queued', 'failed']);
  assert.equal(store.state().metrics.failedJobs, 1);
  assert.doesNotMatch(JSON.stringify(store.state()), /PRIVATE_SOURCE_AND_CREDENTIAL_SENTINEL/);
  store.retry(store.state().jobs[0].id);
  assert.equal((await runJob(store, createSyntheticExtractor())).status, 'completed');
});

test('phase 2 — late extraction cannot overwrite an updated or deleted source', async t => {
  const store = setup(t);
  const input = first();
  store.ingest(input);
  const pending = runJob(store, async () => {
    store.ingest({ ...input, version: 2, text: 'A corrected local summary.' });
    return demoExtraction(input);
  });
  assert.equal((await pending).status, 'obsolete');
  assert.equal(store.state().metrics.items, 0);
  const job = store.claim();
  store.deleteSource(input.id);
  assert.throws(() => store.complete(job, { schemaVersion: 1, items: [] }), { code: 'stale_job_lease' });
  assert.throws(() => store.ingest(input), { code: 'source_deleted' });
});

test('phase 2 — source versions and ownership cannot be silently rewritten', t => {
  const store = setup(t);
  const input = first();
  store.ingest(input);
  assert.throws(() => store.ingest({ ...input, text: 'Changed under the same version.' }), { code: 'source_version_conflict' });
  assert.throws(() => store.ingest({ ...input, version: 2, studentId: 'sibling' }), { code: 'source_scope_changed' });
  store.ingest({ ...input, version: 2 });
  assert.throws(() => store.ingest(input), { code: 'stale_source_version' });
});

test('phase 2 — local files survive restart and two connections claim each job once', t => {
  const path = resolve(localDirectory, `test-${randomUUID()}.sqlite`);
  const store = openStore({ path });
  const second = openStore({ path });
  t.after(() => {
    store.close(); second.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  });
  store.ingest(first());
  const job = second.claim();
  assert.equal(store.claim(), null);
  second.complete(job, demoExtraction(first()));
  assert.equal(store.state().metrics.items, 2);
});

test('phase 2 — database paths cannot target application or network databases', () => {
  for (const path of ['postgres://production/private', '../app.sqlite', 'C:/Users/danie/Documents/ChatGPT/Project Elo-Em/app.sqlite']) {
    assert.throws(() => openStore({ path }), /local_database_path_required/);
  }
});

test('phase 2 — empty supported extraction completes without inventing observations', t => {
  const store = setup(t);
  store.ingest(first());
  store.complete(store.claim(), { schemaVersion: 1, items: [] });
  assert.equal(store.state().metrics.items, 0);
  assert.equal(store.state().jobs[0].status, 'completed');
});

test('phase 2 — invalid local import rolls back every earlier record in the batch', t => {
  const store = setup(t);
  const sources = demoSources();
  assert.throws(() => store.importRecords([
    { source: sources[0], extraction: demoExtraction(sources[0]) },
    { source: sources[1], extraction: { schemaVersion: 1, items: [{ fabricated: true }] } },
  ]));
  assert.equal(store.state().metrics.sources, 0);
  assert.equal(store.state().jobs.length, 0);
});
