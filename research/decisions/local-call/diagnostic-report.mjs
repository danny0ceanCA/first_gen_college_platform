// Offline, metadata-only analysis of exported durable or local Decisions events.
// No database, provider, transcript-classifier or Live connection is imported.
import { decisionsDiagnosticData } from '../../../server/decisions-diagnostic-data.mjs';
import { measureSupportOutcome, summarizeSupportOutcomes } from './outcome-evaluation.mjs';

export const DECISIONS_REPORT_VERSION = 'decisions-evidence-report-2';
const code = value => typeof value === 'string' && /^[a-zA-Z0-9_.: -]{1,200}$/.test(value) ? value : null;
const count = (map, key) => { if (key) map[key] = (map[key] ?? 0) + 1; };
const counters = () => Object.create(null);
const percentiles = input => {
  const values = input.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = n => values.length ? values[Math.max(0, Math.ceil(values.length * n) - 1)] : null;
  return { samples: values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: values.at(-1) ?? null };
};
const classificationStage = stage => ['early_decisions_completed', 'decisions_response_parsed',
  'decisions_observation_finished', 'decision_observation'].includes(stage);
const languageOf = data => ['en', 'es', 'mixed'].includes(data.language ?? data.stamp?.language)
  ? data.language ?? data.stamp.language : 'unknown';
const quality = () => ({ parsedRequests: 0, validatedRequests: 0, legacyOnlyRequests: 0,
  classificationPaths: counters(), choices: counters(), predicateObservations: counters(), refusals: counters(),
  omittedClassificationAnswers: 0, sent: 0, acknowledged: 0, rejected: 0, unconfirmed: 0, conflictingReceipts: 0 });

/** Durable rows: {id,session_id,run_id,sequence,stage,data}; local:
 * {type,callId,workerRunId,workerSequence,...}. Inner lifecycle `sequence`
 * values are not global event identities and must not deduplicate local rows.
 * Missing correlation remains unknown. A repeated export is not another request.
 * Optional reviewedCases use exact transcript/playback evidence in the separate
 * outcome evaluator. Their text is never reproduced in this metadata report.
 */
export function buildDecisionsDiagnosticReport(events = [], { reviewedCases = [], allowFixtureLabels = false } = {}) {
  if (!Array.isArray(events) || events.length > 100000) throw Error('events_must_be_array_of_at_most_100000');
  if (!Array.isArray(reviewedCases) || reviewedCases.length > 10000) throw Error('reviewed_cases_limit');
  const seen = new Map(), rows = [], requests = new Map(), cueEvents = new Map(), durableSequences = new Map();
  const report = { version: DECISIONS_REPORT_VERSION, inputEvents: events.length, uniqueEvents: 0,
    duplicateEvents: 0, conflictingDuplicateEvents: 0, invalidEvents: 0, uncorrelatedEvents: 0, uncorrelatedClassifications: 0,
    observedSequenceGaps: 0, sequenceCoverage: 'only_between_observed_durable_rows',
    stages: counters(), withholdingReasons: counters(), scheduling: { triggerBasis: counters(), requestMoment: counters(), budgetConstraint: counters() },
    freshnessMismatch: counters(), revalidationRequested: 0, revalidated: 0,
    earlyCueOutcomes: counters(), earlyWorkerPolicyReasons: counters(),
    byLanguage: Object.fromEntries(['en', 'es', 'mixed', 'unknown'].map(language => [language, quality()])),
    timings: {}, outcomeReview: null,
    limitations: ['Provider receipt does not prove use, playback or comprehension.',
      'Transcript adaptation and reviewed audio flow are separate evidence.',
      'Missing telemetry and missing reviews remain unknown; no causal improvement is inferred.',
      'Timing includes the named application or transport stage, not private model reasoning.',
      'Sequence gaps may reflect a filtered export; beginning and ending loss cannot be inferred.'] };
  const timings = { earlyClassification: [], completedTransport: [], completedQueue: [], classificationToSend: [], evidenceToSend: [] };
  for (const event of events) {
    const stage = code(event?.stage ?? event?.type);
    if (!stage || !/^[a-z_]{1,100}$/.test(stage)) { report.invalidEvents++; continue; }
    const raw = event.data && typeof event.data === 'object' ? event.data : event;
    const data = decisionsDiagnosticData({ ...raw, type: stage,
      result: raw.classification ?? raw.result ?? { supportNeed: raw.supportNeed, conversationSupport: raw.conversationSupport,
        preferenceChanges: raw.preferenceChanges, facts: raw.probabilities } });
    const call = code(event.session_id ?? event.sessionId ?? event.callId ?? data.stamp?.callId);
    const run = code(event.run_id ?? event.runId ?? event.workerRunId ?? data.workerRunId);
    const durable = typeof event.stage === 'string';
    const sequenceValue = durable ? event.sequence : event.workerSequence;
    const sequence = Number.isSafeInteger(sequenceValue) && sequenceValue >= 0 ? sequenceValue : null;
    const identity = durable && code(event.id) ? `durable-id:${event.id}` : call && run && sequence !== null
      ? JSON.stringify([durable ? 'durable' : 'local', call, run, sequence]) : null;
    const signature = JSON.stringify([stage, data]);
    if (identity && seen.has(identity)) {
      if (seen.get(identity) === signature) report.duplicateEvents++; else report.conflictingDuplicateEvents++;
      continue;
    }
    if (identity) seen.set(identity, signature);
    if (!call || !run) report.uncorrelatedEvents++;
    if (classificationStage(stage) && (!call || !run || !data.operationId)) report.uncorrelatedClassifications++;
    const language = languageOf(data);
    const row = { stage, data, call, run, language, sequence, index: rows.length }; rows.push(row);
    count(report.stages, stage);
    if (durable && call && run && sequence !== null) {
      const key = JSON.stringify([call, run]);
      if (!durableSequences.has(key)) durableSequences.set(key, new Set());
      durableSequences.get(key).add(sequence);
    }
    if (/withheld|skipped|deferred|invalidated|rejected|unavailable|failed/.test(stage)) count(report.withholdingReasons, data.reason ?? 'unknown');
    for (const key of Object.keys(report.scheduling)) count(report.scheduling[key], data[key]);
    for (const key of data.freshnessMismatch ?? []) count(report.freshnessMismatch, key);
    if (data.revalidationRequested === true) report.revalidationRequested++;
    if (data.revalidated === true) report.revalidated++;
    if (call && run && data.operationId) {
      const key = JSON.stringify([call, run, data.operationId]);
      if (!requests.has(key)) requests.set(key, []);
      requests.get(key).push(row);
    }
    if (call && run && data.eventId && /^support_/.test(stage)) {
      const key = JSON.stringify([call, run, data.eventId]);
      if (!cueEvents.has(key)) cueEvents.set(key, []);
      cueEvents.get(key).push(row);
    }
  }
  report.uniqueEvents = rows.length;
  for (const set of durableSequences.values()) {
    const ordered = [...set].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i++) report.observedSequenceGaps += Math.max(0, ordered[i] - ordered[i - 1] - 1);
  }
  const latest = (list, predicate) => list.filter(predicate).at(-1);
  for (const list of requests.values()) {
    const classified = latest(list, row => row.stage === 'early_decisions_completed');
    const earlyCheck = classified ?? latest(list, row => /^early_decisions_(failed|skipped)$/.test(row.stage))
      ?? latest(list, row => row.stage === 'early_decisions_started');
    if (earlyCheck) {
      count(report.earlyWorkerPolicyReasons, classified?.data.policyReason);
      const gate = list.filter(row => /^support_early_(validated|deferred|discarded|skipped|resolved|need_retained)$/.test(row.stage))
        .sort((a, b) => (a.sequence ?? a.index) - (b.sequence ?? b.index)).at(-1);
      const provider = latest(list, row => /^support_early_(context_acknowledged|provider_rejected)$/.test(row.stage));
      const send = latest(list, row => /^support_early_(sent|send_unconfirmed)$/.test(row.stage));
      const decisive = provider ?? send ?? gate ?? earlyCheck;
      const outcome = decisive.stage.replace(/^(support_early_|early_decisions_)/, '');
      const stage = decisive === earlyCheck && outcome === 'completed' ? 'no_parent_outcome_observed' : outcome;
      count(report.earlyCueOutcomes, decisive.data.reason ? `${stage}:${decisive.data.reason}` : stage);
    }
    // Prefer the complete parsed response over repeated/legacy summary events.
    const parsed = latest(list, row => row.stage === 'decisions_response_parsed')
      ?? latest(list, row => classificationStage(row.stage));
    if (parsed) {
      const { data, language } = parsed, target = report.byLanguage[language];
      target.parsedRequests++;
      if (data.classificationValidated === true || data.status === 'completed') target.validatedRequests++;
      count(target.classificationPaths, data.classificationPath ?? 'unknown');
      target.omittedClassificationAnswers += data.omittedClassificationAnswers ?? 0;
      const answers = data.classificationAnswers ?? [];
      if (answers.length) for (const answer of answers) {
        if (answer.type === 'choice') count(target.choices, `${answer.name}:${answer.choice}`);
        if (answer.type === 'predicate') count(target.predicateObservations, answer.name);
        if (answer.type === 'refusal') count(target.refusals, answer.name);
      } else {
        target.legacyOnlyRequests++;
        const result = data.classification ?? {};
        if (result.supportNeed) count(target.choices, `support_need:${result.supportNeed}`);
        for (const [name, value] of Object.entries(result.conversationSupport ?? {})) count(target.choices, `${name}:${value.action}`);
        for (const value of result.preferenceChanges ?? []) count(target.choices, `preference_${value.preference}:${value.action}`);
        for (const name of Object.keys(result.facts ?? {})) count(target.predicateObservations, name);
        for (const name of result.refusedQuestions ?? []) count(target.refusals, name);
      }
    }
    const early = latest(list, row => row.stage === 'early_decisions_completed');
    const completed = latest(list, row => row.stage === 'decisions_api_completed');
    const prepared = latest(list, row => row.stage === 'decisions_api_started' && Number.isFinite(row.data.queueWaitMs))
      ?? latest(list, row => row.stage === 'decisions_request_prepared');
    if (early) timings.earlyClassification.push(early.data.durationMs);
    if (completed) timings.completedTransport.push(completed.data.transportAndJsonMs);
    if (prepared) timings.completedQueue.push(prepared.data.queueWaitMs);
  }
  for (const list of cueEvents.values()) {
    const sent = latest(list, row => /_sent$/.test(row.stage) && row.data.contextSent === true);
    const acknowledged = latest(list, row => /_context_acknowledged$/.test(row.stage));
    const rejected = latest(list, row => /_provider_rejected$/.test(row.stage));
    const unknown = latest(list, row => /_(?:context_unconfirmed|send_unconfirmed|send_failed)$/.test(row.stage));
    const target = report.byLanguage[(sent ?? acknowledged ?? rejected ?? unknown ?? list[0]).language];
    if (sent) {
      target.sent++;
      timings.classificationToSend.push(sent.data.classificationToSendMs);
      timings.evidenceToSend.push(sent.data.inputEvidenceToSendMs);
    }
    if (acknowledged) target.acknowledged++;
    if (rejected) target.rejected++;
    if (acknowledged && rejected) target.conflictingReceipts++;
    if (!acknowledged && !rejected && (sent || unknown)) target.unconfirmed++;
  }
  report.timings = Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, percentiles(values)]));
  report.outcomeReview = summarizeSupportOutcomes(reviewedCases.map(value => measureSupportOutcome({ ...value, allowFixtureLabels })));
  return report;
}
