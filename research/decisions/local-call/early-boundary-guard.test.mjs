import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportGate } from './support.mjs';
import { createEarlyEvidenceTracker } from './early-projector.mjs';
import { earlyResultFixture } from './early-fixtures.mjs';

for (const language of ['en', 'es']) test(`${language}: a duplicate earlier input boundary cannot release current caller support`, () => {
  let at = 10000, version = 0;
  const scope = { sessionId: 'fictional-boundary-call', studentId: 'fictional-student', confirmed: true };
  const tracker = createEarlyEvidenceTracker({ fictional: true, callId: scope.sessionId, studentId: scope.studentId, language }, { now: () => at });
  const sent = [], logs = [];
  const gate = createSupportGate({ enabled: true, conversationEnabled: true, earlyEnabled: true,
    scope, language, getEarlyEvidence: tracker.snapshot, now: () => at,
    send: event => { sent.push(event); return true; }, log: event => logs.push(event) });
  function receive(source, event) {
    tracker.receive({ source, event, atMs: at });
    if (source === 'native') gate.native(event); else gate.boundary(event);
  }
  const native = (id, role, text) => receive('native', { type: `session.${role}_transcript.delta`,
    event_id: id, delta: text, start_ms: at, end_ms: at + 20 });
  const idle = () => gate.playback({ idle: true, version: ++version });
  gate.native({ type: 'session.started' });
  const intro = language === 'en' ? 'Hi. Where would you like to begin?' : 'Hola. ¿Por dónde te gustaría empezar?';
  native('intro', 'output', intro);
  receive('application', { type: 'response.output_audio_transcript.done', response_id: 'intro-boundary', transcript: intro });
  idle(); assert.equal(gate.status().introReady, true);

  at += 100;
  const previous = language === 'en' ? 'I have a college question.' : 'Tengo una pregunta sobre la universidad.';
  const oldBoundary = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'previous-boundary', transcript: previous };
  native('previous-caller', 'input', previous); receive('application', oldBoundary);
  at += 100;
  const current = language === 'en' ? 'I do not understand the difference.' : 'No entiendo la diferencia.';
  native('current-caller', 'input', current);
  const snapshot = tracker.snapshot();
  gate.considerEarly({ stamp: snapshot.stamp, record: { status: 'completed', callId: scope.sessionId,
    studentId: scope.studentId, operationId: 'fictional-operation', requestId: 'fictional-request',
    sourceEventIds: snapshot.sourceEventIds, sourceText: snapshot.text,
    supportRevision: gate.earlySupportRevision(), assistantOutputRevision: snapshot.assistantOutputRevision,
    result: earlyResultFixture() } });
  assert.equal(gate.status().early.pending, true); assert.equal(sent.length, 0);

  // A delayed duplicate is a real possibility when translated events replay.
  // The tracker recognizes it as old and correctly leaves this input open;
  // the generic support boundary handler alone must not authorize a cue.
  receive('application', oldBoundary); idle();
  assert.equal(tracker.snapshot().inputOpen, true);
  assert.equal(sent.length, 0);
  assert.ok(logs.some(row => row.reason === 'caller_boundary_unconfirmed'));
  assert.equal(gate.status().early.pending, true);

  receive('application', { type: 'conversation.item.input_audio_transcription.completed', item_id: 'current-boundary', transcript: current });
  assert.equal(tracker.snapshot().inputOpen, false);
  idle(); assert.equal(sent.length, 1); assert.equal(sent[0].type, 'session.thinking.append');
  const delivered = logs.find(row => row.type === 'support_early_sent');
  assert.equal(delivered.inputBoundaryEvidence, 'matched_application_estimate');
  assert.equal(delivered.callerAudioEnded, 'unknown');
  assert.equal(delivered.sourceComplete, false);
  assert.equal(delivered.playbackClaim, false);
  gate.close(); tracker.close();
});
