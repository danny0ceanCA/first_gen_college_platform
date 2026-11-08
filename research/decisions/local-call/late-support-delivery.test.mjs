import test from 'node:test';
import assert from 'node:assert/strict';
import { createEarlySupportDelivery, LATE_KIND_NOTES } from './early-support-delivery.mjs';
import { earlyResultFixture } from './early-fixtures.mjs';

function fixture(language = 'en', options = {}) {
  let at = 10000, blocker = null;
  const callerText = language === 'es' ? 'Todavía no entiendo lo que significa esa palabra.' : 'I still do not understand what that word means.';
  let snapshot = { usable: true, provisional: true, complete: false, inputOpen: false,
    stamp: { callId: 'fictional-call', studentId: 'fictional-student', language, connectionEpoch: 0,
      scopeEpoch: 0, contributionId: 'input-1', revision: 1 },
    text: callerText, sourceEventIds: ['input-1'], sourceTextEnds: [callerText.length],
    startMs: 1000, endMs: 2000, lastObservedAtMs: 5000, firstObservedAtMs: 5000,
    assistantOutputRevision: 1, contributionOutputOriginRevision: 0, assistantOutputStartedForContribution: true,
    assistantEvidence: [{ revision: 1, sourceEventId: 'output-1', text: language === 'es' ? 'Claro.' : 'Of course.', startMs: 2300, endMs: 2600 }],
  };
  const sent = [], logs = [];
  const gate = createEarlySupportDelivery({ enabled: true, lateEnabled: true, now: () => at,
    getEvidence: () => snapshot, canDeliver: () => blocker, canDeliverLate: () => blocker,
    log: row => logs.push(row), send: (type, content, details) => { sent.push({ type, content, details }); return options.send?.(); },
    ...options.gate });
  const candidate = (action = 'simplify', resultChanges = {}) => {
    const origin = snapshot.contributionOutputOriginRevision;
    const rows = snapshot.assistantEvidence.filter(row => row.revision > origin);
    return { stamp: { ...snapshot.stamp }, record: {
      status: 'completed', callId: snapshot.stamp.callId, studentId: snapshot.stamp.studentId,
      sourceEventIds: [...snapshot.sourceEventIds], sourceText: snapshot.text,
      supportRevision: gate.revision(), assistantOutputRevision: snapshot.assistantOutputRevision,
      operationId: 'fictional-operation', requestId: 'fictional-request',
      triggerBasis: 'settled_late_experiment', classifiedAtMs: at,
      assistantEvidenceComplete: true, assistantOutputOriginRevision: origin,
      sourceOutputEventIds: rows.map(row => row.sourceEventId),
      result: earlyResultFixture({ need: action, ...resultChanges }, { ...snapshot, activeSupport: gate.activeSupport(),
        assistantSinceNeed: { text: rows.map(row => row.text).join(''), sourceEventIds: rows.map(row => row.sourceEventId), evidenceComplete: true } }),
    } };
  };
  return { gate, sent, logs, candidate, block: value => { blocker = value; }, advance: value => { at += value; },
    set: value => { snapshot = { ...snapshot, ...value }; }, snapshot: () => structuredClone(snapshot) };
}

for (const language of ['en', 'es']) {
  test(`${language}: late experiment supplies only a fixed quiet note after fresh complete output evidence`, () => {
    for (const [action, kind] of [['simplify', 'simpler_explanation'], ['example', 'concrete_example'], ['starting_point', 'starting_point']]) {
      const f = fixture(language);
      assert.equal(f.gate.consider(f.candidate(action)).sent, true);
      assert.equal(f.sent.length, 1);
      assert.equal(f.sent[0].type, 'session.thinking.append');
      assert.equal(f.sent[0].content, LATE_KIND_NOTES[kind][language]);
      assert.equal(f.sent[0].details.deliveryMode, 'late_experiment');
      assert.equal(f.sent[0].details.outputEvidenceComplete, true);
      assert.equal(f.sent[0].details.outputEvidenceIsPlayback, false);
      assert.equal(f.sent[0].details.sourceComplete, false, 'transcript grouping is still not a semantic completion guarantee');
      assert.equal(f.sent[0].details.classificationAgeMs, 0);
      assert.ok(f.logs.every(row => row.playbackClaim === false));
      assert.ok(!f.sent[0].content.includes(f.snapshot().text), 'no raw caller text becomes a behavior instruction');
    }
  });

  test(`${language}: a cue captured before the answer cannot authorize late delivery`, () => {
    const f = fixture(language), value = f.candidate();
    value.record.triggerBasis = 'meaningful_evidence';
    value.record.assistantOutputRevision = 0;
    assert.equal(f.gate.consider(value).reason, 'assistant_already_started');
    assert.equal(f.sent.length, 0);
    f.advance(500); f.gate.tick();
    assert.equal(f.sent.length, 0, 'enabling the experiment never extends an early cue into a late one');
  });

  test(`${language}: answered need is cleared without another announcement`, () => {
    const f = fixture(language);
    assert.equal(f.gate.consider(f.candidate('simplify', { addressed: .99 })).reason, 'already_addressed');
    assert.equal(f.sent.length, 0);
    assert.equal(f.gate.activeSupport(), null);
  });

  test(`${language}: experiment is default off and missing late guard fails closed`, () => {
    const disabled = fixture(language, { gate: { lateEnabled: false } });
    assert.equal(disabled.gate.consider(disabled.candidate()).reason, 'late_experiment_disabled');
    assert.equal(disabled.sent.length, 0);
    const absent = fixture(language, { gate: { canDeliverLate: undefined } });
    assert.equal(absent.gate.consider(absent.candidate()).reason, 'unavailable');
    assert.equal(absent.sent.length, 0);
    const defaultGate = createEarlySupportDelivery();
    assert.equal(defaultGate.status().lateEnabled, false);
  });

  test(`${language}: intro, research, active speech, pending context and stale playback prevent late delivery`, () => {
    for (const reason of ['intro_unready', 'session_or_scope_unready', 'research_in_progress',
      'speech_in_progress', 'background_or_context_pending', 'playback_not_fresh_idle']) {
      const f = fixture(language); f.block(reason);
      assert.equal(f.gate.consider(f.candidate()).reason, reason);
      assert.equal(f.sent.length, 0);
      f.advance(2001); f.block(null); f.gate.tick();
      assert.equal(f.sent.length, 0, 'settling another operation cannot resurrect an expired classification');
    }
  });

  test(`${language}: even briefly deferred late support is invalidated by any new output`, () => {
    for (const event of [
      { type: 'session.output_transcript.delta', delta: language === 'es' ? 'Y además ' : 'And also ' },
      { type: 'session.output_audio.delta', delta: Buffer.from([1, 0]).toString('base64') },
      { type: 'session.output_audio.delta', delta: 'malformed-audio' },
    ]) {
      const f = fixture(language); f.block('playback_not_fresh_idle'); f.gate.consider(f.candidate());
      assert.equal(f.gate.status().pending, true);
      f.gate.native(event);
      f.block(null); f.gate.tick();
      assert.equal(f.gate.status().pending, false); assert.equal(f.sent.length, 0);
      assert.ok(f.logs.some(row => row.reason === 'late_new_output_requires_reclassification'));
    }
  });

  test(`${language}: caller corrections invalidate a deferred late classification`, () => {
    const f = fixture(language); f.block('playback_not_fresh_idle'); f.gate.consider(f.candidate());
    const before = f.snapshot();
    f.set({ stamp: { ...before.stamp, revision: 2 }, sourceEventIds: ['input-1', 'correction-1'], inputOpen: true });
    f.gate.native({ type: 'session.input_transcript.delta', delta: language === 'es' ? 'En realidad ' : 'Actually ' });
    f.block(null); f.gate.tick();
    assert.equal(f.sent.length, 0); assert.equal(f.gate.status().pending, false);
  });

  test(`${language}: unchanged evidence gets one delivery attempt even after an ambiguous write`, () => {
    for (const send of [() => true, () => false, () => { throw Error('write ambiguous'); }]) {
      const f = fixture(language, { send });
      f.gate.consider(f.candidate());
      f.advance(500); f.gate.consider(f.candidate()); f.gate.tick();
      assert.equal(f.sent.length, 1);
      assert.equal(f.gate.status().attempts, 1);
    }
  });
}

test('late result metadata must cover the entire current post-caller output interval', () => {
  for (const change of [
    { assistantEvidenceComplete: false }, { assistantEvidenceComplete: undefined },
    { assistantOutputOriginRevision: 1 }, { assistantOutputOriginRevision: undefined },
    { sourceOutputEventIds: [] }, { sourceOutputEventIds: ['different-output'] },
    { sourceOutputEventIds: ['output-1', 'output-2'] }, { assistantOutputRevision: 0 },
    { classifiedAtMs: undefined }, { classifiedAtMs: NaN }, { classifiedAtMs: 12001 },
  ]) {
    const f = fixture(), value = f.candidate(); Object.assign(value.record, change);
    assert.equal(f.gate.consider(value).accepted, false, JSON.stringify(change));
    assert.equal(f.sent.length, 0);
  }
  for (const change of [
    { contributionOutputOriginRevision: undefined }, { contributionOutputOriginRevision: 1 },
    { assistantEvidence: [] }, { inputOpen: true }, { inputOpen: undefined },
    { assistantEvidence: [{ revision: 2, sourceEventId: 'output-1' }] },
  ]) {
    const f = fixture(), value = f.candidate(); f.set(change);
    assert.equal(f.gate.consider(value).accepted, false, JSON.stringify(change));
    assert.equal(f.sent.length, 0);
  }
});

test('late freshness bounds apply at receipt and while waiting for a safe delivery window', () => {
  const expired = fixture(), staleCandidate = expired.candidate(); expired.advance(2001);
  assert.equal(expired.gate.consider(staleCandidate).reason, 'late_classification_expired');
  const caller = fixture(); caller.advance(10001);
  assert.equal(caller.gate.consider(caller.candidate()).reason, 'late_caller_evidence_expired');
  const queued = fixture(); queued.block('playback_not_fresh_idle'); queued.gate.consider(queued.candidate());
  queued.advance(2001); queued.block(null);
  assert.equal(queued.gate.tick().reason, 'late_classification_expired'); assert.equal(queued.sent.length, 0);
  const fresh = fixture(); fresh.block('playback_not_fresh_idle'); fresh.gate.consider(fresh.candidate());
  fresh.advance(200); fresh.block(null); assert.equal(fresh.gate.tick().sent, true);
});

test('new output revision invalidates pending support even if native callback was missed', () => {
  const f = fixture(); f.block('playback_not_fresh_idle'); f.gate.consider(f.candidate());
  const current = f.snapshot();
  f.set({ assistantOutputRevision: 2, assistantEvidence: [...current.assistantEvidence,
    { revision: 2, sourceEventId: 'output-2', text: 'Another sentence.', startMs: 2700, endMs: 3000 }] });
  f.block(null);
  assert.equal(f.gate.tick().reason, 'late_output_revision_changed'); assert.equal(f.sent.length, 0);
});

test('a new classification includes output revision in deduplication without repeating a delivered note', () => {
  const f = fixture();
  assert.equal(f.gate.consider(f.candidate('none')).reason, 'no_support_needed');
  const current = f.snapshot();
  f.set({ assistantOutputRevision: 2, assistantEvidence: [...current.assistantEvidence,
    { revision: 2, sourceEventId: 'output-2', text: 'I can explain.', startMs: 2700, endMs: 3000 }] });
  assert.equal(f.gate.consider(f.candidate()).sent, true);
  assert.equal(f.sent.length, 1);
});

test('shadow mode never sends a late note and reflected silence never invalidates evidence', () => {
  const shadow = fixture('en', { gate: { observeOnly: true } });
  assert.equal(shadow.gate.consider(shadow.candidate()).reason, 'shadow_only');
  assert.equal(shadow.sent.length, 0); assert.equal(shadow.gate.status().attempts, 0);
  const quiet = fixture(); quiet.block('playback_not_fresh_idle'); quiet.gate.consider(quiet.candidate());
  quiet.gate.native({ type: 'session.output_audio.delta', delta: Buffer.alloc(8).toString('base64') });
  quiet.block(null); assert.equal(quiet.gate.tick().sent, true);
});
