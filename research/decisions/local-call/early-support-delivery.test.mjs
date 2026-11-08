import test from 'node:test';
import assert from 'node:assert/strict';
import { createEarlySupportDelivery, EARLY_SUPPORT_NOTES, EARLY_KIND_NOTES } from './early-support-delivery.mjs';
import { createEarlyEvidenceTracker } from './early-projector.mjs';
import { earlyResultFixture } from './early-fixtures.mjs';

const phrases = {
  en: { confused: 'I do not understand what that word means.', followup: 'Could you give me an example?', clear: 'Now I understand. Let us change topics.' },
  es: { confused: 'No entiendo lo que significa esa palabra.', followup: '¿Puedes darme un ejemplo?', clear: 'Ahora entiendo. Cambiemos de tema.' },
};
function fixture(language = 'en', options = {}) {
  let at = 10000, serial = 1, blocker = null;
  let snapshot = { usable: true, provisional: true, complete: false, inputOpen: true,
    stamp: { callId: 'fictional-call', studentId: 'fictional-student', language, connectionEpoch: 0, scopeEpoch: 0,
      contributionId: 'input-1', revision: 1 }, text: phrases[language].confused, sourceEventIds: ['input-1'],
    sourceTextEnds: [phrases[language].confused.length], assistantOutputRevision: 0,
    startMs: 1000, endMs: 2000, firstObservedAtMs: at, lastObservedAtMs: at, assistantOutputStartedForContribution: false };
  const sent = [], logs = [];
  const gate = createEarlySupportDelivery({ enabled: true, getEvidence: () => snapshot, now: () => at,
    canDeliver: () => blocker, log: row => logs.push(row), send: (type, content, details) => {
      sent.push({ type, content, details }); return options.send?.(type, content, details);
    }, ...options.gate });
  function candidate(action = 'simplify', changes = {}) {
    return { stamp: { ...snapshot.stamp }, record: { status: 'completed', callId: snapshot.stamp.callId,
      studentId: snapshot.stamp.studentId, sourceEventIds: [...snapshot.sourceEventIds],
      sourceText: snapshot.text, supportRevision: gate.revision(), assistantOutputRevision: snapshot.assistantOutputRevision,
      operationId: 'operation-' + snapshot.stamp.contributionId + '-' + snapshot.stamp.revision,
      requestId: 'request-' + snapshot.stamp.contributionId + '-' + snapshot.stamp.revision,
      result: earlyResultFixture({ need: action === 'clear' ? 'none' : action === 'continue_simplifying' ? 'related_followup' : action,
        change: action === 'clear' ? 'resolved' : 'unchanged_or_background', ...changes },
        { ...snapshot, activeSupport: gate.activeSupport() }) } };
  }
  function fragment(text = ' More words.', eventId = 'fragment-' + ++serial) {
    snapshot = { ...snapshot, text: snapshot.text + text, currentText: snapshot.text + text,
      stamp: { ...snapshot.stamp, revision: snapshot.stamp.revision + 1 },
      sourceEventIds: [...snapshot.sourceEventIds, eventId], sourceTextEnds: [...snapshot.sourceTextEnds, snapshot.text.length + text.length],
      lastObservedAtMs: at, endMs: snapshot.endMs + 200 };
    gate.native({ type: 'session.input_transcript.delta', event_id: eventId, delta: text });
  }
  function next(text = phrases[language].followup) {
    at += 3000;
    const id = 'input-' + ++serial;
    snapshot = { ...snapshot, stamp: { ...snapshot.stamp, contributionId: id, revision: 1 },
      text, sourceEventIds: [id], sourceTextEnds: [text.length], firstObservedAtMs: at, lastObservedAtMs: at,
      startMs: snapshot.endMs + 1000, endMs: snapshot.endMs + 1500,
      assistantOutputStartedForContribution: false, inputOpen: true, complete: false };
    gate.native({ type: 'session.input_transcript.delta', event_id: id, delta: text });
  }
  return { gate, sent, logs, candidate, fragment, next, advance: ms => { at += ms; },
    block: reason => { blocker = reason; }, snapshot: () => structuredClone(snapshot),
    set: value => { snapshot = { ...snapshot, ...value }; } };
}

for (const language of ['en', 'es']) {
  test(`${language}: retained need is revalidated against benign added background before a quiet note`, () => {
    const f = fixture(language), stale = f.candidate();
    f.fragment(language === 'en' ? ' My family has been' : ' Mi familia ha estado');
    assert.equal(f.gate.consider(stale).reason, 'need_retained_requires_revalidation');
    assert.equal(f.gate.activeSupport().status, 'provisional'); assert.equal(f.sent.length, 0);
    f.gate.tick(); assert.equal(f.sent.length, 0);
    assert.equal(f.gate.consider(f.candidate()).sent, true);
    assert.equal(f.gate.activeSupport().status, 'validated'); assert.equal(f.sent.length, 1);
  });
  test(`${language}: correction suspends a retained observation; only a complete revised need can replace it`, () => {
    const f = fixture(language), stale = f.candidate();
    f.fragment(language === 'en' ? ' Actually what I meant was' : ' En realidad lo que quería decir era');
    f.gate.consider(stale);
    assert.equal(f.gate.consider(f.candidate('simplify', { change: 'correction_pending' })).reason, 'correction_pending');
    assert.equal(f.gate.activeSupport().status, 'provisional'); assert.equal(f.sent.length, 0);
    f.fragment(language === 'en' ? ' the housing form, not that word.' : ' el formulario de vivienda, no esa palabra.');
    assert.equal(f.gate.consider(f.candidate('simplify', { change: 'revised_need' })).sent, true);
    assert.equal(f.gate.activeSupport().sourceText, f.snapshot().text);
  });
  test(`${language}: observed substantive answer clears unnecessary support but an acknowledgment does not`, () => {
    for (const [addressed, expected] of [[.99, 0], [.01, 1]]) {
      const f = fixture(language); f.block('assistant_speech_in_progress'); f.gate.consider(f.candidate());
      f.next(); f.block(null);
      f.set({ assistantSinceNeed: { text: addressed > .9 ? 'One full explanation.' : 'Yes.', sourceEventIds: ['out-1'] } });
      const decision = f.gate.consider(f.candidate('continue_simplifying', { addressed }));
      assert.equal(f.sent.length, expected);
      if (addressed > .9) { assert.equal(decision.reason, 'already_addressed'); assert.equal(f.gate.activeSupport(), null); }
      assert.ok(f.logs.every(row => row.playbackClaim === false));
    }
  });
  test(`${language}: a confirmed replacement clears the old need even when the new support kind is unidentified`, () => {
    const f = fixture(language); f.block('pending_context');
    f.gate.consider(f.candidate());
    assert.ok(f.gate.activeSupport());
    f.next(language === 'en'
      ? 'I understand that now; my actual question concerns the fee waiver.'
      : 'Ya entiendo eso; mi pregunta en realidad es sobre la exención de la cuota.');
    const obsolete = f.candidate('continue_simplifying');
    const beforeRevision = f.gate.revision();
    assert.equal(f.gate.consider(f.candidate('none', { change: 'revised_need' })).reason,
      'revised_need_support_withdrawn');
    assert.equal(f.gate.activeSupport(), null);
    assert.equal(f.gate.revision(), beforeRevision + 1);
    f.block(null); f.gate.tick();
    assert.equal(f.sent.length, 0);
    assert.equal(f.gate.consider(obsolete).reason, 'record_unmatched');
    assert.ok(f.logs.some(row => row.type === 'support_early_state_cleared'
      && row.reason === 'revised_need_unidentified' && row.contextSent === false));
    f.next();
    assert.equal(f.gate.consider(f.candidate('continue_simplifying')).reason, 'no_support_anchor');
    assert.equal(f.sent.length, 0);
  });
  test(`${language}: example and starting-point help use bounded authored notes, not transcript instructions`, () => {
    for (const [action, kind] of [['example', 'concrete_example'], ['starting_point', 'starting_point']]) {
      const f = fixture(language); assert.equal(f.gate.consider(f.candidate(action)).sent, true);
      assert.equal(f.sent[0].content, EARLY_KIND_NOTES[kind][language]);
      assert.equal(f.sent[0].type, 'session.thinking.append');
    }
  });
  test(`${language}: shadow mode records eligibility and retained need without sending or attempting audio context`, () => {
    const f = fixture(language, { gate: { observeOnly: true } });
    assert.equal(f.gate.consider(f.candidate()).reason, 'shadow_only');
    f.gate.tick(); assert.equal(f.sent.length, 0); assert.equal(f.gate.status().attempts, 0);
    assert.ok(f.gate.activeSupport());
  });
  test(`${language}: early support can arrive while input is open without a completed turn`, () => {
    const f = fixture(language);
    const result = f.gate.consider(f.candidate());
    assert.equal(result.sent, true);
    assert.equal(f.sent[0].type, 'session.thinking.append');
    assert.equal(f.sent[0].content, EARLY_SUPPORT_NOTES[language]);
    assert.equal(f.sent[0].details.inputOpen, true);
    assert.equal(f.sent[0].details.sourceComplete, false);
    assert.equal(f.sent[0].details.boundaryBasis, 'native_input_fragment_evidence');
    assert.ok(!f.sent[0].content.includes(phrases[language].confused));
    assert.ok(f.logs.every(row => row.playbackClaim === false));
  });

  test(`${language}: late support is kept locally and revalidated on a related next contribution`, () => {
    const f = fixture(language);
    const first = f.candidate();
    f.gate.native({ type: 'session.output_transcript.delta', delta: language === 'en' ? 'It means ' : 'Significa ' });
    assert.equal(f.gate.consider(first).reason, 'assistant_already_started');
    assert.equal(f.sent.length, 0);
    assert.ok(f.gate.activeSupport());
    f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: 'A finished answer.' });
    f.gate.tick(); assert.equal(f.sent.length, 0);
    f.next();
    f.gate.tick(); assert.equal(f.sent.length, 0, 'a new turn alone does not inject stale support');
    assert.equal(f.gate.consider(f.candidate('continue_simplifying')).sent, true);
    assert.equal(f.sent.length, 1);
  });

  test(`${language}: latest words invalidate an in-flight classification and a deferred note`, () => {
    const f = fixture(language); const original = f.candidate();
    f.fragment(language === 'en' ? ' Actually, I understand now.' : ' De hecho, ya entiendo.');
    assert.equal(f.gate.consider(original).reason, 'need_retained_requires_revalidation');
    assert.equal(f.sent.length, 0, 'a retained prefix cannot bypass the new suffix');
    f.block('pending_context');
    f.gate.consider(f.candidate());
    assert.equal(f.gate.status().pending, true);
    f.fragment(language === 'en' ? ' That was a quotation.' : ' Era una cita.');
    f.block(null); f.gate.tick(); assert.equal(f.sent.length, 0);
    assert.equal(f.gate.status().pending, false);
  });

  test(`${language}: a clear follow-up withdraws local support without forcing a clearing announcement`, () => {
    const f = fixture(language); f.gate.consider(f.candidate());
    f.next(phrases[language].clear);
    assert.equal(f.gate.consider(f.candidate('clear')).reason, 'support_cleared');
    assert.equal(f.gate.activeSupport(), null);
    assert.equal(f.sent.length, 1);
    f.next();
    assert.equal(f.gate.consider(f.candidate('continue_simplifying')).reason, 'no_support_anchor');
    assert.equal(f.sent.length, 1);
  });

  test(`${language}: intro, selection and unknown readiness never store or send support`, () => {
    for (const reason of ['intro_unready', 'session_or_scope_unready', 'language_unsupported', 'unavailable']) {
      const f = fixture(language); f.block(reason);
      assert.equal(f.gate.consider(f.candidate()).reason, reason);
      assert.equal(f.gate.activeSupport(), null); assert.equal(f.sent.length, 0);
    }
  });

  test(`${language}: genuine output and brief backchannels both close the optional pre-answer window`, () => {
    for (const output of [language === 'en' ? 'Yes.' : 'Sí.', language === 'en' ? 'Here is the explanation.' : 'Esta es la explicación.']) {
      const f = fixture(language); f.gate.native({ type: 'session.output_transcript.delta', delta: output });
      f.set({ inputOpen: false, complete: true });
      assert.equal(f.gate.consider(f.candidate()).reason, 'assistant_already_started');
      f.gate.boundary({ type: 'response.output_audio_transcript.done', transcript: output });
      f.gate.tick(); assert.equal(f.sent.length, 0);
    }
  });
}

test('source IDs and every scope/revision field must match exactly', () => {
  for (const field of ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch', 'contributionId', 'revision']) {
    const f = fixture(); const value = f.candidate();
    value.stamp[field] = typeof value.stamp[field] === 'number' ? value.stamp[field] + 1 : 'different';
    assert.equal(f.gate.consider(value).accepted, false, field);
    assert.equal(f.sent.length, 0);
  }
  for (const ids of [undefined, [], ['different'], ['input-1', 'extra']]) {
    const f = fixture(); const value = f.candidate(); value.record.sourceEventIds = ids;
    assert.equal(f.gate.consider(value).reason, 'stale_evidence');
  }
});

test('independent need and correction evidence gates never authorize uncertain support', () => {
  for (const changes of [{ needProbability: .89 }, { needProbability: NaN },
    { needProbability: 1.1 }, { change: 'correction_pending' },
    { facts: { correction_pending: .6 } }]) {
    const f = fixture(); assert.equal(f.gate.consider(f.candidate('simplify', changes)).accepted, false);
    assert.equal(f.gate.activeSupport(), null); assert.equal(f.sent.length, 0);
  }
  const existing = fixture(); existing.gate.consider(existing.candidate()); existing.next();
  assert.equal(existing.gate.consider(existing.candidate('simplify', { facts: { need_revised: .6 } })).reason, 'uncertain_change');
  assert.equal(existing.sent.length, 1, 'uncertain replacement cannot add another note');
});

test('duplicate results and further fragments cannot repeat a note in the same contribution', () => {
  const f = fixture(); const value = f.candidate();
  f.gate.consider(value); assert.equal(f.gate.consider(value).reason, 'record_unmatched');
  f.advance(3000); f.fragment();
  assert.equal(f.gate.consider(f.candidate()).reason, 'unchanged_support_already_supplied');
  assert.equal(f.sent.length, 1);
});

test('pending context can settle before output but never after output', () => {
  const f = fixture(); f.block('pending_context');
  assert.equal(f.gate.consider(f.candidate()).sent, false);
  f.advance(200); f.block(null); assert.equal(f.gate.tick().sent, true);
  const g = fixture(); g.block('pending_context'); g.gate.consider(g.candidate());
  g.gate.native({ type: 'session.output_transcript.delta', delta: 'The answer is ' });
  g.block(null); g.gate.tick(); assert.equal(g.sent.length, 0);
});

test('unmatched or invalid record never mutates local state', () => {
  for (const change of [{ status: 'failed' }, { studentId: 'other' }, { callId: 'other' }, { result: null }]) {
    const f = fixture(); const value = f.candidate(); Object.assign(value.record, change);
    assert.equal(f.gate.consider(value).accepted, false); assert.equal(f.gate.activeSupport(), null);
  }
});

test('a native output flag closes the window even without the local callback', () => {
  const f = fixture(); f.set({ assistantOutputStartedForContribution: true });
  assert.equal(f.gate.consider(f.candidate()).reason, 'assistant_already_started');
});

test('zero reflected PCM is not speech but nonzero or malformed audio blocks delivery', () => {
  const f = fixture(); f.gate.native({ type: 'session.output_audio.delta', delta: Buffer.alloc(8).toString('base64') });
  assert.equal(f.gate.consider(f.candidate()).sent, true);
  for (const delta of [Buffer.from([1, 0]).toString('base64'), 'bad-frame']) {
    const g = fixture(); g.gate.native({ type: 'session.output_audio.delta', delta });
    assert.equal(g.gate.consider(g.candidate()).reason, 'assistant_already_started');
  }
});

test('support expires after 90 seconds or more than three later contributions', () => {
  const f = fixture(); f.gate.consider(f.candidate()); f.advance(90001);
  assert.equal(f.gate.activeSupport(), null);
  const g = fixture(); g.gate.consider(g.candidate());
  for (let n = 0; n < 3; n++) { g.next(); assert.ok(g.gate.activeSupport()); }
  g.next(); assert.equal(g.gate.activeSupport(), null);
});

test('support is scoped to the current student, language and connection', () => {
  for (const change of [{ studentId: 'other' }, { language: 'es' }, { scopeEpoch: 1 }, { connectionEpoch: 1 }]) {
    const f = fixture(); f.gate.consider(f.candidate());
    f.set({ stamp: { ...f.snapshot().stamp, ...change } });
    assert.equal(f.gate.activeSupport(), null);
  }
});

test('silence, unknown evidence and stale playback cannot open the pre-answer window later', () => {
  const f = fixture(); f.block('playback_not_fresh_idle'); f.gate.consider(f.candidate());
  f.advance(2001); f.block(null);
  assert.equal(f.gate.tick().reason, 'preanswer_evidence_expired');
  assert.equal(f.sent.length, 0);
  const g = fixture(); g.set({ usable: false });
  assert.equal(g.gate.consider(g.candidate()).reason, 'stale_evidence');
});

test('ambiguous writes are logged and never retried', () => {
  for (const send of [() => false, () => { throw Error('socket closed'); }]) {
    const f = fixture('en', { send });
    assert.equal(f.gate.consider(f.candidate()).reason, 'write_unconfirmed');
    f.advance(500); f.gate.tick();
    assert.equal(f.sent.length, 1);
    assert.ok(f.logs.some(row => row.type === 'support_early_send_unconfirmed' && row.contextSent === 'unknown'));
  }
});

test('bounded sends persist across scope resets and the controller fails closed when disabled', () => {
  const f = fixture();
  for (let n = 0; n < 4; n++) { if (n) f.next(); assert.equal(f.gate.consider(f.candidate()).sent, true); }
  f.gate.reset(); f.next(); assert.equal(f.gate.consider(f.candidate()).reason, 'rate_limited');
  assert.equal(f.sent.length, 4);
  f.gate.close(); f.next(); assert.equal(f.gate.consider(f.candidate()).reason, 'disabled_or_closed');
  const g = fixture('en', { gate: { enabled: false } });
  assert.equal(g.gate.consider(g.candidate()).reason, 'disabled_or_closed');
});

test('support state is copied and never leaked into delivery diagnostics', () => {
  const f = fixture(); f.gate.consider(f.candidate());
  const state = f.gate.activeSupport(); state.stamp.studentId = 'mutated'; state.sourceText = 'mutated'; state.sourceEventIds.push('mutation');
  assert.equal(f.gate.activeSupport().stamp.studentId, 'fictional-student');
  assert.equal(f.gate.activeSupport().sourceText, phrases.en.confused);
  assert.deepEqual(f.gate.activeSupport().sourceEventIds, ['input-1']);
  assert.ok(!JSON.stringify(f.logs).includes(phrases.en.confused));
});

for (const language of ['en', 'es']) test(`${language}: actual tracker and delivery share native evidence before the adapter boundary`, () => {
  let at = 10000;
  const seed = { fictional: true, callId: 'fictional-call', studentId: 'fictional-student', language };
  const tracker = createEarlyEvidenceTracker(seed, { now: () => at });
  const sent = [];
  const gate = createEarlySupportDelivery({ enabled: true, getEvidence: tracker.snapshot,
    canDeliver: () => null, now: () => at, send: (...args) => { sent.push(args); } });
  const receive = (source, event) => {
    tracker.receive({ source, event, atMs: at });
    if (source === 'native') gate.native(event); else if (source === 'application') gate.boundary(event);
  };
  receive('native', { type: 'session.input_transcript.delta', event_id: 'input-native-1', delta: phrases[language].confused,
    start_ms: 1000, end_ms: 2000 });
  const snapshot = tracker.snapshot();
  at += 350;
  const result = gate.consider({ stamp: snapshot.stamp, record: { status: 'completed', callId: seed.callId, studentId: seed.studentId,
    sourceEventIds: snapshot.sourceEventIds, sourceText: snapshot.text, supportRevision: gate.revision(),
    assistantOutputRevision: snapshot.assistantOutputRevision, result: earlyResultFixture() } });
  assert.equal(result.sent, true);
  assert.equal(sent[0][2].inputEvidenceToSendMs, 350);
  assert.equal(tracker.snapshot().inputOpen, true);
  receive('native', { type: 'session.output_transcript.delta', event_id: 'output-native-1', delta: 'A clear answer.',
    start_ms: 2200, end_ms: 2500 });
  at += 750;
  receive('application', { type: 'conversation.item.input_audio_transcription.completed', item_id: 'adapter-input-1', transcript: phrases[language].confused });
  assert.equal(tracker.snapshot().inputOpen, false);
  assert.equal(tracker.snapshot().assistantOutputStartedForContribution, true);
  gate.tick(); assert.equal(sent.length, 1);
});
