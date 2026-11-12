import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserverState } from '../state.mjs';
import { createObserver } from '../observer.mjs';
import { createCompletedHistoryEvidence } from './completed-history.mjs';
import { createExplanationHistory } from './explanation-history.mjs';
import { buildDecisionRequest } from '../rubric.mjs';

const seed = { fictional: true, authorized: true, accountId: 'fictional-account', callId: 'fictional-call', studentId: 'fictional-student', language: 'en' };
function setup() {
  const state = createObserverState(seed);
  state.apply({ type: 'transcript', id: 'caller', role: 'user', text: 'Show me an example instead.', complete: true, startMs: 10, endMs: 30 });
  state.apply({ type: 'question', id: 'caller', text: 'Show me an example instead.' });
  const memory = createExplanationHistory();
  memory.append({ id: 'definition', role: 'assistant', text: 'A syllabus is a class guide.', complete: true,
    source: 'application_estimate', sourceEventIds: ['definition-source'], startMs: 1, endMs: 5 });
  return { state, snapshot: state.snapshot(), early: { ...seed, usable: true, connectionEpoch: 0,
    scopeEpoch: 3, explanationHistory: memory.snapshot() } };
}

test('captured history enriches only the request, preserving observer fingerprint validation', async () => {
  const f = setup(), history = createCompletedHistoryEvidence(), requests = [], records = [];
  assert.equal(history.capture(f.snapshot, f.early), true);
  assert.equal(Object.isFrozen(f.snapshot), true);
  assert.equal(f.state.matches(f.snapshot), true);
  assert.equal(Object.hasOwn(f.snapshot, 'explanationHistory'), false);
  const observer = createObserver({ state: f.state, mode: 'observe', policy: {
    version: 'history-test', buildRequest: snapshot => buildDecisionRequest(history.enrich(snapshot)),
    parseResponse: () => ({ status: 'completed', result: { supportNeed: 'concrete_example', alreadyAddressed: false } }),
    disposition: () => 'observe_only' },
    budget: { reserve: () => ({ id: 'reservation' }), settle() {} },
    client: { async evaluate(request) { requests.push(request); return { requestId: 'provider', response: { usage: {} } }; } },
    onRecord: row => { history.release(row.fingerprint); records.push(row); } });
  assert.equal(observer.observe(f.snapshot).queued, true); await observer.idle();
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].input).explanationHistory.rows[0].text, 'A syllabus is a class guide.');
  assert.equal(records[0].status, 'completed'); assert.equal(history.size(), 0);
  assert.equal(f.state.matches(f.snapshot), true); observer.close();
});

test('side evidence cannot cross account, student, language, connection or immutable scope boundaries', () => {
  const f = setup(), history = createCompletedHistoryEvidence();
  for (const key of ['callId', 'studentId', 'language', 'connectionEpoch']) {
    const mismatch = { ...f.early, [key]: typeof f.early[key] === 'number' ? 9 : 'other' };
    assert.equal(history.capture(f.snapshot, mismatch), false, key);
  }
  assert.equal(history.capture(f.snapshot, f.early), true);
  for (const key of ['accountId', 'callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch', 'permissionRevision']) {
    const changed = { ...f.snapshot, [key]: typeof f.snapshot[key] === 'number' ? 9 : 'other' };
    assert.equal(history.enrich(changed), changed, key);
  }
  assert.equal(history.enrich({ ...f.snapshot, authorized: false }).explanationHistory, undefined);
  f.state.apply({ type: 'invalidate' });
  assert.equal(f.state.matches(f.snapshot), false, 'history enrichment never bypasses existing freshness fencing');
});

test('duplicate captures do not rewrite pending evidence and clear/eviction remain bounded', () => {
  const f = setup(), history = createCompletedHistoryEvidence({ maximum: 1 });
  history.capture(f.snapshot, f.early);
  f.early.explanationHistory.rows[0].text = 'A different later explanation.';
  assert.equal(history.capture(f.snapshot, f.early), false);
  assert.equal(history.enrich(f.snapshot).explanationHistory.rows[0].text, 'A syllabus is a class guide.');
  const copy = history.enrich(f.snapshot); copy.explanationHistory.rows[0].text = 'mutated';
  assert.equal(history.enrich(f.snapshot).explanationHistory.rows[0].text, 'A syllabus is a class guide.');
  f.state.apply({ type: 'invalidate' }); const next = f.state.snapshot();
  history.capture(next, f.early); assert.equal(history.size(), 1);
  assert.equal(history.enrich(f.snapshot), f.snapshot);
  history.clear(); assert.equal(history.enrich(next), next);
});
