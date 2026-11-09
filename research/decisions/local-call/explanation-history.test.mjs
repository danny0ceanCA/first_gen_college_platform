import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplanationHistory, explanationHistoryInput, fitExplanationHistoryBudget, EXPLANATION_HISTORY_LIMITS } from './explanation-history.mjs';

const row = (id, role, text) => ({ id, role, text, complete: true, source: 'application_estimate',
  sourceEventIds: [`native-${id}`], startMs: 10, endMs: 20 });

test('raw explanation attempts and caller reactions stay distinct from understanding and playback', () => {
  for (const [question, answer, reaction] of [
    ['What is a grant?', 'A grant usually does not have to be repaid.', 'Okay.'],
    ['¿Qué es una beca?', 'Una beca generalmente no se devuelve.', 'Sí.'],
  ]) {
    const history = createExplanationHistory();
    history.append(row('question', 'user', question)); history.append(row('answer', 'assistant', answer));
    history.append(row('reaction', 'user', reaction));
    const input = explanationHistoryInput(history.snapshot({ currentText: question }));
    assert.deepEqual(input.rows.map(item => item.text), [question, answer, reaction]);
    assert.equal(input.comprehension, 'unknown'); assert.equal(input.playback, 'unknown');
    assert.match(input.interpretation, /bare okay\/sí is not proof/);
    assert.deepEqual(input.rows[1].sourceEventIds, ['native-answer']);
  }
});

test('earlier relevant explanation survives short recent history without dropping caller corrections', () => {
  const history = createExplanationHistory();
  history.append(row('old-question', 'user', 'How do grants work?'));
  history.append(row('old-answer', 'assistant', 'Grants are aid that generally is not repaid.'));
  history.append(row('old-reaction', 'user', 'I need an example, not that definition again.'));
  for (let i = 0; i < 12; i++) history.append(row(`other-${i}`, i % 2 ? 'assistant' : 'user', `Tell me about campus housing ${i}.`));
  const snapshot = history.snapshot({ currentText: 'I still do not understand grants.' });
  assert.ok(snapshot.rows.some(item => item.id === 'old-answer'));
  assert.ok(snapshot.rows.some(item => item.id === 'old-reaction'));
  assert.ok(snapshot.rows.some(item => item.id === 'other-11'));
  assert.equal(snapshot.selectionTruncated, true); assert.ok(snapshot.omittedRows > 0);
  assert.ok(snapshot.rows.length <= EXPLANATION_HISTORY_LIMITS.selectedRows);
});

test('full text is never cut at a misleading prefix, and oversized omissions stay explicit', () => {
  const history = createExplanationHistory({ limits: { rowBytes: 500, bytes: 2000, selectedBytes: 1600 } });
  const text = 'Some context. '.repeat(20) + 'Actually, I still do not understand.';
  history.append(row('full', 'user', text));
  assert.equal(history.snapshot().rows[0].text, text);
  assert.equal(history.append(row('too-big', 'assistant', 'x'.repeat(501))), false);
  const snapshot = history.snapshot();
  assert.equal(snapshot.omittedRows, 1); assert.equal(snapshot.selectionTruncated, true);
  assert.equal(snapshot.comprehension, 'unknown');
});

test('recorded and selected history have independent hard bounds and return defensive copies', () => {
  const history = createExplanationHistory();
  for (let i = 0; i < 60; i++) history.append(row(String(i), i % 2 ? 'user' : 'assistant', `Evidence ${i}. `.repeat(80)));
  const first = history.snapshot({ currentText: 'Evidence' });
  assert.ok(first.retainedRows <= EXPLANATION_HISTORY_LIMITS.rows);
  assert.ok(Buffer.byteLength(JSON.stringify(first.rows)) <= EXPLANATION_HISTORY_LIMITS.selectedBytes);
  first.rows[0].text = 'rewritten'; first.rows[0].sourceEventIds.push('fabricated');
  const second = history.snapshot({ currentText: 'Evidence' });
  assert.notEqual(second.rows[0].text, 'rewritten');
  assert.ok(!second.rows[0].sourceEventIds.includes('fabricated'));
  history.clear(); assert.equal(history.snapshot().rows.length, 0); assert.equal(history.snapshot().omittedRows, 0);
});

test('duplicates do not create repeated attempts; conflicting identity closes only optional history', () => {
  const history = createExplanationHistory(), first = row('one', 'user', 'I understand the map now.');
  assert.equal(history.append(first), true); assert.equal(history.append(first), false);
  assert.equal(history.snapshot().rows.length, 1);
  assert.equal(history.append({ ...first, text: 'I do not understand the map.' }), false);
  assert.equal(history.snapshot().unavailable, true); assert.deepEqual(history.snapshot().rows, []);
  assert.equal(explanationHistoryInput(history.snapshot()), null);
  history.clear(); assert.equal(history.append(first), true);
});

test('malformed or fabricated history cannot claim confirmation or enter classifier evidence', () => {
  const history = createExplanationHistory(); history.append(row('one', 'user', 'Yes, the map makes sense now.'));
  const valid = history.snapshot();
  assert.equal(explanationHistoryInput({ ...valid, comprehension: 'confirmed' }).comprehension, 'unknown');
  for (const change of [value => value.rows[0].sourceEventIds = [], value => value.rows[0].complete = false,
    value => value.rows[0].text = 'x'.repeat(8193), value => value.rows.push(value.rows[0])]) {
    const invalid = structuredClone(valid); change(invalid); assert.equal(explanationHistoryInput(invalid), null);
  }
});

test('exchange evidence distinguishes an attempted definition from the caller reaction without inventing comprehension', () => {
  for (const [question, definition, reaction] of [
    ['What does a minor mean?', 'A minor is a smaller second field of study.', 'Can you show me an example instead?'],
    ['¿Qué significa una especialidad secundaria?', 'Es otra área de estudio más pequeña.', '¿Me puedes mostrar un ejemplo mejor?'],
  ]) {
    const history = createExplanationHistory();
    history.append(row('question', 'user', question)); history.append(row('definition', 'assistant', definition));
    history.append(row('reaction', 'user', reaction));
    const input = explanationHistoryInput(history.snapshot({ currentText: reaction }));
    assert.deepEqual(input.exchanges, [{ assistantRowId: 'definition', callerBeforeRowId: 'question', callerAfterRowId: 'reaction' }]);
    assert.equal(input.comprehension, 'unknown'); assert.equal(input.playback, 'unknown');
    assert.equal(Object.hasOwn(input.exchanges[0], 'understood'), false);
    history.clear(); history.append(row('new-scope', 'user', 'New student.'));
    assert.equal(history.snapshot().rows[0].evidenceSequence, 0);
    assert.deepEqual(explanationHistoryInput(history.snapshot()).exchanges, []);
  }
});

test('separately selected historical rows never create a false adjacent exchange', () => {
  const history = createExplanationHistory();
  history.append(row('old-question', 'user', 'What are course credits?'));
  history.append(row('old-answer', 'assistant', 'Credits show how much a class counts.'));
  for (let index = 0; index < 12; index++) history.append(row(`middle-${index}`, 'user', `A separate topic ${index}.`));
  history.append(row('new-reaction', 'user', 'Yes, I understand the apartment rules now.'));
  const snapshot = history.snapshot();
  snapshot.rows = [history.snapshot({ currentText: 'course credits' }).rows.find(value => value.id === 'old-answer'), snapshot.rows.at(-1)];
  const input = explanationHistoryInput(snapshot);
  assert.deepEqual(input.exchanges, [{ assistantRowId: 'old-answer', callerBeforeRowId: null, callerAfterRowId: null }]);
  const legacy = structuredClone(snapshot); legacy.rows.forEach(value => { delete value.evidenceSequence; });
  assert.deepEqual(explanationHistoryInput(legacy).exchanges, [], 'unproven row order cannot create exchanges');
});

test('an omitted oversized correction breaks adjacency without inventing its content', () => {
  for (const [question, correction, answer] of [
    ['Explain grants.', 'Actually, I meant student housing, not grants. ', 'Here is an example.'],
    ['Explica las becas.', 'En realidad hablaba del alojamiento, no de las becas. ', 'Aquí tienes un ejemplo.'],
  ]) {
    const history = createExplanationHistory({ limits: { rowBytes: 64 } });
    history.append(row('question', 'user', question));
    assert.equal(history.append(row('correction', 'user', correction.repeat(3))), false);
    history.append(row('answer', 'assistant', answer));
    const snapshot = history.snapshot(), input = explanationHistoryInput(snapshot);
    assert.deepEqual(snapshot.rows.map(value => value.evidenceSequence), [0, 2]);
    assert.equal(snapshot.omittedRows, 1); assert.equal(snapshot.selectionTruncated, true);
    assert.deepEqual(input.exchanges, [{ assistantRowId: 'answer', callerBeforeRowId: null, callerAfterRowId: null }]);
    assert.equal(input.rows.some(value => value.id === 'correction'), false);
    assert.equal(input.comprehension, 'unknown');
  }
});

test('a fragmented row beyond the source-event limit breaks reaction adjacency', () => {
  const history = createExplanationHistory({ limits: { sourceEvents: 2 } });
  history.append(row('answer', 'assistant', 'A grant is a type of aid.'));
  const omitted = { ...row('correction', 'user', 'No, I meant the housing deposit.'), sourceEventIds: ['part-1', 'part-2', 'part-3'] };
  assert.equal(history.append(omitted), false);
  history.append(row('reaction', 'user', 'Okay.'));
  const input = explanationHistoryInput(history.snapshot());
  assert.deepEqual(input.rows.map(value => value.evidenceSequence), [0, 2]);
  assert.deepEqual(input.exchanges, [{ assistantRowId: 'answer', callerBeforeRowId: null, callerAfterRowId: null }]);
});

test('exact duplicate observations do not introduce artificial gaps between genuine contributions', () => {
  const history = createExplanationHistory(), question = row('question', 'user', 'Explain grants.');
  history.append(question);
  assert.equal(history.append(structuredClone(question)), false);
  assert.equal(history.append(structuredClone(question)), false);
  history.append(row('answer', 'assistant', 'Here is an example.'));
  const snapshot = history.snapshot(), input = explanationHistoryInput(snapshot);
  assert.deepEqual(snapshot.rows.map(value => value.evidenceSequence), [0, 1]);
  assert.equal(snapshot.omittedRows, 0);
  assert.deepEqual(input.exchanges, [{ assistantRowId: 'answer', callerBeforeRowId: 'question', callerAfterRowId: null }]);
});

test('composed request fitting omits whole optional evidence and preserves latest correction', () => {
  const history = createExplanationHistory();
  history.append(row('question', 'user', 'What is an academic advisor?'));
  history.append(row('answer', 'assistant', 'A long historical explanation. '.repeat(40)));
  history.append(row('reaction', 'user', 'I still need a concrete example.'));
  const evidence = { currentContribution: { text: 'Actually, explain the school counselor instead.' },
    explanationHistory: explanationHistoryInput(history.snapshot()) };
  const request = { model: 'gpt-6-luna', input: JSON.stringify(evidence), questions: [] };
  fitExplanationHistoryBudget(request, 1500);
  const fitted = JSON.parse(request.input), retained = new Set(fitted.explanationHistory.rows.map(value => value.id));
  assert.equal(fitted.currentContribution.text, evidence.currentContribution.text);
  assert.equal(fitted.explanationHistory.selectionTruncated, true);
  assert.ok(fitted.explanationHistory.omittedRows > 0);
  assert.ok(fitted.explanationHistory.exchanges.every(exchange => retained.has(exchange.assistantRowId)
    && (!exchange.callerBeforeRowId || retained.has(exchange.callerBeforeRowId))
    && (!exchange.callerAfterRowId || retained.has(exchange.callerAfterRowId))));
  assert.throws(() => fitExplanationHistoryBudget({ model: 'gpt-6-luna', input: JSON.stringify({ currentContribution: { text: 'x'.repeat(2000) } }), questions: [] }, 1500), /request_too_large/);
});
