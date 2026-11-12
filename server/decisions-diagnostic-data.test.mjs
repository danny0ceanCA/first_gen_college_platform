import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionsDiagnosticData } from './decisions-diagnostic-data.mjs';
import { diagnosticClassifications } from '../research/decisions/diagnostic-classifications.mjs';
import { CONFUSION_ACTIONS, CONTINUATION_ACTIONS } from '../research/decisions/conversation-rubric.mjs';

const choice = (name, values, value) => ({ name, type: 'choice', choice: value, confidence: .96,
  probabilities: values.map(item => ({ value: item, probability: item === value ? 1 : 0 })) });

for (const language of ['en','es']) test(`${language}: complete distributions survive without hiding confusion behind supportNeed:none`, () => {
  const event = { type: 'decisions_response_parsed', language, status: 'completed',
    supportNeed: 'none', conversationSupport: { confusion: { action: 'needs_simpler_explanation', confidence: .96, selectedProbability: 1 },
      continuation: { action: 'none', confidence: .96, selectedProbability: 1 } },
    classificationAnswers: [choice('confusion_state', CONFUSION_ACTIONS, 'needs_simpler_explanation'),
      choice('continuation_acceptance', CONTINUATION_ACTIONS, 'none')], classificationValidated: true };
  const row = decisionsDiagnosticData(event);
  assert.equal(row.language, language); assert.equal(row.classificationPath, 'completed');
  assert.equal(row.classification.supportNeed, 'none');
  assert.equal(row.classification.conversationSupport.confusion.action, 'needs_simpler_explanation');
  assert.deepEqual(row.classificationAnswers, event.classificationAnswers);
  assert.equal(row.omittedClassificationAnswers, 0);
});

test('early probabilities, refusal and scheduling/freshness evidence remain independent', () => {
  const row = decisionsDiagnosticData({ type: 'early_decisions_completed', result: {
    facts: { simplify_requested: .97, already_addressed: .01, need_revised: null, arbitrary_private_fact: .8 },
    refusedQuestions: ['need_revised', 'PRIVATE'] },
    triggerBasis: 'recognizable_request', requestMoment: 'meaningful_input', budgetConstraint: 'check_frequency',
    inputAgeMs: 181, quietAgeMs: 0, tokensAvailable: 1.2, revalidationRequested: true, revalidationCount: 1,
    freshnessMismatch: ['revision','assistantOutputRevision','PRIVATE'], freshAtWorker: false,
    sourceStamp: { revision: 1, studentId: 'opaque-student', sourceText: 'PRIVATE' }, currentStamp: { revision: 2 },
    contextSent: false, playbackClaim: false });
  assert.deepEqual(row.freshnessMismatch, ['revision','assistantOutputRevision']);
  assert.equal(row.classificationPath, 'early'); assert.equal(row.inputAgeMs, 181); assert.equal(row.tokensAvailable, 1.2);
  assert.deepEqual(row.classification.refusedQuestions, ['need_revised']);
  assert.equal(row.probabilities.simplify_requested, .97); assert.equal(row.revalidationCount, 1);
  assert.ok(!JSON.stringify(row).includes('PRIVATE')); assert.ok(!JSON.stringify(row).includes('arbitrary_private_fact'));
});

test('raw answer projection rejects arbitrary names, labels, duplicate identities and malformed distributions', () => {
  const input = [choice('confusion_state', CONFUSION_ACTIONS, 'none'), { name: 'already_addressed', type: 'refusal', refusal: 'PRIVATE' },
    { name: 'private_text', type: 'predicate', probability: .9 },
    { name: 'confusion_state', type: 'choice', choice: 'PRIVATE', confidence: 1, probabilities: [] },
    { name: 'simplify_requested', type: 'predicate', probability: NaN },
    { name: 'continuation_acceptance', type: 'choice', choice: 'none', confidence: 1,
      probabilities: [{ value: 'none', probability: 1 }] }];
  const result = diagnosticClassifications(input);
  assert.equal(result.answers.length, 2); assert.equal(result.omittedAnswers, 4);
  assert.deepEqual(result.answers[1], { name: 'already_addressed', type: 'refusal' });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('uncertain sends, readiness and stage-specific timing survive without request contents', () => {
  const value = decisionsDiagnosticData({ contextSent: 'unknown', playbackClaim: false, queueWaitMs: 12, parseMs: 3,
    totalWorkerMs: 220, usage: { input_tokens: 200, input_tokens_details: { cached_tokens: 40 } },
    readiness: { introReady: true, outputOpen: false, pendingContextCount: 1, arbitrary: 'PRIVATE' },
    request: { input: 'PRIVATE' }, privateReasoning: 'PRIVATE', sourceText: 'PRIVATE', providerError: 'PRIVATE' });
  assert.equal(value.contextSent, 'unknown'); assert.equal(value.playbackClaim, false);
  assert.equal(value.readiness.pendingContextCount, 1); assert.equal(value.usage.cachedInputTokens, 40);
  assert.equal(value.queueWaitMs, 12); assert.equal(value.parseMs, 3);
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
});

test('bounded data rejects unsafe numbers and overlong arrays', () => {
  const row = decisionsDiagnosticData({ durationMs: Infinity, inputAgeMs: -1,
    sourceEventIds: Array.from({ length: 200 }, (_, i) => 'event-' + i),
    sourceStamp: { revision: 9007199254740992 }, classificationAnswers: Array.from({ length: 100 }, () => ({ name: 'already_addressed', type: 'predicate', probability: .8 })) });
  assert.equal(row.durationMs, undefined); assert.equal(row.inputAgeMs, undefined);
  assert.equal(row.sourceEventIds.length, 128); assert.deepEqual(row.sourceStamp, {});
  assert.equal(row.classificationAnswers.length, 1); assert.equal(row.omittedClassificationAnswers, 99);
});
