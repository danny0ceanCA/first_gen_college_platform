import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';
import { createSyntheticExtractor } from './extractor.mjs';
import { drainJobs } from './worker.mjs';

async function populated(t) {
  const store = openStore({ path: ':memory:' });
  t.after(() => store.close());
  for (const source of demoSources()) store.ingest(source);
  const results = await drainJobs(store, createSyntheticExtractor(), { retryDelayMs: 0 });
  assert.ok(results.every(result => result.status === 'completed'), JSON.stringify(store.state().jobs));
  return store;
}

test('phase 3 — understanding, intended action, submitted work and pending result remain distinct', async t => {
  const store = await populated(t);
  const { episodes } = store.state();
  const application = episodes.find(episode => episode.episodeKey === 'application-submission');
  assert.equal(application.actionState, 'completed');
  assert.equal(application.outcomeState, 'pending');
  const enrollment = episodes.find(episode => episode.episodeKey === 'admitted-versus-enrolled');
  assert.equal(enrollment.questionState, 'resolved');
  assert.equal(enrollment.actionState, 'intended');
  assert.equal(enrollment.outcomeState, null);
});

test('phase 3 — Spanish correction supersedes the positive report with pending evidence', async t => {
  const store = await populated(t);
  const episode = store.state().episodes.find(row => row.episodeKey === 'asking-for-help');
  assert.equal(episode.outcomeState, 'pending');
  assert.equal(episode.items.find(item => item.sourceId === 'demo-help-positive').state, 'superseded');
  const correction = episode.items.find(item => item.sourceId === 'demo-help-correction');
  assert.equal(correction.corrects, 'demo-help-positive@1#item-1');
  assert.equal(correction.reportedBy, 'student');
  assert.equal(correction.language, 'es');
  assert.equal(correction.occurredAt, null);
});

test('phase 3 — family learning does not resolve a student question or merge siblings', async t => {
  const store = await populated(t);
  const { episodes } = store.state();
  assert.equal(episodes.find(e => e.episodeKey === 'parent-understands-cost').questionState, 'partial');
  assert.equal(episodes.find(e => e.episodeKey === 'student-understands-cost').questionState, 'open');
  assert.equal(episodes.find(e => e.episodeKey === 'family-distance').studentId, null);
  const input = { ...demoSources()[0], id: 'sibling-copy', studentId: 'leo' };
  store.importRecords([{ source: input, extraction: demoExtraction(demoSources()[0]) }]);
  const matching = store.state().episodes.filter(e => e.episodeKey === 'getting-started');
  assert.equal(matching.length, 2);
  assert.notEqual(matching[0].id, matching[1].id);
});

test('phase 3 — foreign student links are rejected atomically', async t => {
  const store = await populated(t);
  const base = demoSources()[0];
  const input = { ...base, id: 'foreign-link', studentId: 'leo' };
  const extraction = demoExtraction(base);
  extraction.items[1].linksTo = 'demo-college-start@1#item-1';
  store.ingest(input);
  assert.throws(() => store.complete(store.claim(), extraction));
  assert.ok(!store.state().episodes.flatMap(e => e.items).some(i => i.sourceId === input.id));
});

test('phase 3 — source revisions invalidate reviews and retain summary evidence history', async t => {
  const store = await populated(t);
  const episode = store.state().episodes.find(e => e.episodeKey === 'getting-started');
  store.review({ episodeId: episode.id, expectedRevision: episode.revision, decision: 'reviewed', note: 'Checked original summary.' });
  const source = demoSources()[0];
  store.ingest({ ...source, version: 2, text: 'I am now considering college with my family.' });
  store.complete(store.claim(), { schemaVersion: 1, items: [] });
  const current = store.state().episodes.find(e => e.id === episode.id);
  assert.equal(current.reviewState, 'needs-review');
  assert.ok(current.items.every(item => item.state === 'superseded'));
  assert.ok(current.items.every(item => item.basis === 'summary'));
  assert.equal(store.state().sourceHistory.filter(row => row.id === source.id).length, 2);
  assert.throws(() => store.review({ episodeId: episode.id, expectedRevision: episode.revision, decision: 'reviewed' }), { code: 'stale_review' });
});

test('phase 3 — deletion erases source history and invalidates dependent evidence links', async t => {
  const store = await populated(t);
  const episode = store.state().episodes.find(e => e.episodeKey === 'parent-understands-cost');
  store.review({ episodeId: episode.id, expectedRevision: episode.revision, decision: 'reviewed', note: 'Source-derived private review.' });
  store.deleteSource('demo-parent-costs');
  const state = store.state();
  assert.ok(!state.sourceHistory.some(row => row.id === 'demo-parent-costs'));
  assert.ok(!state.episodes.flatMap(e => e.items).some(row => row.sourceId === 'demo-parent-costs'));
  assert.ok(!state.reviews.some(row => row.episodeId === episode.id));
  assert.equal(state.episodes.find(e => e.id === episode.id).reviewState, 'needs-review');
});

test('phase 3 — ambiguous evidence remains unlinked with unknown task and result', async t => {
  const store = await populated(t);
  const episode = store.state().episodes.find(e => e.episodeKey === 'unclear-progress');
  assert.equal(episode.outcomeState, 'unknown');
  assert.equal(episode.studentId, null);
  assert.equal(episode.items[0].reportedBy, 'unknown');
  assert.equal(episode.items[0].linksTo, null);
});

test('phase 3 — imported snapshots replay without duplicate observations', t => {
  const store = openStore({ path: ':memory:' });
  t.after(() => store.close());
  const records = demoSources().map(source => ({ source, extraction: demoExtraction(source) }));
  store.importRecords(records);
  const before = store.state().metrics;
  store.importRecords(records);
  assert.deepEqual(store.state().metrics, before);
});
