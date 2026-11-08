import test from 'node:test';
import assert from 'node:assert/strict';
import { createEarlyEvaluator } from './early-evaluator.mjs';
import { createEarlySupportDelivery } from './early-support-delivery.mjs';
import { EARLY_RUBRIC_VERSION, EARLY_QUESTION_COUNT } from './early-rubric.mjs';
import { earlyResponseFixture } from './early-fixtures.mjs';

const usage = { input_tokens: 100, output_tokens: 0, total_tokens: 100,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
const response = (options = {}) => ({ ...earlyResponseFixture(options), usage });
const outcome = answer => ({ response: answer ?? response(), requestId: 'req_fictional', durationMs: 140 });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeBudget() {
  const rows = [];
  return { rows,
    reserve(request) {
      const row = { id: 'reservation-' + rows.length, request, state: 'reserved', reservedUsd: .05 };
      rows.push(row); return { id: row.id };
    },
    settle(id, value) {
      if (!value || value.input_tokens !== 100) throw Object.assign(Error('invalid usage'), { code: 'invalid_usage' });
      const row = rows.find(item => item.id === id); row.state = 'settled'; row.usage = value;
      return { costUsd: .00001 };
    },
    markUnknown(id, reason) { const row = rows.find(item => item.id === id); row.state = 'unknown'; row.reason = reason; },
    summary() { return { requestCount: rows.length,
      reservedUsd: rows.filter(row => row.state !== 'settled').length * .05,
      spentUsd: rows.filter(row => row.state === 'settled').length * .00001 }; },
  };
}
function fixture({ language = 'en', evaluate, maxEvaluations, onResult } = {}) {
  let at = 1000;
  const stamp = { callId: 'fictional-call', studentId: 'fictional-student', language,
    connectionEpoch: 0, scopeEpoch: 0, contributionId: 'input-1', revision: 1 };
  let current = { ...stamp, stamp, provisional: true, complete: false, inputOpen: true,
    usable: true, text: language === 'es' ? 'No entiendo qué hace un asesor académico.' : 'I do not understand what an academic advisor does.',
    sourceEventIds: ['event-1'], lastObservedAtMs: at - 200, startMs: 100, endMs: 900,
    recentDialogue: [], supportRevision: 0, assistantOutputRevision: 0, assistantOutputStartedForContribution: false };
  const logs = [], candidates = [], requests = [], budget = fakeBudget();
  const client = { async evaluate(request, options) {
    requests.push({ request, options });
    return evaluate ? evaluate(request, options) : outcome();
  } };
  const runner = createEarlyEvaluator({ client, budget, current: () => current, now: () => at,
    log: row => logs.push(row), onResult: candidate => { candidates.push(candidate); onResult?.(candidate); },
    ...(maxEvaluations === undefined ? {} : { maxEvaluations }) });
  return { runner, budget, logs, candidates, requests, snapshot: () => structuredClone(current),
    current: () => current, set: values => { current = { ...current, ...values }; },
    revise() { at += 50; current = { ...current, revision: current.revision + 1,
      stamp: { ...current.stamp, revision: current.stamp.revision + 1 },
      sourceEventIds: [...current.sourceEventIds, 'event-' + current.revision + '-new'],
      lastObservedAtMs: at, text: current.text + (language === 'es' ? ' Ya lo entiendo.' : ' I understand now.') }; },
  };
}

for (const language of ['en', 'es']) test(`${language}: evaluator returns typed evidence with correlated usage and no speech claim`, async () => {
  const f = fixture({ language }); const snapshot = f.snapshot();
  await f.runner.evaluate(snapshot); await f.runner.idle();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].request.questions.length, EARLY_QUESTION_COUNT);
  assert.equal(f.requests[0].request.model, 'gpt-6-luna');
  assert.equal(f.budget.rows[0].state, 'settled');
  assert.equal(f.budget.rows[0].request.metadata.callId, snapshot.callId);
  assert.match(f.budget.rows[0].request.metadata.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(f.candidates.length, 1);
  const candidate = f.candidates[0];
  assert.equal(candidate.type, 'early_candidate'); assert.deepEqual(candidate.stamp, snapshot.stamp);
  assert.equal(candidate.record.callId, snapshot.callId); assert.equal(candidate.record.studentId, snapshot.studentId);
  assert.deepEqual(candidate.record.sourceEventIds, snapshot.sourceEventIds);
  assert.equal(candidate.record.freshAtWorker, true); assert.equal(candidate.record.requestId, 'req_fictional');
  assert.equal(candidate.record.sourceText, snapshot.text); assert.equal(candidate.record.supportRevision, snapshot.supportRevision);
  assert.equal(candidate.record.assistantOutputRevision, snapshot.assistantOutputRevision);
  assert.equal(candidate.record.policyDecision.reason, 'support_eligible');
  const started = f.logs.find(row => row.type === 'early_decisions_started');
  const completed = f.logs.find(row => row.type === 'early_decisions_completed');
  assert.equal(started.operationId, completed.operationId); assert.equal(completed.operationId, candidate.record.operationId);
  assert.equal(completed.rubricVersion, EARLY_RUBRIC_VERSION); assert.equal(completed.durationMs, 140);
  assert.equal(completed.costUsd, .00001); assert.deepEqual(completed.usage, usage);
  assert.ok(f.logs.every(row => row.contextSent === false && row.playbackClaim === false));
  assert.ok(!JSON.stringify(f.logs).includes(snapshot.text), 'diagnostics do not copy raw caller text');
  assert.deepEqual(f.runner.status(), { closed: false, evaluations: 1, pending: 0 });
});

test('obsolete classification retains usage but cannot pass the independent parent delivery gate', async () => {
  const pending = deferred(); let f;
  const sends = [], gates = [];
  const delivery = createEarlySupportDelivery({ enabled: true, getEvidence: () => f.current(),
    canDeliver: () => null, now: () => 1000, send: (...args) => sends.push(args) });
  f = fixture({ evaluate: () => pending.promise, onResult: candidate => gates.push(delivery.consider(candidate)) });
  const work = f.runner.evaluate(f.snapshot());
  f.revise(); pending.resolve(outcome()); await work;
  assert.equal(f.budget.rows[0].state, 'settled'); assert.equal(f.candidates.length, 1);
  assert.equal(f.candidates[0].record.freshAtWorker, false);
  assert.equal(gates[0].reason, 'stale_evidence'); assert.equal(sends.length, 0);
  assert.equal(delivery.status().activeSupport, false);
});

test('closed evaluator aborts its request and never forwards a result, even if transport still resolves', async () => {
  const pending = deferred(); const f = fixture({ evaluate: () => pending.promise });
  const work = f.runner.evaluate(f.snapshot());
  assert.equal(f.requests[0].options.signal.aborted, false);
  f.runner.close(); assert.equal(f.requests[0].options.signal.aborted, true);
  pending.resolve(outcome()); await work; await f.runner.idle();
  assert.equal(f.budget.rows[0].state, 'settled'); assert.equal(f.candidates.length, 0);
  assert.equal(f.logs.find(row => row.type === 'early_decisions_completed').freshAtWorker, false);
  assert.deepEqual(f.runner.status(), { closed: true, evaluations: 1, pending: 0 });
});

test('closed or stale evidence never reserves or requests new inference', async () => {
  for (const closed of [false, true]) {
    const f = fixture(); const snapshot = f.snapshot();
    if (closed) f.runner.close(); else f.revise();
    await f.runner.evaluate(snapshot);
    assert.equal(f.requests.length, 0); assert.equal(f.budget.rows.length, 0); assert.equal(f.candidates.length, 0);
    assert.equal(f.logs.at(-1).reason, closed ? 'closed' : 'stale_before_request');
  }
});

test('one evaluator makes at most eight requests per call', async () => {
  const f = fixture();
  for (let n = 0; n < 10; n++) { await f.runner.evaluate(f.snapshot()); f.revise(); }
  assert.equal(f.requests.length, 8); assert.equal(f.budget.rows.length, 8);
  assert.equal(f.runner.status().evaluations, 8);
  assert.equal(f.logs.filter(row => row.type === 'early_decisions_skipped' && row.reason === 'call_limit').length, 2);
});

test('in-flight observation yields immediately and does not block application work', async () => {
  const pending = deferred(); const f = fixture({ evaluate: () => pending.promise });
  let applicationProgress = 0;
  const work = f.runner.evaluate(f.snapshot());
  applicationProgress++;
  await Promise.resolve(); applicationProgress++;
  assert.equal(applicationProgress, 2); assert.equal(f.runner.status().pending, 1);
  assert.equal(f.candidates.length, 0); assert.equal(f.budget.rows[0].state, 'reserved');
  pending.resolve(outcome()); await work; await f.runner.idle();
  assert.equal(f.runner.status().pending, 0);
});

for (const [name, evaluate, expectedReason] of [
  ['missing provider usage', () => outcome({ ...response(), usage: null }), 'invalid_usage'],
  ['network failure', () => Promise.reject(Object.assign(Error('private provider text'), { code: 'network_error' })), 'network_error'],
  ['abort after reservation', (_request, { signal }) => new Promise((_resolve, reject) =>
    signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { code: 'aborted' })), { once: true })), 'aborted'],
]) test(`${name} preserves the reservation and produces no candidate`, async () => {
  const f = fixture({ evaluate }); const work = f.runner.evaluate(f.snapshot());
  if (expectedReason === 'aborted') f.runner.close();
  await work; await f.runner.idle();
  assert.equal(f.budget.rows[0].state, 'unknown'); assert.equal(f.budget.summary().reservedUsd, .05);
  assert.equal(f.candidates.length, 0);
  const failure = f.logs.find(row => row.type === 'early_decisions_failed');
  assert.equal(failure.reason, expectedReason); assert.equal(failure.reservationRetained, true);
  assert.ok(!JSON.stringify(f.logs).includes('private provider text'));
});

test('an invalid request is rejected before reserving or spending', async () => {
  const f = fixture(); f.set({ text: 'x'.repeat(4097) });
  await f.runner.evaluate(f.snapshot());
  assert.equal(f.requests.length, 0); assert.equal(f.budget.rows.length, 0); assert.equal(f.candidates.length, 0);
  assert.equal(f.runner.status().evaluations, 0);
  const failure = f.logs.find(row => row.type === 'early_decisions_failed');
  assert.equal(failure.reason, 'invalid_early_evidence'); assert.equal(failure.reservationRetained, false);
});

test('a refused dimension retains other facts but its policy verdict withholds support', async () => {
  const answer = response(); answer.answers[0] = { type: 'refusal', name: 'simplify_requested' };
  const f = fixture({ evaluate: () => outcome(answer) }); await f.runner.evaluate(f.snapshot());
  assert.equal(f.budget.rows[0].state, 'settled'); assert.equal(f.candidates.length, 1);
  assert.equal(f.candidates[0].record.policyDecision.reason, 'need_refused');
  assert.equal(f.candidates[0].record.policyDecision.eligible, false);
});

test('malformed answers settle known usage without becoming candidates', async () => {
  const f = fixture({ evaluate: () => outcome({ ...response(), answers: response().answers.reverse() }) });
  await f.runner.evaluate(f.snapshot());
  assert.equal(f.budget.rows[0].state, 'settled'); assert.equal(f.candidates.length, 0);
  assert.equal(f.logs.find(row => row.type === 'early_decisions_completed').status, 'invalid');
});

for (const field of ['supportRevision', 'assistantOutputRevision']) test(`${field} changes make in-flight evidence stale`, async () => {
  const pending = deferred(); const f = fixture({ evaluate: () => pending.promise });
  const work = f.runner.evaluate(f.snapshot()); f.set({ [field]: 1 });
  pending.resolve(outcome()); await work;
  assert.equal(f.budget.rows[0].state, 'settled'); assert.equal(f.candidates.length, 1);
  assert.equal(f.candidates[0].record.freshAtWorker, false);
  assert.equal(f.candidates[0].record[field], 0);
});
