import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createObservedLocalSession } from './session.mjs';
import { createEarlyEvidenceTracker } from './early-projector.mjs';
import { EARLY_SUPPORT_NOTES, LATE_KIND_NOTES } from './early-support-delivery.mjs';
import { earlyResultFixture } from './early-fixtures.mjs';

const drain = () => new Promise(resolve => setImmediate(resolve));
function fixture(language = 'en', earlyEnabled = true, options = {}) {
  const scope = { sessionId: 'fictional-early-integration', studentId: 'fictional-student', confirmed: true };
  const seed = { fictional: true, accountId: 'fictional-account', callId: scope.sessionId, studentId: scope.studentId, language };
  const config = { language, tools: [], requestedVoice: 'marin' };
  const allowedStudentIds = [scope.studentId, 'fictional-second'];
  const mirror = createEarlyEvidenceTracker(seed, { allowedStudentIds });
  const worker = new EventEmitter(), sent = [], messages = [], events = [];
  let sequence = 0, playbackVersion = 0, workerSettings, researchCalls = 0, clock = performance.now();
  // The test substitutes the worker before construction: paid:true exercises
  // the authorized integration gates but creates no API client or budget file.
  worker.postMessage = message => {
    const copy = structuredClone(message); messages.push(copy);
    if (copy.source) mirror.receive(copy);
    queueMicrotask(() => worker.emit('message', { type: 'ack' }));
    if (copy.type === 'close') queueMicrotask(() => worker.emit('message', { type: 'closed' }));
  };
  worker.terminate = async () => {};
  const engine = createObservedLocalSession({ scope, config,
    provider: { readyState: 1, send: text => sent.push(JSON.parse(text)) }, emit: event => events.push(event),
    jobRequest() { researchCalls++; throw Error('unexpected_research'); } },
  { localOnly: true, fictional: true, seed, allowedCallIds: [scope.sessionId], allowedStudentIds,
    paid: true, supportEnabled: true, preferencesEnabled: true, conversationEnabled: true,
    ...(earlyEnabled ? { earlyEnabled: true } : {}), ...(options.lateEnabled ? { lateEnabled: true } : {}),
    ...(options.betweenThoughtsEnabled ? { betweenThoughtsEnabled: true } : {}) },
  { ...(options.fakeClock ? { now: () => clock } : {}),
    createWorker: (_url, settings) => { workerSettings = settings; return worker; } });
  function native(role, text) {
    const serial = ++sequence;
    const event = { type: `session.${role}_transcript.delta`, event_id: `native-${serial}`,
      delta: text, start_ms: serial * 100, end_ms: serial * 100 + 50 };
    engine.receive(event); return event;
  }
  const idle = (sameVersion = false) => engine.playback({ idle: true, version: sameVersion ? playbackVersion : ++playbackVersion });
  async function words(role, text) { native(role, text); await drain(); await engine.flush(); }
  async function readyIntro() {
    await words('output', language === 'en' ? 'Hi. It is good to hear from you. Where would you like to start?' : 'Hola. Qué gusto escucharte. ¿Por dónde te gustaría empezar?');
    idle(); assert.equal(engine.observation.status().support.introReady, true);
  }
  function candidate(action = 'simplify') {
    const snapshot = mirror.snapshot();
    return { type: 'early_candidate', stamp: snapshot.stamp, record: { status: 'completed',
      callId: scope.sessionId, studentId: snapshot.studentId, sourceEventIds: snapshot.sourceEventIds,
      sourceText: snapshot.text, supportRevision: engine.observation.status().support.early.supportRevision,
      assistantOutputRevision: snapshot.assistantOutputRevision,
      operationId: `op-${sequence}`, requestId: `req-${sequence}`, result: earlyResultFixture({ need: action === 'continue_simplifying' ? 'related_followup' : action },
        { activeSupport: messages.findLast(row => row.earlySupport)?.earlySupport }) } };
  }
  function latestBoundary() { return messages.findLast(message => message.source === 'application'
    && message.event.type === 'conversation.item.input_audio_transcription.completed'); }
  function oldConfusionCandidates() {
    const packet = latestBoundary();
    const record = { status: 'completed', callId: scope.sessionId, studentId: scope.studentId,
      sourceTranscriptIds: [`user:${packet.event.item_id}`], operationId: 'legacy-op', requestId: 'legacy-req' };
    return [
      { type: 'support_candidate', stamp: packet.supportStamp, record: { ...record,
        result: { supportNeed: 'simpler_explanation', alreadyAddressed: false, addressedProbability: .01, confidence: .99, selectedProbability: .99 } } },
      { type: 'conversation_candidate', stamp: packet.conversationStamp, record: { ...record,
        result: { conversationSupport: { confusion: { action: 'needs_simpler_explanation', confidence: .99, selectedProbability: .99 },
          continuation: { action: 'none', confidence: .99, selectedProbability: .99 } } } } },
    ];
  }
  worker.emit('message', { type: 'ready' }); engine.start();
  return { engine, worker, sent, messages, events, mirror, native, words, idle, readyIntro, candidate, oldConfusionCandidates,
    advance: ms => { clock += ms; }, now: () => clock,
    scope, config, workerSettings: () => workerSettings, researchCalls: () => researchCalls,
    notes: () => sent.filter(event => event.event_id?.startsWith('support_early_')),
    async close() { engine.close(); await engine.observation.closed; mirror.close(); } };
}

for (const language of ['en', 'es']) for (const mode of ['late_experiment', 'between_thoughts']) test(`${language}: settled same-version playback wakes ${mode} once without changing intro or speech`, async () => {
  const between = mode === 'between_thoughts';
  const f = fixture(language, true, { lateEnabled: !between, betweenThoughtsEnabled: between, fakeClock: true });
  const flag = between ? 'betweenThoughtsAllowed' : 'lateAllowed';
  try {
    await f.readyIntro();
    const introCommands = structuredClone(f.sent);
    assert.equal(f.notes().length, 0);
    await f.words('input', language === 'en' ? 'I do not understand what that word means.' : 'No entiendo lo que significa esa palabra.');
    f.advance(100);
    f.engine.receive({ type: 'session.output_audio.delta', delta: Buffer.from([1, 0]).toString('base64') });
    await f.words('output', language === 'en' ? 'Of course.' : 'Claro.');
    f.advance(100); f.idle();
    assert.equal(f.messages.findLast(row => row.source === 'playback')[flag], false);
    const before = f.messages.filter(row => row.source === 'playback').length;
    f.advance(900); f.idle(true);
    const wake = f.messages.findLast(row => row.source === 'playback');
    assert.equal(wake[flag], true);
    assert.equal(f.messages.filter(row => row.source === 'playback').length, before + 1);
    f.idle(true);
    assert.equal(f.messages.filter(row => row.source === 'playback').length, before + 1, 'unchanged idle does not poll classifications');
    assert.equal(f.notes().length, 0, 'a quiet boundary itself cannot inject context');

    const snapshot = f.mirror.snapshot();
    const rows = snapshot.assistantEvidence.filter(row => row.revision > snapshot.contributionOutputOriginRevision);
    const value = f.candidate();
    Object.assign(value.record, { triggerBasis: between ? 'between_thoughts_revalidation' : 'settled_late_experiment', classifiedAtMs: f.now(),
      assistantOutputOriginRevision: snapshot.contributionOutputOriginRevision,
      assistantEvidenceComplete: true, sourceOutputEventIds: rows.map(row => row.sourceEventId),
      result: earlyResultFixture({ need: 'simplify' }, { ...snapshot, assistantSinceNeed: {
        text: rows.map(row => row.text).join(''), sourceEventIds: rows.map(row => row.sourceEventId), evidenceComplete: true } }) });
    f.worker.emit('message', value);
    assert.equal(f.notes().length, 1);
    assert.equal(f.notes()[0].type, 'session.thinking.append');
    assert.equal(f.notes()[0].content, LATE_KIND_NOTES.simpler_explanation[language]);
    assert.deepEqual(f.sent.slice(0, introCommands.length), introCommands);
    assert.equal(f.researchCalls(), 0);
    assert.ok(f.messages.some(row => row.event?.type === 'support_early_sent'
      && row.event.deliveryMode === mode && row.event.playbackClaim === false));
  } finally { await f.close(); }
});

for (const language of ['en', 'es']) {
  const confusion = language === 'en' ? 'I do not understand what that word means.' : 'No entiendo lo que significa esa palabra.';
  test(`${language}: actual wrapper classifies during input but waits for a matching closed input estimate before quiet support`, async () => {
    const f = fixture(language);
    try {
      await f.readyIntro();
      const introProviderCommands = structuredClone(f.sent);
      f.native('input', confusion);
      const packet = f.messages.findLast(row => row.source === 'native');
      assert.equal(packet.earlyAllowed, true); assert.equal(packet.earlySupport, null);
      assert.equal(f.messages.some(row => row.source === 'application' && row.event.type === 'conversation.item.input_audio_transcription.completed'), false);
      f.worker.emit('message', f.candidate());
      assert.equal(f.notes().length, 0);
      assert.equal(f.engine.observation.status().support.early.pending, true);
      assert.ok(f.messages.some(row => row.event?.type === 'support_early_deferred'
        && row.event.reason === 'caller_speech_in_progress'));
      f.idle(); f.idle();
      assert.equal(f.notes().length, 0, 'idle assistant playback does not close caller input');
      await drain(); await f.engine.flush();
      assert.equal(f.mirror.snapshot().inputOpen, false);
      f.idle();
      assert.equal(f.notes().length, 1); assert.equal(f.notes()[0].type, 'session.thinking.append');
      assert.equal(f.notes()[0].delegation_id, null); assert.equal(f.notes()[0].content, EARLY_SUPPORT_NOTES[language]);
      assert.deepEqual(f.sent.slice(0, introProviderCommands.length), introProviderCommands);
      const diagnostic = f.messages.find(row => row.event?.type === 'support_early_sent').event;
      assert.equal(diagnostic.inputOpen, false); assert.equal(diagnostic.sourceComplete, false);
      assert.equal(diagnostic.playbackClaim, false); assert.deepEqual(diagnostic.sourceEventIds, f.mirror.snapshot().sourceEventIds);
      f.engine.receive({ type: 'session.thinking.appended', client_event_id: f.notes()[0].event_id, start_ms: 1000, end_ms: 1050 });
      assert.ok(f.messages.some(row => row.event?.type === 'support_early_context_acknowledged' && row.event.playbackClaim === false));
      assert.equal(f.researchCalls(), 0);
    } finally { await f.close(); }
  });

  test(`${language}: intro remains protected, and a finished-boundary confusion result cannot bypass the early owner`, async () => {
    const f = fixture(language);
    try {
      f.native('input', confusion); f.worker.emit('message', f.candidate());
      assert.equal(f.notes().length, 0); assert.equal(f.engine.observation.status().support.early.activeSupport, false);
      assert.ok(f.messages.some(row => row.event?.reason === 'intro_unready'));
      await f.engine.flush(); await f.readyIntro();
      await f.words('input', confusion); f.idle();
      for (const value of f.oldConfusionCandidates()) f.worker.emit('message', value);
      f.idle();
      assert.equal(f.sent.filter(row => row.event_id?.startsWith('support_')).length, 0);
      assert.ok(f.messages.some(row => row.event?.reason === 'early_support_owns_explanation'));
      assert.equal(f.researchCalls(), 0);
    } finally { await f.close(); }
  });

  test(`${language}: late classifications stay local and only a freshly classified related follow-up can influence the next answer`, async () => {
    const f = fixture(language);
    try {
      await f.readyIntro(); f.native('input', confusion); const late = f.candidate();
      await f.words('output', language === 'en' ? 'We can take this one idea at a time.' : 'Podemos ver una idea a la vez.');
      f.worker.emit('message', late); f.idle();
      assert.equal(f.notes().length, 0); assert.equal(f.engine.observation.status().support.early.activeSupport, true);
      const followup = language === 'en' ? 'Could you explain that with one example?' : '¿Puedes explicarlo con un solo ejemplo?';
      f.native('input', followup);
      const packet = f.messages.findLast(row => row.source === 'native');
      assert.equal(packet.earlySupport.sourceText, confusion);
      assert.equal(packet.earlySupport.contributionId, late.stamp.contributionId);
      assert.equal(f.notes().length, 0, 'local carry is not itself context injection');
      f.worker.emit('message', f.candidate('continue_simplifying'));
      assert.equal(f.notes().length, 0, 'the renewed need can be classified before sending any context');
      await drain(); await f.engine.flush(); f.idle();
      assert.equal(f.notes().length, 1); assert.equal(f.notes()[0].content, EARLY_SUPPORT_NOTES[language]);
    } finally { await f.close(); }
  });

  test(`${language}: later caller fragments invalidate a cue held during input`, async () => {
    const f = fixture(language);
    try {
      await f.readyIntro();
      f.native('input', confusion);
      const candidate = f.candidate();
      f.worker.emit('message', candidate);
      assert.equal(f.engine.observation.status().support.early.pending, true);
      f.native('input', language === 'en' ? ' Actually, I understand now.' : ' En realidad, ya entiendo.');
      assert.equal(f.engine.observation.status().support.early.pending, false);
      await drain(); await f.engine.flush(); f.idle();
      assert.equal(f.notes().length, 0, 'a later boundary cannot revive a cue based on an earlier prefix');
      const discarded = f.messages.find(row => row.event?.type === 'support_early_discarded')?.event;
      assert.equal(discarded?.reason, 'new_input_requires_reclassification');
      assert.equal(discarded.operationId, candidate.record.operationId);
      assert.equal(discarded.deliveryMode, 'preanswer');
      assert.equal(discarded.readiness.inputOpen, true);
      assert.equal(f.researchCalls(), 0);
    } finally { await f.close(); }
  });

  test(`${language}: native output wins immediately and invalidates support waiting on caller input`, async () => {
    const f = fixture(language);
    try {
      await f.readyIntro();
      f.native('input', confusion); f.worker.emit('message', f.candidate());
      assert.equal(f.engine.observation.status().support.early.pending, true);
      await f.words('output', language === 'en' ? 'Let us try one simple example.' : 'Veamos un ejemplo sencillo.');
      f.idle();
      assert.equal(f.notes().length, 0);
      assert.equal(f.engine.observation.status().support.early.pending, false);
      assert.ok(f.events.some(row => row.type === 'response.output_audio_transcript.done'), 'ordinary output is never held for Decisions');
      assert.ok(f.messages.some(row => row.event?.reason === 'assistant_already_started'));
      assert.equal(f.researchCalls(), 0);
    } finally { await f.close(); }
  });

  test(`${language}: an input boundary cannot revive expired support after a long caller contribution`, async () => {
    const f = fixture(language, true, { fakeClock: true });
    try {
      await f.readyIntro();
      f.native('input', confusion); f.advance(100); f.worker.emit('message', f.candidate());
      assert.equal(f.engine.observation.status().support.early.pending, true);
      f.advance(2100); await drain(); await f.engine.flush(); f.idle();
      assert.equal(f.notes().length, 0);
      assert.equal(f.engine.observation.status().support.early.pending, false);
      assert.ok(f.messages.some(row => row.event?.reason === 'preanswer_evidence_expired'));
      assert.equal(f.researchCalls(), 0);
    } finally { await f.close(); }
  });
}

test('new fragments, wrong source IDs, reconnects, and student switches invalidate old candidates in the real wrapper', async () => {
  const f = fixture();
  try {
    await f.readyIntro(); f.native('input', 'I am confused about the form.'); const old = f.candidate();
    f.native('input', ' Actually I understand it now.'); f.worker.emit('message', old);
    assert.equal(f.notes().length, 0);
    const wrongIds = f.candidate(); wrongIds.record.sourceEventIds = ['wrong-source']; f.worker.emit('message', wrongIds);
    assert.equal(f.notes().length, 0);
    const preReconnect = f.candidate(); f.engine.suspend(); f.worker.emit('message', preReconnect);
    assert.equal(f.notes().length, 0); assert.equal(f.mirror.stamp().connectionEpoch, 1);
    f.engine.start(); await f.readyIntro(); f.native('input', 'I need a simpler explanation now.');
    const previousStudent = f.candidate();
    await f.engine.configure(f.config, { ...f.scope, studentId: 'fictional-second' }, 'student-switch');
    f.worker.emit('message', previousStudent);
    assert.equal(f.notes().length, 0); assert.equal(f.engine.observation.status().support.selectionPending, true);
    assert.equal(f.mirror.snapshot().studentId, 'fictional-second'); assert.equal(f.mirror.snapshot().recentDialogue.length, 0);
    assert.equal(f.researchCalls(), 0);
  } finally { await f.close(); }
});

test('language configuration fences a queued old-language candidate synchronously before awaiting the provider update', async () => {
  const f = fixture();
  try {
    await f.readyIntro(); f.native('input', 'I do not understand the difference.'); const old = f.candidate();
    const configuring = f.engine.configure({ ...f.config, language: 'es' }, f.scope, 'language-switch');
    f.worker.emit('message', old);
    assert.equal(f.notes().length, 0);
    await configuring; f.worker.emit('message', old);
    assert.equal(f.notes().length, 0); assert.equal(f.mirror.snapshot().language, 'es');
  } finally { await f.close(); }
});

test('feature remains off by default and cannot be enabled without the local conversation support prerequisites', async () => {
  const f = fixture('en', false);
  try {
    await f.readyIntro(); f.native('input', 'I do not understand the difference.');
    f.worker.emit('message', f.candidate());
    assert.equal(f.workerSettings().workerData.earlyEnabled, false); assert.equal(f.notes().length, 0);
    assert.equal(f.messages.some(row => row.earlyAllowed !== undefined), false);
    assert.equal(f.engine.observation.status().support.early.enabled, false);
  } finally { await f.close(); }
  const scope = { sessionId: 'fictional-guard', studentId: 'fictional-student', confirmed: true };
  assert.throws(() => createObservedLocalSession({ scope, config: { language: 'en' } },
    { localOnly: true, fictional: true, seed: { fictional: true, accountId: 'fictional-account', callId: scope.sessionId,
      studentId: scope.studentId, language: 'en' }, allowedCallIds: [scope.sessionId], paid: true, supportEnabled: true, earlyEnabled: true }),
  /early_support_requires_conversation_support/);
});

test('worker failure closes optional support but leaves the baseline voice connection operational', async () => {
  const f = fixture();
  try {
    await f.readyIntro(); f.native('input', 'I do not understand the difference.'); const candidate = f.candidate();
    f.worker.emit('message', { type: 'failed', reason: 'fictional-log-failure' });
    f.worker.emit('message', candidate);
    assert.equal(f.notes().length, 0); assert.equal(f.engine.observation.status().failed, true);
    const before = f.events.length;
    await f.words('output', 'We can still talk normally.');
    assert.ok(f.events.length > before); assert.equal(f.researchCalls(), 0);
  } finally { await f.close(); }
});
