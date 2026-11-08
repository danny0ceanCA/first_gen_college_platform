// Real Decisions validation with authored fictional text only. No Live session,
// research tools, application records, or production connection is opened.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { createDecisionsClient } from '../client.mjs';
import { buildEarlyRequest, parseEarlyResponse, earlyResultDecision, EARLY_RUBRIC_VERSION } from './early-rubric.mjs';
import { earlyFixtures, earlyPartialFixtures, earlyIndependentFixtures } from './early-fixtures.mjs';
import { createEarlyRefinementBudget, inspectEarlyRefinementAllocation, EARLY_REFINEMENT_BUDGET_FILE } from './early-refinement-budget.mjs';

export function scoreEarlyResult(fixture, parsed) {
  const decision = earlyResultDecision(parsed.result);
  const actionable = decision.eligible;
  const expectedActionable = fixture.expected.eligible ?? ['simplify', 'example', 'starting_point', 'continue_simplifying'].includes(fixture.expected.action);
  const mismatch = [];
  if (decision.action !== fixture.expected.action) mismatch.push('action');
  if (expectedActionable && !actionable) mismatch.push('below_delivery_threshold');
  if (!expectedActionable && actionable) mismatch.push('unexpected_actionable_support');
  if (decision.clearSupport !== (fixture.expected.clearSupport ?? fixture.expected.action === 'clear')) mismatch.push('clear_support');
  if (Object.hasOwn(fixture.expected, 'supportKind') && decision.supportKind !== fixture.expected.supportKind) mismatch.push('support_kind');
  if (Object.hasOwn(fixture.expected, 'replaceNeed') && decision.replaceNeed !== fixture.expected.replaceNeed) mismatch.push('replace_need');
  return { fixtureId: fixture.id, language: fixture.snapshot.language, status: parsed.status,
    expected: fixture.expected, result: parsed.result ?? null, decision, actionable,
    passed: parsed.status === 'completed' && mismatch.length === 0, mismatch };
}

export function earlyClassifierPlan(argv = []) {
  const modes = ['--partial-trace', '--partial-repair', '--development', '--holdout'];
  if (argv.some(arg => !['--execute', ...modes].includes(arg)) || new Set(argv).size !== argv.length
    || modes.filter(mode => argv.includes(mode)).length > 1) throw Error('unsupported_argument');
  if (earlyFixtures.length !== 16 || ['en', 'es'].some(language =>
    earlyFixtures.filter(fixture => fixture.snapshot.language === language).length !== 8)) throw Error('fixed_fixture_suite_changed');
  const partial = argv.includes('--partial-trace');
  const repair = argv.includes('--partial-repair');
  const development = argv.includes('--development');
  const holdout = argv.includes('--holdout');
  if (earlyPartialFixtures.length !== 8 || ['en', 'es'].some(language =>
    earlyPartialFixtures.filter(fixture => fixture.snapshot.language === language).length !== 4)) throw Error('fixed_partial_suite_changed');
  if (earlyIndependentFixtures.length !== 16 || ['en', 'es'].some(language =>
    earlyIndependentFixtures.filter(fixture => fixture.snapshot.language === language).length !== 8)) throw Error('fixed_development_suite_changed');
  return { execute: argv.includes('--execute'), mode: holdout ? 'holdout' : development ? 'development' : repair ? 'partial-repair' : partial ? 'partial-trace' : 'baseline',
    fixtures: holdout ? null : development ? [...earlyFixtures, ...earlyPartialFixtures, ...earlyIndependentFixtures]
      : repair ? earlyPartialFixtures.slice(2, 6) : partial ? earlyPartialFixtures : earlyFixtures,
    maximumRequests: holdout ? 28 : development ? 40 : repair ? 4 : partial ? 8 : 16, ledger: EARLY_REFINEMENT_BUDGET_FILE };
}

export async function main(argv = process.argv.slice(2)) {
  const plan = earlyClassifierPlan(argv);
  // The development route never loads independent holdout text or labels.
  const fixtures = plan.mode === 'holdout' ? (await import('./early-holdout-fixtures.mjs')).earlyHoldoutFixtures : plan.fixtures;
  if (!Array.isArray(fixtures) || fixtures.length !== plan.maximumRequests) throw Error('fixed_fixture_suite_changed');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = resolve(root, 'research/decisions/.local');
  const budgetOptions = { budgetPath: resolve(directory, plan.ledger), conversationEnabled: true, earlyEnabled: true };
  const allocation = inspectEarlyRefinementAllocation(budgetOptions);
  const requests = fixtures.map(fixture => ({ fixture, request: buildEarlyRequest(fixture.snapshot) }));
  const summary = { fictionalOnly: true, suite: plan.mode, cases: requests.length, maximumDecisionsRequests: plan.maximumRequests,
    voiceCalls: 0, liveCues: 0, researchCalls: 0, ledger: plan.ledger, allocation };
  if (!plan.execute) { console.log(JSON.stringify({ preflight: true, ...summary })); return summary; }
  const apiKey = loadEnv('development', root, '').OPENAI_API_KEY;
  if (!apiKey) throw Error('local_openai_key_required');
  const budget = createEarlyRefinementBudget(budgetOptions);
  const client = createDecisionsClient({ apiKey });
  const output = resolve(directory, `early-classifier-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  const report = { ...summary, startedAt: new Date().toISOString(), rubricVersion: EARLY_RUBRIC_VERSION,
    before: budget.summary(), cases: [], evidenceType: 'real_decisions_fictional_provisional_text',
    limitation: plan.mode === 'holdout'
      ? 'These independently authored fictional classifier cases test held-out text, not live timing, audio playback, or improved naturalness.'
      : 'These authored development classifier cases are not independent holdout data and do not prove live timing, audio playback, or improved naturalness.' };
  let consecutiveFailures = 0;
  try {
    if (report.before.maxRequests - report.before.requestCount < requests.length) throw Error('insufficient_request_allowance');
    for (const { fixture, request } of requests) {
      const current = budget.summary();
      if (current.availableUsd < current.reservationUsd || current.requestCount >= current.maxRequests) {
        report.stoppedReason = 'budget_exhausted'; break;
      }
      const operationId = randomUUID();
      const reservation = budget.reserve({ operationId, metadata: { fixtureId: fixture.id, policyVersion: EARLY_RUBRIC_VERSION } });
      let settled = false;
      try {
        const outcome = await client.evaluate(request);
        budget.settle(reservation.id, outcome.response?.usage); settled = true;
        const parsed = parseEarlyResponse(outcome.response, fixture.snapshot);
        report.cases.push({ ...scoreEarlyResult(fixture, parsed), operationId, requestId: outcome.requestId,
          durationMs: outcome.durationMs, usage: outcome.response?.usage });
        consecutiveFailures = parsed.status === 'completed' ? 0 : consecutiveFailures + 1;
      } catch (error) {
        if (!settled) budget.markUnknown(reservation.id, /^[a-zA-Z0-9_.:-]{1,160}$/.test(error.code ?? '') ? error.code : 'validation_failure');
        report.cases.push({ fixtureId: fixture.id, language: fixture.snapshot.language,
          passed: false, actionable: false, status: 'unavailable', reason: error.code ?? 'validation_failure' });
        consecutiveFailures++;
      }
      writeFileSync(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
      const last = report.cases.at(-1);
      console.log(JSON.stringify({ fixtureId: last.fixtureId, passed: last.passed, actionable: last.actionable,
        status: last.status, durationMs: last.durationMs, mismatch: last.mismatch, reason: last.reason }));
      if (consecutiveFailures >= 3) { report.stoppedReason = 'consecutive_failures'; break; }
    }
    report.finishedAt = new Date().toISOString(); report.after = budget.summary();
    report.costUsd = Number((report.after.spentUsd - report.before.spentUsd).toFixed(9));
    report.passed = report.cases.filter(result => result.passed).length;
    report.byLanguage = Object.fromEntries(['en', 'es'].map(language => [language, {
      evaluated: report.cases.filter(result => result.language === language).length,
      passed: report.cases.filter(result => result.language === language && result.passed).length,
      actionable: report.cases.filter(result => result.language === language && result.actionable).length,
    }]));
    const timings = report.cases.map(result => result.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
    report.p50Ms = timings[Math.max(0, Math.ceil(timings.length * 0.5) - 1)] ?? null;
    report.p95Ms = timings[Math.max(0, Math.ceil(timings.length * 0.95) - 1)] ?? null;
    writeFileSync(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: resolve(output, 'results.json'), passed: report.passed, evaluated: report.cases.length,
      costUsd: report.costUsd, p50Ms: report.p50Ms, p95Ms: report.p95Ms, budget: report.after }));
    if (report.passed !== requests.length) process.exitCode = 1;
    return report;
  } finally { budget.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(JSON.stringify({ error: error.code ?? error.message })); process.exitCode = 1; });
