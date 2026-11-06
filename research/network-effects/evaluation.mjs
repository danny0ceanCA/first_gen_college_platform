import { validateSource, validateExtraction } from './contracts.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';

function reject(code) {
  throw Object.assign(new Error(code), { code });
}

function ratio(numerator, denominator) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function matchKey(item) {
  if (!item || typeof item !== 'object' || typeof item.quote !== 'string' || typeof item.kind !== 'string') return null;
  return JSON.stringify([item.quote, item.kind]);
}

function buildReferenceItems(records) {
  const items = new Map();
  for (const { source, expected } of records) {
    if (!expected || !Array.isArray(expected.items)) reject('invalid_evaluation_reference');
    for (const item of expected.items) {
      const id = `${source.id}@${source.version}#${item?.key}`;
      const reference = { ...item, id, accountId: source.accountId, studentId: source.studentId, state: 'current' };
      if (items.has(id) && JSON.stringify(items.get(id)) !== JSON.stringify(reference)) reject('conflicting_evaluation_reference');
      items.set(id, reference);
    }
  }
  return items;
}

function validationContext(record, references) {
  // Include only reference identities used by this example. Lifecycle ordering,
  // correction supersession, and deletion are exercised by the storage tests.
  const referenceIds = new Set();
  for (const extraction of [record.expected, record.actual]) {
    if (!Array.isArray(extraction?.items)) continue;
    for (const item of extraction.items) {
      if (typeof item?.linksTo === 'string') referenceIds.add(item.linksTo);
      if (typeof item?.corrects === 'string') referenceIds.add(item.corrects);
    }
  }
  return { existingItems: [...referenceIds].map(id => references.get(id)).filter(item => item
    && item.accountId === record.source.accountId && item.studentId === record.source.studentId) };
}

/** Compare predictions to human reference labels. This does not grade semantic truth. */
export function evaluatePredictions(rawRecords) {
  if (!Array.isArray(rawRecords) || rawRecords.length > 1000) reject('invalid_evaluation_records');
  const records = rawRecords.map(record => {
    if (!record || typeof record !== 'object' || !Object.hasOwn(record, 'expected') || !Object.hasOwn(record, 'actual')) reject('invalid_evaluation_record');
    return { ...record, source: validateSource(record.source) };
  });
  const references = buildReferenceItems(records);
  const counts = {
    records: records.length, expectedItems: 0, predictedItems: 0, matchedItems: 0,
    missingItems: 0, unexpectedItems: 0, invalidOutputs: 0,
    statusMatches: 0, reporterMatches: 0,
    pendingOutcomes: 0, pendingPreserved: 0, unknownOutcomes: 0, unknownPreserved: 0,
  };
  const details = [];
  for (const record of records) {
    const context = validationContext(record, references);
    let expected;
    try {
      expected = validateExtraction(record.expected, record.source, context);
    } catch {
      reject('invalid_evaluation_reference');
    }
    let validation = { valid: true, code: null };
    try {
      validateExtraction(record.actual, record.source, context);
    } catch (error) {
      validation = { valid: false, code: /^[a-z_]+$/.test(error.code) ? error.code : 'invalid_extraction' };
      counts.invalidOutputs += 1;
    }
    const predictions = Array.isArray(record.actual?.items) ? record.actual.items : [];
    if (predictions.length > 1000) reject('evaluation_prediction_limit');
    const available = new Map();
    for (const [index, prediction] of predictions.entries()) {
      const key = matchKey(prediction);
      if (key === null) continue;
      const indices = available.get(key) ?? [];
      indices.push(index);
      available.set(key, indices);
    }
    const matches = [];
    const missingKeys = [];
    const matchedIndices = new Set();
    counts.expectedItems += expected.items.length;
    counts.predictedItems += predictions.length;
    for (const item of expected.items) {
      const pending = item.kind === 'outcome' && item.status === 'pending';
      const unknown = item.kind === 'outcome' && item.status === 'unknown';
      if (pending) counts.pendingOutcomes += 1;
      if (unknown) counts.unknownOutcomes += 1;
      const index = available.get(matchKey(item))?.shift();
      if (index === undefined) {
        missingKeys.push(item.key);
        counts.missingItems += 1;
        continue;
      }
      matchedIndices.add(index);
      const prediction = predictions[index];
      const statusMatches = prediction.status === item.status;
      const reporterMatches = prediction.reportedBy === item.reportedBy;
      counts.matchedItems += 1;
      if (statusMatches) counts.statusMatches += 1;
      if (reporterMatches) counts.reporterMatches += 1;
      if (pending && statusMatches) counts.pendingPreserved += 1;
      if (unknown && statusMatches) counts.unknownPreserved += 1;
      matches.push({
        expectedKey: item.key, predictedKey: prediction.key ?? null,
        kind: item.kind, quote: item.quote,
        expectedStatus: item.status, predictedStatus: prediction.status ?? null,
        expectedReporter: item.reportedBy, predictedReporter: prediction.reportedBy ?? null,
        statusMatches, reporterMatches,
      });
    }
    const unexpectedIndices = predictions.map((_item, index) => index).filter(index => !matchedIndices.has(index));
    counts.unexpectedItems += unexpectedIndices.length;
    details.push({
      sourceId: record.source.id, sourceVersion: record.source.version,
      language: record.source.language, synthetic: record.source.synthetic,
      expectedItems: expected.items.length, predictedItems: predictions.length,
      validation, matches, missingKeys, unexpectedIndices,
    });
  }
  return {
    schemaVersion: 1,
    method: 'exact-evidence-and-kind-v1',
    counts,
    metrics: {
      evidencePrecision: ratio(counts.matchedItems, counts.predictedItems),
      evidenceRecall: ratio(counts.matchedItems, counts.expectedItems),
      statusAgreement: ratio(counts.statusMatches, counts.matchedItems),
      reporterAgreement: ratio(counts.reporterMatches, counts.matchedItems),
      pendingOutcomePreservation: ratio(counts.pendingPreserved, counts.pendingOutcomes),
      unknownOutcomePreservation: ratio(counts.unknownPreserved, counts.unknownOutcomes),
      validOutputRate: ratio(counts.records - counts.invalidOutputs, counts.records),
    },
    records: details,
    limitations: [
      'Precision and recall match exact source quotes and observation kinds. They do not measure semantic correctness or student benefit.',
      'Comparable fields from invalid outputs remain in diagnostic scoring. Invalid outputs still fail the storage contract.',
      'Status and reporter agreement use matched items. Pending and unknown preservation also count missing predictions as unpreserved.',
      'Reference labels require human review. This report does not evaluate live audio or prove causal guidance effectiveness.',
      'Reference identity validation is independent of timeline order. Lifecycle regression tests cover supersession, source revisions, and deletion.',
    ],
  };
}

export function demoEvaluation() {
  const records = demoSources().map(source => ({ source, expected: demoExtraction(source), actual: demoExtraction(source) }));
  const candidate = structuredClone(records);
  candidate.find(record => record.source.id === 'demo-parent-costs').actual.items[0].reportedBy = 'student';
  candidate.find(record => record.source.id === 'demo-application-pending').actual.items[1].status = 'positive';
  candidate.find(record => record.source.id === 'demo-unknown-speaker').actual.items[0].status = 'positive';
  candidate.find(record => record.source.id === 'demo-practical-needs').actual.items.pop();
  const first = candidate[0].actual.items[0];
  candidate[0].actual.items.push({ ...first, key: 'duplicated-observation' });
  return {
    mode: 'synthetic-evaluation-harness-check',
    providerCalls: 0,
    description: 'Hand-authored fictional labels are replayed, then deliberate errors are inserted to verify the scoring harness. These scores do not establish AI extraction quality.',
    referenceReplay: evaluatePredictions(records),
    knownErrors: evaluatePredictions(candidate),
  };
}
