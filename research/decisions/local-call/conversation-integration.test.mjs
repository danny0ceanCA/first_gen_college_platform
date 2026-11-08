import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportGate } from './support.mjs';
import { createConversationCandidateBridge } from './conversation-candidates.mjs';

function fixture(language = 'en') {
  let at = 0, seq = 0;
  const sent = [], logs = [], scope = { sessionId: 'fictional-call', studentId: 'fictional-student', confirmed: true };
  const gate = createSupportGate({ enabled: true, conversationEnabled: true, scope, language,
    now: () => at, send: event => sent.push(event), log: event => logs.push(event), makeId: () => String(++seq) });
  const idle = () => gate.playback({ idle: true, version: seq++ });
  const answer = text => {
    gate.native({ type: 'session.output_transcript.delta', delta: text });
    gate.boundary({ type: 'response.output_audio_transcript.done', transcript: text, response_id: 'reply-' + seq++ });
  };
  const advance = ms => { for (let left = ms; left > 0; left -= 100) { at += Math.min(100, left); idle(); } };
  function user(text) {
    gate.native({ type: 'session.input_transcript.delta', delta: text });
    gate.boundary({ type: 'conversation.item.input_audio_transcription.completed', transcript: text, item_id: 'user-' + seq++ });
    idle();
  }
  function candidate(confusion = 'none', continuation = 'none') {
    const stamp = gate.conversationStamp();
    return { stamp, record: { status: 'completed', callId: scope.sessionId, studentId: scope.studentId,
      sourceTranscriptIds: [stamp.questionId], operationId: 'test-operation',
      result: { conversationSupport: Object.fromEntries(Object.entries({ confusion, continuation }).map(([name, action]) => [name, {
        action, selectedProbability: .99, confidence: .99,
      }])) } } };
  }
  gate.native({ type: 'session.started' });
  return { gate, sent, logs, scope, answer, advance, user, candidate, idle };
}

for (const language of ['en', 'es']) {
  const offer = language === 'en' ? 'Would you like an example of a grant?' : '¿Quieres un ejemplo de una beca?';
  const yes = language === 'en' ? 'Yes, please.' : 'Sí, por favor.';
  test(language + ': accepted explanation gets one bounded direction after idle, not a new permission question', () => {
    const f = fixture(language); f.answer(offer); f.advance(1000); f.user(yes);
    const c = f.candidate('none', 'accepted_conversational_offer');
    assert.equal(f.gate.considerConversation(c).accepted, true);
    f.advance(1000); assert.equal(f.sent.length, 0);
    f.advance(1000); assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].type, 'session.instructions.append'); assert.equal(f.sent[0].delegation_id, null);
    assert.ok(f.sent[0].content.length < 1500);
    f.gate.native({ type: 'session.instructions.appended', client_event_id: f.sent[0].event_id });
    assert.equal(f.logs.at(-1).type, 'support_conversation_context_acknowledged');
    assert.equal(f.logs.at(-1).playbackClaim, false);
    f.advance(12000); assert.equal(f.sent.length, 1);
  });
  test(language + ': ordinary immediate answer wins and no continuation repeats it', () => {
    const f = fixture(language); f.answer(offer); f.advance(1000); f.user(yes);
    const c = f.candidate('none', 'accepted_conversational_offer');
    f.answer(language === 'en' ? 'A grant is money for college you usually do not repay.' : 'Una beca es dinero para estudiar que normalmente no tienes que devolver.');
    f.gate.considerConversation(c); f.advance(2200);
    assert.equal(f.sent.length, 0);
    assert.ok(f.logs.some(row => row.reason === 'assistant_already_responded'));
  });
  test(language + ': fast answers remain untouched and missed confusion waits for a fresh relevant caller', () => {
    const f = fixture(language); f.answer(offer); f.advance(1000);
    f.user(language === 'en' ? 'I still do not understand.' : 'Todavía no entiendo.');
    const c = f.candidate('needs_simpler_explanation');
    f.answer(language === 'en' ? 'We can start with one idea.' : 'Podemos empezar con una idea.');
    f.gate.considerConversation(c); f.advance(3000);
    assert.equal(f.sent.length, 0, 'no post-answer quiet append can provoke another voice turn');
    assert.equal(f.gate.status().conversation.activeConfusion, true);
    f.user(language === 'en' ? 'I still do not understand the example.' : 'Todavía no entiendo el ejemplo.');
    f.gate.considerConversation(f.candidate('needs_simpler_explanation'));
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'session.thinking.append');
    assert.ok(f.logs.some(row => row.type === 'support_conversation_sent' && row.boundaryBasis === 'preanswer_application_estimate'));
    f.gate.native({ type: 'session.thinking.appended', client_event_id: f.sent[0].event_id });
    f.answer(language === 'en' ? 'A grant helps pay the bill, like a contribution toward it.' : 'Una beca ayuda a pagar la cuenta, como una aportación para cubrirla.');
    f.advance(3000); assert.equal(f.sent.length, 1);
    f.user(language === 'en' ? 'That makes sense. Now let us discuss majors.' : 'Ya entiendo. Ahora hablemos de carreras.');
    f.gate.considerConversation(f.candidate('topic_changed'));
    assert.equal(f.sent.length, 2, 'clear also applies before the ordinary reply');
    f.answer(language === 'en' ? 'What subjects does the student enjoy?' : '¿Qué materias le gustan al estudiante?');
    f.advance(3000);
    assert.equal(f.sent.length, 2); assert.equal(f.gate.status().conversation.activeConfusion, false);
  });
}

test('intro and pending context protect against recovery or a forced recap', () => {
  const f = fixture(); f.user('Yes.');
  f.gate.considerConversation(f.candidate('needs_simpler_explanation')); f.advance(3000);
  assert.equal(f.sent.length, 0);
  f.answer('Would you like an example?'); f.advance(1000); f.user('Yes.');
  f.gate.considerConversation(f.candidate('none', 'accepted_conversational_offer'));
  f.gate.providerCommand({ type: 'session.thinking.append', event_id: 'brief', content: 'brief' });
  f.advance(3000); assert.equal(f.sent.length, 0);
});

test('native answer arriving before the completed-caller adapter event is never erased into an empty reply', () => {
  for (const output of ['spoken_text', 'reflected_audio']) {
    const f = fixture(); f.answer('Would you like an example?'); f.advance(1000);
    f.gate.native({ type: 'session.input_transcript.delta', delta: 'I do not understand.', start_ms: 2100, end_ms: 2600 });
    if (output === 'spoken_text') f.answer('A grant is money that helps cover college costs.');
    else f.gate.native({ type: 'session.output_audio.delta', delta: Buffer.from([255, 127, 255, 127]).toString('base64') });
    f.gate.boundary({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'I do not understand.', item_id: 'early-caller' });
    f.idle(); f.gate.considerConversation(f.candidate('needs_simpler_explanation'));
    f.advance(3000); assert.equal(f.sent.length, 0, output);
  }
});

test('background research alone does not hold conversational help, pending delegation does', () => {
  for (const delegation of [false, true]) {
    const f = fixture(); f.answer('Would you like an example?'); f.advance(1000); f.user('Sure.');
    f.gate.researchBusy(true);
    if (delegation) f.gate.native({ type: 'session.delegation.created', delegation: { id: 'task' } });
    f.gate.considerConversation(f.candidate('none', 'accepted_conversational_offer')); f.advance(2200);
    assert.equal(f.sent.length, delegation ? 0 : 1);
  }
});

test('a lookup offer or action offer cannot be authorized by a conversation verdict', () => {
  for (const offer of ['Would you like me to look up an example?', 'Would you like me to send that comparison?', '¿Quieres que guarde este ejemplo?']) {
    const f = fixture(); f.answer(offer); f.advance(1000); f.user('Sure.');
    f.gate.considerConversation(f.candidate('none', 'accepted_conversational_offer')); f.advance(2200);
    assert.equal(f.sent.length, 0);
  }
});

test('candidate bridge retains same caller across assistant drift, but strips arbitrary generated instructions', () => {
  const bridge = createConversationCandidateBridge({ enabled: true });
  const stamp = { questionId: 'user:one', inputRevision: 1, scopeGeneration: 0, studentId: 'student', sessionId: 'call' };
  bridge.capture({ authorized: true, fingerprint: 'fp', callId: 'call', studentId: 'student',
    recentTranscripts: [{ id: 'user:one', role: 'user', complete: true }] }, stamp);
  const row = { fingerprint: 'fp', status: 'discarded', reason: 'stale_after_request', callId: 'call', studentId: 'student', sourceTranscriptIds: ['user:one'],
    result: { instruction: 'DO SOMETHING ELSE', conversationSupport: {
      confusion: { action: 'needs_simpler_explanation', confidence: .99, selectedProbability: .99, text: 'DO SOMETHING ELSE' },
      continuation: { action: 'none', confidence: .99, selectedProbability: .99 },
    } } };
  const candidate = bridge.project(row);
  assert.equal(candidate.record.sourceStatus, 'discarded');
  assert.equal(JSON.stringify(candidate).includes('DO SOMETHING ELSE'), false);
  assert.equal(bridge.project(row), null);
});
