// Fixed fictional classification suite. No voice connection, profile write,
// research execution or live cue is available from this harness.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { preferenceFixtures, preferenceFixtureSnapshot } from '../preference-fixtures.mjs';
import { preferencePolicy } from '../preference-rubric.mjs';
import { createDecisionsClient } from '../client.mjs';
import { createBudgetLedger } from '../budget.mjs';

export function scorePreferenceResult(fixture, parsed) {
  const changes = parsed.result?.preferenceChanges ?? [];
  // The current gate revalidates the whole preference snapshot conservatively.
  // An uncertain unchanged dimension may conceal a withdrawal of an old style.
  const eligible = parsed.status === 'completed' && changes.length === 2
    && changes.every(change => change.selectedProbability >= 0.9 && change.confidence >= 0.85);
  const mismatches = Object.entries(fixture.expected).flatMap(([preference, expected]) => {
    const change = changes.find(value => value.preference === preference);
    const actual = eligible ? change?.action : 'unchanged';
    return expected === actual ? [] : [{ preference, expected, actual, classification: change ?? null }];
  });
  return { fixtureId: fixture.id, language: fixture.language, status: parsed.status,
    passed: parsed.status === 'completed' && mismatches.length === 0, eligible, mismatches, changes };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some(arg => arg !== '--execute')) throw Error('unsupported_argument');
  const requests = preferenceFixtures.map(fixture => ({ fixture, request: preferencePolicy.buildRequest(preferenceFixtureSnapshot(fixture)) }));
  const summary = { fictionalOnly: true, cases: requests.length, maximumDecisionsRequests: requests.length,
    voiceCalls: 0, liveCues: 0, researchCalls: 0, ledger: 'approved-support-decisions-budget.sqlite', allocatedCapUsd: 1.5 };
  if (!argv.includes('--execute')) { console.log(JSON.stringify({ preflight: true, ...summary })); return; }
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const apiKey = loadEnv('development', root, '').OPENAI_API_KEY;
  if (!apiKey) throw Error('local_openai_key_required');
  const local = resolve(root, 'research/decisions/.local');
  const ledger = resolve(local, summary.ledger);
  // This run must reuse the existing approved allocation, never invent a budget.
  if (!existsSync(ledger)) throw Error('existing_approved_ledger_required');
  const output = resolve(local, `preferences-${Date.now()}`); mkdirSync(output, { recursive: true });
  const budget = createBudgetLedger({ path: ledger, capUsd: 1.5, reservationUsd: 0.05, maxRequests: 200 });
  const report = { ...summary, startedAt: new Date().toISOString(), rubricVersion: preferencePolicy.version,
    before: budget.summary(), cases: [], evidenceType: 'real_decisions_fictional_text',
    limitation: 'Authored classification cases are not an independent holdout and do not establish audio naturalness, playback, or improved user experience.' };
  const client = createDecisionsClient({ apiKey });
  let failures = 0;
  try {
    for (const { fixture, request } of requests) {
      const operationId = randomUUID();
      const reservation = budget.reserve({ operationId, metadata: { fixtureId: fixture.id, policyVersion: preferencePolicy.version } });
      let settled = false;
      try {
        const outcome = await client.evaluate(request);
        budget.settle(reservation.id, outcome.response?.usage); settled = true;
        const parsed = preferencePolicy.parseResponse(outcome.response);
        report.cases.push({ ...scorePreferenceResult(fixture, parsed), operationId, requestId: outcome.requestId,
          durationMs: outcome.durationMs, usage: outcome.response?.usage });
        failures = parsed.status === 'completed' ? 0 : failures + 1;
      } catch (error) {
        if (!settled) budget.markUnknown(reservation.id, error.code || 'validation_failure');
        report.cases.push({ fixtureId: fixture.id, language: fixture.language, passed: false, status: 'unavailable', reason: error.code || error.message });
        failures++;
      }
      writeFileSync(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
      const last = report.cases.at(-1);
      console.log(JSON.stringify({ fixtureId: last.fixtureId, passed: last.passed, status: last.status,
        durationMs: last.durationMs, mismatches: last.mismatches, reason: last.reason }));
      if (failures >= 3 || budget.summary().availableUsd < 0.05) break;
    }
    report.finishedAt = new Date().toISOString(); report.after = budget.summary();
    report.costUsd = Number((report.after.spentUsd - report.before.spentUsd).toFixed(9));
    report.passed = report.cases.filter(value => value.passed).length;
    report.byLanguage = Object.fromEntries(['en', 'es'].map(language => [language, {
      evaluated: report.cases.filter(value => value.language === language).length,
      passed: report.cases.filter(value => value.language === language && value.passed).length,
    }]));
    const timings = report.cases.map(value => value.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
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
  main().catch(error => { console.error(JSON.stringify({ error: error.code || error.message })); process.exitCode = 1; });
