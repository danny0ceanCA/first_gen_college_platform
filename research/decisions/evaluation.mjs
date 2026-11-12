// Offline measurements only. This module never invokes a provider or takes an
// action from a classification. Unavailable classifications are not negatives.
import { SUPPORT_NEEDS } from './rubric.mjs';
const SUCCESS_STATUSES = new Set(['completed', 'ok', 'success']);
const HELP_NEEDS = new Set(SUPPORT_NEEDS.filter(need => !['none', 'unclear'].includes(need)));
const LANGUAGES = ['en', 'es', 'mixed'];
const SPLITS = ['calibration', 'holdout'];
const ROLES = ['family', 'student', 'unknown'];
const roleOf = (record) => ['family', 'student'].includes(record.role) ? record.role : 'unknown';

function isClassification(value) {
  return value && SUPPORT_NEEDS.includes(value.supportNeed)
    && typeof value.alreadyAddressed === 'boolean';
}

function isAvailable(record) {
  return SUCCESS_STATUSES.has(record.status) && isClassification(record.result);
}

function isCandidate(value) {
  return HELP_NEEDS.has(value.supportNeed) && !value.alreadyAddressed;
}

function probability(record) {
  const value = record.result?.selectedProbability;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function validateRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('Evaluation records must be an array.');
  for (const record of records) {
    if (!record || typeof record.fixtureId !== 'string' || !record.fixtureId
      || !['en', 'es', 'mixed'].includes(record.language)
      || !['calibration', 'holdout'].includes(record.split)
      || !isClassification(record.expected)) {
      throw new TypeError('Each record needs a fixture ID, language, split, and valid expected labels.');
    }
  }
}

const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

function confusion(labels) {
  return Object.fromEntries(labels.map((label) => [label,
    Object.fromEntries(labels.map((prediction) => [prediction, 0])),
  ]));
}

// Nearest-rank percentiles report an observed latency rather than interpolate it.
function timing(records) {
  const values = records.map((record) => record.durationMs)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const percentile = (fraction) => values.length
    ? values[Math.max(0, Math.ceil(fraction * values.length) - 1)] : null;
  return { samples: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), method: 'nearest_rank' };
}

function candidateMetrics(records, accepts = (record) => isCandidate(record.result)) {
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  for (const record of records) {
    const expectedCandidate = isCandidate(record.expected);
    const predictedCandidate = accepts(record);
    if (predictedCandidate && expectedCandidate) truePositives += 1;
    else if (predictedCandidate) falsePositives += 1;
    else if (expectedCandidate) falseNegatives += 1;
    else trueNegatives += 1;
  }
  return {
    truePositives, falsePositives, trueNegatives, falseNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
  };
}

function summarize(records) {
  const available = records.filter(isAvailable);
  const supportConfusion = confusion(SUPPORT_NEEDS);
  const addressedConfusion = confusion(['false', 'true']);
  let correctSupport = 0;
  let correctAddressed = 0;
  let correctJoint = 0;
  for (const { expected, result } of available) {
    supportConfusion[expected.supportNeed][result.supportNeed] += 1;
    addressedConfusion[String(expected.alreadyAddressed)][String(result.alreadyAddressed)] += 1;
    const supportMatches = expected.supportNeed === result.supportNeed;
    const addressedMatches = expected.alreadyAddressed === result.alreadyAddressed;
    if (supportMatches) correctSupport += 1;
    if (addressedMatches) correctAddressed += 1;
    if (supportMatches && addressedMatches) correctJoint += 1;
  }
  const statusCounts = {};
  for (const record of records) {
    const status = record.status || 'missing_status';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  return {
    sampleSize: records.length,
    fixtureCount: new Set(records.map((record) => record.fixtureId)).size,
    available: available.length,
    unavailable: records.length - available.length,
    invalidSuccessfulResults: records.filter((record) => SUCCESS_STATUSES.has(record.status)
      && !isClassification(record.result)).length,
    availabilityRate: ratio(available.length, records.length),
    supportNeed: { correct: correctSupport, accuracy: ratio(correctSupport, available.length), confusion: supportConfusion },
    alreadyAddressed: { correct: correctAddressed, accuracy: ratio(correctAddressed, available.length), confusion: addressedConfusion },
    jointAccuracy: ratio(correctJoint, available.length),
    optionalHelp: candidateMetrics(available),
    timing: timing(records),
    availableTiming: timing(available),
    statusCounts,
  };
}

function groupedSummaries(records, summarizeGroup) {
  return {
    overall: summarizeGroup(records),
    byLanguage: Object.fromEntries(LANGUAGES.map((language) => [language,
      summarizeGroup(records.filter((record) => record.language === language)),
    ])),
    bySplit: Object.fromEntries(SPLITS.map((split) => [split,
      summarizeGroup(records.filter((record) => record.split === split)),
    ])),
    byLanguageAndSplit: Object.fromEntries(LANGUAGES.map((language) => [language,
      Object.fromEntries(SPLITS.map((split) => [split,
        summarizeGroup(records.filter((record) => record.language === language && record.split === split)),
      ])),
    ])),
    byRole: Object.fromEntries(ROLES.map((role) => [role,
      summarizeGroup(records.filter((record) => roleOf(record) === role)),
    ])),
  };
}

export function evaluateResults(records) {
  validateRecords(records);
  return {
    ...groupedSummaries(records, summarize),
    interpretation: 'Accuracy and candidate precision/recall use available classifications only. Unavailable results and timings are reported separately. Classification is not an instruction to act.',
  };
}

export function evaluateThreshold(records, calibration) {
  validateRecords(records);
  if (!calibration || calibration.sourceSplit !== 'calibration'
    || typeof calibration.enabled !== 'boolean'
    || (calibration.enabled ? !Number.isFinite(calibration.threshold)
      || calibration.threshold < 0 || calibration.threshold > 1 : calibration.threshold !== null)) {
    throw new TypeError('Threshold evaluation requires an unchanged calibration result.');
  }
  const { enabled, threshold } = calibration;
  // This function applies a frozen choice; it never calls calibrateThreshold or
  // changes the threshold in response to holdout outcomes or language groups.
  const accepts = (record) => enabled && isCandidate(record.result)
    && probability(record) !== null && probability(record) >= threshold;
  const summarizeThreshold = (group) => {
    const available = group.filter(isAvailable);
    const candidates = available.filter((record) => isCandidate(record.result));
    const accepted = available.filter(accepts);
    const correctSubtype = accepted.filter((record) => isCandidate(record.expected)
      && record.expected.supportNeed === record.result.supportNeed).length;
    return {
      sampleSize: group.length,
      fixtureCount: new Set(group.map((record) => record.fixtureId)).size,
      available: available.length,
      unavailable: group.length - available.length,
      rawCandidates: candidates.length,
      missingCandidateScoreCount: candidates.filter((record) => probability(record) === null).length,
      acceptedCandidates: accepted.length,
      acceptedCorrectSubtype: correctSubtype,
      acceptedSubtypePrecision: ratio(correctSubtype, accepted.length),
      ...candidateMetrics(available, accepts),
    };
  };
  return {
    enabled, threshold, sourceSplit: 'calibration',
    calibrationSampleSize: calibration.sampleSize ?? null,
    ...groupedSummaries(records, summarizeThreshold),
    interpretation: 'The calibration threshold is applied unchanged to every evaluated group. Unavailable classifications are excluded from precision/recall and counted separately. This measures label/probability filtering, not the full observer disposition or authorization to act.',
  };
}

export function calibrateThreshold(records) {
  if (!Array.isArray(records)) throw new TypeError('Calibration records must be an array.');
  // Select the preassigned split before inspecting any labels or model results.
  const calibration = records.filter((record) => record?.split === 'calibration');
  validateRecords(calibration);
  const available = calibration.filter(isAvailable);
  const candidates = available.filter((record) => isCandidate(record.result));
  const scored = candidates.filter((record) => probability(record) !== null);
  const positiveEvidence = available.filter((record) => isCandidate(record.expected)).length;
  const negativeEvidence = available.length - positiveEvidence;
  const base = {
    sourceSplit: 'calibration',
    sampleSize: calibration.length,
    availableSampleSize: available.length,
    unavailableSampleSize: calibration.length - available.length,
    scoredCandidateSampleSize: scored.length,
    missingCandidateScoreCount: candidates.length - scored.length,
    positiveEvidence, negativeEvidence,
    interpretation: 'Zero observed false positives on a small calibration set does not establish production safety or calibrated probabilities. Holdout outcomes are not used to select this threshold.',
  };
  if (!positiveEvidence || !negativeEvidence) {
    return { ...base, enabled: false, threshold: null, reason: 'insufficient_positive_or_negative_evidence' };
  }
  // Pick the lowest observed candidate score that accepts at least one genuine
  // request and no observed false positives. Ties are never split or rounded.
  const thresholds = [...new Set(scored.map(probability))].sort((left, right) => left - right);
  for (const threshold of thresholds) {
    const accepts = (record) => isCandidate(record.result)
      && probability(record) !== null && probability(record) >= threshold;
    const metrics = candidateMetrics(available, accepts);
    if (metrics.truePositives > 0 && metrics.falsePositives === 0) {
      return {
        ...base, enabled: true, threshold, reason: 'zero_observed_calibration_false_positives',
        acceptedCandidates: metrics.truePositives + metrics.falsePositives,
        ...metrics,
      };
    }
  }
  return { ...base, enabled: false, threshold: null, reason: 'no_threshold_with_true_positives_and_zero_observed_false_positives' };
}
