import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreConversationResult, conversationClassifierPlan } from './validate-conversation-classifier.mjs';

test('validation scores dimensions independently and rejects uncertain actionable classifications', () => {
  const fixture = { id: 'en-case', language: 'en', expected: { confusion: 'needs_simpler_explanation', continuation: 'none' } };
  const parsed = { status: 'completed', result: { conversationSupport: {
    confusion: { action: 'needs_simpler_explanation', selectedProbability: 0.96, confidence: 0.99 },
    continuation: { action: 'none', selectedProbability: 0.6, confidence: 0.7 },
  } } };
  assert.equal(scoreConversationResult(fixture, parsed).passed, true);
  parsed.result.conversationSupport.confusion.confidence = 0.6;
  assert.equal(scoreConversationResult(fixture, parsed).passed, false);
  parsed.result.conversationSupport.confusion.action = 'none';
  assert.equal(scoreConversationResult(fixture, parsed).mismatches[0].actual, 'none');
});

test('provider refusals and unavailable classifications cannot pass negative fixtures', () => {
  const fixture = { id: 'es-case', language: 'es', expected: { confusion: 'none', continuation: 'none' } };
  for (const status of ['refused', 'unavailable', 'invalid'])
    assert.equal(scoreConversationResult(fixture, { status, result: null }).passed, false);
});

test('refinement selects exactly ten fixed bilingual cases without changing the default paid suite', () => {
  const normal = conversationClassifierPlan();
  assert.equal(normal.fixtures.length, 32); assert.equal(normal.execute, false);
  assert.equal(normal.capUsd, 0.5); assert.equal(normal.maxRequests, 80);
  const refine = conversationClassifierPlan(['--refine']);
  assert.equal(refine.execute, false); assert.equal(refine.capUsd, 0.1); assert.equal(refine.maxRequests, 20);
  assert.equal(refine.ledger, 'approved-continuation-refinement-decisions-budget.sqlite');
  assert.deepEqual(refine.fixtures.map(fixture => fixture.id), [
    'en-conversation-confused', 'es-conversation-confused',
    'en-conversation-accept-example', 'es-conversation-accept-example',
    'en-conversation-research-offer', 'es-conversation-research-offer',
    'en-conversation-repeated-ack', 'es-conversation-repeated-ack',
    'en-conversation-changed-question-then-ack', 'es-conversation-changed-question-then-ack',
  ]);
  assert.equal(conversationClassifierPlan(['--refine', '--execute']).execute, true);
  assert.throws(() => conversationClassifierPlan(['--reset-budget']), /unsupported_argument/);
});
