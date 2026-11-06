const rate = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
function overlaps(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return left.includes(right) || right.includes(left);
}

function hasPriorRelationship(items, priorItems, rubric) {
  if (!rubric.priorCaseId) return false;
  const priorSource = `cal-${rubric.priorCaseId}`;
  const correctionSource = rubric.correctionCaseId ? `cal-${rubric.correctionCaseId}` : null;
  return items.some(item => priorItems.some(prior =>
    item?.linksTo === prior.id && prior.sourceId === priorSource
    || item?.corrects === prior.id && (prior.sourceId === priorSource || prior.sourceId === correctionSource)));
}

// These checks evaluate explicit, author-labelled interpretation requirements
// independently of exact quote/topic agreement. They are not a semantic judge.
function interpretationChecks(example, items, priorItems, valid) {
  const rule = example.rubric.interpretationExpected;
  if (!rule) return [];
  const checks = [{ type: 'interpretation_contract_valid', pass: valid }];
  for (const [index, required] of (rule.requiredObservations || []).entries()) {
    const matches = items.filter(item => item?.kind === required.kind && required.statuses.includes(item.status));
    checks.push({ type: 'required_interpretation_observation', requirementIndex: index,
      kind: required.kind, statuses: required.statuses, pass: matches.length > 0 });
    if (required.requireBarrier) checks.push({ type: 'required_interpretation_barrier', requirementIndex: index,
      kind: required.kind, pass: matches.some(item => typeof item.barrier === 'string' && item.barrier.trim().length > 0) });
  }
  for (const [kind, status] of rule.forbiddenKindStatuses || []) checks.push({
    type: 'forbidden_interpretation_classification', kind, status,
    pass: !items.some(item => item?.kind === kind && item.status === status),
  });
  if (rule.noCorrection) checks.push({ type: 'ordinary_progress_not_correction',
    pass: items.every(item => item?.corrects == null) });
  if (rule.priorLinkRequired) checks.push({ type: 'explicit_prior_interpretation_relationship',
    pass: hasPriorRelationship(items, priorItems, example.rubric) });
  return checks;
}

/** Annotation agreement is a screening aid. It is not a semantic truth judge. */
export function scoreCalibrationCase(example, candidate, { valid = false, priorItems = [] } = {}) {
  const expected = example.expected.items;
  const items = Array.isArray(candidate?.items) ? candidate.items : [];
  const available = new Set(items.map((_item, index) => index));
  const matches = [], missing = [], unexpected = [], flags = [];
  for (const wanted of expected) {
    const possible = [...available].filter(index => overlaps(wanted.quote, items[index]?.quote));
    const best = possible.find(index => items[index]?.kind === wanted.kind) ?? possible[0];
    if (best === undefined) { missing.push(wanted.key); continue; }
    available.delete(best);
    const got = items[best];
    const checks = { kind: got.kind === wanted.kind, status: got.status === wanted.status,
      reporter: got.reportedBy === wanted.reportedBy, topic: got.topic === wanted.topic,
      language: got.language === wanted.language,
      sourceSupport: typeof got.quote === 'string' && example.source.text.includes(got.quote),
      noInventedDate: got.occurredAt === wanted.occurredAt };
    const complete = Object.values(checks).every(Boolean);
    matches.push({ expectedKey: wanted.key, candidateIndex: best, checks, complete });
    if (!checks.reporter) flags.push({ severity: 'critical', type: 'reporter_mismatch', candidateIndex: best });
    if ((got.kind === 'action' && got.status === 'completed' && !(wanted.kind === 'action' && wanted.status === 'completed'))
        || got.kind === 'outcome' && got.status === 'positive' && !(wanted.kind === 'outcome' && wanted.status === 'positive')) {
      flags.push({ severity: 'critical', type: 'unsupported_completion_or_positive_result', candidateIndex: best });
    }
    if (!checks.sourceSupport) flags.push({ severity: 'critical', type: 'unsupported_quote', candidateIndex: best });
    if (!complete) flags.push({ severity: 'review', type: 'annotation_disagreement', candidateIndex: best });
  }
  for (const index of available) {
    const item = items[index];
    unexpected.push(index);
    const exactSource = typeof item?.quote === 'string' && example.source.text.includes(item.quote);
    const critical = !exactSource || item?.reportedBy !== example.source.reporter
      || item?.kind === 'action' && item?.status === 'completed'
      || item?.kind === 'outcome' && item?.status === 'positive';
    flags.push({ severity: critical ? 'critical' : 'review', type: exactSource ? 'unannotated_claim' : 'unsupported_quote', candidateIndex: index });
  }
  if (missing.length) flags.push({ severity: 'review', type: 'missing_expected_observation', expectedKeys: missing });
  if (example.rubric.expectedBarrier && !items.some(item=>typeof item?.barrier==='string' && item.barrier.trim())) {
    flags.push({severity:'review',type:'missing_expected_barrier',expectedBarrier:example.rubric.expectedBarrier});
  }
  if (example.rubric.correctionCaseId) {
    const correction = items.some(item => item?.corrects && priorItems.some(prior => prior.id === item.corrects
      && prior.sourceId === `cal-${example.rubric.correctionCaseId}`));
    if (!correction) flags.push({ severity: 'review', type: 'missing_correction_link' });
  }
  if (example.rubric.priorCaseId) {
    const linked = hasPriorRelationship(items, priorItems, example.rubric);
    if (!linked) flags.push({ severity: 'review', type: 'missing_prior_link' });
  }
  const interpretation = interpretationChecks(example, items, priorItems, valid);
  for (const check of interpretation.filter(check => !check.pass && check.type !== 'interpretation_contract_valid')) {
    flags.push({ severity: ['forbidden_interpretation_classification', 'ordinary_progress_not_correction'].includes(check.type) ? 'critical' : 'review',
      type: 'interpretation_requirement_failed', check });
  }
  if (!valid) flags.push({ severity: 'critical', type: 'invalid_output_contract' });
  return { valid, expectedCount: expected.length, candidateCount: items.length,
    supportedAnnotations: matches.filter(match => match.complete).length,
    matchedCount: matches.length, matches, missing, unexpected, flags,
    criticalFlags: flags.filter(flag => flag.severity === 'critical').length,
    interpretationChecks: interpretation, interpretationPassed: interpretation.length ? interpretation.every(check => check.pass) : null,
    humanReview: { status: 'pending', meaningSupported: null, omissions: null, inappropriateCertainty: null,
      correctPerson: null, note: '' } };
}

export function calibrationSummary(records) {
  const summarize = entries => {
    const expected = entries.reduce((n, row) => n + row.score.expectedCount, 0);
    const predicted = entries.reduce((n, row) => n + row.score.candidateCount, 0);
    const matched = entries.reduce((n, row) => n + row.score.supportedAnnotations, 0);
    const times = entries.filter(row => row.diagnostic?.sent).map(row => row.diagnostic.durationMs).sort((a,b)=>a-b);
    return { cases: entries.length, validOutputs: rate(entries.filter(row => row.score.valid).length, entries.length),
      annotationPrecision: rate(matched, predicted), annotationRecall: rate(matched, expected),
      criticalFlags: entries.reduce((n,row)=>n+row.score.criticalFlags,0),
      pendingHumanReview: entries.filter(row=>row.score.humanReview.status==='pending').length,
      latencyMs: { median: times.length ? times[Math.floor(times.length/2)] : null,
        p95: times.length ? times[Math.min(times.length-1,Math.ceil(times.length*.95)-1)] : null },
      providerCalls: entries.filter(row=>row.diagnostic?.sent).length,
      interpretationChecks: rate(entries.flatMap(row=>row.score.interpretationChecks||[]).filter(check=>check.pass).length,entries.flatMap(row=>row.score.interpretationChecks||[]).length),
      interpretationFailures: entries.filter(row=>row.score.interpretationPassed===false).length,
      pipelineChecks: rate(entries.flatMap(row=>row.pipeline?.checks||[]).filter(check=>check.pass).length,entries.flatMap(row=>row.pipeline?.checks||[]).length),
      pipelineFailures: entries.filter(row=>row.pipeline && !row.pipeline.passed).length,
      correctionSafetyChecks: rate(entries.flatMap(row=>row.pipeline?.safetyChecks||[]).filter(check=>check.pass).length,entries.flatMap(row=>row.pipeline?.safetyChecks||[]).length),
      unsafeCorrectionCases: entries.filter(row=>row.pipeline?.safetyPassed===false).length,
      accountedUsd: entries.reduce((n,row)=>n+(row.accounting?.chargedUsd || 0),0) };
  };
  return { overall: summarize(records),
    byLanguage: Object.fromEntries(['en','es','mixed'].map(language=>[language,summarize(records.filter(row=>row.source.language===language))])),
    bySplit: Object.fromEntries(['development','heldout','regression'].map(split=>[split,summarize(records.filter(row=>row.split===split))])),
    releaseGate: 'human_review_required',
    limitations: [
      'Scores screen agreement with author-labelled fictional examples; they do not establish semantic correctness, student benefit, or real-world accuracy.',
      'Supported alternative interpretations or quote boundaries may be flagged. Review every critical flag and sample clean cases in both languages.',
      'References and scoring are never sent to the extraction model. Sequential context comes only from prior valid model outputs.',
      'Held-out examples must not be used to tune the prompt. Any tuning creates a new experiment and requires a fresh untouched holdout.',
    ] };
}
