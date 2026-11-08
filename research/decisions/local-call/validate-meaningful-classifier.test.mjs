import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEarlyRequest } from './early-rubric.mjs';
import { needHistoryFixtures } from './need-history-fixtures.mjs';
import { meaningfulClassifierPlan, scoreMeaningfulResult, summarizeMeaningfulCases } from './validate-meaningful-classifier.mjs';

test('fixed independently authored set has 12 cases per language and explicit source IDs', () => {
  assert.equal(needHistoryFixtures.length, 24);
  assert.equal(new Set(needHistoryFixtures.map(row => row.id)).size, 24);
  for (const language of ['en', 'es']) assert.equal(needHistoryFixtures.filter(row => row.language === language).length, 12);
  for (const row of needHistoryFixtures) {
    assert.ok(Object.isFrozen(row)); assert.equal(row.snapshot.provisional, true);
    assert.equal(row.snapshot.complete, false);
    assert.ok(row.snapshot.explanationHistory.rows.every(turn => turn.sourceEventIds.length > 0 && turn.source === 'application_estimate'));
    assert.doesNotThrow(() => buildEarlyRequest(row.snapshot));
  }
});

test('preflight is default; only an explicit execute flag permits the fixed maximum', () => {
  assert.equal(meaningfulClassifierPlan().execute, false);
  assert.equal(meaningfulClassifierPlan(['--execute']).maximumRequests, 24);
  assert.equal(meaningfulClassifierPlan(['--execute']).liveCalls, 0);
  const focused = meaningfulClassifierPlan(['--focused-retest']);
  assert.equal(focused.execute, false); assert.equal(focused.maximumRequests, 5);
  assert.equal(focused.evaluationDesign, 'development_retest_of_five_known_cases_not_holdout');
  assert.equal(meaningfulClassifierPlan(['--focused-retest', '--execute']).maximumRequests, 5);
  for (const args of [['--reset'], ['--execute', '--execute'], ['--cap', '100']])
    assert.throws(() => meaningfulClassifierPlan(args), /unsupported_argument/);
});

test('scoring separates action, eligibility, clearing, unavailable and language counts', () => {
  const en = needHistoryFixtures[0], es = needHistoryFixtures[1];
  const correct = scoreMeaningfulResult(en, { status: 'completed', decision: en.expected });
  assert.equal(correct.passed, true);
  const wrong = scoreMeaningfulResult(es, { status: 'completed', decision: { ...es.expected, eligible: false, action: 'none' } });
  assert.deepEqual(wrong.mismatch, ['action', 'eligible']);
  const unavailable = scoreMeaningfulResult(en, null);
  const summary = summarizeMeaningfulCases([{ ...correct, durationMs: 100 }, { ...wrong, durationMs: 300 }, unavailable]);
  assert.equal(summary.evaluated, 3); assert.equal(summary.passed, 1);
  assert.equal(summary.missedEligible, 2); assert.equal(summary.unavailable, 1);
  assert.equal(summary.byLanguage.en.evaluated, 2); assert.equal(summary.byLanguage.es.evaluated, 1);
  assert.equal(summary.p50Ms, 100); assert.equal(summary.p95Ms, 300);
});
