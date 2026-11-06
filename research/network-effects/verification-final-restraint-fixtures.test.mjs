import test from 'node:test';
import assert from 'node:assert/strict';
import { finalRestraintCases, finalRestraintVersion } from './verification-final-restraint-fixtures.mjs';
import { restraintCases } from './verification-restraint-fixtures.mjs';
import { verificationCases } from './verification-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';

test('final restraint holdout is balanced, fictional and uses newly authored text', () => {
  const cases = finalRestraintCases(), previous = [...restraintCases(), ...verificationCases()];
  assert.equal(finalRestraintVersion, 'first-generation-verifier-final-restraint-12-v1');
  assert.equal(cases.length, 12); assert.equal(new Set(cases.map(row => row.id)).size, 12);
  for (const language of ['en', 'es', 'mixed']) {
    const group = cases.filter(row => row.source.language === language);
    assert.equal(group.length, 4);
    assert.equal(group.filter(row => row.expected.decision === 'keep').length, 2);
    assert.equal(group.filter(row => row.expected.decision === 'revise').length, 2);
  }
  for (const row of cases) {
    assert.equal(row.split, 'heldout'); assert.equal(row.source.synthetic, true);
    assert.equal(row.rubric.humanReview, 'pending');
    assert.ok(!previous.some(old => old.source.text === row.source.text || old.id === row.id));
    assert.ok(!Object.hasOwn(row.source, 'expected'));
  }
});

test('final restraint labels are grounded, canonical and retain supported reference scope', () => {
  for (const row of finalRestraintCases()) {
    validateSource(row.source);
    for (const extraction of [row.initialCandidate, row.expected.extraction]) {
      validateExtraction(extraction, row.source);
      for (const value of extraction.items) {
        assert.ok(row.source.text.includes(value.quote));
        assert.equal(value.corrects, null); assert.equal(value.occurredAt, null);
        assert.equal(value.language, row.source.language);
        if (value.linksTo) assert.ok(extraction.items.some(other => other.key === value.linksTo));
      }
    }
    for (const quote of row.rubric.barrierEvidence) assert.ok(row.source.text.includes(quote));
    for (const required of row.rubric.requiredObservations) {
      assert.ok(row.expected.extraction.items.some(value => value.kind === required.kind && required.statuses.includes(value.status)
        && (!required.requireBarrier || value.barrier)), row.id);
    }
    for (const [kind, status] of row.rubric.forbiddenKindStatuses) {
      assert.ok(!row.expected.extraction.items.some(value => value.kind === kind && value.status === status), row.id);
    }
  }
});

test('final restraint controls are exact no-ops and failure repairs require a separate result', () => {
  for (const row of finalRestraintCases()) {
    if (row.expected.decision === 'keep') {
      assert.deepEqual(row.expected.extraction, row.initialCandidate);
      assert.deepEqual(row.rubric.preserveInitialKeys, row.initialCandidate.items.map(value => value.key));
    } else {
      assert.notDeepEqual(row.expected.extraction, row.initialCandidate);
      assert.ok(row.expected.extraction.items.some(value => value.barrier));
      assert.ok(row.rubric.barrierEvidence.length);
      if (row.rubric.mechanisms.includes('failure_after_success')) {
        const positives = row.expected.extraction.items.filter(value => value.kind === 'outcome' && value.status === 'positive');
        const failures = row.expected.extraction.items.filter(value => value.kind === 'outcome' && value.status === 'unsuccessful');
        assert.equal(positives.length, 1); assert.equal(failures.length, 1);
        assert.notEqual(positives[0].key, failures[0].key); assert.ok(failures[0].barrier);
      }
    }
  }
});

test('final restraint instances do not share mutable data across runs', () => {
  const first = finalRestraintCases();
  first[0].initialCandidate.items[0].statement = 'changed';
  first[0].expected.extraction.items[0].statement = 'changed';
  first[0].rubric.requiredObservations[0].statuses[0] = 'changed';
  const next = finalRestraintCases();
  assert.notEqual(next[0].initialCandidate.items[0].statement, 'changed');
  assert.notEqual(next[0].expected.extraction.items[0].statement, 'changed');
  assert.notEqual(next[0].rubric.requiredObservations[0].statuses[0], 'changed');
});
