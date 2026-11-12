import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionRequest, parseDecisionResponse, SUPPORT_NEEDS } from './rubric.mjs';
import { conversationPolicy } from './conversation-rubric.mjs';
import { recognitionFixtures } from './recognition-fixtures.mjs';
import { evaluateResults } from './evaluation.mjs';

const response = (kind, addressed = .01) => ({ model: 'gpt-6-luna', answers: [
  { name: 'support_need', type: 'choice', choice: kind, confidence: .96,
    probabilities: SUPPORT_NEEDS.map(value => ({ value, probability: value === kind ? .95 : .05 / (SUPPORT_NEEDS.length - 1) })) },
  { name: 'already_addressed', type: 'predicate', probability: addressed },
] });

test('the completed classifier accepts concrete examples with validated complete distributions', () => {
  assert.equal(parseDecisionResponse(response('concrete_example')).result.supportNeed, 'concrete_example');
  const missing = response('concrete_example'); missing.answers[0].probabilities.pop();
  assert.equal(parseDecisionResponse(missing).status, 'invalid');
  const old = response('concrete_example'); old.answers[0].probabilities = old.answers[0].probabilities.filter(row => row.value !== 'concrete_example');
  assert.equal(parseDecisionResponse(old).status, 'invalid');
  const nullRow = response('concrete_example'); nullRow.answers[0].probabilities[1] = null;
  assert.equal(parseDecisionResponse(nullRow).status, 'invalid');
  assert.equal(parseDecisionResponse({ ...response('concrete_example'), model: ' ' }).status, 'invalid');
});

test('evaluation counts example requests as useful support rather than unavailable results', () => {
  const report = evaluateResults([{ fixtureId: 'example-needed', language: 'es', split: 'holdout',
    expected: { supportNeed: 'concrete_example', alreadyAddressed: false }, status: 'completed',
    result: parseDecisionResponse(response('concrete_example')).result }]);
  assert.equal(report.overall.available, 1); assert.equal(report.overall.optionalHelp.truePositives, 1);
  assert.equal(report.overall.supportNeed.confusion.concrete_example.concrete_example, 1);
});

test('completed evidence separates a renewed request from old explanations and later output', () => {
  for (const language of ['en', 'es']) {
    const renewed = recognitionFixtures.find(row => row.id === `recognition-${language}-renewed-after-clarity`);
    const input = JSON.parse(buildDecisionRequest(renewed.snapshot).input);
    assert.equal(input.currentContribution.text, renewed.snapshot.currentQuestion.text);
    assert.equal(input.explanationHistory.rows[1].role, 'user');
    assert.equal(input.explanationHistory.comprehension, 'unknown');
    assert.equal(input.explanationHistory.playback, 'unknown');
    const answered = recognitionFixtures.find(row => row.id === `recognition-${language}-example-already-given`);
    const answeredInput = JSON.parse(conversationPolicy.buildRequest(answered.snapshot).input);
    assert.equal(answeredInput.currentContribution.span, 1);
    assert.equal(answeredInput.conversationContribution.assistantAfterCaller.length, 1);
    assert.equal(answeredInput.currentContribution.text, answered.snapshot.currentQuestion.text);
  }
});

test('independent bilingual holdout is bounded, immutable and never supplies expected labels', () => {
  assert.equal(recognitionFixtures.length, 24);
  assert.equal(recognitionFixtures.filter(row => row.language === 'en').length, 12);
  assert.equal(recognitionFixtures.filter(row => row.language === 'es').length, 12);
  for (const fixture of recognitionFixtures) {
    assert.equal(Object.isFrozen(fixture.expected), true);
    const request = conversationPolicy.buildRequest({ ...fixture.snapshot, expected: fixture.expected, labelSource: fixture.labelSource });
    assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 32768);
    const input = JSON.parse(request.input);
    assert.equal(Object.hasOwn(input, 'expected'), false);
    assert.equal(Object.hasOwn(input, 'labelSource'), false);
    assert.equal(request.questions.length, 12);
  }
});
