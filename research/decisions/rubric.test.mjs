import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionRequest, parseDecisionResponse, shadowDisposition, SUPPORT_NEEDS } from './rubric.mjs';

export function providerResponse(choice = 'starting_point', addressed = 0.01) {
  return { model: 'gpt-6-luna', answers: [
    { name: 'support_need', type: 'choice', choice, confidence: 0.95,
      probabilities: SUPPORT_NEEDS.map(value => ({ value, probability: value === choice ? 0.96 : 0.01 })) },
    { name: 'already_addressed', type: 'predicate', probability: addressed },
  ], usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
}

const snapshot = () => ({ fictional: true, authorized: true, closed: false, language: 'en', role: 'family', brief: 'Fictional high-school student.', currentQuestion: { text: 'Where do we begin?' }, recentTranscripts: [{ id: 'u1', role: 'user', text: 'Where do we begin?', complete: true }], opportunities: [], researchFindings: [], expected: 'DO NOT SEND', secret: 'DO NOT SEND', accountId: 'DO NOT SEND' });

test('request uses only standalone Decisions fields and excludes labels/identity', () => {
  const request = buildDecisionRequest(snapshot());
  assert.deepEqual(Object.keys(request).sort(), ['input', 'model', 'prompt_cache_options', 'questions']);
  assert.equal(JSON.stringify(request).includes('DO NOT SEND'), false);
  assert.equal(request.questions.length, 2);
  assert.deepEqual(request.prompt_cache_options, { mode: 'explicit' });
});
test('refusal, wrong identity, bad distribution and typed wrong choice stay unavailable', () => {
  const valid = providerResponse();
  assert.equal(parseDecisionResponse(valid).status, 'completed');
  for (const mutate of [
    r => { r.answers.reverse(); }, r => { r.answers[0].choice = true; },
    r => { r.answers[0].probabilities[0].probability = NaN; },
    r => { r.answers[0].probabilities[0].value = r.answers[0].probabilities[1].value; },
    r => { r.answers[0].probabilities[0].probability = 0.5; },
    r => { r.answers[1].probability = 1.2; },
  ]) {
    const response = structuredClone(valid); mutate(response);
    assert.equal(parseDecisionResponse(response).status, 'invalid');
    assert.equal(parseDecisionResponse(response).result, null);
  }
  valid.answers[1] = { name: 'already_addressed', type: 'refusal' };
  assert.equal(parseDecisionResponse(valid).status, 'refused');
});
test('shadow disposition never treats confidence as authorization or transcript as playback', () => {
  const s = snapshot(), result = parseDecisionResponse(providerResponse()).result;
  assert.equal(shadowDisposition(s, result), 'uncalibrated');
  assert.equal(shadowDisposition(s, result, 0.9), 'shadow_candidate');
  s.recentTranscripts[0].complete = false;
  assert.equal(shadowDisposition(s, result, 0.9), 'provisional_input');
  s.recentTranscripts[0].complete = true;
  s.questionRevision = 1;
  s.opportunities.push({ kind: result.supportNeed, status: 'declined', questionRevision: 1 });
  assert.equal(shadowDisposition(s, result, 0.9), 'opportunity_closed');
  s.questionRevision = 2;
  assert.equal(shadowDisposition(s, result, 0.9), 'shadow_candidate', 'new request must not be blocked by old decline');
  s.opportunities = [];
  result.alreadyAddressed = true;
  assert.equal(shadowDisposition(s, result, 0.9), 'transcript_already_addressed');
});
test('closed, real or oversized snapshots cannot become paid requests', () => {
  for (const patch of [{fictional:false},{closed:true},{authorized:false},{brief:'a'.repeat(40000)}]) assert.throws(() => buildDecisionRequest({...snapshot(),...patch}));
});
