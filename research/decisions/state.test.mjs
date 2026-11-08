import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserverState, OBSERVER_STATE_LIMITS } from './state.mjs';

const seed = () => ({ fictional: true, accountId: 'fictional-account', callId: 'fictional-call', studentId: 'fictional-student-a', language: 'en', role: 'family', brief: { interests: ['science'] } });
const transcript = (overrides = {}) => ({ type: 'transcript', id: 'span-1', role: 'user', text: 'How do I begin?', startMs: 0, endMs: 1000, complete: true, ...overrides });
const finding = (overrides = {}) => ({ type: 'finding', id: 'finding-1', jobId: 'job-1', revision: 1, fact: 'An appointment is available.', year: '2026', scenario: 'First-time family inquiry', limitation: 'Availability must be confirmed before attending.', sourceIds: ['fictional-source-1'], ...overrides });
const stamp = (snapshot) => Object.fromEntries(['accountId', 'callId', 'studentId', 'permissionRevision', 'connectionEpoch', 'scopeEpoch', 'questionRevision', 'inputRevision'].map((key) => [key, snapshot[key]]));

test('nonfictional seeds require explicit isolated-copy provenance and snapshots cannot mutate state', () => {
  assert.throws(() => createObserverState({ ...seed(), fictional: false }), /fictional_data_required/);
  const initial = seed();
  const observer = createObserverState(initial);
  initial.brief.interests.push('changed outside observer');
  const snapshot = observer.snapshot();
  assert.deepEqual(snapshot.brief.interests, ['science']);
  assert(Object.isFrozen(snapshot.brief.interests));
  assert.throws(() => snapshot.brief.interests.push('mutate'), TypeError);
  assert.equal(observer.matches(snapshot), true);
  assert.equal(observer.matches({ ...snapshot, studentId: 'fictional-other-student' }), false);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test('isolated account copies retain truthful provenance and do not bypass scope checks', () => {
  const state = createObserverState({ ...seed(), fictional: false, isolatedLocal: true, dataKind: 'isolated-copy' });
  const snapshot = state.snapshot();
  assert.equal(snapshot.fictional, false);
  assert.equal(snapshot.dataKind, 'isolated-copy');
  assert.equal(state.matches(snapshot), true);
  assert.equal(state.matches({ ...snapshot, accountId: 'other' }), false);
});

test('native invalidation and same-student context updates fence stale decisions', () => {
  const state = createObserverState(seed());
  state.apply(transcript());
  const before = state.snapshot();
  assert.equal(state.apply({ type: 'invalidate' }).accepted, true);
  assert.equal(state.matches(before), false);
  const revised = state.snapshot();
  state.apply({ type: 'context', language: 'es' });
  assert.equal(state.matches(revised), false);
  assert.equal(state.snapshot().recentTranscripts.length, 1);
  assert.equal(state.snapshot().language, 'es');
});

test('playback evidence is retained without invalidating transcript-only classification', () => {
  const state = createObserverState(seed());
  state.apply(transcript());
  const before = state.snapshot();
  state.apply({ type: 'playback', id: 'play1', state: 'playing', atMs: 10 });
  assert.equal(state.matches(before), true);
  assert.equal(state.snapshot().playbackEvidence.length, 1);
  assert.equal(state.matches({ ...before, playbackEvidence: [{ state: 'ended' }] }), false);
});

test('a partial span is accumulated explicitly and never treated as a completed question', () => {
  const observer = createObserverState(seed());
  assert.equal(observer.apply(transcript({ text: 'How do I', endMs: 400, complete: false })).accepted, true);
  assert.equal(observer.snapshot().currentQuestion, null);
  assert.equal(observer.snapshot().recentTranscripts[0].complete, false);
  assert.equal(observer.apply(transcript()).accepted, true);
  assert.equal(observer.snapshot().recentTranscripts.length, 1);
  assert.equal(observer.snapshot().recentTranscripts[0].text, 'How do I begin?');
  assert.deepEqual(observer.apply(transcript({ text: 'How', endMs: 200, complete: false })), { accepted: false, reason: 'finalized_transcript' });
});

test('changed questions invalidate work captured against an earlier snapshot', () => {
  const observer = createObserverState(seed());
  observer.apply({ type: 'question', id: 'q1', text: 'How much does it cost?' });
  const before = observer.snapshot();
  observer.apply({ type: 'question', id: 'q2', text: 'Actually, where do I apply?' });
  assert.equal(observer.matches(before), false);
  assert.equal(observer.apply(finding({ stamp: stamp(before) })).reason, 'stale_questionRevision');
  assert.equal(observer.snapshot().researchFindings.length, 0);
  assert.equal(observer.snapshot().questionRevision, 2);
});

test('student changes clear prior context and reject late results from the previous student', () => {
  const observer = createObserverState(seed());
  observer.apply(transcript());
  observer.apply(finding());
  observer.apply({ type: 'opportunity', id: 'o1', kind: 'clarification', status: 'pending' });
  const previous = observer.snapshot();
  assert.equal(observer.apply({ type: 'scope', studentId: 'fictional-student-b', language: 'es', brief: 'Le interesa el arte.', stamp: stamp(previous) }).accepted, true);
  const next = observer.snapshot();
  assert.equal(next.studentId, 'fictional-student-b');
  assert.equal(next.language, 'es');
  assert.equal(next.scopeEpoch, 1);
  assert.equal(next.recentTranscripts.length, 0);
  assert.equal(next.researchFindings.length, 0);
  assert.equal(next.opportunities.length, 0);
  assert.equal(observer.apply(finding({ stamp: stamp(previous) })).reason, 'stale_studentId');
  assert.equal(observer.apply(finding({ stamp: { studentId: null } })).reason, 'stale_studentId');
});

test('transcript completion and context acknowledgment never become evidence of playback', () => {
  const observer = createObserverState(seed());
  observer.apply(transcript({ role: 'assistant', text: 'Podemos dar un paso a la vez.' }));
  observer.apply({ type: 'context_ack', id: 'append-1', kind: 'thinking', atMs: 1500 });
  let current = observer.snapshot();
  assert.equal(current.playbackEvidence.length, 0);
  assert.equal(current.contextAcknowledgments.length, 1);
  assert.equal(JSON.stringify(current).includes('heard'), false);
  observer.apply({ type: 'playback', id: 'audio-1', state: 'interrupted', atMs: 1800, playedMs: 200 });
  current = observer.snapshot();
  assert.equal(current.playbackEvidence[0].state, 'interrupted');
  assert.equal(current.recentTranscripts[0].complete, true);
});

test('reconnect invalidates old results and does not carry delivery acknowledgments forward', () => {
  const observer = createObserverState(seed());
  observer.apply({ type: 'context_ack', id: 'append-1' });
  observer.apply({ type: 'playback', id: 'audio-1', state: 'ended', atMs: 3000 });
  const old = observer.snapshot();
  observer.apply({ type: 'reconnect' });
  const next = observer.snapshot();
  assert.equal(next.connectionEpoch, 1);
  assert.equal(next.contextAcknowledgments.length, 0);
  assert.equal(next.playbackEvidence.length, 0);
  assert.deepEqual(next.connectionGaps, [{ previousConnectionEpoch: 0, connectionEpoch: 1,
    atMs: null, reason: 'connection_reestablished', transcriptContinuity: 'unknown' }]);
  assert.equal(observer.matches(old), false);
  assert.equal(observer.apply(transcript({ stamp: stamp(old) })).reason, 'stale_connectionEpoch');
});

test('connection gaps preserve uncertainty about an unfinished utterance', () => {
  const observer = createObserverState(seed());
  observer.apply(transcript({ text: 'Quería preguntar sobre', complete: false }));
  observer.apply({ type: 'reconnect', reason: 'transport_lost', atMs: 1100 });
  const current = observer.snapshot();
  assert.equal(current.recentTranscripts[0].complete, false);
  assert.equal(current.connectionGaps[0].transcriptContinuity, 'unknown');
  assert.equal(current.connectionGaps[0].reason, 'transport_lost');
  assert.equal(current.currentQuestion, null);
});

test('revocation removes context and closing invalidates otherwise current results', () => {
  const observer = createObserverState(seed());
  observer.apply(finding());
  const before = observer.snapshot();
  observer.apply({ type: 'revoke' });
  assert.equal(observer.matches(before), false);
  assert.equal(observer.matches(observer.snapshot()), false);
  assert.equal(observer.snapshot().brief, null);
  assert.equal(observer.snapshot().researchFindings.length, 0);
  assert.equal(observer.snapshot().permissionRevision, 1);
  assert.equal(observer.apply(transcript()).reason, 'not_authorized');
  assert.equal(observer.apply({ type: 'close' }).accepted, true);
  assert.equal(observer.apply({ type: 'reconnect' }).reason, 'closed');
  const separate = createObserverState(seed());
  const current = separate.snapshot();
  separate.apply({ type: 'close' });
  assert.equal(separate.matches(current), false);
});

test('a corrected finding replaces one version atomically and rejects old or conflicting versions', () => {
  const observer = createObserverState(seed());
  observer.apply(finding());
  observer.apply(finding({ revision: 2, fact: 'The office requires a different appointment.' }));
  assert.equal(observer.snapshot().researchFindings.length, 1);
  assert.equal(observer.apply(finding()).reason, 'stale_finding');
  assert.equal(observer.apply(finding({ revision: 2, fact: 'Conflicting result' })).reason, 'conflicting_finding_revision');
  assert.equal(observer.snapshot().researchFindings[0].limitation, finding().limitation);
});

test('an addressed opportunity belongs to its original question, not every later request of that kind', () => {
  const observer = createObserverState(seed());
  observer.apply({ type: 'question', id: 'q1', text: 'How do I begin exploring college?' });
  observer.apply({ type: 'opportunity', id: 'help-1', kind: 'starting_point', status: 'addressed', questionRevision: 1 });
  observer.apply({ type: 'question', id: 'q2', text: 'Now, how do I begin asking for tutoring?' });
  const current = observer.snapshot();
  assert.equal(current.questionRevision, 2);
  assert.equal(current.opportunities[0].questionRevision, 1);
  assert.equal(observer.apply({ type: 'opportunity', id: 'late-help', kind: 'starting_point', status: 'addressed', questionRevision: 1 }).reason, 'stale_questionRevision');
  assert.equal(observer.snapshot().opportunities.length, 1);
});

test('duplicate events do not churn fingerprints and rejected events leave state intact', () => {
  const observer = createObserverState(seed());
  observer.apply(transcript());
  const current = observer.snapshot();
  assert.equal(observer.apply(transcript()).reason, 'duplicate');
  assert.equal(observer.matches(current), true);
  assert.equal(observer.apply(transcript({ id: 'different', startMs: 1000, endMs: 0 })).reason, 'invalid_transcript');
  assert.deepEqual(observer.snapshot(), current);
});

test('long histories are bounded in bytes and findings retain complete qualifications', () => {
  const observer = createObserverState(seed());
  for (let index = 0; index < 60; index += 1) {
    assert.equal(observer.apply(transcript({ id: `span-${index}`, text: 'ñ'.repeat(1000), startMs: index * 1000, endMs: (index + 1) * 1000 })).accepted, true);
    assert.equal(observer.apply(finding({ id: `finding-${index}`, fact: 'A'.repeat(2300), limitation: 'L'.repeat(1000), scenario: 'S'.repeat(500) })).accepted, true);
  }
  const current = observer.snapshot();
  assert(Buffer.byteLength(JSON.stringify(current), 'utf8') <= OBSERVER_STATE_LIMITS.bytes);
  assert(current.recentTranscripts.length <= OBSERVER_STATE_LIMITS.transcripts);
  assert.equal(current.recentTranscripts.at(-1).id, 'span-59');
  assert(current.researchFindings.length <= OBSERVER_STATE_LIMITS.findings);
  assert(current.researchFindings.some((item) => item.id === 'finding-59'));
  for (const item of current.researchFindings) {
    assert.equal(item.fact.length, 2300);
    assert.equal(item.limitation.length, 1000);
    assert.equal(item.scenario.length, 500);
    assert.equal(item.year, '2026');
    assert.deepEqual(item.sourceIds, ['fictional-source-1']);
  }
});

test('oversized text is rejected rather than silently trimming qualifying information', () => {
  const observer = createObserverState(seed());
  const before = observer.snapshot();
  assert.equal(observer.apply(finding({ limitation: 'ñ'.repeat(600) })).reason, 'invalid_limitation');
  assert.equal(observer.apply(transcript({ text: 'ñ'.repeat(1100) })).reason, 'invalid_text');
  assert.equal(observer.matches(before), true);
});

const researchTask = (overrides = {}) => ({ type: 'research_task', jobId: 'fictional-job', revision: 1,
  question: 'What is the published total?', status: 'running', evidenceVersion: 1, evidenceAvailability: 'available',
  findings: [{ fact: 'The published total is USD 40,000.', year: '2026–27', scenario: 'Off-campus undergraduate academic year',
    limitation: 'Before aid; not the individual bill.', status: 'verified', subject: 'Fictional college', aspect: 'total_budget', sourceIds: ['1'] }], ...overrides });

test('research task snapshots keep completion, qualification and playback as separate evidence', () => {
  const state = createObserverState(seed());
  state.apply(transcript());
  assert.equal(state.apply(researchTask()).accepted, true);
  const partial = state.snapshot();
  assert.equal(partial.researchTasks[0].status, 'running');
  assert.equal(partial.researchTasks[0].findings[0].limitation, researchTask().findings[0].limitation);
  assert.equal(state.apply(researchTask({ revision: 2, status: 'completed', evidenceVersion: 2 })).accepted, true);
  assert.equal(state.matches(partial), false);
  assert.equal(state.snapshot().playbackEvidence.length, 0);
  assert.equal(state.apply(researchTask()).reason, 'stale_research_task');
  assert.equal(state.apply(researchTask({ revision: 2, status: 'completed', evidenceVersion: 2 })).reason, 'duplicate');
  assert.equal(state.apply(researchTask({ revision: 2, status: 'failed' })).reason, 'conflicting_research_revision');
  assert.equal(state.apply(researchTask({ revision: 3, status: 'completed', evidenceAvailability: 'missing', findings: [] })).accepted, true);
  assert.equal(state.snapshot().researchTasks[0].findings.length, 0);
  assert.equal(state.snapshot().researchTasks[0].evidenceAvailability, 'missing');
});

test('research tasks reject inconsistent/oversized evidence and clear across student scopes', () => {
  const state = createObserverState(seed());
  state.apply(researchTask());
  const initial = state.snapshot();
  for (const invalid of [researchTask({ revision: 2, status: 'cancelled' }),
    researchTask({ revision: 2, evidenceAvailability: 'missing' }),
    researchTask({ revision: 2, findings: [] }),
    researchTask({ revision: 2, findings: [{ ...researchTask().findings[0], limitation: 'x'.repeat(2049) }] })]) {
    assert.equal(state.apply(invalid).accepted, false);
    assert.deepEqual(state.snapshot(), initial);
  }
  state.apply({ type: 'scope', studentId: 'fictional-second' });
  assert.equal(state.snapshot().researchTasks.length, 0);
  assert.equal(state.apply(researchTask({ stamp: stamp(initial) })).reason, 'stale_studentId');
});

test('bounded research jobs preserve whole facts and do not crowd out the caller', () => {
  const state = createObserverState(seed());
  state.apply(transcript());
  for (let i = 0; i < 30; i++) assert.equal(state.apply(researchTask({ jobId: `job-${i}` })).accepted, true);
  const snapshot = state.snapshot();
  assert.equal(snapshot.researchTasks.length, OBSERVER_STATE_LIMITS.researchTasks);
  assert.equal(snapshot.researchTasks.at(-1).jobId, 'job-29');
  assert.equal(snapshot.recentTranscripts.length, 1);
  assert.equal(snapshot.researchTasks.every(task => JSON.stringify(task.findings) === JSON.stringify(researchTask().findings)), true);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= OBSERVER_STATE_LIMITS.bytes);
});
