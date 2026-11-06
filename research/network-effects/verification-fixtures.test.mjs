import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationCases, verificationVersion } from './verification-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';
import { calibrationCases } from './calibration-fixtures.mjs';
import { freshCalibrationCases } from './calibration-fresh-fixtures.mjs';
import { fresh2CalibrationCases } from './calibration-fresh2-fixtures.mjs';
import { interpretationCases } from './calibration-interpretation-fixtures.mjs';
import { finalInterpretationCases } from './interpretation-final-fixtures.mjs';

test('verifier fixtures balance fresh fictional development/holdout cases and clean controls', () => {
  const cases = verificationCases();
  assert.equal(verificationVersion, 'first-generation-verification-18-v1');
  assert.equal(cases.length, 18);
  assert.equal(new Set(cases.map(value => value.id)).size, 18);
  const oldCases = [...calibrationCases(), ...freshCalibrationCases(), ...fresh2CalibrationCases(),
    ...interpretationCases(), ...finalInterpretationCases()];
  for (const split of ['development', 'heldout']) {
    for (const language of ['en', 'es', 'mixed']) {
      const group = cases.filter(value => value.split === split && value.source.language === language);
      assert.equal(group.length, 3);
      assert.equal(group.filter(value => value.expected.decision === 'keep').length, 1);
      assert.equal(group.filter(value => value.expected.decision === 'revise').length, 2);
    }
  }
  for (const value of cases) {
    assert.equal(value.source.synthetic, true);
    assert.equal(value.rubric.humanReview, 'pending');
    assert.ok(!oldCases.some(old => old.source.id === value.source.id || old.source.text === value.source.text));
    assert.ok(!Object.hasOwn(value.source, 'expected'));
    assert.ok(!Object.hasOwn(value.initialCandidate, 'expected'));
  }
});

test('verifier candidates and expected repairs are canonical, grounded, and use only supplied references', () => {
  for (const value of verificationCases()) {
    validateSource(value.source);
    validateExtraction(value.initialCandidate, value.source, { existingItems: value.existingItems });
    validateExtraction(value.expected.extraction, value.source, { existingItems: value.existingItems });
    for (const priorSource of value.priorSources) {
      validateSource(priorSource);
      const items = value.existingItems.filter(prior => prior.sourceId === priorSource.id).map(prior => {
        const { id, sourceId, sourceVersion, accountId, studentId, state, ...canonical } = prior;
        return canonical;
      });
      validateExtraction({ schemaVersion: 1, items }, priorSource);
    }
    for (const extraction of [value.initialCandidate, value.expected.extraction]) {
      for (const observed of extraction.items) {
        assert.equal(observed.corrects, null);
        assert.equal(observed.occurredAt, null);
        assert.ok(value.source.text.includes(observed.quote));
        assert.equal(observed.language, value.source.language);
        if (observed.linksTo) assert.ok(extraction.items.some(local => local.key === observed.linksTo)
          || value.existingItems.some(prior => prior.id === observed.linksTo));
      }
    }
    for (const required of value.rubric.requiredObservations) {
      assert.ok(value.expected.extraction.items.some(observed => observed.kind === required.kind
        && required.statuses.includes(observed.status) && (!required.requireBarrier || observed.barrier)), value.id);
    }
    for (const [kind, status] of value.rubric.forbiddenKindStatuses) {
      assert.ok(!value.expected.extraction.items.some(observed => observed.kind === kind && observed.status === status));
    }
    if (value.rubric.requirePriorLink) {
      assert.ok(value.existingItems.length > 0);
      assert.ok(value.expected.extraction.items.some(observed => value.existingItems.some(prior => prior.id === observed.linksTo)));
    }
  }
});

test('verifier clean controls are exact no-ops and repairs contain substantive semantic changes', () => {
  for (const value of verificationCases()) {
    if (value.expected.decision === 'keep') {
      assert.deepEqual(value.expected.extraction, value.initialCandidate);
      assert.deepEqual(value.rubric.preserveInitialKeys, value.initialCandidate.items.map(observed => observed.key));
    } else {
      assert.notDeepEqual(value.expected.extraction, value.initialCandidate);
      assert.ok(value.expected.extraction.items.some(expected => {
        const initial = value.initialCandidate.items.find(observed => observed.key === expected.key);
        return !initial || ['kind', 'status', 'statement', 'barrier', 'reportedBy', 'linksTo'].some(field => initial[field] !== expected[field]);
      }));
    }
  }
  const mechanisms = new Set(verificationCases().flatMap(value => value.rubric.mechanisms));
  for (const required of ['wrong_actor', 'unknown_reporter_despite_explicit_parent', 'negated_completion',
    'completed_request_understated', 'omitted_unsuccessful_result', 'omitted_barrier',
    'clean_no_prior_correction_target', 'missing_existing_prior_link', 'clean_pending_fulfillment',
    'false_understanding', 'false_positive_result']) assert.ok(mechanisms.has(required));
});

test('verifier fixture instances cannot leak prior mutations across test runs', () => {
  const first = verificationCases();
  first[0].initialCandidate.items[0].statement = 'mutated';
  first[0].expected.extraction.items[0].statement = 'mutated';
  first[0].rubric.requiredObservations[0].statuses[0] = 'mutated';
  const second = verificationCases();
  assert.notEqual(second[0].initialCandidate.items[0].statement, 'mutated');
  assert.notEqual(second[0].expected.extraction.items[0].statement, 'mutated');
  assert.notEqual(second[0].rubric.requiredObservations[0].statuses[0], 'mutated');
});
