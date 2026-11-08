// Controlled transcript replay: real Decisions + real observer worker, fake voice
// transport/playback. This verifies the cue pipe, not conversational naturalness.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { createObservedLocalSession } from './session.mjs';
import { SUPPORT_NOTES } from './support.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const local = resolve(root, 'research/decisions/.local');
const fixtures = [
  { language: 'en', kind: 'starting_point', intro: 'Hi, I am glad you are here. We can take college one step at a time.',
    request: 'I am the first in my family to think about college, and I have no idea where to begin. Can you help me find a starting point?' },
  { language: 'en', kind: 'simpler_explanation', intro: 'A prerequisite is a course that you complete before enrolling in another course.',
    request: 'I still do not understand what prerequisite means. Could you explain that more simply, with an everyday example?' },
  { language: 'en', kind: 'next_step', intro: 'You have chosen to learn about college options and have written down one subject that interests you.',
    request: 'I have already written down that subject. What is one small next step I can take today?' },
  { language: 'es', kind: 'starting_point', intro: 'Hola, me alegra que estés aquí. Podemos entender la universidad poco a poco.',
    request: 'Soy la primera persona de mi familia que piensa en ir a la universidad y no sé por dónde empezar. ¿Me ayudas a encontrar un punto de partida?' },
  { language: 'es', kind: 'simpler_explanation', intro: 'Un prerrequisito es una materia que debes completar antes de inscribirte en otra materia.',
    request: 'Todavía no entiendo qué significa prerrequisito. ¿Me lo puedes explicar con palabras más sencillas y un ejemplo cotidiano?' },
  { language: 'es', kind: 'next_step', intro: 'Ya decidiste conocer tus opciones para la universidad y anotaste un tema que te interesa.',
    request: 'Ya anoté ese tema. ¿Cuál es un solo paso pequeño que puedo hacer hoy para seguir adelante?' },
];
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ preflight: true, cases: fixtures.length, maximumDecisionsRequests: 18,
    voiceCalls: 0, fictionalOnly: true, ledger: 'approved-support-decisions-budget.sqlite',
    capUsd: 1.5, command: 'node research/decisions/local-call/validate-support.mjs --execute' }));
  process.exit(0);
}
const apiKey = loadEnv('development', root, '').OPENAI_API_KEY;
if (!apiKey) throw Error('local_openai_key_required');
mkdirSync(local, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const drain = () => new Promise(resolve => setImmediate(resolve));
const report = { startedAt: new Date().toISOString(), fictionalOnly: true, voiceCalls: 0, researchCalls: 0,
  evidenceType: 'controlled_transcript_replay_with_real_decisions_and_worker',
  evidenceLimits: 'Voice provider, transcript timing, playback-idle heartbeats and context acknowledgments are simulated. No assistant reply is allowed before classification finishes. This demonstrates cue plumbing under controlled conditions, not live audio delivery, natural timing, human experience, or improvement.',
  budget: { ledger: 'approved-support-decisions-budget.sqlite', allocatedCapUsd: 1.5, maximumRequestsThisRun: 18 }, cases: [] };

for (const fixture of fixtures) {
  const callId = `support-replay-${randomUUID()}`;
  const seed = { fictional: true, accountId: 'fictional-support-replay', callId, studentId: 'fictional-student', language: fixture.language, role: 'family' };
  const commands = [], application = [], file = resolve(local, `${callId}.jsonl`);
  const records = () => { try { return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  const result = { callId, language: fixture.language, requestedKind: fixture.kind, errors: [] };
  let heartbeat, engine;
  async function waitFor(predicate, label, maxMs = 18000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      if (engine.observation.status().failed) throw Error('observer_failed');
      if (predicate(records())) return;
      await pause(30);
    }
    throw Error(label);
  }
  try {
    engine = createObservedLocalSession({ scope: { sessionId: callId, studentId: seed.studentId, confirmed: true },
      config: { language: fixture.language, tools: [], requestedVoice: 'marin' },
      provider: { readyState: 1, send(value) { commands.push({ at: Date.now(), ...JSON.parse(value) }); } },
      emit(event) { application.push({ at: Date.now(), ...event }); },
      jobRequest() { report.researchCalls++; throw Error('unexpected_research'); } },
    { localOnly: true, fictional: true, seed, allowedCallIds: [callId], paid: true, supportEnabled: true, apiKey });
    if (!await engine.observation.ready) throw Error('worker_unavailable');
    engine.start();
    engine.receive({ type: 'session.output_transcript.delta', delta: fixture.intro, start_ms: 0, end_ms: 1000 });
    await drain(); await engine.flush(); engine.playback({ idle: true, version: 1 });
    heartbeat = setInterval(() => engine.playback({ idle: true, version: 1 }), 100);
    // Finish the intro-only classification before the request; it is not a cue.
    await waitFor(rows => rows.some(row => row.type === 'decision_observation'), 'intro_observation_timeout');
    if (!engine.observation.status().support.introReady) throw Error('intro_not_ready');
    result.requestAt = Date.now();
    engine.receive({ type: 'session.input_transcript.delta', delta: fixture.request, start_ms: 2000, end_ms: 4000 });
    await drain(); await engine.flush();
    await waitFor(rows => rows.filter(row => row.type === 'decision_observation').length >= 2, 'request_observation_timeout');
    await pause(150);
    const cue = commands.find(event => event.event_id?.startsWith('support_'));
    result.cueSent = Boolean(cue);
    result.requestToCueMs = cue ? cue.at - result.requestAt : null;
    result.fixedQuietNote = Boolean(cue && cue.type === 'session.thinking.append' && cue.delegation_id === null
      && cue.content === SUPPORT_NOTES[fixture.language][fixture.kind]);
    if (!result.fixedQuietNote) result.errors.push('expected_fixed_quiet_note_missing');
    if (cue) {
      engine.receive({ type: 'session.thinking.appended', client_event_id: cue.event_id, start_ms: 4100, end_ms: 4100 });
      await waitFor(rows => rows.some(row => row.type === 'support_context_acknowledged'), 'simulated_ack_log_timeout', 2000);
    }
    const rows = records();
    result.classifications = rows.filter(row => row.type === 'decision_observation').map(row => ({ status: row.status,
      durationMs: row.durationMs, supportNeed: row.result?.supportNeed, confidence: row.result?.confidence,
      selectedProbability: row.result?.selectedProbability, addressedProbability: row.result?.addressedProbability,
      alreadyAddressed: row.result?.alreadyAddressed, reason: row.reason ?? null, inputTokens: row.usage?.input_tokens ?? null }));
    result.diagnostics = rows.filter(row => row.type.startsWith('support_')).map(row => ({ type: row.type,
      reason: row.reason ?? null, contextSent: row.contextSent, playbackClaim: row.playbackClaim }));
    result.acknowledgmentDiagnosticVerified = result.diagnostics.some(row => row.type === 'support_context_acknowledged' && row.playbackClaim === false);
    result.acknowledgmentSource = 'simulated_provider_event';
    result.userBoundaries = application.filter(row => row.type === 'conversation.item.input_audio_transcription.completed').length;
    result.assistantBoundaries = application.filter(row => row.type === 'response.output_audio_transcript.done').length;
    if (result.userBoundaries !== 1 || result.assistantBoundaries !== 1) result.errors.push('unexpected_boundary_count');
  } catch (error) { result.errors.push(error.message); }
  finally { clearInterval(heartbeat); engine?.close(); await engine?.observation.closed; }
  const finalRows = records().filter(row => row.type === 'decision_observation');
  result.decisionsRequests = finalRows.filter(row => row.operationId).length;
  result.accountedInputTokens = finalRows.reduce((sum, row) => sum + (row.usage?.input_tokens ?? 0), 0);
  result.passed = result.errors.length === 0 && result.fixedQuietNote && result.acknowledgmentDiagnosticVerified;
  report.cases.push(result);
  writeFileSync(resolve(local, 'support-controlled-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ language: result.language, kind: result.requestedKind, passed: result.passed,
    requestToCueMs: result.requestToCueMs, requests: result.decisionsRequests, errors: result.errors }));
  if (report.cases.reduce((sum, row) => sum + row.decisionsRequests, 0) > 18) throw Error('run_request_limit_exceeded');
}
report.finishedAt = new Date().toISOString();
report.totalRequests = report.cases.reduce((sum, row) => sum + row.decisionsRequests, 0);
report.accountedCostUsd = report.cases.reduce((sum, row) => sum + row.accountedInputTokens, 0) * 0.1 / 1_000_000;
report.passedCases = report.cases.filter(row => row.passed).length;
writeFileSync(resolve(local, 'support-controlled-validation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passedCases, total: report.cases.length, requests: report.totalRequests,
  accountedCostUsd: report.accountedCostUsd, voiceCalls: 0, report: 'research/decisions/.local/support-controlled-validation.json' }));
if (report.passedCases !== report.cases.length) process.exitCode = 1;
