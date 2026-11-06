import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationCases } from './calibration-fixtures.mjs';
import { freshCalibrationCases } from './calibration-fresh-fixtures.mjs';
import { fresh2CalibrationCases, fresh2CalibrationVersion } from './calibration-fresh2-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';

test('second fresh holdout — 20 new fictional cases remain separate from all consumed datasets', () => {
  const cases = fresh2CalibrationCases();
  const oldCases = [...calibrationCases(), ...freshCalibrationCases()];
  assert.equal(fresh2CalibrationVersion, 'first-generation-navigation-fresh-20-v1');
  assert.equal(cases.length, 20);
  assert.deepEqual(Object.fromEntries(['en', 'es', 'mixed'].map(language => [language,
    cases.filter(example => example.source.language === language).length])), { en: 7, es: 7, mixed: 6 });
  assert.equal(new Set(cases.map(example => example.source.id)).size, 20);
  assert.equal(new Set(cases.map(example => example.source.text)).size, 20);
  assert.ok(cases.every(example => !oldCases.some(old => old.source.id === example.source.id || old.source.text === example.source.text)));
  assert.ok(cases.every(example => example.source.synthetic && example.split === 'heldout' && example.rubric.humanReview === 'pending'));
  assert.equal(cases.filter(example => example.rubric.correctionCaseId).length, 3);
  assert.equal(cases.filter(example => !example.expected.items.length).length, 2);
  assert.equal(cases.filter(example => example.rubric.forbiddenKindStatuses.length).length, 3);
});

test('second fresh holdout — expected observations have exact evidence, known correction targets and no invented date precision', () => {
  const existingItems = [];
  for (const example of fresh2CalibrationCases()) {
    validateSource(example.source);
    validateExtraction(example.expected, example.source, { existingItems });
    for (const item of example.expected.items) {
      assert.equal(item.language, example.source.language);
      if (item.occurredAt !== null) assert.ok(item.quote.includes(item.occurredAt));
      if (item.corrects) {
        const target = existingItems.find(prior => prior.id === item.corrects);
        assert.equal(target.kind, 'outcome');
        assert.equal(target.status, 'positive');
        assert.equal(item.kind, 'outcome');
        assert.equal(item.status, 'pending');
        assert.equal(target.reportedBy, item.reportedBy);
        assert.equal(target.accountId, example.source.accountId);
        assert.equal(target.studentId, example.source.studentId);
        target.state = 'superseded';
      }
      existingItems.push({ ...item, id: `${example.source.id}@1#${item.key}`,
        sourceId: example.source.id, accountId: example.source.accountId,
        studentId: example.source.studentId, state: 'current' });
    }
  }
  assert.equal(existingItems.filter(item => item.occurredAt !== null).length, 2);
  assert.equal(fresh2CalibrationCases().find(example => example.id === 'fresh2-en-05').expected.items[0].occurredAt, null);
});
