import test from 'node:test';
import assert from 'node:assert/strict';
import { createEarlyEvidenceTracker, createEarlyProjector, meaningfulEarlyEvidence,
  sameEarlyEvidenceStamp, EARLY_EVIDENCE_LIMITS } from './early-projector.mjs';

const seed = { fictional: true, accountId: 'fictional-account', callId: 'fictional-call', studentId: 'aiden', language: 'en' };
const delta = (id, text, atMs, role = 'user') => ({ source: 'native', atMs,
  event: { type: role === 'user' ? 'session.input_transcript.delta' : 'session.output_transcript.delta',
    event_id: id, delta: text, start_ms: atMs, end_ms: atMs + 20 } });
const boundary = (text, atMs, role = 'user', id = `b${atMs}`) => ({ source: 'application', atMs,
  event: role === 'user' ? { type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text }
    : { type: 'response.output_audio_transcript.done', response_id: id, transcript: text } });
const immediate = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let at = 0, next = 0; const timers = new Map();
  return { now: () => at,
    schedule(callback, delay) { const id = ++next; timers.set(id, { callback, due: at + delay }); return id; },
    cancel(id) { timers.delete(id); },
    advance(ms) { at += ms; for (const [id, timer] of [...timers]) if (timer.due <= at) { timers.delete(id); timer.callback(); } },
    count: () => timers.size,
    nextDue: () => timers.size ? Math.min(...[...timers.values()].map(timer => timer.due)) : Infinity };
}
function setup(language = 'en', options = {}) {
  const time = clock(), captures = [], logs = [];
  const projector = createEarlyProjector({ ...seed, language }, snapshot => captures.push(snapshot), row => logs.push(row),
    { ...time, allowedStudentIds: ['aiden', 'elodie'], ...options });
  return { time, projector, captures, logs, send: packet => projector.receive(packet) };
}

for (const [language, trace, subject] of [
  ['en', [[0, ' I'], [155, ' am'], [556, ' confused'], [934, ' about'], [1362, ' grants'],
    [1532, ' and'], [2129, ' loans'], [2987, '. I'], [3132, ' have been'], [3543, ' reading a'],
    [4172, ' college'], [4362, ' letter'], [4576, ' with'], [4746, ' my'], [5113, ' family'],
    [5977, ', and'], [6134, ' I'], [6559, ' cannot'], [6761, ' work'], [6928, ' out'],
    [7332, ' which'], [7731, ' money'], [8167, ' would'], [8382, ' have'], [8528, ' to be'],
    [8972, ' paid'], [9356, ' back'], [9753, ' later']], 'grants and loans'],
  ['es', [[0, ' No'], [155, ' entiendo'], [934, ' las'], [1362, ' becas'], [1532, ' y'],
    [2129, ' los'], [2600, ' préstamos'], [2987, '. He'], [3132, ' estado'], [3543, ' leyendo una'],
    [4172, ' carta'], [4362, ' de la'], [4576, ' universidad'], [4746, ' con'], [5113, ' mi familia'],
    [5977, ', y'], [6134, ' no'], [6559, ' logro'], [6761, ' entender'], [6928, ' qué'],
    [7332, ' dinero'], [7731, ' tendríamos'], [8167, ' que'], [8382, ' devolver'], [8528, ' después'],
    [8972, ' de'], [9356, ' terminar'], [9753, ' los estudios']], 'becas y los préstamos'],
]) test(`${language}: distributed replay reserves the second check for material subject evidence`, async () => {
  // English follows the captured fragment cadence; Spanish uses a fictional
  // counterpart with long pauses after articles and conjunctions. Neither is
  // proof that a pause marks a finished thought or that a cue was heard.
  const f = setup(language, { distributed: true, maxPerCall: 16, maxPerContribution: 2 });
  for (const [at, text] of trace) {
    await advanceTo(f.time, at);
    f.send(delta(`trace-${at}`, text, at));
  }
  await advanceTo(f.time, 11000);
  assert.equal(f.captures.length, 2);
  assert.equal(f.captures[0].text.trim(), language === 'en' ? 'I am confused' : 'No entiendo');
  assert.ok(f.captures[1].text.includes(subject), f.captures[1].text);
  assert.ok(Buffer.byteLength(f.captures[1].text) - Buffer.byteLength(f.captures[0].text) >= 16);
  assert.ok(f.captures.every(row => !/\b(?:about|and|y|las|los)\s*$/iu.test(row.text)));
  assert.ok(f.captures.every(row => row.complete === false));
  assert.ok(f.captures[1].observedAtMs < trace.at(-1)[0], 'classification never waits for the whole long caller contribution');
  assert.equal(f.projector.snapshot().text, trace.map(([, text]) => text).join(''));
  f.projector.close();
});

for (const [language, text, explanation] of [
  ['en', "I'm confused.", 'A prerequisite is a class you take before another class.'],
  ['es', 'No entiendo.', 'Un requisito previo es una clase que cursas antes de otra.'],
  ['es', 'No entiendo eso.', 'Un requisito previo es una clase que cursas antes de otra.'],
]) test(`${language}: distributed tail guards preserve a short need with known conversational context: ${text}`, async () => {
  const f = setup(language, { distributed: true, maxPerCall: 16, maxPerContribution: 2 });
  f.send(delta('explanation', explanation, 0, 'assistant'));
  f.send(boundary(explanation, 20, 'assistant'));
  f.time.advance(100); f.send(delta('confusion', text, 100));
  await advanceTo(f.time, 450);
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].text, text);
  assert.ok(f.captures[0].recentDialogue.some(row => row.text === explanation));
  f.projector.close();
});

for (const language of ['en', 'es']) test(`${language}: a queued late check cannot label a new caller contribution as late`, async () => {
  let lateAllowed = false;
  const f = setup(language, { distributed: true, maxPerCall: 16, maxPerContribution: 2, lateAllowed: () => lateAllowed });
  const first = language === 'en' ? 'I do not understand what that word means.' : 'No entiendo lo que significa esa palabra.';
  f.send(delta('first', first, 0));
  f.time.advance(50); f.send(boundary(first, 50));
  f.send(delta('ack', language === 'en' ? 'Of course.' : 'Claro.', 50, 'assistant'));
  f.time.advance(300); await immediate();
  assert.equal(f.captures.length, 0);
  lateAllowed = true;
  f.send({ source: 'playback', atMs: 350, event: { type: 'browser_playback', idle: true, version: 1 } });
  assert.equal(f.time.count(), 1);
  const second = language === 'en' ? 'Can you show me a different example?' : '¿Puedes mostrarme un ejemplo diferente ahora?';
  f.send(delta('second', second, 350));
  f.time.advance(0); await immediate();
  assert.equal(f.captures.length, 0, 'new caller evidence still gets its accumulation window');
  f.time.advance(350); await immediate();
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].contributionId, 'second');
  assert.equal(f.captures[0].triggerBasis, 'reserved_quiet_gap');
  assert.equal(f.captures[0].lateExperiment, false);
  f.projector.close();
});

test('a queued early check is reclassified as late only when current settled evidence permits it', async () => {
  let lateAllowed = false;
  const f = setup('en', { distributed: true, lateAllowed: () => lateAllowed });
  const text = 'I do not understand what that word means.';
  f.send(delta('input', text, 0)); f.time.advance(100);
  f.send(boundary(text, 100)); f.send(delta('ack', 'Of course.', 100, 'assistant'));
  lateAllowed = true;
  f.send({ source: 'playback', atMs: 100, event: { type: 'browser_playback', idle: true, version: 1 } });
  f.time.advance(250); await immediate();
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].triggerBasis, 'settled_late_experiment');
  assert.equal(f.captures[0].assistantOutputRevision, 1);
  assert.equal(f.captures[0].lateExperiment, true);
  f.projector.close();
});

test('a retained prefix permits a bounded recheck of a short new suffix without repeating unchanged input', async () => {
  let retained = false;
  const f = setup('en', { needsRevalidation: () => retained });
  f.send(delta('one', 'I do not understand how college credits work.', 0));
  f.time.advance(160); await immediate(); assert.equal(f.captures.length, 1);
  f.send(delta('two', ' But', 180));
  f.time.advance(160); await immediate(); assert.equal(f.captures.length, 1);
  retained = true; f.projector.refresh(); f.time.advance(160); await immediate();
  assert.equal(f.captures.length, 2); assert.ok(f.captures[1].text.endsWith(' But'));
  f.projector.refresh(); f.time.advance(500); await immediate(); assert.equal(f.captures.length, 2);
  f.projector.close();
});
test('a delayed retained-need revision rechecks the same latest words once within existing request caps', async () => {
  let revision = 0;
  const f = setup('en', { needsRevalidation: () => revision > 0, supportRevision: () => revision });
  f.send(delta('one', 'I do not understand how college credits work.', 0));
  f.time.advance(160); await immediate(); assert.equal(f.captures.length, 1);
  revision = 1; f.projector.refresh(); f.time.advance(160); await immediate();
  assert.equal(f.captures.length, 2);
  f.projector.refresh(); f.time.advance(500); await immediate(); assert.equal(f.captures.length, 2);
  revision = 2; f.projector.refresh(); f.time.advance(350); await immediate(); assert.equal(f.captures.length, 3);
  revision = 3; f.projector.refresh(); f.time.advance(1000); await immediate(); assert.equal(f.captures.length, 3);
  f.projector.close();
});
async function advanceTo(time, target) {
  while (time.nextDue() <= target) {
    time.advance(time.nextDue() - time.now());
    await immediate();
  }
  time.advance(target - time.now());
  await immediate();
}

for (const [language, opening, continuation] of [
  ['en', 'I do not understand the difference', ' between a grant and a loan.'],
  ['es', 'No entiendo la diferencia entre estas', ' becas y los préstamos.'],
]) {
  test(`${language}: observes accumulated partial speech before the existing 1.1-second boundary`, async () => {
    const h = setup(language);
    h.send(delta('n1', opening, 0)); h.time.advance(100);
    h.send(delta('n2', continuation, 100)); h.time.advance(60); await immediate();
    assert.equal(h.captures.length, 1);
    const capture = h.captures[0];
    assert.equal(capture.observedAtMs, 160); assert.equal(capture.text, opening + continuation);
    assert.deepEqual(capture.sourceEventIds, ['n1', 'n2']); assert.equal(capture.stamp.revision, 2);
    assert.equal(capture.provisional, true); assert.equal(capture.complete, false); assert.equal(capture.inputOpen, true);
    assert.equal(capture.recentDialogue.length, 0, 'the early observer never manufactures a complete user turn');
    assert.equal(h.projector.tracker.snapshot().inputOpen, true);
    h.send(boundary(opening + continuation, 1100));
    assert.equal(h.projector.tracker.snapshot().inputOpen, false);
    assert.equal(h.projector.tracker.snapshot().recentDialogue[0].source, 'application_estimate');
    h.projector.close();
  });

  test(`${language}: short acknowledgments and assistant output do not use early classifier requests`, async () => {
    const h = setup(language);
    h.send(delta('a1', language === 'en' ? 'Would an example help?' : '¿Te ayudaría un ejemplo?', 0, 'assistant'));
    h.time.advance(200); await immediate(); assert.equal(h.captures.length, 0);
    h.send(delta('u1', language === 'en' ? 'Okay.' : 'Sí.', 200));
    h.time.advance(200); await immediate(); assert.equal(h.captures.length, 0);
    h.projector.close();
  });
}

test('parent and worker stamps remain deterministic across selection, connection, and contribution boundaries', () => {
  const options = { allowedStudentIds: ['aiden', 'elodie'] };
  const parent = createEarlyEvidenceTracker(seed, options), worker = createEarlyEvidenceTracker(seed, options);
  const packets = [delta('n1', 'I cannot understand this example.', 10), boundary('I cannot understand this example.', 1200),
    delta('a1', 'Let us try another example.', 1250, 'assistant'), boundary('Let us try another example.', 2200, 'assistant'),
    delta('n2', 'Please use a simpler example.', 2300),
    { source: 'scope', atMs: 2400, event: { type: 'scope_transition' } },
    { source: 'scope', atMs: 2500, event: { type: 'scope_changed', studentId: 'elodie', language: 'es', confirmed: true } },
    delta('n3', 'No me queda claro esto.', 2600),
    { source: 'connection', atMs: 2800, event: { type: 'browser_control_detached' } },
    delta('n4', 'Todavía no entiendo la diferencia.', 2900)];
  for (const packet of packets) {
    parent.receive(packet); worker.receive(structuredClone(packet));
    assert.deepEqual(parent.snapshot(), worker.snapshot());
  }
  assert.equal(parent.stamp().contributionId, 'n4'); assert.equal(parent.stamp().connectionEpoch, 1);
  assert.equal(parent.snapshot().studentId, 'elodie');
  assert.equal(parent.snapshot().recentDialogue.length, 0, 'student and connection changes clear previous dialogue');
});

test('new caller words invalidate the exact earlier revision, including a later correction', () => {
  const tracker = createEarlyEvidenceTracker(seed);
  tracker.receive(delta('u1', 'I am confused about that.', 0)); const earlier = tracker.stamp();
  tracker.receive(delta('u2', ' Actually I understand; change the topic.', 100));
  assert.equal(sameEarlyEvidenceStamp(earlier, tracker.stamp()), false);
  assert.equal(tracker.snapshot().text, 'I am confused about that. Actually I understand; change the topic.');
  assert.equal(sameEarlyEvidenceStamp(tracker.stamp(), tracker.snapshot().stamp), true);
  assert.equal(sameEarlyEvidenceStamp({}, {}), false);
});

test('duplicate native evidence neither changes revision nor costs another observation', async () => {
  const h = setup(), packet = delta('u1', 'I do not understand this at all.', 0);
  h.send(packet); h.send(structuredClone(packet)); h.time.advance(160); await immediate();
  h.send(packet); h.time.advance(200); await immediate();
  assert.equal(h.captures.length, 1); assert.equal(h.projector.stamp().revision, 1);
  h.projector.close();
});

test('a changed payload under one event ID, missing ID, or reversed interval fails closed', () => {
  for (const bad of [
    delta('u1', 'Changed words under reused ID.', 0),
    { ...delta('u2', 'Missing event identity.', 100), event: { ...delta('u2', 'Missing event identity.', 100).event, event_id: undefined } },
    { ...delta('u2', 'Reversed interval.', 100), event: { ...delta('u2', 'Reversed interval.', 100).event, start_ms: 300, end_ms: 200 } },
    delta('u2', 'Earlier interval out of order.', -10),
  ]) {
    const tracker = createEarlyEvidenceTracker(seed);
    tracker.receive(delta('u1', 'I need a simpler explanation.', 0)); tracker.receive(bad);
    assert.equal(tracker.snapshot().usable, false); assert.equal(tracker.snapshot().stopped, true);
  }
});

test('scope and language changes revoke partial evidence and pending inference timers', async () => {
  const h = setup(); h.send(delta('u1', 'I do not understand this at all.', 0));
  h.send({ source: 'scope', atMs: 30, event: { type: 'scope_transition' } });
  h.time.advance(200); await immediate(); assert.equal(h.captures.length, 0); assert.equal(h.time.count(), 0);
  h.send({ source: 'scope', atMs: 200, event: { type: 'scope_changed', studentId: 'elodie', language: 'es', confirmed: true } });
  h.send(delta('u2', 'No me queda claro esto.', 200));
  h.time.advance(160); await immediate(); assert.equal(h.captures.length, 1);
  const stamp = h.projector.stamp();
  h.send({ source: 'scope', atMs: 360, event: { type: 'context_changed', language: 'en' } });
  assert.equal(sameEarlyEvidenceStamp(stamp, h.projector.stamp()), false);
  assert.equal(h.projector.snapshot().text, ''); h.projector.close();
});

test('unselected or unauthorized students are never eligible', async () => {
  const time = clock(), captures = [];
  const projector = createEarlyProjector({ ...seed, studentId: 'unselected' }, value => captures.push(value), () => {},
    { ...time, allowedStudentIds: ['aiden'] });
  projector.receive(delta('u1', 'I am confused about this process.', 0)); time.advance(200); await immediate();
  assert.equal(captures.length, 0);
  projector.receive({ source: 'scope', atMs: 200, event: { type: 'scope_changed', studentId: 'someone-else', language: 'en' } });
  assert.equal(projector.snapshot().stopped, true); projector.close();
});

test('intro readiness predicate defers classification without changing transcript evidence', async () => {
  let ready = false;
  const h = setup('en', { enabled: () => ready });
  h.send(delta('u1', 'I do not understand the difference', 0)); h.time.advance(200); await immediate();
  assert.equal(h.captures.length, 0); assert.equal(h.projector.snapshot().text, 'I do not understand the difference');
  ready = true; h.send(delta('u2', ' between these two terms.', 200)); h.time.advance(160); await immediate();
  assert.equal(h.captures.length, 1); h.projector.close();
});

test('continuous fragments coalesce in a finite window rather than postponing forever', async () => {
  const h = setup(); h.send(delta('u0', 'I still do not understand the difference', 0));
  for (let index = 1; index <= 3; index++) { h.time.advance(50); h.send(delta(`u${index}`, ' and more', index * 50)); }
  h.time.advance(10); await immediate();
  assert.equal(h.captures.length, 1); assert.equal(h.captures[0].observedAtMs, 160);
  assert.equal(h.captures[0].sourceEventIds.length, 4); h.projector.close();
});

test('the recorded 28-fragment cadence reserves the last request for a later complete clause', async () => {
  // Fictional validation trace. This tests scheduling against observed cadence,
  // not model confidence or a promise of speech delivery on a future call.
  const trace = [[0, ' I'], [155, ' am'], [556, ' confused'], [934, ' about'], [1362, ' grants'],
    [1532, ' and'], [2129, ' loans'], [2987, '. I'], [3132, ' have been'], [3543, ' reading a'],
    [4172, ' college'], [4362, ' letter'], [4576, ' with'], [4746, ' my'], [5113, ' family'],
    [5977, ', and'], [6134, ' I'], [6559, ' cannot'], [6761, ' work'], [6928, ' out'],
    [7332, ' which'], [7731, ' money'], [8167, ' would'], [8382, ' have'], [8528, ' to be'],
    [8972, ' paid'], [9356, ' back'], [9753, ' later']];
  const time = clock(), captures = [], completions = [], logs = [], durations = [475, 353, 303];
  const projector = createEarlyProjector(seed, capture => {
    const ordinal = captures.push(capture);
    return new Promise(resolve => time.schedule(() => {
      completions.push({ at: time.now(), fresh: sameEarlyEvidenceStamp(capture.stamp, projector.stamp()) });
      resolve();
    }, durations[ordinal - 1]));
  }, row => logs.push(row), time);
  for (let index = 0; index < trace.length; index++) {
    await advanceTo(time, trace[index][0]);
    projector.receive(delta(`trace${index + 1}`, trace[index][1], trace[index][0]));
  }
  await advanceTo(time, 11000);
  assert.equal(captures.length, 3);
  assert.deepEqual(captures.map(capture => capture.stamp.revision), [3, 6, 7]);
  assert.deepEqual(captures.map(capture => capture.observedAtMs), [716, 1692, 2479]);
  assert.equal(captures[2].text, ' I am confused about grants and loans');
  assert.equal(captures[2].triggerBasis, 'reserved_quiet_gap');
  assert.equal(captures[2].quietAgeMs, 350);
  assert.equal(captures[2].complete, false);
  assert.deepEqual(completions[2], { at: 2782, fresh: true });
  assert.equal(logs.filter(row => row.type === 'early_observation_started').at(-1).triggerBasis, 'reserved_quiet_gap');
  projector.close();
});

test('continuous new words retain the final request until a quiet gap without delaying the first two', async () => {
  const h = setup();
  h.send(delta('u1', 'I do not understand this process.', 0));
  await advanceTo(h.time, 160);
  h.send(delta('u2', ' Please explain more.', 160));
  await advanceTo(h.time, 320);
  assert.deepEqual(h.captures.map(capture => capture.observedAtMs), [160, 320]);
  for (let index = 0; index < 8; index++) {
    await advanceTo(h.time, 400 + index * 100);
    h.send(delta(`later${index}`, ' more', h.time.now()));
    assert.equal(h.captures.length, 2);
  }
  await advanceTo(h.time, 1449); assert.equal(h.captures.length, 2);
  await advanceTo(h.time, 1450);
  assert.equal(h.captures.length, 3); assert.equal(h.captures[2].quietAgeMs, 350);
  assert.equal(h.captures[2].stamp.revision, 10);
  h.projector.close();
});

for (const [language, correction, ending] of [
  ['en', ' Actually, no, I', ' understand now.'],
  ['es', ' En realidad, no, ya', ' entiendo ahora.'],
]) {
  test(`${language}: a correction resets the reserved pause and is preserved without claiming completion`, async () => {
    const h = setup(language);
    h.send(delta('u1', language === 'en' ? 'I do not understand this process.' : 'No entiendo esta parte del proceso.', 0));
    await advanceTo(h.time, 160);
    h.send(delta('u2', language === 'en' ? ' Please explain more.' : ' Explícame un poco más.', 160));
    await advanceTo(h.time, 320);
    h.send(delta('u3', correction, 320));
    const incomplete = h.projector.stamp();
    await advanceTo(h.time, 600); h.send(delta('u4', ending, 600));
    await advanceTo(h.time, 949); assert.equal(h.captures.length, 2);
    await advanceTo(h.time, 950);
    assert.equal(h.captures.length, 3);
    assert.ok(h.captures[2].text.endsWith(correction + ending));
    assert.equal(sameEarlyEvidenceStamp(incomplete, h.captures[2].stamp), false);
    assert.equal(h.captures[2].complete, false); assert.equal(h.captures[2].provisional, true);
    // A further correction also revokes this exact evidence revision. Semantic
    // readiness/confidence remain the evaluator's independent responsibility.
    h.send(delta('u5', language === 'en' ? ' Wait, I meant' : ' Espera, quería decir', 951));
    assert.equal(sameEarlyEvidenceStamp(h.captures[2].stamp, h.projector.stamp()), false);
    await advanceTo(h.time, 2000); assert.equal(h.captures.length, 3);
    h.projector.close();
  });
}

test('one in-flight evaluation coalesces to latest material growth and respects both request limits', async () => {
  const time = clock(), captures = [], pending = [];
  const projector = createEarlyProjector(seed, value => { captures.push(value); return new Promise(resolve => pending.push(resolve)); },
    () => {}, { ...time, maxPerContribution: 3, maxPerCall: 4 });
  let text = 'I do not understand this process.';
  projector.receive(delta('n1', text, 0)); time.advance(160); await immediate();
  for (let index = 2; index <= 6; index++) { text += ' Please explain more.'; projector.receive(delta(`n${index}`, ' Please explain more.', time.now())); }
  time.advance(1000); await immediate(); assert.equal(captures.length, 1); assert.equal(time.count(), 0);
  pending.shift()(); await immediate(); time.advance(160); await immediate();
  assert.equal(captures.length, 2); assert.equal(captures[1].text, text); assert.equal(captures[1].stamp.revision, 6);
  text += ' And try another example.'; projector.receive(delta('n7', ' And try another example.', time.now()));
  pending.shift()(); await immediate(); time.advance(350); await immediate();
  assert.equal(captures.length, 3);
  text += ' Please explain the next part.'; projector.receive(delta('n8', ' Please explain the next part.', time.now()));
  pending.shift()(); await immediate(); time.advance(1000); await immediate(); assert.equal(captures.length, 3);
  projector.receive(boundary(text, time.now()));
  projector.receive(delta('next1', 'I am still confused about this.', time.now())); time.advance(160); await immediate();
  assert.equal(captures.length, 4); pending.shift()(); await immediate();
  projector.receive(delta('next2', ' Please explain it in another way.', time.now())); time.advance(500); await immediate();
  assert.equal(captures.length, 4); projector.close();
});

test('a finished application span cancels queued partial inference and retains separate boundary provenance', async () => {
  const h = setup(), text = 'I do not understand this at all.';
  h.send(delta('u1', text, 0)); h.send(boundary(text, 80)); h.time.advance(160); await immediate();
  assert.equal(h.captures.length, 0);
  assert.equal(h.projector.snapshot().recentDialogue[0].complete, true);
  assert.equal(h.projector.snapshot().complete, false, 'partial capture contract never changes to fake provider finality');
  h.send(delta('u2', 'Please give me one simple example.', 160)); h.time.advance(160); await immediate();
  assert.equal(h.captures[0].stamp.contributionId, 'u2'); assert.equal(h.captures[0].stamp.revision, 1); h.projector.close();
});

test('an ambiguous application boundary invalidates attribution without claiming those words belong to this student', () => {
  const tracker = createEarlyEvidenceTracker(seed);
  tracker.receive(delta('u1', 'My new question.', 0)); const previous = tracker.stamp();
  tracker.receive(boundary('Old buffered words. My new question.', 100));
  assert.equal(tracker.snapshot().usable, false); assert.equal(tracker.snapshot().recentDialogue.length, 0);
  assert.equal(sameEarlyEvidenceStamp(previous, tracker.stamp()), false);
  tracker.receive(delta('u2', 'I need a simpler example now.', 200)); assert.equal(tracker.snapshot().usable, true);
});

test('assistant partial and completed text are context evidence, never evidence of playback completion', () => {
  const tracker = createEarlyEvidenceTracker(seed);
  tracker.receive(delta('u1', 'Please explain the difference to me.', 0));
  tracker.receive(delta('a1', 'A grant usually does not need repayment.', 200, 'assistant'));
  const partial = tracker.snapshot();
  assert.equal(partial.assistantOutputStartedForContribution, true); assert.equal(partial.assistantOutputRevision, 1);
  assert.equal(partial.recentDialogue[0].complete, false); assert.equal(partial.recentDialogue[0].source, 'native_transcript');
  assert.equal(Object.hasOwn(partial, 'playbackComplete'), false);
  tracker.receive(boundary('A grant usually does not need repayment.', 800, 'assistant'));
  assert.equal(tracker.snapshot().recentDialogue[0].source, 'application_estimate');
});

test('evidence limits fail closed rather than silently dropping a potentially important correction', () => {
  const tracker = createEarlyEvidenceTracker(seed);
  tracker.receive(delta('u1', 'x'.repeat(EARLY_EVIDENCE_LIMITS.textBytes), 0));
  tracker.receive(delta('u2', ' Actually no.', 100));
  assert.equal(tracker.snapshot().stopped, true); assert.equal(tracker.snapshot().reason, 'caller_evidence_overflow');
});

test('oversized classification context is retained as evidence but never sliced or submitted', async () => {
  const h = setup();
  const text = 'Please help me understand this process. ' + 'detail '.repeat(600);
  assert.ok(Buffer.byteLength(text) > EARLY_EVIDENCE_LIMITS.classificationBytes);
  assert.ok(Buffer.byteLength(text) < EARLY_EVIDENCE_LIMITS.textBytes);
  h.send(delta('u1', text, 0)); h.time.advance(200); await immediate();
  assert.equal(h.captures.length, 0); assert.equal(h.projector.status().evaluated, 0);
  assert.equal(h.projector.snapshot().text, text); assert.equal(h.projector.snapshot().usable, true);
  h.projector.close();
});

test('closing a projector cancels pending work and rejected observations are logged without escaping to Live', async () => {
  const h = setup(); h.send(delta('u1', 'I do not understand this at all.', 0)); h.projector.close();
  h.time.advance(200); await immediate(); assert.equal(h.captures.length, 0);
  const time = clock(), logs = [];
  const projector = createEarlyProjector(seed, () => { throw new TypeError('do not log private exception payload'); }, row => logs.push(row), time);
  projector.receive(delta('u1', 'I need help understanding this form.', 0)); time.advance(160); await immediate();
  assert.equal(logs.find(row => row.type === 'early_observation_failed').reason, 'TypeError');
  assert.equal(projector.status().inFlight, false); projector.close();
});

test('meaningful input accepts short clear bilingual confusion while rejecting unfinished names and acknowledgments', () => {
  for (const value of ['No entiendo', 'Estoy confundida', "I'm confused", 'No lo entiendo', 'No me queda claro', 'I am confused', 'I do not understand', '¿Qué significa esto?']) {
    assert.equal(meaningfulEarlyEvidence(value), true, value);
  }
  for (const value of ['Aiden', 'Okay.', 'Sí.', 'And the', 'No', 'I am']) assert.equal(meaningfulEarlyEvidence(value), false, value);
});

for (const language of ['en', 'es']) {
  test(`${language}: distributed checks refill on later meaningful contributions without polling or spending on acknowledgments`, async () => {
    const h = setup(language, { distributed: true, maxPerContribution: 2, maxPerCall: 16 });
    const text = language === 'en' ? 'Please help me understand the college application.' : 'No entiendo cómo empezar la solicitud universitaria.';
    for (let index = 0; index < 4; index++) {
      const at = h.time.now();
      h.send(delta(`u${index}`, text, at)); await advanceTo(h.time, at + 350);
      h.send(boundary(text, h.time.now(), 'user', `boundary${index}`));
    }
    assert.equal(h.captures.length, 3);
    assert.ok(h.logs.some(row => row.reason === 'distributed_budget_reserved_for_later'));
    assert.equal(h.time.count(), 0, 'no refill polling while caller is idle');
    await advanceTo(h.time, 30000); assert.equal(h.captures.length, 3);
    const ack = language === 'en' ? 'Okay.' : 'Sí.';
    h.send(delta('ack', ack, h.time.now())); await advanceTo(h.time, 31000);
    h.send(boundary(ack, h.time.now(), 'user', 'ack-boundary'));
    assert.equal(h.captures.length, 3);
    h.send(delta('later-need', text, h.time.now())); await advanceTo(h.time, 31350);
    assert.equal(h.captures.length, 4);
    h.projector.close();
  });
}

test('distributed mode retains a matched boundary but never waits for it or treats it as provider finality', async () => {
  const h = setup('en', { distributed: true }); const text = 'Please explain how a college application works.';
  h.send(delta('u', text, 0)); h.send(boundary(text, 80)); await advanceTo(h.time, 350);
  assert.equal(h.captures.length, 1); assert.equal(h.captures[0].inputOpen, false);
  assert.equal(h.captures[0].complete, false); assert.equal(h.captures[0].provisional, true);
  h.projector.close();
});

test('late experiment reclassifies fresh post-output evidence only when independently allowed', async () => {
  let ready = false;
  const h = setup('en', { distributed: true, maxPerContribution: 2, lateAllowed: () => ready });
  const text = 'Please explain how a college application works.';
  h.send(delta('u', text, 0)); await advanceTo(h.time, 350);
  h.send(boundary(text, 400));
  h.send(delta('a', 'Let us take this one step at a time.', 500, 'assistant'));
  await advanceTo(h.time, 1500); assert.equal(h.captures.length, 1);
  h.send(boundary('Let us take this one step at a time.', 1500, 'assistant'));
  ready = true; h.send({ source: 'playback', event: { type: 'playback', idle: true }, atMs: 1500 });
  await advanceTo(h.time, 1500);
  assert.equal(h.captures.length, 2); assert.equal(h.captures[1].triggerBasis, 'settled_late_experiment');
  assert.equal(h.captures[1].assistantOutputRevision, 1);
  h.projector.close();
});

test('earlier explanation evidence survives the short dialogue window and clears on scope change', () => {
  const tracker = createEarlyEvidenceTracker(seed, { allowedStudentIds: ['aiden', 'elodie'] });
  for (let index = 0; index < 14; index++) {
    const role = index % 2 ? 'assistant' : 'user';
    const text = index === 1 ? 'A seminar is a small discussion class.' : `The campus activity number ${index} is over.`;
    tracker.receive(delta(`n${index}`, text, index * 100, role));
    tracker.receive(boundary(text, index * 100 + 50, role, `b${index}`));
  }
  tracker.receive(delta('new', 'I still do not understand seminars.', 1500));
  // Lexical retrieval is deliberately conservative: use an exact concept term.
  tracker.receive(delta('more', ' What is a seminar?', 1600));
  assert.ok(tracker.snapshot().explanationHistory.rows.some(row => row.text.includes('small discussion')));
  assert.equal(tracker.snapshot().explanationHistory.comprehension, 'unknown');
  tracker.receive({ source: 'scope', event: { type: 'scope_changed', studentId: 'elodie', language: 'es' } });
  assert.equal(tracker.snapshot().explanationHistory.rows.length, 0);
});
