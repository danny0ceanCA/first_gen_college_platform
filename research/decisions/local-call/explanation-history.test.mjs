import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplanationHistory, explanationHistoryInput, EXPLANATION_HISTORY_LIMITS } from './explanation-history.mjs';

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
