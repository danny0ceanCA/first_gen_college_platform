import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createObservedLocalSession } from './session.mjs';

const drain = () => new Promise(resolve => setImmediate(resolve));
for (const language of ['en', 'es']) test(`${language}: actual wrapper delivers a lasting preference after speech and later supersedes it`, async () => {
  let now = 0, version = 0;
  const worker = new EventEmitter(), sent = [], messages = [];
  worker.postMessage = m => { messages.push(m); if (m.type === 'close') queueMicrotask(() => worker.emit('message', { type: 'closed' })); };
  worker.terminate = async () => {};
  const scope = { sessionId: 'fictional-preference-call', studentId: 'fictional-student', confirmed: true };
  const engine = createObservedLocalSession({ scope, config: { language, tools: [], requestedVoice: 'marin' },
    provider: { readyState: 1, send: text => sent.push(JSON.parse(text)) }, emit() {}, jobRequest() { throw Error('unexpected_research'); } },
  { localOnly: true, fictional: true, seed: { fictional: true, accountId: 'fictional-account', callId: scope.sessionId, studentId: scope.studentId, language },
    allowedCallIds: [scope.sessionId], paid: true, supportEnabled: true, preferencesEnabled: true },
  { createWorker: () => worker, now: () => now });
  const idle = () => engine.playback({ idle: true, version: ++version });
  async function words(role, text) {
    engine.receive({ type: `session.${role}_transcript.delta`, delta: text, start_ms: now, end_ms: now + 50 });
    await drain(); await engine.flush();
  }
  function result(action) {
    const packet = messages.findLast(m => m.source === 'application' && m.event.type === 'conversation.item.input_audio_transcription.completed');
    const value = { action, confidence: .99, selectedProbability: .99 };
    return { type: 'preference_candidate', stamp: packet.preferenceStamp, record: { status: 'completed',
      sourceStatus: 'discarded', sourceReason: 'stale_after_request', callId: scope.sessionId, studentId: scope.studentId, requestId: `req-${now}`,
      sourceTranscriptIds: [`user:${packet.event.item_id}`], operationId: `op-${now}`,
      result: { preferenceChanges: { plain_language: value, one_step_at_a_time: value } } } };
  }
  const notes = () => sent.filter(event => event.event_id?.startsWith('support_preference_'));
  try {
    worker.emit('message', { type: 'ready' }); await engine.observation.ready; engine.start();
    await words('output', language === 'es' ? 'Hola. ¿Cómo te ayudo?' : 'Hello. How can I help?'); idle();
    now = 1000;
    await words('input', language === 'es' ? 'Durante esta conversación usa palabras sencillas y un paso a la vez.' : 'Throughout this conversation use plain words and one step at a time.');
    const candidate = result('enable');
    engine.receive({ type: 'session.output_transcript.delta', delta: language === 'es' ? 'Claro. ' : 'Of course. ', start_ms: now, end_ms: now + 50 });
    worker.emit('message', candidate); assert.equal(notes().length, 0, 'assistant speech never waits or receives an interrupting cue');
    await drain(); await engine.flush(); idle();
    // Real sideband connections keep streaming zero-valued PCM after speech.
    // Those transport frames must not erase the completed thought or lock it.
    for (let i = 0; i < 5; i++) {
      now += 200;
      engine.receive({ type: 'session.output_audio.delta', delta: Buffer.alloc(9600).toString('base64') });
      idle();
    }
    assert.equal(notes().length, 1);
    assert.equal(notes()[0].type, 'session.thinking.append');
    const delivery = messages.find(m => m.event?.type === 'support_preference_sent');
    assert.equal(delivery.event.requestId, candidate.record.requestId);
    assert.equal(delivery.event.readiness.playbackIdle, true);
    assert.equal(delivery.event.readiness.inputOpen, false);
    assert.equal(delivery.event.readiness.outputOpen, false);
    assert.ok(delivery.event.pendingMs >= 900);
    assert.equal(delivery.event.playbackClaim, false);
    assert.equal(typeof delivery.atMs, 'number');
    engine.receive({ type: 'session.thinking.appended', client_event_id: notes()[0].event_id });
    worker.emit('message', candidate); now += 5000; idle(); assert.equal(notes().length, 1);
    await words('input', language === 'es' ? 'Retira esas preferencias y vuelve a tu estilo normal.' : 'Remove those preferences and return to your normal style.');
    worker.emit('message', result('disable'));
    await words('output', language === 'es' ? 'Claro, seguimos.' : 'Of course, we can continue.'); idle(); now += 1000; idle();
    assert.equal(notes().length, 2);
    assert.match(notes()[1].content, language === 'es' ? /sin preferencia activa/ : /no active preference/);
    assert.ok(messages.some(m => m.event?.type === 'support_preference_context_acknowledged'));
  } finally { engine.close(); await engine.observation.closed; }
});
