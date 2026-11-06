import test from 'node:test';
import assert from 'node:assert/strict';
import { restraintCases, restraintVersion } from './verification-restraint-fixtures.mjs';
import { verificationCases } from './verification-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';

test('restraint holdout balances languages, clean controls and material defects with new fictional text', () => {
  const cases = restraintCases(), previous = verificationCases();
  assert.equal(restraintVersion, 'first-generation-verifier-restraint-18-v1');
  assert.equal(cases.length, 18);
  assert.equal(new Set(cases.map(row => row.id)).size, 18);
  for (const language of ['en', 'es', 'mixed']) {
    const group = cases.filter(row => row.source.language === language);
    assert.equal(group.length, 6);
    assert.equal(group.filter(row => row.expected.decision === 'keep').length, 3);
    assert.equal(group.filter(row => row.expected.decision === 'revise').length, 3);
  }
  for (const row of cases) {
    assert.equal(row.split, 'heldout'); assert.equal(row.source.synthetic, true);
    assert.equal(row.rubric.humanReview, 'pending');
    assert.ok(!previous.some(old => old.source.text === row.source.text || old.id === row.id));
    assert.ok(!Object.hasOwn(row.source, 'expected'));
    assert.ok(!Object.hasOwn(row.initialCandidate, 'rubric'));
  }
});

test('restraint candidates and expected repairs are canonical, grounded and reference safe', () => {
  for (const row of restraintCases()) {
    validateSource(row.source);
    validateExtraction(row.initialCandidate, row.source, { existingItems: row.existingItems });
    validateExtraction(row.expected.extraction, row.source, { existingItems: row.existingItems });
    for (const candidate of [row.initialCandidate, row.expected.extraction]) {
      for (const item of candidate.items) {
        assert.ok(row.source.text.includes(item.quote));
        assert.equal(item.language, row.source.language);
        assert.equal(item.corrects, null); assert.equal(item.occurredAt, null);
        if (item.linksTo) assert.ok(candidate.items.some(other => other.key === item.linksTo));
      }
    }
    for (const quote of row.rubric.barrierEvidence) assert.ok(row.source.text.includes(quote));
    for (const required of row.rubric.requiredObservations) {
      assert.ok(row.expected.extraction.items.some(item => item.kind === required.kind && required.statuses.includes(item.status)
        && (!required.requireBarrier || item.barrier)), row.id);
    }
    for (const [kind, status] of row.rubric.forbiddenKindStatuses) {
      assert.ok(!row.expected.extraction.items.some(item => item.kind === kind && item.status === status), row.id);
    }
  }
});

test('clean controls demand exact preservation while every defect needs a substantive repair and obstacle field', () => {
  const cases = restraintCases();
  for (const row of cases) {
    if (row.expected.decision === 'keep') {
      assert.deepEqual(row.expected.extraction, row.initialCandidate);
      assert.deepEqual(row.rubric.preserveInitialKeys, row.initialCandidate.items.map(item => item.key));
    } else {
      assert.notDeepEqual(row.expected.extraction, row.initialCandidate);
      assert.ok(row.rubric.requiredObservations.some(item => item.requireBarrier));
      assert.ok(row.rubric.barrierEvidence.length);
      assert.ok(row.expected.extraction.items.some(item => {
        const prior = row.initialCandidate.items.find(other => other.key === item.key);
        return !prior || ['kind', 'status', 'statement', 'barrier', 'reportedBy'].some(field => prior[field] !== item[field]);
      }));
    }
  }
  const mechanisms = new Set(cases.flatMap(row => row.rubric.mechanisms));
  for (const value of ['no_inferred_action', 'clean_optional_question', 'clean_waiting_dependency',
    'preserve_explicit_barrier', 'mixed_negation', 'family_attribution', 'obstacle_after_progress',
    'omitted_knowledge_barrier', 'omitted_access_barrier']) assert.ok(mechanisms.has(value));
});

test('restraint fixtures do not share mutable candidates, labels or rubrics between runs', () => {
  const first = restraintCases();
  first[0].initialCandidate.items[0].statement = 'changed';
  first[0].expected.extraction.items[0].statement = 'changed';
  first[0].rubric.requiredObservations[0].statuses[0] = 'changed';
  const next = restraintCases();
  assert.notEqual(next[0].initialCandidate.items[0].statement, 'changed');
  assert.notEqual(next[0].expected.extraction.items[0].statement, 'changed');
  assert.notEqual(next[0].rubric.requiredObservations[0].statuses[0], 'changed');
});
