import test from 'node:test';
import assert from 'node:assert/strict';
import { createEarlyProjector, createEarlyEvidenceTracker, sameEarlyEvidenceStamp } from './early-projector.mjs';
import { earlyFreshnessMismatch } from './early-evaluator.mjs';

const seed = { fictional: true, accountId: 'fictional-account', callId: 'fictional-call', studentId: 'fictional-student', language: 'en' };
const settle = () => new Promise(resolve => setImmediate(resolve));
const delta = (id, text, atMs, role = 'user') => ({ source: 'native', atMs,
  event: { type: role === 'user' ? 'session.input_transcript.delta' : 'session.output_transcript.delta',
    event_id: id, delta: text, start_ms: atMs, end_ms: atMs + 10 } });
const boundary = (id, text, atMs, role = 'user') => ({ source: 'application', atMs,
  event: role === 'user' ? { type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text }
    : { type: 'response.output_audio_transcript.done', response_id: id, transcript: text } });
function setup(language, options = {}) {
  let at = 0, sequence = 0; const timers = new Map(), captures = [], logs = [];
  const clock = { now: () => at, schedule(fn, delay) { const id = ++sequence; timers.set(id, { fn, due: at + delay }); return id; },
    cancel(id) { timers.delete(id); } };
  const projector = createEarlyProjector({ ...seed, language }, capture => captures.push(capture), row => logs.push(row), {
    ...clock, distributed: true, meaningfulScheduling: true, maxPerCall: 16, maxPerContribution: 3,
    betweenThoughtsAllowed: () => true, ...options });
  return { captures, logs, projector, now: () => at,
    send(id, text, role) { projector.receive(delta(id, text, at, role)); },
    async until(target) {
      while (true) {
        const due = Math.min(Infinity, ...[...timers.values()].map(timer => timer.due));
        if (due > target) break;
        at = due;
        for (const [id, timer] of [...timers]) if (timer.due <= at) { timers.delete(id); timer.fn(); }
        await settle();
      }
      at = target; await settle();
    },
  };
}

for (const [language, recognizable, ordinary, correction] of [
  ['en', 'Could you give an example of office hours?', 'My daughter showed me the campus website.', ' Actually, I meant an example of orientation.'],
  ['es', '¿Puedes darme un ejemplo de las horas de consulta?', 'Mi hija me mostró la página del campus.', ' En realidad, quería un ejemplo de la orientación.'],
]) {
  test(`${language}: recognizable requests start sooner while ordinary material waits for its short gap`, async () => {
    const fast = setup(language); fast.send('request', recognizable);
    await fast.until(159); assert.equal(fast.captures.length, 0);
    await fast.until(160); assert.equal(fast.captures.length, 1);
    assert.equal(fast.captures[0].triggerBasis, 'recognizable_request');
    assert.equal(fast.captures[0].observedAtMs, 160);
    const normal = setup(language); normal.send('ordinary', ordinary);
    await normal.until(349); assert.equal(normal.captures.length, 0);
    await normal.until(350); assert.equal(normal.captures.length, 1);
    assert.equal(normal.captures[0].triggerBasis, 'reserved_quiet_gap');
    fast.projector.close(); normal.projector.close();
  });

  test(`${language}: a fast scheduled request uses every new correction rather than its queued prefix`, async () => {
    const f = setup(language); f.send('request', recognizable);
    const prefix = f.projector.stamp();
    await f.until(100); f.send('correction', correction);
    await f.until(160); assert.equal(f.captures.length, 1);
    assert.equal(f.captures[0].text, recognizable + correction);
    assert.deepEqual(f.captures[0].sourceEventIds, ['request', 'correction']);
    assert.equal(sameEarlyEvidenceStamp(prefix, f.captures[0].stamp), false);
    assert.equal(f.captures[0].complete, false);
    await f.until(170); f.send('third-fragment', language === 'en' ? ' Wait, not that.' : ' Espera, eso no.');
    assert.equal(sameEarlyEvidenceStamp(f.captures[0].stamp, f.projector.stamp()), false);
    f.projector.close();
  });

  test(`${language}: a request emerging after generic context advances the first check without fragment polling`, async () => {
    const f = setup(language); f.send('background', ordinary);
    await f.until(100); f.send('need', ' ' + recognizable);
    await f.until(150); f.send('detail', language === 'en' ? ' Please.' : ' Por favor.');
    await f.until(259); assert.equal(f.captures.length, 0);
    await f.until(260); assert.equal(f.captures.length, 1);
    assert.equal(f.captures[0].triggerBasis, 'recognizable_request');
    assert.deepEqual(f.captures[0].sourceEventIds, ['background', 'need', 'detail']);
    await f.until(1000); assert.equal(f.captures.length, 1);
    f.projector.close();
  });

  test(`${language}: two input checks leave one bounded fresh check after observed output`, async () => {
    const f = setup(language); let text = recognizable;
    f.send('request', text); await f.until(160);
    const more = language === 'en' ? ' I am asking because I have never visited a teacher.' : ' Lo pregunto porque nunca he visitado a una profesora.';
    await f.until(200); f.send('detail', more); text += more;
    await f.until(550); assert.equal(f.captures.length, 2);
    for (let index = 0; index < 6; index++) {
      await f.until(600 + index * 50); f.send(`fragment-${index}`, ' ' + index); text += ' ' + index;
    }
    await f.until(1300); assert.equal(f.captures.length, 2, 'the last request is reserved instead of classifying every fragment');
    f.projector.receive(boundary('caller', text, f.now()));
    f.send('answer', language === 'en' ? 'I can help with that.' : 'Te puedo ayudar con eso.', 'assistant');
    f.projector.refresh(); await f.until(1650);
    assert.equal(f.captures.length, 3);
    assert.equal(f.captures[2].triggerBasis, 'between_thoughts_revalidation');
    assert.equal(f.captures[2].assistantOutputRevision, 1);
    assert.equal(f.captures[2].text, text);
    assert.equal(f.captures[2].revalidationCount, 2);
    f.send('more-answer', ' More words.', 'assistant'); f.projector.refresh(); await f.until(2500);
    assert.equal(f.captures.length, 3); f.projector.close();
  });
}

test('output boundaries describe only a matched transcript; new output invalidates that boundary immediately', () => {
  const tracker = createEarlyEvidenceTracker(seed);
  tracker.receive(delta('caller', 'Give me an example.', 0));
  tracker.receive(delta('output-1', 'For example,', 30, 'assistant'));
  assert.equal(tracker.snapshot().assistantBoundaryRevision, -1);
  assert.equal(tracker.snapshot().outputOpen, true);
  tracker.receive(delta('output-2', ' ask one homework question.', 60, 'assistant'));
  tracker.receive(boundary('output-boundary', 'For example, ask one homework question.', 90, 'assistant'));
  const matched = tracker.snapshot();
  assert.equal(matched.assistantBoundaryRevision, 2); assert.equal(matched.assistantOutputRevision, 2);
  assert.equal(matched.outputOpen, false); assert.equal(Object.hasOwn(matched, 'playbackComplete'), false);
  tracker.receive(delta('output-3', ' You can bring your notes.', 120, 'assistant'));
  assert.notEqual(tracker.snapshot().assistantBoundaryRevision, tracker.snapshot().assistantOutputRevision);
  assert.equal(tracker.snapshot().outputOpen, true);
  tracker.receive(boundary('ambiguous', 'Different buffered speech.', 150, 'assistant'));
  assert.notEqual(tracker.snapshot().assistantBoundaryRevision, tracker.snapshot().assistantOutputRevision);
});

test('freshness diagnostics identify concurrent revisions without treating unchanged playback as changed meaning', () => {
  const tracker = createEarlyEvidenceTracker(seed); tracker.receive(delta('caller', 'Give me an example.', 0));
  const observed = { ...tracker.snapshot(), supportRevision: 2 };
  assert.deepEqual(earlyFreshnessMismatch(observed, observed), []);
  const latest = { ...observed, stamp: { ...observed.stamp, revision: 2 }, supportRevision: 3, assistantOutputRevision: 1 };
  assert.deepEqual(earlyFreshnessMismatch(observed, latest), ['revision', 'supportRevision', 'assistantOutputRevision']);
  assert.deepEqual(earlyFreshnessMismatch(observed, { ...observed, playback: { idle: true, version: 9 } }), []);
  for (const field of ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch', 'contributionId']) {
    assert.deepEqual(earlyFreshnessMismatch(observed, { ...observed, stamp: { ...observed.stamp, [field]: 'different' } }), [field]);
  }
  assert.ok(earlyFreshnessMismatch(observed, { ...observed, usable: false }, true).includes('observer_closed'));
});
