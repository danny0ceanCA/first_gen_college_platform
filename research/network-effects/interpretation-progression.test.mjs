import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';

const register = (name, fn) => test('SQLite interpretation progression: ' + name, fn);
async function setup(t) {
  const store = openStore({ path: ':memory:' });
  t.after(() => store.close());
  return store;
}

const source = (id, text, day = 1, overrides = {}) => ({
  id, version: 1, accountId: 'progress-family', studentId: 'progress-student',
  reporter: 'student', language: 'en', kind: 'note',
  recordedAt: '2026-11-' + String(day).padStart(2, '0') + 'T12:00:00.000Z',
  text, synthetic: true, ...overrides,
});
const item = (input, key, kind, status, overrides = {}) => ({
  key, episodeKey: 'requested-support', topic: 'finding_help', barrier: null,
  kind, status, statement: overrides.quote || input.text, quote: input.text, reportedBy: input.reporter,
  language: input.language, occurredAt: null, linksTo: null, corrects: null, ...overrides,
});
async function save(store, input, items) {
  const queued = await store.ingest(input, 'interpretation-progression-test');
  const job = await store.claim({ jobId: queued.id });
  assert.ok(job);
  await store.complete(job, { schemaVersion: 1, items });
}
async function episodeFor(store, input, episodeKey = 'requested-support') {
  const state = await store.state({ accountId: input.accountId, studentId: input.studentId });
  const episode = state.episodes.find(value => value.episodeKey === episodeKey);
  assert.ok(episode);
  if (store.getEpisode) assert.deepEqual((await store.getEpisode(episode.id)).episode, episode);
  return episode;
}

register('explicit later results advance the same milestone without rewriting its pending history', async t => {
  const store = await setup(t);
  const examples = [
    ['en', 'I requested the session and am still waiting for a date.', 'I attended that session.'],
    ['es', 'Pedí la sesión y todavía espero la fecha.', 'Asistí a esa sesión.'],
    ['mixed', 'Ya pedí la sesión. They have not given me a date yet.', 'Fui a esa sesión. I attended.'],
  ];
  for (const [language, waitingText, attendedText] of examples) {
    const pending = source('pending-' + language, waitingText, 1, { language, studentId: 'student-' + language });
    await save(store, pending, [item(pending, 'waiting', 'outcome', 'pending')]);
    const next = source('attended-' + language, attendedText, 2, { language, studentId: pending.studentId });
    await save(store, next, [
      item(next, 'attended', 'action', 'completed', { linksTo: pending.id + '@1#waiting' }),
      item(next, 'reported-result', 'outcome', 'positive', { linksTo: pending.id + '@1#waiting' }),
    ]);
    const episode = await episodeFor(store, pending);
    assert.equal(episode.outcomeState, 'positive');
    assert.equal(episode.actionState, 'completed');
    assert.equal(episode.analysisEligible, true);
    const previous = episode.items.find(value => value.id === pending.id + '@1#waiting');
    assert.equal(previous.status, 'pending');
    assert.equal(previous.state, 'current'); // historically true, not retracted
    assert.ok(episode.items.every(value => value.corrects === null));
    const outcome = episode.items.find(value => value.sourceId === next.id && value.kind === 'outcome');
    assert.equal(outcome.linksTo, previous.id);
    assert.equal(outcome.linkState, 'supported');
    assert.deepEqual(episode.correctionCoverageHolds, []);
    const state = await store.state({ accountId: pending.accountId, studentId: pending.studentId });
    assert.equal(state.sourceHistory.length, 2);
    assert.equal(state.metrics.pending, 0);
  }
});

register('a completed action and new understanding alone do not manufacture an outcome', async t => {
  const store = await setup(t);
  const pending = source('awaiting-response', 'I am waiting for a response from the office.');
  await save(store, pending, [item(pending, 'waiting', 'outcome', 'pending')]);
  const action = source('sent-reminder', 'I sent a reminder. Now I understand how to contact the office.', 2);
  await save(store, action, [
    item(action, 'reminder', 'action', 'completed', { quote: 'I sent a reminder.', linksTo: 'awaiting-response@1#waiting' }),
    item(action, 'understood-contact', 'understanding', 'reported', { quote: 'Now I understand how to contact the office.', linksTo: 'reminder' }),
  ]);
  const episode = await episodeFor(store, pending);
  assert.equal(episode.actionState, 'completed');
  assert.equal(episode.outcomeState, 'pending');
  assert.equal(episode.analysisEligible, true);
  assert.equal(episode.items.filter(value => value.kind === 'outcome').length, 1);
  assert.equal((await store.state()).metrics.pending, 1);
  if (store.overview) assert.equal((await store.overview()).metrics.pending, 1);
});

register('another concern, student, or reporter cannot silently resolve the student pending result', async t => {
  const store = await setup(t);
  const pending = source('student-waiting', 'I am waiting for the requested session.');
  await save(store, pending, [item(pending, 'waiting', 'outcome', 'pending')]);
  const otherConcern = source('library-card-arrived', 'My library card arrived.', 2);
  await save(store, otherConcern, [item(otherConcern, 'received', 'outcome', 'positive', { episodeKey: 'library-card' })]);
  assert.equal((await episodeFor(store, pending)).outcomeState, 'pending');
  const sibling = source('sibling-attended', 'I attended the requested session.', 3, { studentId: 'other-student' });
  await save(store, sibling, [item(sibling, 'attended', 'outcome', 'positive')]);
  assert.equal((await episodeFor(store, pending)).outcomeState, 'pending');
  assert.equal((await episodeFor(store, sibling)).outcomeState, 'positive');
  const parent = source('parent-report', 'The office told me the requested session happened.', 4, { reporter: 'parent' });
  await save(store, parent, [item(parent, 'parent-result', 'outcome', 'positive')]);
  const disagreement = await episodeFor(store, pending);
  assert.equal(disagreement.outcomeState, 'conflicting');
  assert.equal(disagreement.reviewState, 'needs-review');
  assert.equal(disagreement.analysisEligible, false);
  assert.ok(disagreement.items.some(value => value.sourceId === pending.id && value.status === 'pending' && value.state === 'current'));
  assert.ok(disagreement.items.every(value => value.corrects === null));
  assert.equal((await episodeFor(store, otherConcern, 'library-card')).outcomeState, 'positive');
});

register('submission and receipt acknowledgment remain separate from admission', async t => {
  const store = await setup(t);
  const submitted = source('application-submitted', 'I submitted my application. The school has not given me an admission decision.');
  await save(store, submitted, [
    item(submitted, 'submission', 'action', 'completed', { episodeKey: 'admission-decision', topic: 'applications', quote: 'I submitted my application.' }),
    item(submitted, 'decision-pending', 'outcome', 'pending', { episodeKey: 'admission-decision', topic: 'applications',
      quote: 'The school has not given me an admission decision.', linksTo: 'submission' }),
  ]);
  const receipt = source('application-receipt', 'The office confirmed receiving my application. The admission decision is still pending.', 2);
  await save(store, receipt, [
    item(receipt, 'receipt-confirmed', 'outcome', 'positive', { episodeKey: 'application-receipt', topic: 'applications',
      quote: 'The office confirmed receiving my application.' }),
    item(receipt, 'still-waiting', 'outcome', 'pending', { episodeKey: 'admission-decision', topic: 'applications',
      quote: 'The admission decision is still pending.', linksTo: 'application-submitted@1#decision-pending' }),
  ]);
  const admission = await episodeFor(store, submitted, 'admission-decision');
  assert.equal(admission.actionState, 'completed');
  assert.equal(admission.outcomeState, 'pending');
  assert.equal(admission.analysisEligible, true);
  assert.ok(admission.items.every(value => value.status !== 'positive' && value.corrects === null));
  assert.equal((await episodeFor(store, receipt, 'application-receipt')).outcomeState, 'positive');
  assert.equal((await store.state()).metrics.pending, 1);
});
