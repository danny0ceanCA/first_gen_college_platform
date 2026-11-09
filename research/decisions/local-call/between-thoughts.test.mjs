import test from 'node:test';
import assert from 'node:assert/strict';
import { createEarlyEvidenceTracker } from './early-projector.mjs';
import { createSupportGate } from './support.mjs';
import { earlyResultFixture } from './early-fixtures.mjs';

function fixture(language, { enabled = true, intro = true } = {}) {
  let now = 1000, serial = 0, version = 0;
  const scope = { sessionId: 'fictional-boundary', studentId: 'fictional-student', confirmed: true };
  const tracker = createEarlyEvidenceTracker({ fictional: true, callId: scope.sessionId,
    accountId: 'fictional-account', studentId: scope.studentId, language });
  const sent = [], logs = [];
  const gate = createSupportGate({ enabled: true, earlyEnabled: true, betweenThoughtsEnabled: enabled,
    scope, language, now: () => now, getEarlyEvidence: tracker.snapshot,
    send: event => { sent.push(event); }, log: event => logs.push(event) });
  const native = (role, text) => {
    const event = { type: `session.${role}_transcript.delta`, event_id: `native-${++serial}`,
      delta: text, start_ms: now, end_ms: now + 20 };
    tracker.receive({ source: 'native', event, atMs: now }); gate.native(event); return event;
  };
  const boundary = (role, text) => {
    const event = role === 'input' ? { type: 'conversation.item.input_audio_transcription.completed', item_id: `b-${++serial}`, transcript: text }
      : { type: 'response.output_audio_transcript.done', response_id: `b-${++serial}`, transcript: text };
    tracker.receive({ source: 'application', event, atMs: now }); gate.boundary(event);
  };
  const idle = () => gate.playback({ idle: true, version: ++version });
  const advance = ms => { now += ms; };
  gate.native({ type: 'session.started' });
  if (intro) {
    const greeting = language === 'en' ? 'Hi. Good to hear from you.' : 'Hola. Qué gusto escucharte.';
    native('output', greeting); boundary('output', greeting); idle();
    assert.equal(gate.status().introReady, true);
  }
  const caller = language === 'en' ? 'Could you give me a different example of a prerequisite?'
    : '¿Me das otro ejemplo de un requisito previo?';
  advance(100); native('input', caller); boundary('input', caller);
  const acknowledgment = language === 'en' ? 'Of course.' : 'Claro.';
  advance(100); native('output', acknowledgment); boundary('output', acknowledgment); idle();
  function candidate(changes = {}) {
    const s = tracker.snapshot();
    const rows = s.assistantEvidence.filter(row => row.revision > s.contributionOutputOriginRevision);
    return { stamp: s.stamp, record: {
      status: 'completed', callId: scope.sessionId, studentId: scope.studentId,
      operationId: 'fictional-operation', requestId: 'fictional-request',
      sourceEventIds: s.sourceEventIds, sourceText: s.text, supportRevision: gate.earlySupportRevision(),
      assistantOutputRevision: s.assistantOutputRevision, assistantOutputOriginRevision: s.contributionOutputOriginRevision,
      triggerBasis: 'between_thoughts_revalidation', classifiedAtMs: now,
      assistantEvidenceComplete: true, sourceOutputEventIds: rows.map(row => row.sourceEventId),
      result: earlyResultFixture({ need: 'example', ...changes }, { ...s, activeSupport: gate.earlySupport(),
        assistantSinceNeed: { text: rows.map(row => row.text).join(''), sourceEventIds: rows.map(row => row.sourceEventId), evidenceComplete: true } }) } };
  }
  return { gate, tracker, sent, logs, native, boundary, idle, advance, candidate,
    close() { gate.close(); tracker.close(); } };
}

for (const language of ['en', 'es']) {
  test(`${language}: quiet support during research requires fresh evidence, not an old delayed cue`, () => {
    const f = fixture(language);
    try {
      f.gate.researchBusy(true);
      // Research may last many seconds. A newly classified, complete interval
      // can help if the same need remains; an old preanswer verdict cannot.
      f.advance(20000); f.idle();
      assert.equal(f.gate.betweenThoughtsAllowed(), true);
      const old = f.candidate(); old.record.triggerBasis = 'recognizable_request';
      assert.equal(f.gate.considerEarly(old).sent, false);
      const fresh = f.candidate();
      assert.equal(f.gate.considerEarly(fresh).sent, true);
      assert.equal(f.sent.length, 1);
      assert.equal(f.sent[0].type, 'session.thinking.append');
      assert.equal(f.sent[0].delegation_id, null);
      assert.ok(!f.sent[0].content.includes(f.tracker.snapshot().text));
      assert.ok(f.logs.some(row => row.deliveryMode === 'between_thoughts'
        && row.boundaryBasis === 'application_estimate_with_fresh_playback' && row.playbackClaim === false));
      f.gate.native({ type: 'session.thinking.appended', client_event_id: f.sent[0].event_id, start_ms: 22000, end_ms: 22020 });
      assert.ok(f.logs.some(row => row.type === 'support_early_context_acknowledged' && row.playbackClaim === false));
      assert.equal(f.gate.considerEarly(f.candidate()).sent, false, 'no repeated support for an unchanged need');
      assert.equal(f.sent.length, 1);
    } finally { f.close(); }
  });

  test(`${language}: an already answered request never creates another announcement`, () => {
    const f = fixture(language);
    try {
      assert.equal(f.gate.considerEarly(f.candidate({ addressed: .99 })).reason, 'already_addressed');
      f.idle(); assert.equal(f.sent.length, 0);
      assert.equal(f.gate.earlySupport(), null);
    } finally { f.close(); }
  });

  test(`${language}: resumed assistant speech invalidates an in-flight or deferred boundary cue`, () => {
    for (const deferred of [false, true]) {
      const f = fixture(language);
      try {
        const value = f.candidate();
        if (deferred) { f.gate.delegationBusy(true); f.gate.considerEarly(value); }
        f.native('output', language === 'en' ? 'Let us look at a familiar example.' : 'Veamos un ejemplo conocido.');
        if (!deferred) assert.equal(f.gate.considerEarly(value).sent, false);
        f.gate.delegationBusy(false); f.idle();
        assert.equal(f.sent.length, 0);
      } finally { f.close(); }
    }
  });

  test(`${language}: a changed question withdraws old support before any quiet append`, () => {
    const f = fixture(language);
    try {
      const value = f.candidate();
      f.gate.delegationBusy(true); f.gate.considerEarly(value);
      const text = language === 'en' ? 'Actually, I understand now. Let us talk about housing.'
        : 'En realidad ya entiendo. Hablemos del alojamiento.';
      f.native('input', text); f.boundary('input', text); f.gate.delegationBusy(false); f.idle();
      assert.equal(f.sent.length, 0);
      const corrected = f.candidate({ need: 'none', change: 'resolved_or_left' });
      corrected.record.triggerBasis = 'recognizable_request';
      assert.equal(f.gate.considerEarly(corrected).sent, false);
      assert.equal(f.gate.earlySupport(), null);
    } finally { f.close(); }
  });

  test(`${language}: intro/selection, pending delegation/context and stale playback keep their fences`, () => {
    for (const scenario of ['disabled', 'selection', 'delegation', 'context', 'playback', 'audio', 'unmatched_output']) {
      const f = fixture(language, { enabled: scenario !== 'disabled' });
      try {
        if (scenario === 'selection') f.gate.boundary({ type: 'origen.selection.context', stage: 'staged' });
        if (scenario === 'delegation') f.gate.native({ type: 'session.delegation.created', delegation: { id: 'pending' } });
        if (scenario === 'context') f.gate.providerCommand({ type: 'session.thinking.append', event_id: 'research-update', content: 'Verified fact.' });
        if (scenario === 'playback') f.advance(1501);
        if (scenario === 'audio') f.gate.native({ type: 'session.output_audio.delta', delta: Buffer.from([100, 5]).toString('base64') });
        if (scenario === 'unmatched_output') {
          f.native('output', language === 'en' ? 'Another point' : 'Otro punto');
          f.boundary('output', 'This boundary does not match native output.'); f.idle();
        }
        assert.equal(f.gate.betweenThoughtsAllowed(), false, scenario);
        assert.equal(f.gate.considerEarly(f.candidate()).sent, false, scenario);
        assert.equal(f.sent.length, 0, scenario);
      } finally { f.close(); }
    }
  });
}
