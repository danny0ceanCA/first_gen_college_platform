import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionDiagnostics } from './decision-diagnostics.mjs';
import { createSupportGate } from './support.mjs';
import { createPreferenceDelivery } from './preference-delivery.mjs';

const snapshot = (fingerprint = 'snapshot-a') => ({ callId: 'isolated-call', studentId: 'student-a', fingerprint,
  currentQuestion: { id: 'user:question-a', text: 'DO_NOT_LOG_TRANSCRIPT' },
  recentTranscripts: [{ id: 'user:question-a', role: 'user', text: 'DO_NOT_LOG_TRANSCRIPT', complete: true }],
  researchTasks: [], researchFindings: [], authorized: true, scopeEpoch: 1, connectionEpoch: 1, inputRevision: 3, questionRevision: 2 });
const usage = Object.freeze({ input_tokens: 20, output_tokens: 0, total_tokens: 20,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
function diagnosticsFixture() {
  let at = 100;
  const rows = [];
  const logger = createDecisionDiagnostics({ log: row => rows.push(row), now: () => at, rubricVersion: 'review-version' });
  const originalRequest = Object.freeze({ model: 'gpt-6-luna', input: 'DO_NOT_LOG_INPUT',
    questions: Object.freeze([{ name: 'support_need', instructions: 'DO_NOT_LOG_PROMPT', type: 'boolean' }]) });
  const parsed = Object.freeze({ status: 'completed', result: { supportNeed: 'none', preferenceChanges: [] } });
  const policy = logger.wrapPolicy({ version: 'review-version', buildRequest: () => originalRequest, parseResponse: () => parsed });
  const ledger = logger.wrapBudget({ reserve: () => ({ id: 'reservation-a' }),
    settle: () => ({ costUsd: .000002, reservedUsd: .05, exceededReservation: false }), markUnknown() {},
    summary: () => ({ spentUsd: .000002, capUsd: 1.5 }), close() {} });
  return { logger, policy, ledger, rows, originalRequest, parsed, advance: n => { at += n; } };
}

test('a duplicate snapshot offered during inference preserves original request and cost correlation', async () => {
  const f = diagnosticsFixture(), state = snapshot();
  f.logger.offer(state); f.advance(20);
  const request = f.policy.buildRequest(state);
  f.ledger.reserve({ operationId: 'operation-a', metadata: { snapshotHash: state.fingerprint } });
  const client = f.logger.wrapClient({ async evaluate() {
    f.advance(100); f.logger.offer(state); f.logger.receipt(state, { queued: false, reason: 'duplicate' });
    f.advance(100); return { requestId: 'provider-a', durationMs: 200, response: { model: 'gpt-6-luna', usage } };
  } });
  const outcome = await client.evaluate(request); f.ledger.settle('reservation-a', usage);
  f.policy.parseResponse(outcome.response);
  f.logger.finish({ ...state, operationId: 'operation-a', requestId: 'provider-a', durationMs: 200, status: 'completed', result: f.parsed.result });
  const row = f.rows.findLast(item => item.type === 'decisions_observation_finished');
  assert.equal(row.operationId, 'operation-a'); assert.equal(row.requestId, 'provider-a');
  assert.equal(row.reservationId, 'reservation-a'); assert.equal(row.costUsd, .000002);
  assert.equal(row.totalWorkerMs, 220, 'total starts at the original offer, not a duplicate offer');
  assert.equal(row.questionId, 'user:question-a');
});

test('coalescing a pending snapshot does not clear the active request lifecycle', async () => {
  const f = diagnosticsFixture(), active = snapshot('active'), pending = snapshot('pending');
  f.logger.offer(active); const request = f.policy.buildRequest(active);
  f.ledger.reserve({ operationId: 'operation-active', metadata: { snapshotHash: active.fingerprint } });
  f.logger.offer(pending); f.logger.finish({ ...pending, status: 'skipped', reason: 'coalesced' });
  f.logger.offer(snapshot('next'));
  assert.equal(f.rows.at(-1).queueState, 'inference_in_flight');
  const outcome = await f.logger.wrapClient({ async evaluate() {
    return { response: { usage }, requestId: 'provider-active', durationMs: 1 };
  } }).evaluate(request);
  f.ledger.settle('reservation-a', usage); f.policy.parseResponse(outcome.response);
  f.logger.finish({ ...active, status: 'completed', requestId: 'provider-active', operationId: 'operation-active', result: f.parsed.result });
  f.logger.offer(snapshot('after'));
  assert.equal(f.rows.at(-1).queueState, 'idle');
});

test('budget rejection finalizes the lifecycle without fabricating API completion or leaving it active', () => {
  const f = diagnosticsFixture(), state = snapshot(); f.logger.offer(state); f.policy.buildRequest(state);
  const error = Object.assign(Error('DO_NOT_LOG_BUDGET_DETAILS'), { code: 'budget_exhausted' });
  const budget = f.logger.wrapBudget({ reserve() { throw error; }, summary: () => ({ availableUsd: 0 }) });
  assert.throws(() => budget.reserve({ operationId: 'operation-rejected', metadata: { snapshotHash: state.fingerprint } }), e => e === error);
  f.logger.finish({ ...state, operationId: 'operation-rejected', status: 'unavailable', reason: 'budget_exhausted' });
  f.logger.offer(snapshot('after-rejection'));
  assert.equal(f.rows.at(-1).queueState, 'idle');
  assert.equal(f.rows.some(row => row.type === 'decisions_api_started'), false);
  assert.equal(f.rows.some(row => row.type === 'decisions_api_completed'), false);
  assert.equal(JSON.stringify(f.rows).includes('DO_NOT_LOG'), false);
});

test('telemetry preserves request, client options, response and parser return values without leaking bodies', async () => {
  const f = diagnosticsFixture(), state = snapshot(); f.logger.offer(state);
  const request = f.policy.buildRequest(state);
  assert.equal(request, f.originalRequest);
  const options = Object.freeze({ signal: new AbortController().signal });
  const response = Object.freeze({ model: 'gpt-6-luna', usage, private_reasoning: 'DO_NOT_LOG_REASONING', body: 'DO_NOT_LOG_BODY' });
  const outcome = Object.freeze({ requestId: 'provider-a', durationMs: 12, response });
  const wrapped = f.logger.wrapClient({ async evaluate(gotRequest, gotOptions) {
    assert.equal(gotRequest, request); assert.equal(gotOptions, options); return outcome;
  } });
  assert.equal(await wrapped.evaluate(request, options), outcome);
  assert.equal(f.policy.parseResponse(response), f.parsed);
  assert.equal(JSON.stringify(f.rows).includes('DO_NOT_LOG'), false);
  assert.equal(f.rows.every(row => row.contextSent === false && row.playbackClaim === false), true);
});

function supportFixture() {
  let at = 0, version = 0;
  const rows = [], commands = [];
  const initialScope = { sessionId: 'isolated-call', studentId: 'student-a', confirmed: true };
  const support = createSupportGate({ enabled: true, preferencesEnabled: true, scope: initialScope, language: 'en',
    now: () => at, send: command => commands.push(command), log: row => rows.push(row), makeId: () => 'event-a' });
  const idle = () => support.playback({ idle: true, version: ++version });
  support.native({ type: 'session.started' });
  support.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Welcome back.' }); idle();
  support.native({ type: 'session.input_transcript.delta', delta: 'Please use simple words throughout our call.' });
  support.boundary({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'preference-a', transcript: 'Please use simple words throughout our call.' });
  support.considerPreference({ stamp: support.preferenceStamp(), record: { status: 'completed', callId: initialScope.sessionId,
    studentId: initialScope.studentId, operationId: 'operation-a', requestId: 'provider-a', sourceTranscriptIds: ['user:preference-a'],
    result: { preferenceChanges: {
      plain_language: { action: 'enable', confidence: .99, selectedProbability: .99 },
      one_step_at_a_time: { action: 'unchanged', confidence: .99, selectedProbability: .99 },
    } } } });
  support.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Of course, we can keep things simple.' }); idle();
  at = 1000; idle(); assert.equal(commands.length, 1);
  return { support, rows, commands, initialScope, advance: ms => { at += ms; } };
}

test('a delayed provider acknowledgment retains the originating student and language after selection changes', () => {
  const f = supportFixture();
  f.support.configure({ ...f.initialScope, studentId: 'student-b' }, 'es');
  f.support.native({ type: 'session.thinking.appended', client_event_id: f.commands[0].event_id, start_ms: 1200, end_ms: 1201 });
  const row = f.rows.findLast(item => item.type === 'support_preference_context_acknowledged');
  assert.equal(row.studentId, 'student-a'); assert.equal(row.callId, 'isolated-call'); assert.equal(row.language, 'en');
  assert.equal(row.requestId, 'provider-a'); assert.equal(row.operationId, 'operation-a');
  assert.equal(row.playbackClaim, false); assert.equal(row.contextSent, true);
});

test('an unresolved context event retains its original scope and uncertainty after a language/student switch', () => {
  const f = supportFixture();
  f.support.configure({ ...f.initialScope, studentId: 'student-b' }, 'es');
  f.advance(10000); f.support.status();
  const row = f.rows.findLast(item => item.type === 'support_context_unconfirmed');
  assert.equal(row.studentId, 'student-a'); assert.equal(row.language, 'en');
  assert.equal(row.kind, 'preference'); assert.equal(row.revision, 1);
  assert.equal(row.playbackClaim, false); assert.equal(row.reason, 'acknowledgment_timeout');
  assert.equal(f.commands.length, 1);
});

test('a diagnostic readiness getter failure does not prevent an otherwise safe preference update', () => {
  let at = 0;
  const sent = [], rows = [];
  const scope = { sessionId: 'isolated-call', studentId: 'student-a', confirmed: true };
  const gate = createPreferenceDelivery({ enabled: true, scope, now: () => at, canDeliver: () => null,
    deliveryState() { throw Error('DO_NOT_LOG_DIAGNOSTIC_DETAILS'); },
    send: (content, details) => sent.push({ content, details }), log: row => rows.push(row) });
  gate.boundary({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'preference-a' });
  assert.doesNotThrow(() => gate.consider({ stamp: gate.stamp(), record: { status: 'completed', callId: scope.sessionId,
    studentId: scope.studentId, sourceTranscriptIds: ['user:preference-a'], result: { preferenceChanges: {
      plain_language: { action: 'enable', confidence: .99, selectedProbability: .99 },
      one_step_at_a_time: { action: 'unchanged', confidence: .99, selectedProbability: .99 },
    } } } }));
  gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Of course, we can keep things simple.' });
  gate.playback({ idle: true }); at = 1000;
  assert.doesNotThrow(() => gate.playback({ idle: true }));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].details.readiness, { diagnosticUnavailable: true });
  assert.equal(JSON.stringify(rows).includes('DO_NOT_LOG'), false);
});
