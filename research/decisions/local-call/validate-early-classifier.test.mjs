import test from 'node:test';
import assert from 'node:assert/strict';
import { earlyClassifierPlan, scoreEarlyResult } from './validate-early-classifier.mjs';
import { earlyFixtures, earlyIndependentFixtures, earlyResponseFixture } from './early-fixtures.mjs';
import { parseEarlyResponse } from './early-rubric.mjs';

const result = (options = {}, snapshot = {}) => parseEarlyResponse(earlyResponseFixture(options), snapshot);
test('early validation is a fixed fictional bilingual suite and requires an execute flag', () => {
  assert.equal(earlyClassifierPlan().execute, false);
  assert.equal(earlyClassifierPlan(['--execute']).execute, true);
  assert.equal(earlyClassifierPlan().maximumRequests, 16);
  assert.equal(earlyClassifierPlan(['--partial-trace']).maximumRequests, 8);
  assert.equal(earlyClassifierPlan(['--partial-trace']).execute, false);
  assert.equal(earlyClassifierPlan(['--partial-repair']).maximumRequests, 4);
  assert.equal(earlyClassifierPlan(['--development']).maximumRequests, 40);
  assert.equal(earlyClassifierPlan(['--development']).fixtures.length, 40);
  assert.equal(earlyClassifierPlan(['--holdout']).maximumRequests, 28);
  assert.equal(earlyClassifierPlan(['--holdout']).fixtures, null, 'planning never imports holdout text');
  assert.equal(earlyClassifierPlan(['--development', '--execute']).execute, true);
  for (const argv of [['--production'], ['--count', '100'], ['--execute', '--execute'],
    ['--development', '--holdout'], ['--partial-trace', '--development'], ['--partial-trace', '--partial-repair']])
    assert.throws(() => earlyClassifierPlan(argv), /unsupported_argument/);
});
test('a correct label below confidence threshold is reported as ineligible, not a success', () => {
  const fixture = earlyFixtures.find(value => value.id === 'en-confusion');
  assert.equal(scoreEarlyResult(fixture, result()).passed, true);
  const low = scoreEarlyResult(fixture, result({ needProbability: .6 }));
  assert.equal(low.passed, false); assert.equal(low.actionable, false);
  assert.deepEqual(low.mismatch, ['below_delivery_threshold']);
  assert.equal(low.decision.reason, 'uncertain_need');
});
test('incomplete meaning, ordinary questions, and refusals never count as actionable support', () => {
  const partial = earlyFixtures.find(value => value.id === 'es-partial');
  const ordinary = earlyFixtures.find(value => value.id === 'en-ordinary');
  assert.equal(scoreEarlyResult(partial, result({ need: 'incomplete' })).passed, true);
  assert.equal(scoreEarlyResult(partial, result({ need: 'incomplete' })).actionable, false);
  assert.equal(scoreEarlyResult(ordinary, result({ need: 'none' })).passed, true);
  assert.equal(scoreEarlyResult(ordinary, result()).passed, false);
  assert.equal(scoreEarlyResult(ordinary, { status: 'refused', result: null }).passed, false);
});
test('clearing and addressed suppression are correct without counting as supportive delivery', () => {
  const cleared = earlyFixtures.find(value => value.id === 'es-resolved');
  const clearScore = scoreEarlyResult(cleared, result({ need: 'none', change: 'resolved' }));
  assert.equal(clearScore.passed, true); assert.equal(clearScore.actionable, false);
  assert.equal(clearScore.decision.clearSupport, true);
  const addressed = earlyIndependentFixtures.find(value => value.id === 'en-addressed');
  const addressedScore = scoreEarlyResult(addressed, result({ need: 'example', addressed: .99 }, addressed.snapshot));
  assert.equal(addressedScore.passed, true); assert.equal(addressedScore.actionable, false);
  assert.equal(scoreEarlyResult(addressed, result({ need: 'none' })).passed, false, 'no-op does not count as clearing addressed support');
});
test('example and starting-point eligibility and optional exact kind/replacement expectations are scored', () => {
  for (const [id, need] of [['en-example', 'example'], ['es-start', 'starting_point']]) {
    const fixture = earlyIndependentFixtures.find(value => value.id === id);
    assert.equal(scoreEarlyResult(fixture, result({ need })).passed, true);
    assert.equal(scoreEarlyResult(fixture, result({ need, needProbability: .5 })).passed, false);
  }
  const revised = { id: 'replacement-policy', snapshot: { language: 'en' },
    expected: { action: 'simplify', eligible: true, clearSupport: false, supportKind: 'simpler_explanation', replaceNeed: true } };
  assert.equal(scoreEarlyResult(revised, result({ change: 'revised_need' })).passed, true);
  assert.deepEqual(scoreEarlyResult(revised, result()).mismatch, ['replace_need']);
});
