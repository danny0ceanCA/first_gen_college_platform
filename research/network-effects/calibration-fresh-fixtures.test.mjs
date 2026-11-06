import test from 'node:test';
import assert from 'node:assert/strict';
import { freshCalibrationCases, freshCalibrationVersion } from './calibration-fresh-fixtures.mjs';
import { calibrationCases } from './calibration-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';

test('fresh holdout — 30 new fictional sources stay held out across three languages and correction chains', () => {
  const examples = freshCalibrationCases();
  const prior = calibrationCases();
  assert.equal(freshCalibrationVersion, 'first-generation-navigation-fresh-30-v1');
  assert.equal(examples.length, 30);
  assert.deepEqual(Object.fromEntries(['en', 'es', 'mixed'].map(language => [language,
    examples.filter(example => example.source.language === language).length])), { en: 10, es: 10, mixed: 10 });
  assert.equal(new Set(examples.map(example => example.source.id)).size, 30);
  assert.equal(new Set(examples.map(example => example.source.text)).size, 30);
  assert.ok(examples.every(example => !prior.some(old => old.source.id === example.source.id || old.source.text === example.source.text)));
  assert.ok(examples.every(example => example.split === 'heldout' && example.source.synthetic && example.rubric.humanReview === 'pending'));
  assert.equal(examples.filter(example => example.rubric.correctionCaseId).length, 3);
  assert.ok(examples.filter(example => example.rubric.expectedBarrier).length >= 12);
  assert.equal(examples.filter(example => !example.expected.items.length).length, 2);
  assert.equal(new Set(examples.flatMap(example => example.expected.items.map(item => item.topic))).size, 8);
});

test('fresh holdout — expected corrections resolve within the exact synthetic scope and event dates have direct evidence', () => {
  const examples = freshCalibrationCases();
  const existingItems = [];
  for (const example of examples) {
    validateSource(example.source);
    validateExtraction(example.expected, example.source, { existingItems });
    for (const item of example.expected.items) {
      if (item.occurredAt !== null) assert.ok(item.quote.includes(item.occurredAt));
      assert.equal(item.language, example.source.language);
      if (item.corrects) {
        const target = existingItems.find(prior => prior.id === item.corrects);
        assert.equal(target.kind, item.kind);
        assert.equal(target.reportedBy, item.reportedBy);
        assert.equal(target.accountId, example.source.accountId);
        assert.equal(target.studentId, example.source.studentId);
        assert.equal(item.status, 'pending');
        assert.equal(target.status, 'positive');
        target.state = 'superseded';
      }
      existingItems.push({ ...item, id: `${example.source.id}@1#${item.key}`,
        sourceId: example.source.id, accountId: example.source.accountId,
        studentId: example.source.studentId, state: 'current' });
    }
  }
  assert.equal(existingItems.filter(item => item.occurredAt !== null).length, 2);
  assert.equal(examples.find(example => example.id === 'fresh-mixed-06').expected.items[0].occurredAt, null);
});
