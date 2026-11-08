// Explicit fictional evaluation. Independent of the local microphone approval.
import { mkdirSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createObserverState } from './state.mjs';
import { createObserver } from './observer.mjs';
import { createDecisionsClient } from './client.mjs';
import { createBudgetLedger } from './budget.mjs';
import { broadFixtures } from './broad-fixtures.mjs';
import { broadPolicy, BROAD_PREDICATES } from './broad-rubric.mjs';

export function stateForBroadFixture(fixture) {
  const state = createObserverState({ fictional: true, accountId: 'fictional-account',
    callId: `fictional-${fixture.id}`, studentId: 'fictional-student', language: fixture.language, role: fixture.role });
  const apply = event => { const receipt = state.apply(event); if (!receipt.accepted) throw Error(`fixture_rejected:${fixture.id}:${receipt.reason}`); };
  for (const transcript of fixture.transcripts) apply({ type: 'transcript', ...transcript });
  apply({ type: 'question', id: 'fixture-current-question', text: fixture.question });
  for (const finding of fixture.researchFindings ?? []) apply({ type: 'finding', ...finding });
  for (const task of fixture.researchTasks ?? []) apply({ type: 'research_task', ...task });
  return state;
}

const expectedStatus = (fixture, name) => fixture.expectedProvisional ? 'provisional'
  : fixture.expectedUnavailable?.includes(name) ? 'unavailable'
    : fixture.expected.predicates[name] ? 'observed' : 'not_observed';

export function evaluateBroadResults(records) {
  const count = rows => {
    const completed = rows.filter(r => r.status === 'completed');
    const duration = completed.map(r => r.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = p => duration.length ? duration[Math.max(0, Math.ceil(duration.length * p) - 1)] : null;
    const predicates = Object.fromEntries(BROAD_PREDICATES.map(name => {
      const scored = completed.map(r => ({ expected: r.expectedStatuses[name], actual: r.disposition?.predicates?.[name]?.status }));
      const binary = scored.filter(r => ['observed', 'not_observed'].includes(r.expected));
      return [name, { assessed: scored.length, correctStatus: scored.filter(r => r.actual === r.expected).length,
        expectedUnavailable: scored.filter(r => r.expected === 'unavailable').length,
        expectedProvisional: scored.filter(r => r.expected === 'provisional').length,
        binaryCases: binary.length, truePositive: binary.filter(r => r.expected === 'observed' && r.actual === 'observed').length,
        falsePositive: binary.filter(r => r.expected === 'not_observed' && r.actual === 'observed').length,
        missedPositive: binary.filter(r => r.expected === 'observed' && r.actual !== 'observed').length }];
    }));
    return { cases: rows.length, completed: completed.length,
      supportCorrect: completed.filter(r => r.result?.supportNeed === r.expected.supportNeed).length,
      alreadyAddressedCorrect: completed.filter(r => r.result?.alreadyAddressed === r.expected.alreadyAddressed).length,
      exactCases: completed.filter(r => r.mismatches.length === 0).length,
      p50Ms: percentile(0.5), p95Ms: percentile(0.95), predicates };
  };
  return { overall: count(records), byLanguage: Object.fromEntries(['en', 'es'].map(language => [language, count(records.filter(r => r.language === language))])),
    failures: records.filter(r => r.status !== 'completed' || r.mismatches.length).map(r => ({ fixtureId: r.fixtureId, status: r.status, mismatches: r.mismatches, reason: r.reason })) };
}

export function scoreBroadObservation(fixture, observation) {
  const expectedStatuses = Object.fromEntries(BROAD_PREDICATES.map(name => [name, expectedStatus(fixture, name)]));
  const mismatches = [];
  if (observation?.status === 'completed') {
    for (const field of ['supportNeed', 'alreadyAddressed']) if (observation.result?.[field] !== fixture.expected[field])
      mismatches.push({ field, expected: fixture.expected[field], actual: observation.result?.[field] });
    for (const name of BROAD_PREDICATES) if (observation.disposition?.predicates?.[name]?.status !== expectedStatuses[name])
      mismatches.push({ field: name, expected: expectedStatuses[name], actual: observation.disposition?.predicates?.[name]?.status });
  }
  return { fixtureId: fixture.id, pairId: fixture.pairId, language: fixture.language, topic: fixture.topic,
    expected: fixture.expected, expectedStatuses, mismatches, status: observation?.status ?? 'missing',
    result: observation?.result ?? null, disposition: observation?.disposition ?? null,
    requestId: observation?.requestId ?? null, durationMs: observation?.durationMs ?? null,
    reason: observation?.reason ?? null, usage: observation?.usage ?? null };
}

function parseArgs(argv) {
  const options = { real: false, runId: null, limit: broadFixtures.length, ids: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--real') options.real = true;
    else if (arg === '--run-id') options.runId = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--fixture-ids') options.ids = argv[++i]?.split(',');
    else throw Error('unsupported_cli_option');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > broadFixtures.length) throw Error('invalid_limit');
  if (options.runId !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(options.runId)) throw Error('invalid_run_id');
  if (options.ids?.some(id => !broadFixtures.some(f => f.id === id))) throw Error('unknown_fixture');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const selected = broadFixtures.filter(f => !options.ids || options.ids.includes(f.id)).slice(0, options.limit);
  // Validate the complete chosen set before opening the ledger or contacting a model.
  for (const fixture of selected) broadPolicy.buildRequest(stateForBroadFixture(fixture).snapshot());
  if (!options.real) {
    const summary = { mode: 'offline', fixturesValidated: selected.length, apiCalls: 0, liveConnections: 0, intervention: false };
    console.log(JSON.stringify(summary)); return summary;
  }
  if (!process.env.ORIGEN_DECISIONS_TEST_KEY) throw Error('dedicated_test_key_required');
  const root = fileURLToPath(new URL('./.local/', import.meta.url));
  mkdirSync(root, { recursive: true });
  const runId = options.runId ?? `broad-${Date.now()}`;
  const output = join(root, runId);
  if (existsSync(output)) throw Error('run_id_already_exists');
  mkdirSync(output);
  // New $2 approval applies only to this fixed fictional suite. A run name cannot reset it.
  const budget = createBudgetLedger({ path: join(root, 'approved-broad-two-dollar-budget.sqlite'),
    capUsd: 2, reservationUsd: 0.05, maxRequests: 120 });
  const client = createDecisionsClient({ apiKey: process.env.ORIGEN_DECISIONS_TEST_KEY });
  const records = [];
  let consecutiveFailures = 0;
  try {
    for (const fixture of selected) {
      const state = stateForBroadFixture(fixture);
      let loggingFailed = false;
      const observer = createObserver({ state, budget, client, mode: 'observe', policy: broadPolicy, maxEvaluations: 1,
        onRecord(row) { try { appendFileSync(join(output, 'observations.jsonl'), JSON.stringify({ fixtureId: fixture.id, ...row }) + '\n'); }
          catch { loggingFailed = true; } } });
      observer.observe(); await observer.idle(); observer.close();
      if (loggingFailed) throw Error('diagnostic_write_failed');
      const record = scoreBroadObservation(fixture, observer.records().at(-1));
      records.push(record);
      writeFileSync(join(output, 'results.json'), JSON.stringify(records, null, 2) + '\n');
      console.log(JSON.stringify({ fixtureId: fixture.id, status: record.status, durationMs: record.durationMs,
        mismatches: record.mismatches, reason: record.reason }));
      consecutiveFailures = record.status === 'completed' ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= 3 || budget.summary().availableUsd < 0.05) break;
    }
    const summary = { mode: 'real-fictional-only', runId, rubricVersion: broadPolicy.version,
      requested: selected.length, evaluated: records.length, evaluation: evaluateBroadResults(records), budget: budget.summary(),
      liveConnections: 0, intervention: false,
      limitation: 'Authored paired text cases evaluate observation only. No production, live audio, independent holdout, factual research verification or conversation improvement is established.' };
    writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ summaryFile: join(output, 'summary.json'), budget: summary.budget }));
    return summary;
  } finally { budget.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(JSON.stringify({ error: error.code || error.message })); process.exitCode = 1; });
