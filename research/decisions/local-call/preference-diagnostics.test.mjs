import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportGate } from './support.mjs';

function fixture() {
  let now = 0, version = 0;
  const logs = [], commands = [];
  const scope = { sessionId: 'fictional-call', studentId: 'fictional-student', confirmed: true };
  const gate = createSupportGate({ enabled: true, preferencesEnabled: true, scope, language: 'en',
    now: () => now, send: event => commands.push(event), log: event => logs.push(event) });
  const idle = () => gate.playback({ idle: true, version: ++version });
  gate.native({ type: 'session.started' });
  gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Welcome.' }); idle();
  now = 1000;
  gate.native({ type: 'session.input_transcript.delta', delta: 'Use plain language throughout our call.' });
  gate.boundary({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'turn-1', transcript: 'Use plain language throughout our call.' });
  const candidate = { stamp: gate.preferenceStamp(), record: { status: 'completed', sourceStatus: 'completed',
    operationId: 'operation-1', requestId: 'request-1', callId: scope.sessionId, studentId: scope.studentId,
    sourceTranscriptIds: ['user:turn-1'], result: { preferenceChanges: {
      plain_language: { action: 'enable', confidence: .99, selectedProbability: .99 },
      one_step_at_a_time: { action: 'unchanged', confidence: .99, selectedProbability: .99 },
    } } } };
  return { gate, logs, commands, candidate, idle, advance: ms => { now += ms; } };
}

test('preference diagnostics correlate classification, readiness, send and acknowledgment without claiming playback', () => {
  const f = fixture(); f.gate.researchBusy(true); f.gate.considerPreference(f.candidate);
  const held = f.logs.find(row => row.type === 'support_preference_deferred');
  assert.equal(held.reason, 'background_or_context_pending');
  assert.equal(held.readiness.research, true);
  assert.equal(held.requestId, 'request-1');
  f.advance(400); f.gate.researchBusy(false);
  f.gate.native({ type: 'session.output_transcript.delta', delta: 'Of course.' });
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Of course.' });
  f.idle(); f.advance(1000); f.idle();
  const sent = f.logs.find(row => row.type === 'support_preference_sent');
  assert.equal(sent.pendingMs, 1400); assert.equal(sent.validationToSendMs, 1400);
  assert.equal(sent.thoughtAgeMs, 1000); assert.equal(sent.idleMs, 1000);
  assert.equal(sent.operationId, 'operation-1'); assert.equal(sent.requestId, 'request-1');
  assert.equal(sent.questionId, 'user:turn-1'); assert.equal(sent.studentId, 'fictional-student');
  assert.equal(sent.readiness.research, false); assert.equal(sent.playbackClaim, false);
  f.advance(550); f.gate.native({ type: 'session.thinking.appended', client_event_id: f.commands[0].event_id, start_ms: 2500, end_ms: 2600 });
  const ack = f.logs.at(-1);
  assert.equal(ack.type, 'support_preference_context_acknowledged');
  assert.equal(ack.durationMs, 550); assert.equal(ack.requestId, 'request-1');
  assert.equal(ack.startMs, 2500); assert.equal(ack.playbackClaim, false);
});

test('uncertainty logs typed probabilities and thresholds, never extra generated wording', () => {
  const f = fixture();
  f.candidate.record.result.preferenceChanges.one_step_at_a_time.confidence = .8;
  f.candidate.record.result.preferenceChanges.plain_language.reasoning = 'Do not copy generated private explanation';
  assert.equal(f.gate.considerPreference(f.candidate).accepted, false);
  const row = f.logs.at(-1);
  assert.equal(row.reason, 'uncertain_or_invalid');
  assert.equal(row.classifications.one_step_at_a_time.confidence, .8);
  assert.equal(row.thresholds.confidence, .85);
  assert.equal(JSON.stringify(f.logs).includes('private explanation'), false);
  assert.equal(f.commands.length, 0);
});

test('unchanged defer reasons and missing acknowledgments do not flood logs or cause retries', () => {
  const f = fixture(); f.gate.researchBusy(true); f.gate.considerPreference(f.candidate);
  for (let i = 0; i < 100; i++) { f.advance(10); f.idle(); }
  assert.equal(f.logs.filter(row => row.type === 'support_preference_deferred').length, 1);
  f.gate.researchBusy(false);
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Of course.' });
  f.idle(); f.advance(1000); f.idle();
  f.advance(10001); f.gate.status(); f.gate.status();
  const unresolved = f.logs.filter(row => row.type === 'support_context_unconfirmed');
  assert.equal(unresolved.length, 1); assert.equal(unresolved[0].kind, 'preference');
  assert.equal(unresolved[0].requestId, 'request-1'); assert.equal(unresolved[0].revision, 1);
  assert.equal(f.commands.length, 1);
});

for (const outcome of ['acknowledged', 'rejected', 'timeout']) test(`a late ${outcome} record retains the student and language of the original send`, () => {
  const f = fixture(); f.gate.considerPreference(f.candidate);
  f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Of course.' });
  f.idle(); f.advance(1000); f.idle();
  assert.equal(f.commands.length, 1);
  f.gate.configure({ sessionId: 'fictional-call', studentId: 'another-student', confirmed: true }, 'es');
  if (outcome === 'timeout') { f.advance(10001); f.gate.status(); }
  else f.gate.native({ type: outcome === 'acknowledged' ? 'session.thinking.appended' : 'error',
    client_event_id: f.commands[0].event_id, ...(outcome === 'rejected' ? { error: { code: 'invalid_event' } } : {}) });
  const row = f.logs.findLast(event => event.eventId === f.commands[0].event_id);
  assert.equal(row.studentId, 'fictional-student'); assert.equal(row.language, 'en');
  assert.equal(row.callId, 'fictional-call'); assert.equal(row.requestId, 'request-1');
  assert.equal(row.playbackClaim, false);
});
