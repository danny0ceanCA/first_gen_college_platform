// One real Decisions request through the actual local worker. No Live connection.
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { createBudgetLedger } from '../budget.mjs';

if (process.argv.some(arg => arg.startsWith('--') && arg !== '--execute')) throw Error('unsupported_argument');
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ preflight: true, maximumDecisionsRequests: 1, fictionalOnly: true,
    voiceCalls: 0, ledger: 'approved-support-decisions-budget.sqlite', allocatedCapUsd: 1.5 }));
  process.exit(0);
}
const root = fileURLToPath(new URL('../../../', import.meta.url));
const apiKey = loadEnv('development', root, '').OPENAI_API_KEY;
if (!apiKey) throw Error('local_openai_key_required');
const local = resolve(root, 'research/decisions/.local'), budgetPath = resolve(local, 'approved-support-decisions-budget.sqlite');
if (!existsSync(budgetPath)) throw Error('existing_approved_ledger_required');
const ledger = createBudgetLedger({ path: budgetPath, capUsd: 1.5, reservationUsd: .05, maxRequests: 200 });
const before = ledger.summary(); ledger.close();
if (before.availableUsd < .05 || before.requestCount >= 200) throw Error('budget_exhausted');
const callId = `diagnostics-${randomUUID()}`, studentId = 'fictional-diagnostics-student';
const file = resolve(local, `${callId}.jsonl`);
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { env: {}, workerData: {
  seed: { fictional: true, isolatedLocal: true, dataKind: 'fictional', accountId: 'fictional-diagnostics-account', callId, studentId, language: 'en', role: 'student' },
  paid: true, supportEnabled: true, preferencesEnabled: true, apiKey, logPath: file, budgetPath, allowedStudentIds: [studentId],
} });
let resolveReady, resolveCandidate, resolveClosed, rejectWait;
const ready = new Promise(resolve => { resolveReady = resolve; });
const candidate = new Promise(resolve => { resolveCandidate = resolve; });
const closed = new Promise(resolve => { resolveClosed = resolve; });
const error = new Promise((_, reject) => { rejectWait = reject; });
const timer = setTimeout(() => rejectWait(Error('diagnostic_validation_timeout')), 25000);
worker.on('message', message => {
  if (message.type === 'ready') resolveReady();
  if (message.type === 'preference_candidate') resolveCandidate(message);
  if (message.type === 'closed') resolveClosed();
  if (message.type === 'failed') rejectWait(Error(message.reason));
});
worker.on('error', rejectWait);
const wait = promise => Promise.race([promise, error]);
try {
  await wait(ready);
  const text = 'For the rest of this call, please use everyday words whenever we discuss college.';
  worker.postMessage({ source: 'native', atMs: performance.now(), event: {
    type: 'session.input_transcript.delta', event_id: 'fictional-native-1', delta: text, start_ms: 1000, end_ms: 3000,
  } });
  worker.postMessage({ source: 'application', atMs: performance.now(), event: {
    type: 'conversation.item.input_audio_transcription.completed', item_id: 'diagnostic-turn', transcript: text,
  }, preferenceStamp: { scopeGeneration: 0, inputRevision: 2, questionId: 'user:diagnostic-turn', studentId, sessionId: callId } });
  const result = await wait(candidate);
  worker.postMessage({ type: 'close', atMs: performance.now() }); await wait(closed);
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const required = ['worker_started', 'snapshot_offered', 'request_prepared', 'budget_reserved', 'api_started', 'api_completed',
    'budget_settled', 'response_parsed', 'observation_finished', 'candidate_forwarded', 'worker_closing', 'worker_closed'];
  const missing = required.filter(stage => !rows.some(row => row.type === `decisions_${stage}`));
  const api = rows.find(row => row.type === 'decisions_api_completed');
  const settled = rows.find(row => row.type === 'decisions_budget_settled');
  const checks = {
    allStagesPresent: missing.length === 0,
    oneRequest: rows.filter(row => row.type === 'decisions_api_started').length === 1,
    appendSequenceComplete: rows.every((row, index) => row.workerSequence === index + 1),
    clocksPresent: rows.every(row => row.at && Number.isFinite(row.workerElapsedMs)),
    callLinked: rows.every(row => row.callId === callId),
    operationAndRequestLinked: Boolean(api?.operationId && api?.requestId && api.operationId === settled?.operationId && api.requestId === settled?.requestId),
    reservationLinked: Boolean(api?.reservationId && api.reservationId === settled?.reservationId),
    usageAndCostPresent: Number.isFinite(api?.usage?.inputTokens) && Number.isFinite(settled?.costUsd),
    candidateNotDelivery: rows.filter(row => row.type === 'decisions_candidate_forwarded').every(row => row.contextSent === false && row.playbackClaim === false),
    noKeyLogged: !readFileSync(file, 'utf8').includes(apiKey),
  };
  const report = { at: new Date().toISOString(), callId, fictionalOnly: true, voiceCalls: 0, maximumDecisionsRequests: 1,
    checks, missing, passed: Object.values(checks).every(Boolean), rows: rows.length,
    costUsd: settled?.costUsd ?? null, transportAndJsonMs: api?.transportAndJsonMs ?? null,
    preferenceResult: result.record.result.preferenceChanges,
    evidenceLimit: 'Actual Decisions request and worker persistence; caller transcript and boundary were synthetic. No Live session, playback or naturalness test occurred.',
    logFile: file };
  const reportPath = resolve(local, `${callId}-report.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks, rows: rows.length, costUsd: report.costUsd,
    transportAndJsonMs: report.transportAndJsonMs, report: reportPath }));
  if (!report.passed) process.exitCode = 1;
} finally { clearTimeout(timer); await worker.terminate(); }
