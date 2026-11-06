import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePredictions, demoEvaluation } from './evaluation.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';

function record(id = 'demo-college-start') {
  const source = demoSources().find(item => item.id === id);
  return { source, expected: demoExtraction(source), actual: demoExtraction(source) };
}

test('phase 4 evaluation — reference replay matches quotes and kinds independently of generated keys', () => {
  const input = record();
  input.actual.items[0].key = 'another-key';
  input.actual.items[1].linksTo = 'another-key';
  const result = evaluatePredictions([input]);
  assert.equal(result.counts.invalidOutputs, 0);
  assert.equal(result.metrics.evidencePrecision.value, 1);
  assert.equal(result.metrics.evidenceRecall.value, 1);
  assert.equal(result.metrics.statusAgreement.value, 1);
});

test('phase 4 evaluation — fabricated quotes are invalid, unexpected, and missing from evidence recall', () => {
  const input = record();
  input.actual.items[0].quote = 'Invented words that are absent from the saved source.';
  const result = evaluatePredictions([input]);
  assert.equal(result.counts.invalidOutputs, 1);
  assert.equal(result.records[0].validation.code, 'unsupported_item_evidence');
  assert.deepEqual(result.metrics.evidencePrecision, { numerator: 1, denominator: 2, value: 0.5 });
  assert.deepEqual(result.metrics.evidenceRecall, { numerator: 1, denominator: 2, value: 0.5 });
  assert.equal(result.counts.missingItems, 1);
  assert.equal(result.counts.unexpectedItems, 1);
});

test('phase 4 evaluation — false success loses pending preservation even when the quote matches', () => {
  const input = record('demo-application-pending');
  input.actual.items[1].status = 'positive';
  const result = evaluatePredictions([input]);
  assert.equal(result.counts.invalidOutputs, 0);
  assert.equal(result.metrics.evidencePrecision.value, 1);
  assert.equal(result.metrics.statusAgreement.value, 0.5);
  assert.deepEqual(result.metrics.pendingOutcomePreservation, { numerator: 0, denominator: 1, value: 0 });
});

test('phase 4 evaluation — parent-to-student attribution fails contract and attribution comparison', () => {
  const input = record('demo-parent-costs');
  input.actual.items[0].reportedBy = 'student';
  const result = evaluatePredictions([input]);
  assert.equal(result.counts.invalidOutputs, 1);
  assert.equal(result.records[0].validation.code, 'invalid_item_attribution');
  assert.equal(result.metrics.reporterAgreement.value, 0.5);
});

test('phase 4 evaluation — missing and duplicate supported observations affect denominators', () => {
  const missing = record('demo-practical-needs');
  missing.actual.items.pop();
  const extra = record();
  extra.actual.items.push({ ...extra.actual.items[0], key: 'extra-duplicate' });
  const result = evaluatePredictions([missing, extra]);
  assert.equal(result.counts.invalidOutputs, 0);
  assert.equal(result.counts.expectedItems, 4);
  assert.equal(result.counts.predictedItems, 4);
  assert.equal(result.counts.matchedItems, 3);
  assert.equal(result.metrics.evidencePrecision.value, 0.75);
  assert.equal(result.metrics.evidenceRecall.value, 0.75);
});

test('phase 4 evaluation — unknown outcomes and missing outputs remain visible', () => {
  const input = record('demo-unknown-speaker');
  input.actual = null;
  const result = evaluatePredictions([input]);
  assert.equal(result.counts.invalidOutputs, 1);
  assert.equal(result.metrics.evidencePrecision.value, null);
  assert.equal(result.metrics.evidenceRecall.value, 0);
  assert.deepEqual(result.metrics.unknownOutcomePreservation, { numerator: 0, denominator: 1, value: 0 });
  const empty = evaluatePredictions([]);
  assert.equal(empty.metrics.evidenceRecall.value, null);
  assert.equal(empty.metrics.validOutputRate.value, null);
});

test('phase 4 evaluation — expected reference records must themselves have source evidence', () => {
  const input = record();
  input.expected.items[0].quote = 'An unsupported reference label.';
  assert.throws(() => evaluatePredictions([input]), { code: 'invalid_evaluation_reference' });
});

test('phase 4 evaluation — synthetic known-error exercise detects regressions without provider calls', () => {
  const report = demoEvaluation();
  assert.equal(report.providerCalls, 0);
  assert.equal(report.referenceReplay.counts.invalidOutputs, 0);
  assert.equal(report.referenceReplay.metrics.evidenceRecall.value, 1);
  assert.equal(report.knownErrors.counts.invalidOutputs, 1);
  assert.ok(report.knownErrors.metrics.evidencePrecision.value < 1);
  assert.ok(report.knownErrors.metrics.evidenceRecall.value < 1);
  assert.ok(report.knownErrors.metrics.reporterAgreement.value < 1);
  assert.ok(report.knownErrors.metrics.pendingOutcomePreservation.value < 1);
  assert.equal(report.knownErrors.metrics.unknownOutcomePreservation.value, 0);
  assert.match(report.description, /do not establish AI extraction quality/);
});
