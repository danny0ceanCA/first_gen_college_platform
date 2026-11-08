import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createObservedLocalSession } from './session.mjs';

const drain = () => new Promise(resolve => setImmediate(resolve));
async function setup(language, enabled = true) {
  const sent = [], worker = new EventEmitter(); worker.messages = [];
  worker.postMessage = m => { worker.messages.push(m); if (m.type === 'close') queueMicrotask(() => worker.emit('message', { type: 'closed' })); };
  worker.terminate = async () => {};
  const scope = { sessionId: 'fictional-support-session', studentId: 'fictional-student', confirmed: true };
  const engine = createObservedLocalSession({ scope, config: { language, tools: [], requestedVoice: 'marin' },
    provider: { send: value => sent.push(JSON.parse(value)) }, emit() {}, jobRequest() { throw Error('unexpected_research'); } },
  { localOnly: true, fictional: true, seed: { fictional: true, accountId: 'fictional-account', callId: scope.sessionId, studentId: scope.studentId, language },
    allowedCallIds: [scope.sessionId], paid: enabled, supportEnabled: enabled }, { createWorker: () => worker });
  worker.emit('message', { type: 'ready' }); await engine.observation.ready; engine.start();
  engine.receive({ type: 'session.output_transcript.delta', delta: language === 'en' ? 'Hi, good to hear from you.' : 'Hola, qué gusto escucharte.', start_ms: 0, end_ms: 500 });
  await drain(); await engine.flush(); engine.playback({ idle: true, version: 1 });
  engine.receive({ type: 'session.input_transcript.delta', delta: language === 'en' ? 'Can you help me figure out where to begin with college?' : '¿Me ayudas a saber por dónde empezar con la universidad?', start_ms: 1000, end_ms: 2000 });
  await drain(); await engine.flush();
  const packet = worker.messages.findLast(m => m.source === 'application' && m.event.type === 'conversation.item.input_audio_transcription.completed');
  const candidate = { type: 'support_candidate', stamp: packet.supportStamp, record: { status: 'completed', callId: scope.sessionId,
    studentId: scope.studentId, sourceTranscriptIds: [`user:${packet.event.item_id}`], operationId: 'fictional-op',
    result: { supportNeed: 'starting_point', confidence: .99, selectedProbability: .99, alreadyAddressed: false, addressedProbability: .01 } } };
  return { engine, worker, sent, candidate };
}

for (const language of ['en', 'es']) test(`${language}: support wrapper accepts only one matched quiet cue after intro and preserves baseline startup`, async () => {
  const base = await setup(language, false), active = await setup(language);
  const clean = rows => JSON.stringify(rows).replace(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi, 'ID');
  try {
    assert.equal(clean(active.sent), clean(base.sent));
    const before = active.sent.length;
    active.worker.emit('message', active.candidate);
    assert.equal(active.sent.length, before + 1);
    assert.equal(active.sent.at(-1).type, 'session.thinking.append');
    assert.equal(active.sent.at(-1).delegation_id, null);
    assert.equal(active.sent.at(-1).content.includes(language === 'es' ? 'Observación' : 'Conversation support'), true);
    active.worker.emit('message', active.candidate); assert.equal(active.sent.length, before + 1);
    active.engine.receive({ type: 'session.thinking.appended', client_event_id: active.sent.at(-1).event_id });
    assert.ok(active.worker.messages.some(m => m.type === 'support_diagnostic' && m.event.type === 'support_context_acknowledged'));
    base.worker.emit('message', active.candidate); assert.equal(base.sent.length, before);
  } finally { base.engine.close(); active.engine.close(); await Promise.all([base.engine.observation.closed, active.engine.observation.closed]); }
});

for (const change of ['speech', 'delegation', 'suspend', 'forged', 'research-only']) test(`support wrapper rejects candidate after ${change}`, async () => {
  const f = await setup('en');
  try {
    if (change === 'speech') f.engine.receive({ type: 'session.output_transcript.delta', delta: 'We can start small.', start_ms: 2100, end_ms: 2300 });
    if (change === 'delegation') f.engine.receive({ type: 'session.delegation.created', delegation: { id: 'del-1', target: 'responses' } });
    if (change === 'suspend') f.engine.suspend();
    if (change === 'forged') f.candidate.record.studentId = 'another-student';
    if (change === 'research-only') f.candidate.record.result = { supportNeed: 'none', predicates: { research_relevant_now: { observed: true } } };
    const before = f.sent.length;
    f.worker.emit('message', f.candidate); assert.equal(f.sent.length, before);
  } finally { f.engine.close(); await f.engine.observation.closed; }
});
