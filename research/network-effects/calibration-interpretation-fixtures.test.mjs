import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationCases } from './calibration-fixtures.mjs';
import { freshCalibrationCases } from './calibration-fresh-fixtures.mjs';
import { fresh2CalibrationCases } from './calibration-fresh2-fixtures.mjs';
import { interpretationCases, interpretationVersion } from './calibration-interpretation-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';

test('interpretation holdout — new fictional multilingual sources preserve complete sequential scenarios', () => {
  const cases = interpretationCases();
  const priorCases = [...calibrationCases(), ...freshCalibrationCases(), ...fresh2CalibrationCases()];
  assert.equal(interpretationVersion, 'first-generation-interpretation-24-v1');
  assert.equal(cases.length, 24);
  assert.deepEqual(Object.fromEntries(['en', 'es', 'mixed'].map(language => [language,
    cases.filter(example => example.source.language === language).length])), { en: 8, es: 8, mixed: 8 });
  assert.equal(new Set(cases.map(example => example.source.id)).size, 24);
  assert.ok(cases.every(example => !priorCases.some(prior => prior.source.id === example.source.id || prior.source.text === example.source.text)));
  assert.ok(cases.every(example => example.source.synthetic && example.split === 'heldout' && example.rubric.humanReview === 'pending'));
  assert.equal(cases.filter(example => example.rubric.priorCaseId).length, 9);
  assert.equal(cases.filter(example => example.rubric.interpretationExpected.fulfillsPendingCaseId).length, 3);
  for (const scenario of new Set(cases.map(example => example.scenario))) {
    const sequence = cases.filter(example => example.scenario === scenario);
    assert.equal(new Set(sequence.map(example => example.source.accountId)).size, 1);
    assert.equal(new Set(sequence.map(example => example.source.studentId)).size, 1);
    assert.equal(new Set(sequence.map(example => example.source.reporter)).size, 1);
  }
});

test('interpretation holdout — expected evidence and progress links validate without treating progress as correction', () => {
  const existingItems = [];
  const byCase = new Map();
  for (const example of interpretationCases()) {
    validateSource(example.source);
    validateExtraction(example.expected, example.source, { existingItems });
    const rule = example.rubric.interpretationExpected;
    assert.equal(rule.noCorrection, true);
    for (const required of rule.requiredObservations) assert.ok(example.expected.items.some(item =>
      item.kind === required.kind && required.statuses.includes(item.status) && (!required.requireBarrier || item.barrier)));
    for (const [kind, status] of rule.forbiddenKindStatuses) assert.ok(!example.expected.items.some(item => item.kind === kind && item.status === status));
    if (rule.fulfillsPendingCaseId) {
      assert.ok(byCase.get(rule.fulfillsPendingCaseId).expected.items.some(item => item.kind === 'outcome' && item.status === 'pending'));
      assert.ok(example.expected.items.some(item => item.kind === 'action' && item.status === 'completed'));
    }
    for (const item of example.expected.items) {
      assert.equal(item.corrects, null);
      assert.equal(item.occurredAt, null);
      assert.equal(item.language, example.source.language);
      if (item.linksTo) assert.ok(existingItems.some(prior => prior.id === item.linksTo));
      existingItems.push({ ...item, id: `${example.source.id}@1#${item.key}`,
        sourceId: example.source.id, accountId: example.source.accountId,
        studentId: example.source.studentId, state: 'current' });
    }
    byCase.set(example.id, example);
  }
});
