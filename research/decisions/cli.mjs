import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createObserverState } from './state.mjs';
import { buildDecisionRequest } from './rubric.mjs';
import { createObserver } from './observer.mjs';
import { createDecisionsClient } from './client.mjs';
import { createBudgetLedger } from './budget.mjs';
import { fixtures } from './fixtures.mjs';
import { evaluateResults, calibrateThreshold, evaluateThreshold } from './evaluation.mjs';

export function stateForFixture(fixture) {
  const state = createObserverState({ fictional: true,
    accountId: 'fictional-account', callId: `fictional-call-${fixture.id}`, studentId: 'fictional-student-mira',
    language: fixture.language, role: fixture.role,
    brief: 'Fictional family exploring college. No real student records are included.',
  });
  const apply = event => {
    const result = state.apply(event);
    if (!result.accepted) throw new Error(`fixture_${fixture.id}_${result.reason}`);
  };
  for (const transcript of fixture.transcripts) apply({ type: 'transcript', ...transcript });
  apply({ type: 'question', id: `${fixture.id}-question`, text: fixture.question });
  for (const finding of fixture.researchFindings ?? []) apply({ type: 'finding', ...finding });
  for (const opportunity of fixture.opportunities ?? []) apply({ type: 'opportunity', ...opportunity });
  return state;
}

function argsOf(argv) {
  const options = { real: false, runId: null, limit: fixtures.length, fixtureIds: null, capUsd: 5 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--real') options.real = true;
    else if (arg === '--run-id') options.runId = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--fixture-ids') options.fixtureIds = argv[++i]?.split(',');
    else if (arg === '--cap-usd') options.capUsd = Number(argv[++i]);
    else throw new Error('unsupported_cli_option');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > fixtures.length) throw new Error('invalid_limit');
  if (!Number.isFinite(options.capUsd) || options.capUsd <= 0 || options.capUsd > 5) throw new Error('cap_exceeds_approval');
  if (options.runId !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(options.runId)) throw new Error('invalid_run_id');
  if (options.fixtureIds?.some(id => !fixtures.some(f => f.id === id))) throw new Error('unknown_fixture');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = argsOf(argv);
  const selected = fixtures.filter(f => !options.fixtureIds || options.fixtureIds.includes(f.id)).slice(0, options.limit);
  // Every fixture is validated before opening the ledger or making any request.
  for (const fixture of selected) buildDecisionRequest(stateForFixture(fixture).snapshot());
  if (!options.real) {
    const summary = { mode: 'offline', fixturesValidated: selected.length, apiCalls: 0, liveConnections: 0, intervention: false };
    console.log(JSON.stringify(summary)); return summary;
  }
  if (!process.env.ORIGEN_DECISIONS_TEST_KEY) throw new Error('dedicated_test_key_required');
  const localRoot = fileURLToPath(new URL('./.local/', import.meta.url));
  mkdirSync(localRoot, { recursive: true });
  const runId = options.runId ?? new Date().toISOString().replace(/[^a-zA-Z0-9]/g, '');
  const output = join(localRoot, runId);
  if (existsSync(output)) throw new Error('run_id_already_exists');
  mkdirSync(output);
  // All runs share one immutable approval ledger; changing run-id cannot reset it.
  const budget = createBudgetLedger({ path: join(localRoot, 'approved-five-dollar-budget.sqlite'), capUsd: options.capUsd, reservationUsd: 0.05, maxRequests: 60 });
  const client = createDecisionsClient({ apiKey: process.env.ORIGEN_DECISIONS_TEST_KEY, timeoutMs: 15000 });
  const records = [];
  let consecutiveFailures = 0;
  try {
    for (const fixture of selected) {
      const state = stateForFixture(fixture);
      let diagnosticFailure = false;
      const observer = createObserver({ state, client, budget, mode: 'observe', maxEvaluations: 1,
        onRecord: record => {
          try { appendFileSync(join(output, 'observations.jsonl'), JSON.stringify({ fixtureId: fixture.id, ...record }) + '\n'); }
          catch { diagnosticFailure = true; throw new Error('diagnostic_write_failed'); }
        },
      });
      observer.observe(); await observer.idle();
      if (diagnosticFailure) throw new Error('diagnostic_write_failed');
      const observation = observer.records().at(-1);
      const record = { fixtureId: fixture.id, language: fixture.language, role: fixture.role, split: fixture.split,
        expected: fixture.expected, result: observation?.result ?? null, status: observation?.status ?? 'missing',
        durationMs: observation?.durationMs ?? null, requestId: observation?.requestId ?? null,
        reason: observation?.reason ?? null, usage: observation?.usage ?? null };
      records.push(record);
      writeFileSync(join(output, 'results.json'), JSON.stringify(records, null, 2) + '\n');
      console.log(JSON.stringify({ fixtureId: fixture.id, status: record.status, durationMs: record.durationMs, reason: record.reason, budget: budget.summary() }));
      observer.close();
      consecutiveFailures = record.status === 'completed' ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= 3 || budget.summary().availableUsd < 0.05) break;
    }
    const calibration = calibrateThreshold(records);
    const summary = { mode: 'real-fictional-only', runId, requested: selected.length, completed: records.length,
      evaluation: evaluateResults(records), calibration, thresholdEvaluation: evaluateThreshold(records, calibration), budget: budget.summary(),
      liveConnections: 0, intervention: false,
      limitation: 'Classification on authored text fixtures does not establish naturalness or audible latency. No live call was changed or tested.',
    };
    writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ summaryFile: join(output, 'summary.json'), budget: summary.budget }));
    return summary;
  } finally { budget.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ error: error.code || error.message })); process.exitCode = 1; });
}
