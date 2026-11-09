import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDecisionsDiagnosticReport } from './diagnostic-report.mjs';
import { decisionsDiagnosticData } from '../../../server/decisions-diagnostic-data.mjs';
import { CONFUSION_ACTIONS } from '../conversation-rubric.mjs';
import { makeOutcomeFixture } from './outcome-fixtures.mjs';

const choice = (name, values, selected) => ({ name, type: 'choice', choice: selected, confidence: .9,
  probabilities: values.map(value => ({ value, probability: value === selected ? 1 : 0 })) });
function fixture(language) {
  let sequence = 0;
  const record = (stage, details = {}) => ({ id: `${language}-${++sequence}`, stage,
    sequence, session_id: 'call-' + language, run_id: 'run', data: decisionsDiagnosticData({ type: stage, language,
      operationId: 'request', ...details }) });
  return [record('decisions_api_completed', { transportAndJsonMs: 300, providerRequestCompleted: true }),
    record('decisions_response_parsed', { classificationPath: 'completed', classificationValidated: true, status: 'completed',
      supportNeed: 'none', classificationAnswers: [choice('confusion_state', CONFUSION_ACTIONS, 'needs_simpler_explanation')] }),
    record('decisions_observation_finished', { status: 'completed', result: { supportNeed: 'none' } }),
    record('support_conversation_sent', { contextSent: true, eventId: 'append', classificationToSendMs: 80, inputEvidenceToSendMs: 400 }),
    record('support_conversation_context_acknowledged', { eventId: 'append', contextSent: true })];
}

for (const language of ['en', 'es']) test(`${language}: full classification evidence survives durable projection and repeated result summaries`, () => {
  const rows = fixture(language), report = buildDecisionsDiagnosticReport([...rows, rows[0]]);
  const target = report.byLanguage[language];
  assert.equal(report.duplicateEvents, 1); assert.equal(target.parsedRequests, 1);
  assert.equal(target.legacyOnlyRequests, 0); assert.equal(target.validatedRequests, 1);
  assert.equal(target.choices['confusion_state:needs_simpler_explanation'], 1);
  assert.equal(target.choices['support_need:none'], undefined, 'a legacy summary must not replace the full parsed response');
  assert.equal(target.sent, 1); assert.equal(target.acknowledged, 1);
  assert.equal(report.timings.completedTransport.p50Ms, 300); assert.equal(report.timings.classificationToSend.p50Ms, 80);
  assert.equal(report.outcomeReview.samples, 0);
});

test('paths and languages are explicit, early evidence is distinct from completed support classification', () => {
  const report = buildDecisionsDiagnosticReport([{ type: 'early_decisions_completed', callId: 'call', workerRunId: 'run',
    operationId: 'early', stamp: { language: 'es' }, durationMs: 125,
    result: { facts: { confusion: .93 } } }, { type: 'decision_observation', callId: 'call', workerRunId: 'run',
    operationId: 'legacy', result: { supportNeed: 'none' } }]);
  assert.equal(report.byLanguage.es.classificationPaths.early, 1);
  assert.equal(report.byLanguage.unknown.classificationPaths.completed, 1);
  assert.equal(report.timings.earlyClassification.samples, 1);
  assert.equal(report.timings.completedTransport.samples, 0);
});

test('queue timing is attributed from API start after the budget operation exists', () => {
  const report = buildDecisionsDiagnosticReport([{ type: 'decisions_request_prepared', callId: 'call', workerRunId: 'run', queueWaitMs: 42 },
    { type: 'decisions_api_started', callId: 'call', workerRunId: 'run', operationId: 'request', queueWaitMs: 42 }]);
  assert.equal(report.timings.completedQueue.samples, 1);
  assert.equal(report.timings.completedQueue.p50Ms, 42);
});

test('unknown correlation is counted; duplicate conflicts and durable sequence gaps are visible without fake totals', () => {
  const rows = fixture('en');
  const report = buildDecisionsDiagnosticReport([rows[0], rows[3], { ...rows[0], data: { status: 'different' } },
    { type: 'decisions_response_parsed', classificationPath: 'completed', result: { supportNeed: 'none' } },
    { type: 'INVALID PRIVATE TEXT' }]);
  assert.equal(report.conflictingDuplicateEvents, 1); assert.equal(report.observedSequenceGaps, 2);
  assert.equal(report.invalidEvents, 1); assert.equal(report.uncorrelatedClassifications, 1);
  assert.equal(report.byLanguage.en.unconfirmed, 1); assert.equal(report.byLanguage.unknown.parsedRequests, 0);
});

test('repeated local exports deduplicate by worker sequence, not inner lifecycle sequence', () => {
  const first = { type: 'support_early_deferred', callId: 'call', workerRunId: 'run', workerSequence: 10,
    sequence: 1, reason: 'input_open', language: 'en' };
  const second = { ...first, workerSequence: 11, reason: 'audio_active' };
  const report = buildDecisionsDiagnosticReport([first, second, structuredClone(first), structuredClone(second)]);
  assert.equal(report.uniqueEvents, 2); assert.equal(report.duplicateEvents, 2);
  assert.equal(report.conflictingDuplicateEvents, 0); assert.equal(report.stages.support_early_deferred, 2);
  assert.equal(report.withholdingReasons.input_open, 1); assert.equal(report.withholdingReasons.audio_active, 1);
  assert.equal(report.observedSequenceGaps, 0, 'local worker counters do not become durable sequence coverage');
});

test('conflicting local export rows are visible and do not overwrite the first worker event', () => {
  const row = { type: 'support_early_deferred', callId: 'call', workerRunId: 'run', workerSequence: 20,
    sequence: 7, reason: 'input_open' };
  const report = buildDecisionsDiagnosticReport([row, { ...row, reason: 'different', sequence: 8 }]);
  assert.equal(report.uniqueEvents, 1); assert.equal(report.conflictingDuplicateEvents, 1);
  assert.equal(report.withholdingReasons.input_open, 1); assert.equal(report.withholdingReasons.different, undefined);
});

test('local lifecycle sequence alone cannot establish global identity and durable rows use their own sequence', () => {
  const local = { type: 'support_early_deferred', callId: 'call', workerRunId: 'run', sequence: 1, reason: 'input_open' };
  const durable = { stage: local.type, session_id: local.callId, run_id: local.workerRunId,
    sequence: 2, data: { reason: 'input_open', workerSequence: 50 } };
  const report = buildDecisionsDiagnosticReport([local, { ...local, reason: 'audio_active' },
    durable, structuredClone(durable), { ...durable, sequence: 3 }]);
  assert.equal(report.uniqueEvents, 4); assert.equal(report.duplicateEvents, 1);
  assert.equal(report.conflictingDuplicateEvents, 0); assert.equal(report.observedSequenceGaps, 0);
});

test('freshness dimensions, frequency budget and between-thought boundary evidence stay independent', () => {
  const report = buildDecisionsDiagnosticReport([{ type: 'support_early_deferred', callId: 'call', workerRunId: 'run',
    reason: 'stale', freshnessMismatch: ['revision', 'observer_closed', 'private details'], revalidationRequested: true,
    triggerBasis: 'accumulated_input', requestMoment: 'example_request', budgetConstraint: 'check_frequency',
    deliveryMode: 'between_thoughts', boundaryBasis: 'application_estimate_with_fresh_playback' }]);
  assert.deepEqual({ ...report.freshnessMismatch }, { revision: 1, observer_closed: 1 });
  assert.equal(report.revalidationRequested, 1); assert.equal(report.scheduling.budgetConstraint.check_frequency, 1);
  assert.ok(!JSON.stringify(report).includes('private details'));
});

test('contradictory receipt telemetry remains visible rather than silently preferring success', () => {
  const rows = fixture('en');
  rows.push({ ...rows.at(-1), id: 'rejected', sequence: 6, stage: 'support_conversation_provider_rejected' });
  const result = buildDecisionsDiagnosticReport(rows).byLanguage.en;
  assert.equal(result.acknowledged, 1); assert.equal(result.rejected, 1); assert.equal(result.conflictingReceipts, 1);
});

test('reviewed outcomes retain independent language denominators and cannot be inferred from acknowledgments', () => {
  const inputs = ['en', 'es'].map(language => makeOutcomeFixture(language, 'need_addressed_flow_preserved').input);
  const unreviewed = buildDecisionsDiagnosticReport(fixture('en'), { reviewedCases: inputs });
  assert.equal(unreviewed.byLanguage.en.acknowledged, 1);
  assert.equal(unreviewed.outcomeReview.byLanguage.en.needAddressed, 0, 'fixture labels require explicit opt in');
  const reviewed = buildDecisionsDiagnosticReport([], { reviewedCases: inputs, allowFixtureLabels: true });
  for (const language of ['en', 'es']) {
    assert.equal(reviewed.outcomeReview.byLanguage[language].needAddressed, 1);
    assert.equal(reviewed.outcomeReview.byLanguage[language].syntheticSamples, 1);
  }
  assert.ok(!JSON.stringify(reviewed).includes('Office hours'));
});

test('offline CLI creates a new bounded report and never overwrites an existing artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'origen-decisions-report-'));
  try {
    const input = join(directory, 'events.jsonl'), output = join(directory, 'report.json');
    await writeFile(input, fixture('en').map(row => JSON.stringify(row)).join('\n'));
    const args = [resolve('scripts/decisions-diagnostic-report.mjs'), input, '--output', output];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).byLanguage.en.acknowledged, 1);
    assert.notEqual(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
    await writeFile(input, '{"private":"SECRET_BAD_JSON');
    const invalid = spawnSync(process.execPath, [args[0], input], { encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.ok(!invalid.stderr.includes('SECRET_BAD_JSON'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
