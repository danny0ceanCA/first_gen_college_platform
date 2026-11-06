import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';
import { startReviewServer } from './service.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { request } from 'node:http';

async function service(t) {
  const store = openStore({ path: ':memory:' });
  store.importRecords([{ source: demoSources()[0], extraction: demoExtraction(demoSources()[0]) }]);
  const server = await startReviewServer(store, { port: 0 });
  t.after(async () => { await server.close(); store.close(); });
  const state = await (await fetch(`${server.url}/api/state`)).json();
  const episode = state.episodes[0];
  const input = { episodeId: episode.id, expectedRevision: episode.revision, decision: 'reviewed', note: 'Checked local source evidence.' };
  const headers = { 'Content-Type': 'application/json', 'X-Review-Token': state.reviewToken, Origin: server.url };
  const review = (body = input, extraHeaders = headers) => fetch(`${server.url}/api/review`, { method: 'POST', headers: extraHeaders, body: JSON.stringify(body) });
  return { store, server, state, episode, input, headers, review };
}

test('phase 4 — review workspace serves local evidence and persists revision-bound review', async t => {
  const f = await service(t);
  assert.equal(f.state.mode, 'isolated-local');
  assert.equal(f.state.sources[0].synthetic, true);
  const response = await f.review();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).episodes[0].reviewState, 'reviewed');
  const refreshed = await (await fetch(`${f.server.url}/api/state`)).json();
  assert.equal(refreshed.reviews[0].note, f.input.note);
  assert.equal(f.store.state().metrics.items, 2);
});

test('phase 4 — source changes reject stale review instead of approving different evidence', async t => {
  const f = await service(t);
  f.store.ingest({ ...demoSources()[0], version: 2 });
  const response = await f.review();
  assert.equal(response.status, 409);
  assert.equal(f.store.state().reviews.length, 0);
});

test('phase 4 — localhost requests require exact host, origin and review token', async t => {
  const f = await service(t);
  assert.equal((await f.review(f.input, { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await f.review(f.input, { ...f.headers, Origin: 'https://outside.example' })).status, 403);
  const spoofedHost = await new Promise((resolve, reject) => {
    const req = request(`${f.server.url}/api/state`, { headers: { Host: 'outside.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(spoofedHost, 403);
  assert.equal((await fetch(`${f.server.url}/api/state`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(f.store.state().reviews.length, 0);
});

test('phase 4 — malformed review and unknown write routes have no side effects', async t => {
  const f = await service(t);
  assert.equal((await f.review({ ...f.input, note: 'x'.repeat(2001) })).status, 400);
  assert.equal((await f.review({ ...f.input, publish: true })).status, 400);
  assert.equal((await fetch(`${f.server.url}/api/live`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${f.server.url}/../store.mjs`)).status, 404);
  assert.equal(f.store.state().reviews.length, 0);
});

test('phase 4 — UI is local, accessible and treats evidence as text', async t => {
  const f = await service(t);
  const response = await fetch(f.server.url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();
  assert.match(html, /id="search-input"/);
  assert.match(html, /id="episode-detail"/);
  const script = await (await fetch(`${f.server.url}/app.js`)).text();
  assert.doesNotMatch(script, /\.innerHTML\s*=|eval\(|new Function\(/);
  assert.match(script, /textContent/);
});

test('phase 4 — runtime modules are isolated from application services and credentials', async () => {
  const previewImports=new Set(['../../server/admin.mjs','../../server/recent-auth.mjs',
    '../../server/network-effects/repository.mjs','../../server/network-effects/pglite-test-pool.mjs']);
  for (const file of await readdir(new URL('./', import.meta.url))) {
    if (!file.endsWith('.mjs') || file.endsWith('.test.mjs')) continue;
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source,/session\.(?:thinking|commentary|instructions)\.append|from\s+['"][^'"\n]*(?:live-|voice-|student-brief|binder|conversation-desk)/,file);
    if(file==='admin-preview.mjs'){
      // This explicit isolated entrypoint mounts the real admin API/UI on an
      // in-memory test database. It is not part of the extraction runtime.
      const upstream=[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match=>match[1]).filter(path=>path.startsWith('../'));
      assert.deepEqual(new Set(upstream),previewImports);
      assert.doesNotMatch(source,/DATABASE_URL|process\.env|dotenv|from\s+['"]pg['"]/);
      assert.match(source,/new PGlite\(\)/);assert.match(source,/envFile:false/);
      continue;
    }
    if(file==='calibration-runner.mjs'){
      // Paid calibration has exactly one explicit credential, never an ambient
      // app key, account loader, .env loader, or service database connection.
      assert.match(source,/process\.env\.NETWORK_EFFECTS_OPENAI_API_KEY/);
      assert.doesNotMatch(source.replaceAll('process.env.NETWORK_EFFECTS_OPENAI_API_KEY','explicitCalibrationKey'),/process\.env|DATABASE_URL|dotenv|from\s+['"](?:\.\.\/|pg['"])/);
      continue;
    }
    assert.doesNotMatch(source, /from\s+['"](?:\.\.\/|pg['"]|dotenv)|DATABASE_URL|process\.env/, file);
  }
  const serverDirectory=new URL('../../server/',import.meta.url);
  for(const file of await readdir(serverDirectory)){
    if(!file.endsWith('.mjs')||file.endsWith('.test.mjs')||!/(?:live|voice|brief|binder|memory|research)/i.test(file))continue;
    const source=await readFile(new URL(file,serverDirectory),'utf8');
    assert.doesNotMatch(source,/(?:from\s+|import\s*\()["'][^"']*network-effects/,file);
  }
});
