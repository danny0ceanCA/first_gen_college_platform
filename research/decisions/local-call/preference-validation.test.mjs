import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePreferenceResult } from './validate-preference-classifier.mjs';

test('reported eligibility matches whole-snapshot gate even when only an unchanged dimension is uncertain', () => {
  const fixture = { id: 'fictional-retraction', language: 'en', expected: { plain_language: 'disable', one_step_at_a_time: 'unchanged' } };
  const parsed = { status: 'completed', result: { preferenceChanges: [
    { preference: 'plain_language', action: 'disable', confidence: .99, selectedProbability: .99 },
    { preference: 'one_step_at_a_time', action: 'unchanged', confidence: .7, selectedProbability: .8 },
  ] } };
  const result = scorePreferenceResult(fixture, parsed);
  assert.equal(result.eligible, false); assert.equal(result.passed, false);
  assert.equal(result.mismatches[0].expected, 'disable'); assert.equal(result.mismatches[0].actual, 'unchanged');
  parsed.result.preferenceChanges[1].confidence = .95; parsed.result.preferenceChanges[1].selectedProbability = .98;
  assert.equal(scorePreferenceResult(fixture, parsed).passed, true);
});
