import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationDelivery, acknowledgmentOnly, conversationalOffer } from './conversation-delivery.mjs';
import { createConversationCandidateBridge } from './conversation-candidates.mjs';

function fixture(language = 'en', options = {}) {
  let at = 1000, serial = 0, blocker = null;
  let scope = { sessionId: 'fictional-call', studentId: 'fictional-student', confirmed: true };
  const sent = [], logs = [];
  const gate = createConversationDelivery({ enabled: true, language, scope, now: () => at,
    canDeliver: () => blocker, log: row => logs.push(row),
    send: (type, content, details) => { sent.push({ type, content, details }); return options.send?.(type, content, details); }, ...options.gate });
  const advance = ms => { at += ms; };
  function thought(text) {
    gate.native({ type: 'session.output_transcript.delta', delta: text });
    gate.boundary({ type: 'response.output_audio_transcript.done', transcript: text });
    gate.playback({ idle: true });
  }
  function offer(text = language === 'en' ? 'Would you like me to explain with an example?' : '¿Quieres que lo explique con un ejemplo?') { thought(text); advance(1000); }
  function request(confusion = 'none', continuation = 'none', text = language === 'en' ? 'Yes, please.' : 'Sí, por favor.', timing = { start_ms: at, end_ms: at + 50 }) {
    const id = 'u' + ++serial;
    gate.native({ type: 'session.input_transcript.delta', delta: text, ...timing });
    gate.boundary({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
    return { stamp: gate.stamp(), record: { status: 'completed', sourceStatus: 'completed', operationId: 'operation-' + id, requestId: 'provider-' + id,
      callId: scope.sessionId, studentId: scope.studentId, sourceTranscriptIds: ['user:' + id],
      result: { conversationSupport: {
        confusion: { action: confusion, confidence: .99, selectedProbability: .99 },
        continuation: { action: continuation, confidence: .99, selectedProbability: .99 },
      } } } };
  }
  const settle = () => { advance(901); gate.playback({ idle: true }); };
  const reset = (next = { ...scope, studentId: 'fictional-second' }, nextLanguage = language) => { scope = next; language = nextLanguage; gate.reset(scope, language); };
  return { gate, sent, logs, request, offer, thought, settle, advance, reset, block: value => { blocker = value; } };
}

for (const language of ['en', 'es']) {
  test(`${language}: accepted explanation resumes only after a complete acknowledgment and quiet gap`, () => {
    const f = fixture(language); f.offer(); const candidate = f.request('none', 'accepted_conversational_offer');
    assert.equal(f.gate.consider(candidate).accepted, true);
    assert.equal(f.sent.length, 0);
    f.thought(language === 'en' ? 'Okay.' : 'Claro.');
    f.advance(899); f.gate.tick(); assert.equal(f.sent.length, 0);
    f.advance(2); f.gate.playback({ idle: true });
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].type, 'session.instructions.append');
    assert.equal(f.sent[0].details.supportKind, 'continuation');
    assert.equal(f.sent[0].details.boundaryBasis, 'application_estimate');
    assert.equal(f.sent[0].details.playbackEvidence, 'fresh_idle');
    assert.ok(f.logs.every(row => row.playbackClaim === false));
    assert.equal(f.gate.consider(candidate).reason, 'duplicate');
    f.advance(12000); f.gate.tick(); assert.equal(f.sent.length, 1);
  });

  test(`${language}: substantive native answer suppresses a delayed continuation instead of repeating it`, () => {
    const f = fixture(language); f.offer(); const candidate = f.request('none', 'accepted_conversational_offer');
    f.thought(language === 'en' ? 'Think of the budget as an estimate for the whole year.' : 'Piensa en el presupuesto como una estimación para todo el año.');
    f.gate.consider(candidate); f.settle();
    assert.equal(f.sent.length, 0);
    assert.equal(f.gate.status().pending, false);
    assert.ok(f.logs.some(row => row.reason === 'assistant_already_responded' && row.evidence === 'transcript_only'));
  });

  test(`${language}: temporary confusion quietly guides a later reply and clears when the caller understands`, () => {
    const f = fixture(language); f.offer();
    const unclear = f.request('needs_simpler_explanation', 'none', language === 'en' ? 'I still do not understand.' : 'Todavía no entiendo.');
    f.gate.consider(unclear); f.thought(language === 'en' ? 'We can take it one idea at a time.' : 'Podemos ir una idea a la vez.'); f.settle();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'session.thinking.append');
    assert.equal(f.sent[0].details.activeConfusion, true);
    f.advance(2600);
    f.gate.consider(f.request('resolved', 'none', language === 'en' ? 'That makes sense now.' : 'Ahora sí lo entiendo.'));
    f.thought(language === 'en' ? 'Great.' : 'Perfecto.'); f.settle();
    assert.equal(f.sent.length, 2); assert.equal(f.sent[1].type, 'session.thinking.append');
    assert.equal(f.sent[1].details.activeConfusion, false);
  });

  test(`${language}: all reachable application-authored support combinations stay within the append budget`, () => {
    for (const confusion of ['none', 'needs_simpler_explanation']) {
      const f = fixture(language); f.offer(); f.gate.consider(f.request(confusion, 'accepted_conversational_offer'));
      f.thought(language === 'en' ? 'Okay.' : 'Claro.'); f.settle();
      assert.equal(f.sent.length, 1);
      assert.ok(Buffer.byteLength(f.sent[0].content, 'utf8') <= 480, 'UTF-8 bytes conservatively bound the provider 500-token content limit');
    }
  });
}

test('a later caller turn, scope change, or open speech invalidates the earlier candidate', () => {
  const f = fixture(); f.offer(); const earlier = f.request('none', 'accepted_conversational_offer');
  f.gate.native({ type: 'session.input_transcript.delta', delta: 'Actually...' });
  assert.equal(f.gate.consider(earlier).reason, 'stale_caller_or_scope');
  const latest = f.request('needs_simpler_explanation', 'none', 'Actually explain the application first.');
  f.reset(); assert.equal(f.gate.consider(latest).reason, 'stale_caller_or_scope');
  f.advance(5000); f.gate.playback({ idle: true }); assert.equal(f.sent.length, 0);
});

test('unfinished speech, busy/stale playback, and pending context prevent delivery', () => {
  const f = fixture(); f.offer(); const candidate = f.request('needs_simpler_explanation');
  f.gate.native({ type: 'session.output_transcript.delta', delta: 'A college budget includes' });
  f.gate.consider(candidate);
  f.advance(5000); f.gate.playback({ idle: true }); assert.equal(f.sent.length, 0);
  f.thought('A college budget includes several parts.'); f.settle(); assert.equal(f.sent.length, 0, 'finishing the answer never releases a late quiet note');
  f.block('speech_in_progress'); f.gate.consider(f.request('needs_simpler_explanation'));
  for (const reason of ['speech_in_progress', 'playback_not_fresh_idle', 'background_or_context_pending', 'intro_unready']) {
    f.block(reason); f.advance(100); f.gate.tick(); assert.equal(f.sent.length, 0);
  }
  f.block(null); f.gate.tick(); assert.equal(f.sent.length, 1);
});

test('a short pause in reflected output audio does not count as a completed thought', () => {
  const f = fixture(); f.offer(); f.gate.consider(f.request('none', 'accepted_conversational_offer'));
  f.thought('Okay.'); f.advance(800);
  f.gate.native({ type: 'session.output_audio.delta', delta: Buffer.from([255, 127, 255, 127]).toString('base64') });
  f.gate.playback({ idle: true }); f.advance(899); f.gate.tick(); assert.equal(f.sent.length, 0);
  f.advance(2); f.gate.playback({ idle: true }); assert.equal(f.sent.length, 1);
});

test('uncertain provider writes consume the attempt and never repeat the continuation', () => {
  const f = fixture('en', { send: () => { throw Error('socket outcome unknown'); } });
  f.offer(); f.gate.consider(f.request('none', 'accepted_conversational_offer')); f.thought('Okay.'); f.settle();
  assert.equal(f.sent.length, 1); assert.ok(f.logs.some(row => row.type === 'support_conversation_send_unconfirmed'));
  for (let index = 0; index < 8; index++) { f.advance(3000); f.gate.playback({ idle: true }); }
  assert.equal(f.sent.length, 1);
});

test('research or record-change offers never grant conversational recovery permission', () => {
  for (const text of ['Would you like me to check the official cost and explain it?', '¿Quieres que busque y explique el costo?', 'I can save that and explain the next step.']) {
    const f = fixture(); f.offer(text); f.gate.consider(f.request('none', 'accepted_conversational_offer')); f.thought('Okay.'); f.settle();
    assert.equal(f.sent.length, 0);
  }
});

test('an offer is consumed by the immediately next caller turn, not reused after a changed question', () => {
  const f = fixture(); f.offer(); f.request('none', 'none', 'Actually, what are the application deadlines?');
  f.advance(1000); f.gate.consider(f.request('none', 'accepted_conversational_offer')); f.thought('Okay.'); f.settle();
  assert.equal(f.sent.length, 0);
});

test('an old offer does not become permission to continue much later in the call', () => {
  const f = fixture(); f.offer(); f.advance(120000);
  f.gate.consider(f.request('none', 'accepted_conversational_offer')); f.thought('Okay.'); f.settle();
  assert.equal(f.sent.length, 0);
});

for (const language of ['en', 'es']) test(`${language}: rapid repeated affirmative spans retain the offer only for the latest caller classification`, () => {
  const f = fixture(language); f.offer();
  const first = f.request('none', 'accepted_conversational_offer', language === 'en' ? 'Okay.' : 'Sí.');
  f.advance(200);
  const second = f.request('none', 'accepted_conversational_offer', language === 'en' ? 'Okay.' : 'Claro.');
  assert.equal(f.gate.consider(first).reason, 'stale_caller_or_scope');
  assert.equal(f.gate.consider(second).accepted, true);
  f.thought(language === 'en' ? 'Okay.' : 'Claro.'); f.settle();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].details.questionId, second.stamp.questionId);
  assert.ok(f.logs.some(row => row.offerEvidence === 'adjacent_affirmative_group' && row.offerGroupSize === 2));
});

test('acknowledgment carry is bounded by provider time, wall time, span count and complete positive content', () => {
  for (const scenario of ['late_provider', 'late_arrival', 'fourth_span', 'missing_time', 'backward_time', 'new_question', 'negative', 'gratitude']) {
    const f = fixture(); f.offer(); f.request('none', 'none', 'Okay.');
    let latest;
    if (scenario === 'late_provider') latest = f.request('none', 'accepted_conversational_offer', 'Okay.', { start_ms: 6500, end_ms: 6600 });
    if (scenario === 'late_arrival') { f.advance(4100); latest = f.request('none', 'accepted_conversational_offer', 'Okay.', { start_ms: 2200, end_ms: 2250 }); }
    if (scenario === 'fourth_span') { for (let i = 0; i < 3; i++) { f.advance(100); latest = f.request('none', 'accepted_conversational_offer', 'Okay.'); } }
    if (scenario === 'missing_time') latest = f.request('none', 'accepted_conversational_offer', 'Okay.', null);
    if (scenario === 'backward_time') latest = f.request('none', 'accepted_conversational_offer', 'Okay.', { start_ms: 100, end_ms: 150 });
    if (['new_question', 'negative', 'gratitude'].includes(scenario)) {
      f.advance(100); f.request('none', 'none', scenario === 'new_question' ? 'What is the deadline?' : scenario === 'negative' ? 'Not now.' : 'Thank you.');
      f.advance(100); latest = f.request('none', 'accepted_conversational_offer', 'Okay.');
    }
    f.gate.consider(latest); f.thought('Okay.'); f.settle();
    assert.equal(f.sent.length, 0, scenario);
  }
});

test('any intervening assistant transcript, audible output or scope reset ends an acknowledgment group', () => {
  for (const between of ['partial_transcript', 'audio', 'completed_ack', 'scope_reset']) {
    const f = fixture(); f.offer(); f.request('none', 'none', 'Okay.'); f.advance(100);
    if (between === 'partial_transcript') f.gate.native({ type: 'session.output_transcript.delta', delta: 'Let us' });
    if (between === 'audio') f.gate.native({ type: 'session.output_audio.delta', delta: Buffer.from([255, 127, 255, 127]).toString('base64') });
    if (between === 'completed_ack') f.thought('Sure.');
    if (between === 'scope_reset') f.reset();
    f.advance(100); f.gate.consider(f.request('none', 'accepted_conversational_offer', 'Okay.'));
    f.thought('Okay.'); f.settle(); assert.equal(f.sent.length, 0, between);
  }
});

test('quiet confusion and clear notes support only the current ordinary reply without demanding extra speech', () => {
  for (const language of ['en', 'es']) {
    const f = fixture(language); f.offer(); f.gate.consider(f.request('needs_simpler_explanation'));
    f.thought(language === 'en' ? 'Here is one example you can use.' : 'Aquí tienes un ejemplo que puedes usar.'); f.settle();
    f.advance(3000); f.gate.consider(f.request('resolved')); f.thought(language === 'en' ? 'Great.' : 'Perfecto.'); f.settle();
    assert.equal(f.sent.length, 2);
    for (const event of f.sent) {
      assert.equal(event.type, 'session.thinking.append');
      assert.ok(Buffer.byteLength(event.content, 'utf8') <= 480);
      assert.match(event.content, language === 'en' ? /(?:Current reply|current ordinary reply)/u : /respuesta actual/u);
      assert.match(event.content, language === 'en' ? /no new request/u : /no es otra solicitud/u);
      assert.match(event.content, language === 'en' ? /start or extend speech solely for this note/u : /empieces o prolongues la voz solo por esta nota/u);
      assert.doesNotMatch(event.content, /Wait for the next caller|Espera el siguiente turno/u);
    }
  }
});

test('a missed pre-answer note stays local until a later caller explicitly revalidates the need', () => {
  const f = fixture(); f.offer(); const missed = f.request('needs_simpler_explanation', 'none', 'I do not understand the budget.');
  f.thought('A budget estimates the whole year, not just tuition.'); f.gate.consider(missed); f.settle();
  assert.equal(f.sent.length, 0);
  for (let i = 0; i < 5; i++) { f.advance(1000); f.gate.playback({ idle: true }); }
  assert.equal(f.sent.length, 0);
  f.gate.consider(f.request('none', 'none', 'What is next?')); assert.equal(f.sent.length, 0, 'a fresh unrelated classification does not revalidate confusion');
  f.thought('You can compare the parts.'); f.advance(1000);
  f.gate.consider(f.request('needs_simpler_explanation', 'none', 'I still do not understand what the parts mean.'));
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'session.thinking.append');
  assert.equal(f.sent[0].details.boundaryBasis, 'preanswer_application_estimate');
});

test('weak or invalid classifications never activate optional support', () => {
  for (const mutate of [c => { c.record.result.conversationSupport.continuation.confidence = .84; },
    c => { c.record.result.conversationSupport.continuation.selectedProbability = .89; },
    c => { c.record.result.conversationSupport.continuation.action = 'start_research'; }]) {
    const f = fixture(); f.offer(); const candidate = f.request('none', 'accepted_conversational_offer'); mutate(candidate);
    f.gate.consider(candidate); f.thought('Okay.'); f.settle(); assert.equal(f.sent.length, 0);
  }
});

test('candidate bridge preserves typed provenance and removes all generated instructions', () => {
  const f = fixture(); f.offer(); const candidate = f.request('needs_simpler_explanation');
  const snapshot = { fingerprint: 'snapshot1', authorized: true, callId: 'fictional-call', studentId: 'fictional-student', recentTranscripts: [{ role: 'user', id: candidate.stamp.questionId, complete: true }] };
  const bridge = createConversationCandidateBridge({ enabled: true });
  assert.equal(bridge.capture(snapshot, candidate.stamp), true);
  const row = { ...candidate.record, fingerprint: snapshot.fingerprint, status: 'discarded', reason: 'stale_after_request',
    result: { ...candidate.record.result, generatedText: 'Unsafe extra instructions.' } };
  row.result.conversationSupport.confusion.extra = 'Unsafe extra instructions.';
  const projected = bridge.project(row);
  assert.equal(projected.record.sourceStatus, 'discarded');
  assert.equal(projected.record.sourceReason, 'stale_after_request');
  assert.equal(JSON.stringify(projected).includes('Unsafe'), false);
  assert.equal(f.gate.consider(projected).accepted, true);
  assert.equal(bridge.project(row), null);
});

test('candidate bridge rejects unconfirmed snapshots, mismatched scope, failed providers and invalid classifications', () => {
  const f = fixture(); f.offer(); const candidate = f.request('needs_simpler_explanation');
  const snapshot = { fingerprint: 'snapshot1', authorized: true, callId: 'fictional-call', studentId: 'fictional-student', recentTranscripts: [{ role: 'user', id: candidate.stamp.questionId, complete: true }] };
  const logs = [], bridge = createConversationCandidateBridge({ enabled: true, log: row => logs.push(row) });
  for (const changes of [{ authorized: false }, { closed: true }, { studentId: 'another-student' }, { callId: 'another-call' },
    { recentTranscripts: [{ role: 'user', id: candidate.stamp.questionId, complete: false }] }]) {
    assert.equal(bridge.capture({ ...snapshot, ...changes }, candidate.stamp), false);
  }
  for (const changes of [{ studentId: 'another-student' }, { callId: 'another-call' }, { status: 'failed' }, { status: 'discarded', reason: 'scope_changed' },
    { result: { conversationSupport: { confusion: { action: 'none', confidence: NaN, selectedProbability: .99 } } } }]) {
    assert.equal(bridge.capture(snapshot, candidate.stamp), true);
    assert.equal(bridge.project({ ...candidate.record, fingerprint: snapshot.fingerprint, ...changes }), null);
  }
  assert.ok(logs.every(row => row.contextSent === false && row.playbackClaim === false));
  assert.equal(bridge.capture(snapshot, { ...candidate.stamp, inputRevision: -1 }), false);
  assert.equal(bridge.capture(snapshot, candidate.stamp), true); bridge.clear();
  assert.equal(bridge.project({ ...candidate.record, fingerprint: snapshot.fingerprint }), null);
});

test('delivery rejects wrong provenance and unsupported scope before considering classifier confidence', () => {
  for (const changes of [{ callId: 'another-call' }, { studentId: 'another-student' }, { sourceTranscriptIds: ['user:another'] },
    { status: 'failed' }, { sourceStatus: 'discarded', sourceReason: 'scope_changed' }]) {
    const f = fixture(); f.offer(); const candidate = f.request('needs_simpler_explanation');
    Object.assign(candidate.record, changes);
    assert.equal(f.gate.consider(candidate).reason, 'record_unmatched');
    f.thought('Okay.'); f.settle(); assert.equal(f.sent.length, 0);
  }
  for (const scope of [{ sessionId: 'fictional-call', studentId: 'unselected', confirmed: true },
    { sessionId: 'fictional-call', studentId: 'fictional-student', confirmed: false }]) {
    const f = fixture(); f.reset(scope); f.offer();
    assert.equal(f.gate.consider(f.request('needs_simpler_explanation')).reason, 'disabled_or_scope_unready');
  }
});

test('malformed worker provenance fails closed without throwing into the call event loop', () => {
  for (const malformed of [{}, 42, 'user:u1', [null], [42]]) {
    const f = fixture(); f.offer(); const candidate = f.request('needs_simpler_explanation');
    candidate.record.sourceTranscriptIds = malformed;
    assert.doesNotThrow(() => assert.equal(f.gate.consider(candidate).reason, 'record_unmatched'));
  }
  const bridge = createConversationCandidateBridge({ enabled: true });
  assert.doesNotThrow(() => assert.equal(bridge.capture({ authorized: true, recentTranscripts: {} }, {}), false));
});

test('temporary confusion clear plus continuation stays bounded and does not become a permanent preference', () => {
  for (const language of ['en', 'es']) {
    const f = fixture(language); f.offer(); f.gate.consider(f.request('needs_simpler_explanation'));
    f.thought(language === 'en' ? 'We can use one idea at a time.' : 'Podemos ir una idea a la vez.'); f.settle();
    f.advance(12000); f.offer(); f.gate.consider(f.request('resolved', 'accepted_conversational_offer'));
    f.thought(language === 'en' ? 'Okay.' : 'Claro.'); f.settle();
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent[1].details.activeConfusion, false);
    assert.equal(f.sent[1].type, 'session.instructions.append');
    assert.ok(Buffer.byteLength(f.sent[1].content, 'utf8') <= 480);
  }
});

test('app-owned confusion expiry waits for the next pre-answer opportunity, never post-answer idle', () => {
  for (const language of ['en', 'es']) {
    const f = fixture(language); f.offer(); f.gate.consider(f.request('needs_simpler_explanation'));
    f.thought(language === 'en' ? 'We can take one small step.' : 'Podemos dar un paso pequeño.'); f.settle();
    assert.equal(f.sent.length, 1);
    f.advance(91000); f.block('playback_not_fresh_idle'); f.gate.tick(); assert.equal(f.sent.length, 1);
    f.block(null); f.gate.playback({ idle: true }); assert.equal(f.sent.length, 1);
    f.gate.consider(f.request('none', 'none', language === 'en' ? 'What is enrollment?' : '¿Qué es la inscripción?'));
    assert.equal(f.sent.length, 2); assert.equal(f.sent[1].type, 'session.thinking.append');
    assert.equal(f.sent[1].details.clearingTemporaryContext, true);
    assert.equal(f.sent[1].details.activeConfusion, false);
    assert.equal(f.sent.some(item => item.type === 'session.instructions.append'), false);
  }
});

test('expiry requires a fresh current classification and never resurrects old permission', () => {
  const f = fixture(); f.offer(); f.gate.consider(f.request('needs_simpler_explanation', 'accepted_conversational_offer'));
  f.thought('Okay.'); f.settle(); assert.equal(f.sent.length, 1);
  f.advance(91000);
  f.gate.native({ type: 'session.input_transcript.delta', delta: 'My next question...' });
  f.gate.playback({ idle: true }); assert.equal(f.sent.length, 1, 'open caller speech fences even an expiry clear');
  const fresh = f.request('none', 'none', 'What does enrollment mean?'); // Deliberately defer Decisions result.
  f.gate.playback({ idle: true }); assert.equal(f.sent.length, 1);
  f.gate.consider(fresh);
  assert.equal(f.sent.length, 2); assert.equal(f.sent[1].type, 'session.thinking.append');
  assert.equal(f.sent[1].details.clearingTemporaryContext, true);
  assert.equal(f.sent[1].details.classificationToSendMs, 0);
  assert.equal(f.sent[1].details.operationId, fresh.record.operationId);
});

test('assistant output before the caller-completed adapter event still closes the quiet window', () => {
  for (const output of ['transcript', 'audio_only', 'completed_answer']) {
    const f = fixture(); f.offer();
    f.gate.native({ type: 'session.input_transcript.delta', delta: 'I do not understand.', start_ms: 2100, end_ms: 2500 });
    if (output !== 'audio_only') f.gate.native({ type: 'session.output_transcript.delta', delta: 'Think of the budget as a yearly estimate.' });
    else f.gate.native({ type: 'session.output_audio.delta', delta: Buffer.from([255, 127, 255, 127]).toString('base64') });
    if (output === 'completed_answer') f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'Think of the budget as a yearly estimate.' });
    f.gate.boundary({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'early', transcript: 'I do not understand.' });
    const candidate = { stamp: f.gate.stamp(), record: { status: 'completed', sourceStatus: 'completed', operationId: 'early-op',
      callId: 'fictional-call', studentId: 'fictional-student', sourceTranscriptIds: ['user:early'], result: { conversationSupport: {
        confusion: { action: 'needs_simpler_explanation', confidence: .99, selectedProbability: .99 },
        continuation: { action: 'none', confidence: .99, selectedProbability: .99 },
      } } } };
    f.gate.consider(candidate); f.advance(2000); f.gate.playback({ idle: true });
    assert.equal(f.sent.length, 0, output);
    assert.ok(f.logs.some(row => row.reason === 'quiet_preanswer_window_missed'));
  }
});

test('quiet delivery also expires without output when the narrow pre-answer window is missed', () => {
  const f = fixture(); f.offer(); const candidate = f.request('needs_simpler_explanation');
  f.advance(1501); f.gate.consider(candidate); f.gate.playback({ idle: true }); assert.equal(f.sent.length, 0);
});

test('offer and acknowledgment helpers accept bilingual ordinary replies without turning actions into explanations', () => {
  for (const text of ['Okay.', 'Sí, claro.', 'Thank you!', 'De acuerdo.']) assert.equal(acknowledgmentOnly(text), true);
  for (const text of ['Okay, the application has two parts.', 'Sí, primero necesitas una cuenta.']) assert.equal(acknowledgmentOnly(text), false);
  assert.equal(conversationalOffer('Would you like an example?'), true);
  assert.equal(conversationalOffer('¿Quieres un ejemplo?'), true);
  assert.equal(conversationalOffer('Would you like me to submit it?'), false);
});
