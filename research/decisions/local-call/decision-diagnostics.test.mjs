import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionDiagnostics } from './decision-diagnostics.mjs';

const snapshot = (fingerprint = 'snapshot-1') => ({ callId: 'call-1', studentId: 'student-1', fingerprint,
  currentQuestion: { id: 'user:turn-1', text: 'PRIVATE_TRANSCRIPT' }, recentTranscripts: [{ id: 'user:turn-1', role: 'user', complete: true, text: 'PRIVATE_TRANSCRIPT' }],
  researchTasks: [], researchFindings: [], scopeEpoch: 2, connectionEpoch: 1, questionRevision: 3, inputRevision: 5, authorized: true });
const request = () => ({ model: 'gpt-6-luna', input: 'PRIVATE_TRANSCRIPT', questions: [{ name: 'support_need', type: 'choice', instructions: 'PRIVATE_PROMPT' }], prompt_cache_options: { mode: 'explicit' } });
const usage = { input_tokens: 1000, output_tokens: 10, total_tokens: 1010,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
function harness() {
  let time = 100, reservations = 0, spent = 0;
  const events = [];
  const diagnostics = createDecisionDiagnostics({ log: event => events.push(event), now: () => time, rubricVersion: 'test-policy-1' });
  const budget = diagnostics.wrapBudget({
    reserve() { reservations++; return { id: `reservation-${reservations}` }; },
    settle() { spent = .0001; return { costUsd: spent, reservedUsd: .05, exceededReservation: false }; },
    markUnknown() {}, summary: () => ({ capUsd: 1.5, spentUsd: spent, reservationUsd: .05 }), close() {},
  });
  const policy = diagnostics.wrapPolicy({ version: 'test-policy-1', buildRequest: request,
    parseResponse: () => ({ status: 'completed', reason: null, result: { supportNeed: 'none', preferenceChanges: [
      { preference: 'plain_language', action: 'enable', confidence: .99, selectedProbability: .99 },
    ] } }), disposition: () => 'observed' });
  return { diagnostics, events, budget, policy, advance: ms => { time += ms; } };
}

test('lifecycle links snapshot, turn, operation, provider request and reservation; queue/API/parse/total timing stay distinct', async () => {
  const h = harness(), state = snapshot(); h.diagnostics.offer(state); h.advance(20);
  const input = h.policy.buildRequest(state);
  h.budget.reserve({ operationId: 'operation-1', metadata: { snapshotHash: state.fingerprint } });
  h.diagnostics.receipt(state, { queued: true }); h.advance(2);
  const client = h.diagnostics.wrapClient({ async evaluate(value) { assert.equal(value, input); h.advance(220); return {
    response: { model: 'gpt-6-luna', answers: [], usage, ignoredText: 'PRIVATE_RESPONSE' }, requestId: 'req-1', durationMs: 218,
  }; } });
  const outcome = await client.evaluate(input); h.budget.settle('reservation-1', usage); h.advance(1);
  const parsed = h.policy.parseResponse(outcome.response);
  h.diagnostics.finish({ ...state, operationId: 'operation-1', requestId: 'req-1', status: 'discarded', reason: 'stale_after_request', result: parsed.result, durationMs: 218 });
  const prepared = h.events.find(event => event.type === 'decisions_request_prepared');
  assert.equal(prepared.queueWaitMs, 20); assert.equal(prepared.inputBytes, Buffer.byteLength('PRIVATE_TRANSCRIPT'));
  const completed = h.events.find(event => event.type === 'decisions_api_completed');
  assert.equal(completed.operationId, 'operation-1'); assert.equal(completed.requestId, 'req-1');
  assert.equal(completed.reservationId, 'reservation-1'); assert.equal(completed.transportAndJsonMs, 218);
  assert.equal(completed.clientAwaitMs, 220); assert.equal(completed.usage.inputTokens, 1000);
  const finished = h.events.at(-1);
  assert.equal(finished.stale, true); assert.equal(finished.totalWorkerMs, 243); assert.equal(finished.costUsd, .0001);
  assert.deepEqual(finished.sourceTranscriptIds, ['user:turn-1']); assert.equal(finished.questionId, 'user:turn-1');
  assert.ok(h.events.every(event => event.contextSent === false && event.playbackClaim === false && event.schemaVersion === 1));
  assert.equal(JSON.stringify(h.events).includes('PRIVATE_'), false);
  assert.deepEqual(h.events.map(event => event.sequence), h.events.map((_, index) => index + 1));
});

test('timeout logs uncertainty and preserved reservation without provider error text or credentials', async () => {
  const h = harness(), state = snapshot(); h.diagnostics.offer(state);
  const input = h.policy.buildRequest(state); h.budget.reserve({ operationId: 'operation-2', metadata: { snapshotHash: state.fingerprint } });
  const client = h.diagnostics.wrapClient({ async evaluate() {
    h.advance(15000); const error = Error('PRIVATE_PROVIDER_TEXT'); Object.assign(error, { code: 'timeout', requestId: 'req-timeout', durationMs: 15000 }); throw error;
  } });
  await assert.rejects(client.evaluate(input), /PRIVATE_PROVIDER_TEXT/);
  h.budget.markUnknown('reservation-1', 'timeout');
  const failure = h.events.find(event => event.type === 'decisions_api_failed');
  assert.equal(failure.requestId, 'req-timeout'); assert.equal(failure.usageKnown, false);
  assert.equal(failure.outcome, 'cancelled_or_timed_out_locally_provider_completion_unknown');
  assert.equal(h.events.at(-1).reservationRetained, true);
  assert.equal(JSON.stringify(h.events).includes('PRIVATE_'), false);
});

test('preparation failure and coalesced/skipped snapshots retain attribution without claiming an API call', () => {
  const h = harness(), state = snapshot('pending-1'); h.diagnostics.offer(state); h.advance(12);
  h.diagnostics.finish({ ...state, status: 'skipped', reason: 'coalesced' });
  assert.equal(h.events.at(-1).operationId, null); assert.equal(h.events.at(-1).transportAndJsonMs, null);
  assert.equal(h.events.at(-1).totalWorkerMs, 12);
  const failPolicy = h.diagnostics.wrapPolicy({ version: 'test', buildRequest() { throw Error('ineligible_snapshot'); } });
  h.diagnostics.offer(snapshot('invalid-1'));
  assert.throws(() => failPolicy.buildRequest(snapshot('invalid-1')), /ineligible_snapshot/);
  h.diagnostics.finish({ ...snapshot('invalid-1'), status: 'unavailable', reason: 'ineligible_snapshot' });
  h.diagnostics.receipt(snapshot('invalid-1'), { queued: true });
  assert.equal(h.events.at(-1).fingerprint, 'invalid-1'); assert.equal(h.events.at(-1).callId, 'call-1');
  assert.equal(h.events.some(event => event.type === 'decisions_api_started'), false);
});

test('candidate forwarding explicitly awaits eligibility and never claims context delivery', () => {
  const h = harness(); h.diagnostics.candidate('lasting_preference', { ...snapshot(), operationId: 'operation-3', requestId: 'req-3',
    status: 'discarded', reason: 'stale_after_request' }, { questionId: 'user:turn-1', inputRevision: 9 });
  assert.equal(h.events[0].sourceStatus, 'discarded');
  assert.equal(h.events[0].eligibility, 'awaiting_parent_scope_confidence_and_playback_checks');
  assert.equal(h.events[0].broadResearchActionAuthorized, false); assert.equal(h.events[0].contextSent, false);
});

test('duplicate offers preserve active request attribution and original queue clock', async () => {
  const h = harness(), state = snapshot(); h.diagnostics.offer(state); h.advance(15);
  const input = h.policy.buildRequest(state);
  h.budget.reserve({ operationId: 'operation-active', metadata: { snapshotHash: state.fingerprint } });
  h.advance(10); h.diagnostics.offer(state); h.diagnostics.receipt(state, { queued: false, reason: 'duplicate' });
  const duplicate = h.events.find(event => event.type === 'decisions_snapshot_offered' && event.duplicateOffer);
  assert.equal(duplicate.operationId, 'operation-active'); assert.equal(duplicate.reservationId, 'reservation-1');
  const client = h.diagnostics.wrapClient({ async evaluate() { h.advance(200); return { response: { model: 'gpt-6-luna', usage }, requestId: 'req-active', durationMs: 200 }; } });
  const outcome = await client.evaluate(input); h.budget.settle('reservation-1', usage); h.policy.parseResponse(outcome.response);
  h.diagnostics.finish({ ...state, status: 'completed', operationId: 'operation-active', requestId: 'req-active', durationMs: 200 });
  const finished = h.events.at(-1);
  assert.equal(finished.totalWorkerMs, 225); assert.equal(finished.reservationId, 'reservation-1');
  assert.equal(finished.operationId, 'operation-active'); assert.equal(finished.requestId, 'req-active');
  assert.equal(finished.costUsd, .0001);
  h.diagnostics.offer(snapshot('next'));
  assert.equal(h.events.at(-1).queueState, 'idle');
});

test('a failed diagnostic sink is distinct from a provider transport failure', async () => {
  const events = [];
  const d = createDecisionDiagnostics({ rubricVersion: 'test', log(event) {
    if (event.type === 'decisions_api_completed') throw Error('disk unavailable');
    events.push(event);
  } });
  const state = snapshot(); d.offer(state);
  const p = d.wrapPolicy({ buildRequest: request }); const input = p.buildRequest(state);
  const c = d.wrapClient({ async evaluate() { return { response: { model: 'gpt-6-luna', usage }, requestId: 'req-confirmed', durationMs: 200 }; } });
  await assert.rejects(c.evaluate(input), error => error.code === 'diagnostic_write_failed');
  assert.equal(events.some(event => event.type === 'decisions_api_failed'), false);
});
