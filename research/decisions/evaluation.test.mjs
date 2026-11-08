import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures } from './fixtures.mjs';
import { calibrateThreshold, evaluateResults, evaluateThreshold } from './evaluation.mjs';

const label = (supportNeed, alreadyAddressed = false) => ({ supportNeed, alreadyAddressed });
const record = (id, truth, predicted, extras = {}) => ({
  fixtureId: id, language: 'en', split: 'calibration', expected: truth,
  result: predicted ? { ...predicted, selectedProbability: 0.9, confidence: 'high' } : null,
  status: predicted ? 'completed' : 'timeout', durationMs: 10,
  ...extras,
});

test('fictional fixture splits are fixed and cover the agreed languages and edge cases', () => {
  assert.equal(fixtures.length, 36);
  assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, 36);
  assert.deepEqual(Object.fromEntries(['en', 'es', 'mixed'].map((language) => [language,
    fixtures.filter((fixture) => fixture.language === language).length,
  ])), { en: 14, es: 14, mixed: 8 });
  assert.equal(fixtures.filter((fixture) => fixture.split === 'calibration').length, 18);
  assert.equal(fixtures.filter((fixture) => fixture.split === 'holdout').length, 18);
  assert.ok(Object.isFrozen(fixtures));
  for (const fixture of fixtures) {
    assert.ok(Object.isFrozen(fixture.expected));
    assert.equal(fixture.question, fixture.transcripts.findLast((entry) => entry.role === 'user').text);
    assert.ok(['student', 'family'].includes(fixture.role));
    assert.ok(fixture.transcripts.every((entry) => typeof entry.complete === 'boolean'
      && entry.endMs >= entry.startMs));
    assert.equal(new Set(fixture.transcripts.map((entry) => entry.id)).size, fixture.transcripts.length);
  }
  assert.ok(fixtures.some((fixture) => fixture.expected.alreadyAddressed));
  assert.ok(fixtures.some((fixture) => fixture.transcripts.some((entry) => !entry.complete)));
  assert.ok(fixtures.some((fixture) => fixture.opportunities?.some((entry) => entry.status === 'declined')));
  assert.equal(fixtures.filter((fixture) => fixture.researchFindings?.length).length, 2);
  for (const fact of fixtures.flatMap((fixture) => fixture.researchFindings || [])) {
    assert.deepEqual(Object.keys(fact).sort(), ['id', 'jobId', 'revision', 'fact', 'year', 'scenario', 'limitation', 'sourceIds'].sort());
  }
});

test('accuracy, confusion, optional-help precision/recall and timing stay distinct', () => {
  const records = [
    record('tp', label('starting_point'), label('starting_point'), { durationMs: 10 }),
    record('fp', label('none'), label('next_step'), { durationMs: 20 }),
    record('fn', label('next_step'), label('none'), { language: 'es', split: 'holdout', durationMs: 30 }),
    record('tn', label('starting_point', true), label('starting_point', true), { language: 'mixed', durationMs: 40 }),
    record('unavailable-help', label('next_step'), null, { durationMs: 100 }),
    record('unavailable-no-help', label('none'), null, { language: 'es', durationMs: 200 }),
  ];
  const result = evaluateResults(records);
  assert.equal(result.overall.sampleSize, 6);
  assert.equal(result.overall.available, 4);
  assert.equal(result.overall.unavailable, 2);
  assert.equal(result.overall.supportNeed.accuracy, 0.5);
  assert.equal(result.overall.alreadyAddressed.accuracy, 1);
  assert.equal(result.overall.jointAccuracy, 0.5);
  assert.equal(result.overall.supportNeed.confusion.none.next_step, 1);
  assert.deepEqual(result.overall.optionalHelp, {
    truePositives: 1, falsePositives: 1, trueNegatives: 1, falseNegatives: 1,
    precision: 0.5, recall: 0.5,
  });
  assert.equal(result.overall.timing.p50Ms, 30);
  assert.equal(result.overall.timing.p95Ms, 200);
  assert.equal(result.overall.availableTiming.p95Ms, 40);
  assert.equal(result.byLanguage.es.sampleSize, 2);
  assert.equal(result.byLanguage.es.unavailable, 1);
  assert.equal(result.bySplit.holdout.sampleSize, 1);
  assert.equal(result.byLanguageAndSplit.es.holdout.available, 1);
});

test('unavailable and invalid results never count as false or correct negatives', () => {
  const result = evaluateResults([
    record('timeout', label('starting_point'), null),
    record('invalid-label', label('none'), { supportNeed: 'invented', alreadyAddressed: false }),
    record('failure-with-result', label('none'), label('none'), { status: 'failed' }),
  ]).overall;
  assert.equal(result.available, 0);
  assert.equal(result.unavailable, 3);
  assert.equal(result.invalidSuccessfulResults, 1);
  assert.equal(result.supportNeed.accuracy, null);
  assert.equal(result.jointAccuracy, null);
  assert.deepEqual(result.optionalHelp, {
    truePositives: 0, falsePositives: 0, trueNegatives: 0, falseNegatives: 0,
    precision: null, recall: null,
  });
});

test('threshold uses calibration only, with zero observed candidate false positives', () => {
  const calibration = [
    record('strong-help', label('starting_point'), label('starting_point'), { result: { ...label('starting_point'), selectedProbability: 0.9 } }),
    record('weaker-help', label('next_step'), label('next_step'), { result: { ...label('next_step'), selectedProbability: 0.7 } }),
    record('false-help', label('none'), label('simpler_explanation'), { result: { ...label('simpler_explanation'), selectedProbability: 0.8 } }),
    record('no-help', label('none'), label('none')),
  ];
  const selected = calibrateThreshold(calibration);
  assert.equal(selected.enabled, true);
  assert.equal(selected.threshold, 0.9);
  assert.equal(selected.falsePositives, 0);
  assert.equal(selected.truePositives, 1);
  assert.equal(selected.precision, 1);
  assert.equal(selected.recall, 0.5);
  const heldOut = {
    split: 'holdout',
    get expected() { throw new Error('Holdout labels must not be inspected during calibration.'); },
    get result() { throw new Error('Holdout predictions must not be inspected during calibration.'); },
  };
  assert.deepEqual(calibrateThreshold([...calibration, heldOut]), selected);
});

test('ties at probability one cannot be hidden by a threshold or rounding', () => {
  const tied = [
    record('true-help', label('starting_point'), label('starting_point'), { result: { ...label('starting_point'), selectedProbability: 1 } }),
    record('false-help', label('none'), label('starting_point'), { result: { ...label('starting_point'), selectedProbability: 1 } }),
  ];
  const result = calibrateThreshold(tied);
  assert.equal(result.enabled, false);
  assert.equal(result.threshold, null);
  assert.equal(result.reason, 'no_threshold_with_true_positives_and_zero_observed_false_positives');
});

test('calibration needs observed positive and negative examples and valid probabilities', () => {
  const positive = record('positive', label('starting_point'), label('starting_point'));
  assert.equal(calibrateThreshold([positive]).reason, 'insufficient_positive_or_negative_evidence');
  const noProbability = { ...positive, result: { ...label('starting_point'), confidence: 1 } };
  const result = calibrateThreshold([noProbability, record('negative', label('none'), label('none'))]);
  assert.equal(result.enabled, false);
  assert.equal(result.missingCandidateScoreCount, 1);
  assert.equal(result.scoredCandidateSampleSize, 0);
});

test('already-addressed help is not a new candidate and subtype accuracy is measured separately', () => {
  const result = evaluateResults([
    record('repeat', label('starting_point', true), label('starting_point')),
    record('wrong-kind', label('starting_point'), label('next_step')),
  ]).overall;
  assert.equal(result.optionalHelp.falsePositives, 1);
  assert.equal(result.optionalHelp.truePositives, 1);
  assert.equal(result.supportNeed.accuracy, 0.5);
  assert.equal(result.alreadyAddressed.accuracy, 0.5);
  assert.equal(result.jointAccuracy, 0);
});

test('empty measurements are explicit and invalid expected labels fail rather than inflate metrics', () => {
  const empty = evaluateResults([]);
  assert.equal(empty.overall.sampleSize, 0);
  assert.equal(empty.overall.timing.samples, 0);
  assert.equal(empty.overall.timing.p50Ms, null);
  assert.equal(empty.byLanguage.es.optionalHelp.precision, null);
  assert.throws(() => evaluateResults([record('bad-truth', label('not-a-label'), label('none'))]), TypeError);
  assert.equal(evaluateResults([record('invalid-time', label('none'), label('none'), { durationMs: Infinity })]).overall.timing.samples, 0);
});

test('role summaries include family, student and unknown without dropping unavailable records', () => {
  const result = evaluateResults([
    record('family-help', label('starting_point'), label('starting_point'), { role: 'family' }),
    record('family-timeout', label('none'), null, { role: 'family' }),
    record('student-none', label('none'), label('none'), { role: 'student' }),
    record('missing-role', label('none'), label('none')),
    record('unrecognized-role', label('none'), label('none'), { role: 'unspecified' }),
  ]);
  assert.equal(result.byRole.family.sampleSize, 2);
  assert.equal(result.byRole.family.available, 1);
  assert.equal(result.byRole.family.unavailable, 1);
  assert.equal(result.byRole.family.jointAccuracy, 1);
  assert.equal(result.byRole.student.sampleSize, 1);
  assert.equal(result.byRole.unknown.sampleSize, 2);
  assert.equal(Object.values(result.byRole).reduce((total, group) => total + group.sampleSize, 0), 5);
});

test('holdout threshold evaluation preserves the calibration choice even when a higher score is wrong', () => {
  const calibration = Object.freeze(calibrateThreshold([
    record('cal-help', label('starting_point'), label('starting_point'), { result: { ...label('starting_point'), selectedProbability: 0.8 } }),
    record('cal-none', label('none'), label('none')),
  ]));
  assert.equal(calibration.threshold, 0.8);
  const result = evaluateThreshold([
    record('held-help', label('starting_point'), label('starting_point'), { split: 'holdout', role: 'family' }),
    record('held-false', label('none'), label('next_step'), { split: 'holdout', language: 'es', role: 'student', result: { ...label('next_step'), selectedProbability: 0.99 } }),
    record('held-low', label('next_step'), label('next_step'), { split: 'holdout', language: 'mixed', result: { ...label('next_step'), selectedProbability: 0.79 } }),
    record('held-timeout', label('starting_point'), null, { split: 'holdout', role: 'family' }),
  ], calibration);
  assert.equal(calibration.threshold, 0.8);
  assert.equal(result.threshold, 0.8);
  assert.equal(result.overall.acceptedCandidates, 2);
  assert.equal(result.overall.truePositives, 1);
  assert.equal(result.overall.falsePositives, 1);
  assert.equal(result.overall.falseNegatives, 1);
  assert.equal(result.overall.unavailable, 1);
  assert.equal(result.overall.precision, 0.5);
  assert.equal(result.overall.recall, 0.5);
  assert.equal(result.bySplit.calibration.sampleSize, 0);
  assert.equal(result.bySplit.holdout.sampleSize, 4);
  assert.equal(result.byLanguage.es.falsePositives, 1);
  assert.equal(result.byLanguageAndSplit.mixed.holdout.falseNegatives, 1);
  assert.equal(result.byRole.family.unavailable, 1);
});

test('disabled threshold and missing scores remain closed; subtype correctness stays separate', () => {
  const records = [
    record('wrong-subtype', label('starting_point'), label('next_step')),
    record('missing-score', label('next_step'), label('next_step'), { result: label('next_step') }),
    record('timeout', label('starting_point'), null),
  ];
  const selected = { enabled: true, threshold: 0.8, sourceSplit: 'calibration', sampleSize: 2 };
  const result = evaluateThreshold(records, selected);
  assert.equal(result.overall.truePositives, 1);
  assert.equal(result.overall.acceptedCorrectSubtype, 0);
  assert.equal(result.overall.acceptedSubtypePrecision, 0);
  assert.equal(result.overall.missingCandidateScoreCount, 1);
  assert.equal(result.overall.falseNegatives, 1);
  assert.equal(result.overall.unavailable, 1);
  const disabled = evaluateThreshold(records, { enabled: false, threshold: null, sourceSplit: 'calibration' });
  assert.equal(disabled.overall.acceptedCandidates, 0);
  assert.equal(disabled.overall.precision, null);
  assert.equal(disabled.overall.falseNegatives, 2);
  assert.throws(() => evaluateThreshold(records, { ...selected, sourceSplit: 'holdout' }), TypeError);
  assert.throws(() => evaluateThreshold(records, { ...selected, threshold: NaN }), TypeError);
});
