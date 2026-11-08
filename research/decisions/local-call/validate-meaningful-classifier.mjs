// One bounded fictional Decisions-only run. No Live connection, tools,
// application records, production access or old-budget reset.
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { createDecisionsClient } from '../client.mjs';
import { buildEarlyRequest, parseEarlyResponse, EARLY_RUBRIC_VERSION } from './early-rubric.mjs';
import { needHistoryFixtures } from './need-history-fixtures.mjs';
import { createMicrophoneBudget, MICROPHONE_BUDGET_FILE } from './microphone-budget.mjs';

const FOCUSED_RETEST_IDS = Object.freeze([
  'history-en-older-clear-new-confusion-overrides',
  'history-es-older-clear-new-confusion-overrides',
  'history-en-leave-need-change-topic',
  'history-es-leave-need-change-topic',
  'history-es-explicit-clarity',
]);

export function scoreMeaningfulResult(fixture, parsed) {
  const decision = parsed?.decision;
  const mismatch = [];
  for (const key of ['action', 'eligible', 'clearSupport', 'replaceNeed']) {
    if (Object.hasOwn(fixture.expected, key) && decision?.[key] !== fixture.expected[key]) mismatch.push(key);
  }
  return { fixtureId: fixture.id, language: fixture.language, expected: fixture.expected,
    status: parsed?.status ?? 'unavailable', decision: decision ?? null, result: parsed?.result ?? null,
    passed: parsed?.status === 'completed' && mismatch.length === 0, mismatch };
}
export function summarizeMeaningfulCases(cases = []) {
  const group = rows => {
    const timed = rows.map(row => row.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
    return { evaluated: rows.length, passed: rows.filter(row => row.passed).length,
      actionCorrect: rows.filter(row => row.decision?.action === row.expected.action).length,
      eligibilityCorrect: rows.filter(row => row.decision?.eligible === row.expected.eligible).length,
      missedEligible: rows.filter(row => row.expected.eligible && row.decision?.eligible !== true).length,
      unwantedEligible: rows.filter(row => !row.expected.eligible && row.decision?.eligible === true).length,
      clearCorrect: rows.filter(row => row.decision?.clearSupport === row.expected.clearSupport).length,
      unavailable: rows.filter(row => row.status !== 'completed').length,
      p50Ms: timed.length ? timed[Math.ceil(timed.length * .5) - 1] : null,
      p95Ms: timed.length ? timed[Math.ceil(timed.length * .95) - 1] : null };
  };
  return { ...group(cases), byLanguage: Object.fromEntries(['en', 'es'].map(language =>
    [language, group(cases.filter(row => row.language === language))])) };
}
export function meaningfulClassifierPlan(argv = []) {
  if (argv.some(arg => !['--execute', '--focused-retest'].includes(arg)) || new Set(argv).size !== argv.length) throw Error('unsupported_argument');
  if (needHistoryFixtures.length !== 24 || ['en', 'es'].some(language =>
    needHistoryFixtures.filter(row => row.language === language).length !== 12)) throw Error('fixed_fixture_suite_changed');
  const focusedRetest = argv.includes('--focused-retest');
  return { execute: argv.includes('--execute'), maximumRequests: focusedRetest ? 5 : 24,
    focusedRetest, evaluationDesign: focusedRetest ? 'development_retest_of_five_known_cases_not_holdout' : 'fixed_independently_authored_cases',
    fictionalOnly: true, liveCalls: 0,
    researchCalls: 0, cuesSent: 0, ledger: MICROPHONE_BUDGET_FILE, rubricVersion: EARLY_RUBRIC_VERSION };
}

export async function runMeaningfulClassifier(argv = process.argv.slice(2)) {
  const plan = meaningfulClassifierPlan(argv);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = resolve(root, 'research/decisions/.local');
  const tracked = ['need-history-fixtures.mjs', 'early-rubric.mjs', 'explanation-history.mjs'];
  const hashes = () => Object.fromEntries(tracked.map(file => [file,
    createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex')]));
  const sourceHashes = hashes();
  const selected = plan.focusedRetest ? FOCUSED_RETEST_IDS.map(id => needHistoryFixtures.find(fixture => fixture.id === id)) : needHistoryFixtures;
  if (selected.length !== plan.maximumRequests || selected.some(fixture => !fixture)) throw Error('fixed_retest_suite_changed');
  const prepared = selected.map(fixture => ({ fixture, request: buildEarlyRequest(fixture.snapshot) }));
  if (!plan.execute) { const result = { ...plan, cases: prepared.length, sourceHashes };
    console.log(JSON.stringify(result)); return result; }
  const apiKey = loadEnv('development', root, '').OPENAI_API_KEY;
  if (!apiKey) throw Error('local_openai_key_required');
  const budget = createMicrophoneBudget({ budgetPath: resolve(directory, plan.ledger), microphoneBudgetApproved: true });
  const client = createDecisionsClient({ apiKey });
  const file = resolve(directory, `meaningful-classifier-20261108-${Date.now()}.json`);
  const report = { ...plan, sourceHashes, startedAt: new Date().toISOString(), before: budget.summary(), cases: [],
    evidenceType: 'fictional_decisions_classification_not_conversation_outcome',
    limitation: 'Independent authored cases measure classification on this fixed set. They do not establish audible delivery, naturalness, student understanding or a causal benefit.' };
  mkdirSync(directory, { recursive: true });
  const save = () => writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  let consecutiveFailures = 0;
  try {
    if (report.before.maxRequests - report.before.requestCount < plan.maximumRequests) throw Error('insufficient_request_allowance');
    for (const { fixture, request } of prepared) {
      if (JSON.stringify(hashes()) !== JSON.stringify(sourceHashes)) { report.stoppedReason = 'source_changed_during_run'; break; }
      const available = budget.summary();
      if (available.availableUsd < available.reservationUsd || available.requestCount >= available.maxRequests) {
        report.stoppedReason = 'budget_exhausted'; break;
      }
      const operationId = randomUUID();
      const reservation = budget.reserve({ operationId, metadata: { fixtureId: fixture.id, policyVersion: EARLY_RUBRIC_VERSION } });
      let settled = false;
      try {
        const outcome = await client.evaluate(request);
        const cost = budget.settle(reservation.id, outcome.response?.usage); settled = true;
        const parsed = parseEarlyResponse(outcome.response, fixture.snapshot);
        report.cases.push({ ...scoreMeaningfulResult(fixture, parsed), operationId, requestId: outcome.requestId,
          durationMs: outcome.durationMs, usage: outcome.response?.usage, costUsd: cost.costUsd });
        consecutiveFailures = parsed.status === 'completed' ? 0 : consecutiveFailures + 1;
      } catch (error) {
        const code = /^[a-zA-Z0-9_.:-]{1,160}$/.test(error.code ?? '') ? error.code : 'validation_failure';
        if (!settled) budget.markUnknown(reservation.id, code);
        report.cases.push({ ...scoreMeaningfulResult(fixture, null), operationId, status: 'unavailable', reason: code });
        consecutiveFailures++;
      }
      save();
      const last = report.cases.at(-1);
      console.log(JSON.stringify({ fixtureId: last.fixtureId, passed: last.passed, mismatch: last.mismatch,
        durationMs: last.durationMs, reason: last.reason }));
      if (consecutiveFailures >= 3) { report.stoppedReason = 'consecutive_failures'; break; }
    }
    report.finishedAt = new Date().toISOString(); report.after = budget.summary();
    report.summary = summarizeMeaningfulCases(report.cases);
    report.costUsd = Number((report.after.spentUsd - report.before.spentUsd).toFixed(9));
    save();
    console.log(JSON.stringify({ file, ...report.summary, costUsd: report.costUsd, budget: report.after }));
    if (report.summary.passed !== plan.maximumRequests) process.exitCode = 1;
    return report;
  } finally { budget.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runMeaningfulClassifier().catch(error => { console.error(JSON.stringify({ error: error.code ?? error.message })); process.exitCode = 1; });
