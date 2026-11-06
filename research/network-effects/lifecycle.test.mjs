import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, localDirectory } from './store.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function setup(t) {
  const store = openStore({ path: ':memory:' });
  t.after(() => store.close());
  return store;
}

function source(id, text, overrides = {}) {
  return {
    id, version: 1, accountId: 'demo-lifecycle-family', studentId: 'student-one',
    reporter: 'student', language: 'en', kind: 'summary', synthetic: true,
    recordedAt: '2026-11-01T10:00:00.000Z', text, ...overrides,
  };
}

function observation(input, status, overrides = {}) {
  return { schemaVersion: 1, items: [{
    key: 'result', episodeKey: 'enrollment-confirmation', topic: 'enrollment', barrier: null,
    kind: 'outcome', status, statement: input.text, quote: input.text,
    reportedBy: input.reporter, language: input.language, occurredAt: null,
    linksTo: null, corrects: null, ...overrides,
  }] };
}

function correctedRecords() {
  const initial = source('result-positive', 'I received enrollment confirmation.');
  const correction = source('result-correction', 'Actually, I received an acknowledgment and confirmation is still pending.', {
    recordedAt: '2026-11-02T10:00:00.000Z',
  });
  return [
    { source: initial, extraction: observation(initial, 'positive') },
    { source: correction, extraction: observation(correction, 'pending', { corrects: 'result-positive@1#result' }) },
  ];
}

function episode(store) {
  return store.state().episodes.find(item => item.episodeKey === 'enrollment-confirmation');
}

function reverseObjectFields(value) {
  if (Array.isArray(value)) return value.map(reverseObjectFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectFields(item)]));
  }
  return value;
}

test('phase 3 regression — deleting a correction cannot resurrect the earlier incorrect positive claim', t => {
  const store = setup(t);
  store.importRecords(correctedRecords());
  assert.equal(episode(store).outcomeState, 'pending');
  store.deleteSource('result-correction');
  const current = episode(store);
  assert.equal(current.items.find(item => item.sourceId === 'result-positive').state, 'superseded');
  assert.equal(current.outcomeState, 'unknown');
  assert.equal(current.reviewState, 'needs-review');
  assert.ok(!store.state().sourceHistory.some(item => item.id === 'result-correction'));
});

test('phase 3 regression — revising a correction preserves uncertainty until current evidence is processed', t => {
  const store = setup(t);
  const records = correctedRecords();
  store.importRecords(records);
  const revised = { ...records[1].source, version: 2,
    text: 'I checked again and enrollment confirmation is still pending.',
    recordedAt: '2026-11-03T10:00:00.000Z' };
  const queued = store.ingest(revised, 'local-snapshot-v1');
  assert.equal(episode(store).items.find(item => item.sourceId === 'result-positive').state, 'superseded');
  assert.equal(episode(store).outcomeState, 'unknown');
  assert.equal(episode(store).reviewState, 'needs-review');
  const job = store.claim({ jobId: queued.id });
  store.complete(job, observation(revised, 'pending'));
  assert.equal(episode(store).outcomeState, 'pending');
  assert.ok(!episode(store).items.some(item => item.state === 'current' && item.status === 'positive'));
});

test('phase 3 regression — deleting the newest correction in a chain keeps earlier corrected claims suppressed', t => {
  const store = setup(t);
  const records = correctedRecords();
  const final = source('result-unclear', 'I am no longer sure what the message meant.', {
    recordedAt: '2026-11-03T10:00:00.000Z',
  });
  records.push({ source: final, extraction: observation(final, 'unknown', { corrects: 'result-correction@1#result' }) });
  store.importRecords(records);
  store.deleteSource(final.id);
  const current = episode(store);
  assert.ok(current.items.every(item => item.state === 'superseded'));
  assert.equal(current.outcomeState, 'unknown');
  assert.equal(current.reviewState, 'needs-review');
});

test('phase 2 regression — older extractor completion cannot overwrite a newer generation', t => {
  const store = setup(t);
  const input = source('generation-source', 'I received enrollment confirmation.');
  const oldQueued = store.ingest(input, 'extractor-v1');
  const oldJob = store.claim({ jobId: oldQueued.id });
  const newQueued = store.ingest(input, 'extractor-v2');
  const newJob = store.claim({ jobId: newQueued.id });
  assert.ok(newJob);
  store.complete(newJob, observation(input, 'positive', { statement: 'The student reports receiving enrollment confirmation.' }));
  assert.throws(() => store.complete(oldJob, observation(input, 'positive')), { code: 'stale_job_lease' });
  assert.equal(episode(store).items[0].extractorVersion, 'extractor-v2');
  assert.equal(episode(store).items[0].statement, 'The student reports receiving enrollment confirmation.');
});

test('phase 3 regression — disagreement between parent and student requires review', t => {
  const store = setup(t);
  const student = source('student-question', 'I still do not understand what enrollment means.');
  const parent = source('parent-question', 'I understand what enrollment means now.', {
    reporter: 'parent', recordedAt: '2026-11-02T10:00:00.000Z',
  });
  store.importRecords([
    { source: student, extraction: observation(student, 'open', { kind: 'question' }) },
    { source: parent, extraction: observation(parent, 'resolved', { kind: 'question' }) },
  ]);
  assert.equal(episode(store).questionState, 'conflicting');
  assert.equal(episode(store).reviewState, 'needs-review');
  assert.equal(episode(store).items.filter(item => item.state === 'current').length, 2);
});

test('phase 2 regression — reordered JSON and corrected-target references replay idempotently', t => {
  const store = setup(t);
  const records = demoSources().map(input => ({ source: input, extraction: demoExtraction(input) }));
  store.importRecords(records);
  const before = store.state();
  store.importRecords(reverseObjectFields(records));
  assert.deepEqual(store.state().metrics, before.metrics);
  assert.equal(store.state().jobs.length, before.jobs.length);
  assert.equal(store.state().sourceHistory.length, before.sourceHistory.length);
  assert.deepEqual(store.state().episodes, before.episodes);
});

for (const status of ['positive', 'pending']) {
  test(`phase 3 regression — later independent ${status} evidence can resolve removed evidence uncertainty`, t => {
    const store = setup(t);
    store.importRecords(correctedRecords());
    store.deleteSource('result-correction');
    const later = source(`later-${status}`, status === 'positive'
      ? 'Today the enrollment office confirmed my enrollment.'
      : 'Today the enrollment office confirmed my enrollment is still pending.', {
      recordedAt: '2026-11-04T10:00:00.000Z',
    });
    store.importRecords([{ source: later, extraction: observation(later, status) }]);
    const current = episode(store);
    assert.equal(current.outcomeState, status);
    assert.equal(current.reviewState, 'unreviewed');
    assert.equal(current.items.find(item => item.sourceId === 'result-positive').state, 'superseded');
  });
}

test('phase 3 regression — newer report of an older event cannot clear removed evidence uncertainty', t => {
  const store = setup(t);
  store.importRecords(correctedRecords());
  store.deleteSource('result-correction');
  const retrospective = source('later-retrospective', 'At 2026-11-01T10:00:00.000Z, before that correction, I thought my enrollment was confirmed.', {
    recordedAt: '2026-11-04T10:00:00.000Z',
  });
  store.importRecords([{ source: retrospective, extraction: observation(retrospective, 'positive', {
    occurredAt: '2026-11-01T10:00:00.000Z',
  }) }]);
  assert.equal(episode(store).outcomeState, 'unknown');
  assert.equal(episode(store).reviewState, 'needs-review');
});

test('phase 3 regression — another reporter or kind cannot clear removed outcome evidence', t => {
  const store = setup(t);
  store.importRecords(correctedRecords());
  store.deleteSource('result-correction');
  const parent = source('later-parent', 'I believe enrollment is confirmed.', {
    reporter: 'parent', recordedAt: '2026-11-04T10:00:00.000Z',
  });
  const action = source('later-student-action', 'I sent the enrollment office a question.', {
    recordedAt: '2026-11-05T10:00:00.000Z',
  });
  store.importRecords([
    { source: parent, extraction: observation(parent, 'positive') },
    { source: action, extraction: observation(action, 'completed', { kind: 'action' }) },
  ]);
  assert.equal(episode(store).outcomeState, 'unknown');
  assert.equal(episode(store).reviewState, 'needs-review');
});

test('phase 3 regression — removing the independent replacement restores uncertainty without reviving corrected claims', t => {
  const store = setup(t);
  store.importRecords(correctedRecords());
  store.deleteSource('result-correction');
  const replacement = source('replacement', 'Today enrollment confirmation is still pending.', {
    recordedAt: '2026-11-04T10:00:00.000Z',
  });
  store.importRecords([{ source: replacement, extraction: observation(replacement, 'pending') }]);
  assert.equal(episode(store).outcomeState, 'pending');
  store.deleteSource(replacement.id);
  assert.equal(episode(store).outcomeState, 'unknown');
  assert.ok(episode(store).items.every(item => item.state === 'superseded'));
});

test('phase 2 regression — replaying a completed snapshot does not cancel a newer running extractor', t => {
  const store = setup(t);
  const input = source('replay-during-extraction', 'I received enrollment confirmation.');
  const records = [{ source: input, extraction: observation(input, 'positive') }];
  store.importRecords(records);
  const queued = store.ingest(input, 'extractor-v2');
  const running = store.claim({ jobId: queued.id });
  store.importRecords(reverseObjectFields(records));
  assert.equal(store.state().jobs.find(job => job.id === queued.id).status, 'running');
  store.complete(running, observation(input, 'positive', { statement: 'Enrollment was confirmed according to the student.' }));
  assert.equal(episode(store).items[0].extractorVersion, 'extractor-v2');
  store.importRecords(records);
  assert.equal(episode(store).items[0].extractorVersion, 'extractor-v2');
});

test('phase 3 regression — event time outranks save time for retrospective outcome reports', t => {
  const store = setup(t);
  const earlier = source('reported-earlier', 'My enrollment was still pending at 2026-11-02T10:00:00.000Z.', {
    recordedAt: '2026-11-05T10:00:00.000Z',
  });
  const later = source('confirmed-later', 'My enrollment was confirmed at 2026-11-03T10:00:00.000Z.', {
    recordedAt: '2026-11-04T10:00:00.000Z',
  });
  store.importRecords([
    { source: later, extraction: observation(later, 'positive', { occurredAt: '2026-11-03T10:00:00.000Z' }) },
    { source: earlier, extraction: observation(earlier, 'pending', { occurredAt: '2026-11-02T10:00:00.000Z' }) },
  ]);
  assert.equal(episode(store).outcomeState, 'positive');
  assert.equal(episode(store).items.filter(item => item.state === 'current').length, 2);
});

test('phase 3 regression — upgrading an older isolated invalidation schema keeps missing evidence uncertain', t => {
  const path = resolve(localDirectory, `lifecycle-schema-${randomUUID()}.sqlite`);
  let store = openStore({ path });
  t.after(() => {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  });
  store.importRecords(correctedRecords());
  store.deleteSource('result-correction');
  const id = episode(store).id;
  store.close();
  const legacy = new DatabaseSync(path);
  legacy.exec(`DROP TABLE invalidations;
    CREATE TABLE invalidations (source_id TEXT NOT NULL, episode_id TEXT NOT NULL, kind TEXT NOT NULL,
      PRIMARY KEY(source_id,episode_id,kind));`);
  legacy.prepare('INSERT INTO invalidations VALUES (?, ?, ?)').run('result-correction', id, 'outcome');
  legacy.close();
  store = openStore({ path });
  assert.equal(episode(store).outcomeState, 'unknown');
  assert.equal(episode(store).reviewState, 'needs-review');
  assert.ok(episode(store).items.every(item => item.state === 'superseded'));
});
