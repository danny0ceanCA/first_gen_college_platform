import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNativeTriggerEvaluation, createNativeTriggerObserver,
  NATIVE_FICTIONAL_CASES, NATIVE_TRANSCRIPT_TYPES,
} from './native-trigger-evaluation.mjs';

const [input, output] = NATIVE_TRANSCRIPT_TYPES;
const scope = { sessionId: 'fictional-call', studentId: 'fictional-student', connectionId: 'fictional-connection' };
const options = { enabled: true, isolated: true, fixtureId: 'en-first-step', scope };
const source = (id, type = input, delta = 'I need a simple example.') => ({
  event_id: id, type, delta, start_ms: 100, end_ms: 300,
});
const completion = (id, sourceId, type = input, changes = {}) => {
  const questionIndex = type === input ? 0 : 1;
  return { event_id: id, type: 'decision.event', delegation_id: null,
    trigger_id: `trg-${id}`, source_event_id: sourceId, source_event_type: type,
    event: { type: 'decision.completed', decision: { model: 'provider-selected-model',
      answers: buildNativeTriggerEvaluation(options).sessionPatch.triggers[questionIndex].decisions.questions
        .map(question => ({ type: 'predicate', name: question.name, probability: 0.95 })),
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 50, cache_write_tokens: 0 },
        output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 100 },
    } }, ...changes };
};
const setup = (extra = {}) => {
  let clock = 1000;
  const diagnostics = [];
  const observer = createNativeTriggerObserver({ ...options, now: () => clock,
    onDiagnostic: event => diagnostics.push(event), ...extra });
  return { observer, diagnostics, advance: ms => { clock += ms; }, setClock: ms => { clock = ms; },
    send: event => observer.observe(event, scope) };
};

test('default is disabled; explicit fictional isolation cannot be bypassed with a production or injection option', () => {
  assert.deepEqual(buildNativeTriggerEvaluation().sessionPatch, null);
  assert.equal(createNativeTriggerObserver().observe(source('s')).reason, 'disabled');
  assert.throws(() => buildNativeTriggerEvaluation({ enabled: true }), /isolation/);
  assert.throws(() => buildNativeTriggerEvaluation({ ...options, isolated: false }), /isolation/);
  assert.throws(() => buildNativeTriggerEvaluation({ ...options, fixtureId: 'real-account' }), /fictional/);
  assert.throws(() => buildNativeTriggerEvaluation({ ...options, observeOnly: false }), /cannot inject/);
  assert.throws(() => createNativeTriggerObserver({ ...options, scope: {} }), /scope/);
});

test('session patch supplies only Live triggers, never a standalone request or model/delegation/voice changes', () => {
  const original = { model: 'keep-original', instructions: 'keep-intro', voice: 'keep-voice', delegation: { type: 'responses' } };
  const result = buildNativeTriggerEvaluation(options);
  assert.deepEqual(Object.keys(result.sessionPatch), ['triggers']);
  assert.deepEqual({ ...original, ...result.sessionPatch, triggers: undefined }, { ...original, triggers: undefined });
  assert.equal(result.sessionPatch.triggers.length, 2);
  for (const trigger of result.sessionPatch.triggers) {
    assert.equal(trigger.type, 'decisions');
    assert.equal(trigger.model, undefined); assert.equal(trigger.id, undefined);
    assert.deepEqual(Object.keys(trigger.decisions), ['questions']);
    assert.ok(trigger.decisions.questions.length > 0 && trigger.decisions.questions.length <= 64);
  }
  assert.deepEqual(result.requiredEventTypes, ['decision.event', input, output]);
  assert.equal(result.spending.paidCallsAuthorized, false);
  assert.equal(result.spending.hardPreRequestBudgetAvailable, false);
  assert.throws(() => { result.limits.durationMs = Infinity; }, TypeError);
});

for (const [fixtureId, fixture] of Object.entries(NATIVE_FICTIONAL_CASES)) {
  test(`${fixture.language}: source-correlated observation distinguishes receipt, model compute, speech and comprehension`, () => {
    const { send, advance, observer, diagnostics } = setup({ fixtureId });
    assert.equal(send(source('user-1', input, fixture.caller)).reason, 'source_recorded');
    advance(215);
    const record = send(completion('decision-1', 'user-1'));
    assert.equal(record.accepted, true); assert.equal(record.sourceToResultMs, 215);
    assert.equal(record.providerComputeMs, null); assert.equal(record.deliveredToLive, false);
    assert.equal(record.adaptationObserved, false); assert.equal(record.playbackEvidence, 'not_collected');
    assert.equal(record.comprehension, 'not_established');
    assert.equal(record.providerModel, 'provider-selected-model');
    assert.equal(observer.summary().tokenUsage, 100);
    assert.equal(JSON.stringify(diagnostics).includes(fixture.caller), false);
    assert.equal(JSON.stringify(observer.summary()).includes(fixture.caller), false);
  });
}

test('coalesced fragments correlate to the latest source without claiming exact provider coverage', () => {
  const { send } = setup();
  send(source('s1', input, 'Can you'));
  send(source('s2', input, 'give an example?'));
  const result = send(completion('d2', 's2'));
  assert.equal(result.accepted, true); assert.equal(result.sourceSequence, 2);
  assert.equal(result.possibleCoalescing, true); assert.equal(result.unclassifiedSourceCount, 1);
  assert.equal(send(completion('d1', 's1')).reason, 'out_of_order_result');
});

test('latest input and output result ordering is independent', () => {
  const { send } = setup();
  send(source('input1')); send(source('output1', output, 'Here is one example.'));
  assert.equal(send(completion('output-decision', 'output1', output)).accepted, true);
  assert.equal(send(completion('input-decision', 'input1')).accepted, true);
});

test('newer correction pending makes the earlier result non-current', () => {
  const { send } = setup();
  send(source('s1', input, 'Explain housing.'));
  send(source('s2', input, 'Actually I mean the application.'));
  assert.equal(send(completion('d1', 's1')).reason, 'newer_source_pending');
  assert.equal(send(completion('d2', 's2')).accepted, true);
});

test('unknown source, wrong source direction and client-delegated decisions are not native trigger evidence', () => {
  const { send, observer } = setup();
  assert.equal(send(completion('unknown', 'missing')).reason, 'unknown_or_evicted_source');
  send(source('s1'));
  assert.equal(send(completion('wrong-direction', 's1', output)).reason, 'source_direction_mismatch');
  assert.equal(send(completion('delegation', 's1', input, { delegation_id: 'client-delegation' })).reason, 'not_native_completion');
  assert.equal(observer.summary().accepted, 0);
  assert.equal(observer.summary().tokenUsage, 200); // Unknown/mismatched native work was still billed; client delegation excluded.
});

test('duplicate event/trigger IDs never double-count usage or become a second observation', () => {
  const { send, observer } = setup();
  send(source('s1')); const event = completion('d1', 's1');
  assert.equal(send(event).accepted, true);
  assert.equal(send(event).reason, 'duplicate_event');
  assert.equal(send({ ...event, event_id: 'duplicate-envelope' }).reason, 'duplicate_trigger');
  assert.equal(send(source('s1')).reason, 'duplicate_event');
  assert.equal(observer.summary().accepted, 1); assert.equal(observer.summary().tokenUsage, 100);
});

test('bounded source retention, expiry, and call/student/connection scopes fence stale results', () => {
  const { send, advance, observer } = setup({ maxSources: 2, maxSourceAgeMs: 100 });
  send(source('s1')); send(source('s2')); send(source('s3'));
  assert.equal(observer.summary().retainedSources, 2);
  assert.equal(send(completion('d1', 's1')).reason, 'unknown_or_evicted_source');
  advance(101);
  assert.equal(send(completion('d3', 's3')).reason, 'stale_source');
  for (const key of Object.keys(scope)) {
    assert.equal(observer.observe(source('scope-event'), { ...scope, [key]: 'other' }).reason, 'scope_mismatch');
  }
  observer.close(); assert.equal(send(completion('closed', 's3')).reason, 'closed');
});

test('ordered names, finite probabilities and per-question refusals stay distinct', () => {
  const { send } = setup(); send(source('s1'));
  const wrong = completion('wrong', 's1'); wrong.event.decision.answers.reverse();
  assert.equal(send(wrong).reason, 'invalid_answers');
  const nan = completion('nan', 's1'); nan.event.decision.answers[0].probability = NaN;
  assert.equal(send(nan).reason, 'invalid_answers');
  const refusal = completion('refusal', 's1');
  refusal.event.decision.answers[0] = { type: 'refusal', name: refusal.event.decision.answers[0].name };
  const result = send(refusal);
  assert.equal(result.accepted, true); assert.equal(result.answers[0].type, 'refusal');
  assert.equal(result.answers[1].probability, 0.95);
});

test('invalid or missing usage remains unknown, never a zero-cost proof', () => {
  const { send, observer } = setup(); send(source('s1'));
  const event = completion('d1', 's1'); event.event.decision.usage.input_tokens = -100;
  const result = send(event);
  assert.equal(result.accepted, true); assert.equal(result.usageValid, false); assert.equal(result.usage, null);
  assert.equal(observer.summary().malformedUsage, 1);
});

test('duration/event limits are observable stop signals and not claims of a pre-request spending cap', () => {
  const run = setup({ durationMs: 1000 });
  run.advance(1000); assert.equal(run.observer.tick().stopReason, 'duration_limit');
  assert.equal(run.observer.tick().requiresTransportDisable, true);
  assert.equal(run.send(source('late')).reason, 'closed');
  const capped = setup({ maxDecisionEvents: 1 });
  capped.send(source('s1')); assert.equal(capped.send(completion('d1', 's1')).accepted, true);
  assert.equal(capped.observer.summary().stopReason, 'decision_event_limit');
  assert.equal(capped.observer.summary().hardPreRequestBudgetAvailable, false);
  assert.equal(capped.send(completion('d2', 's1')).reason, 'closed');
  const bounded = setup({ maxSources: 2, maxDecisionEvents: 1 });
  bounded.send(source('a')); bounded.send(source('b')); bounded.send(source('c'));
  assert.equal(bounded.send(source('d')).reason, 'event_limit');
});

test('invalid clocks, invalid bounds, malformed fragments and logging failures cannot change conversation', () => {
  assert.throws(() => setup({ durationMs: Infinity }), /durationMs/);
  assert.throws(() => setup({ maxDecisionEvents: 0 }), /maxDecisionEvents/);
  const run = setup({ onDiagnostic: () => { throw Error('logging failed'); } });
  assert.equal(run.send({ ...source('bad'), end_ms: -1 }).reason, 'malformed_transcript');
  assert.equal(run.send({ ...source('too-long'), delta: 'x'.repeat(8193) }).reason, 'malformed_transcript');
  run.send(source('s1')); assert.equal(run.send(completion('d1', 's1')).accepted, true);
  run.setClock(1); assert.equal(run.observer.tick().stopReason, 'clock_invalid');
});
