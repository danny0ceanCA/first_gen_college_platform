import test from 'node:test';
import assert from 'node:assert/strict';
import { createEarlyEvidenceTracker } from './early-projector.mjs';
import { matchEarlyCapture, withEarlyNeedContext } from './early-need-context.mjs';

function fixture() {
  const tracker = createEarlyEvidenceTracker({ fictional: true, callId: 'fictional', studentId: 'student', language: 'es' });
  const receive = (id, text, role = 'input', time = 100) => tracker.receive({ source: 'native', atMs: time,
    event: { type: `session.${role}_transcript.delta`, event_id: id, delta: text, start_ms: time, end_ms: time + 10 } });
  receive('one', 'No entiendo la inscripción.');
  const old = tracker.snapshot();
  const record = { sourceText: old.text, sourceEventIds: old.sourceEventIds };
  return { tracker, receive, old, record };
}
test('retained prefix preserves original exact evidence but never claims latest meaning', () => {
  const f = fixture();
  assert.equal(matchEarlyCapture(f.tracker.snapshot(), f.old.stamp, f.record).exact, true);
  f.receive('two', ' Mi familia ha estado', 'input', 120);
  const captured = matchEarlyCapture(f.tracker.snapshot(), f.old.stamp, f.record);
  assert.equal(captured.exact, false); assert.equal(captured.sourceText, f.old.text);
  f.receive('three', ' intentando comprenderla.', 'input', 150);
  assert.deepEqual(matchEarlyCapture(f.tracker.snapshot(), f.old.stamp, f.record).sourceEventIds, ['one']);
  for (const record of [{ ...f.record, sourceText: 'fabricated' }, { ...f.record, sourceEventIds: ['other'] },
    { ...f.record, sourceEventIds: ['one', 'two'] }]) assert.equal(matchEarlyCapture(f.tracker.snapshot(), f.old.stamp, record), null);
  assert.equal(matchEarlyCapture(f.tracker.snapshot(), { ...f.old.stamp, scopeEpoch: 1 }, f.record), null);
});
test('assistant evidence excludes everything before need origin and makes no playback claim', () => {
  const f = fixture(); f.receive('out-before', 'Hola.', 'output', 120);
  const support = { originOutputRevision: f.tracker.snapshot().assistantOutputRevision };
  f.receive('out-after', 'Puedes comenzar ', 'output', 200);
  f.receive('out-later', 'con una clase.', 'output', 240);
  const enriched = withEarlyNeedContext(f.tracker.snapshot(), support, 3);
  assert.equal(enriched.assistantSinceNeed.text, 'Puedes comenzar con una clase.');
  assert.deepEqual(enriched.assistantSinceNeed.sourceEventIds, ['out-after', 'out-later']);
  assert.equal(enriched.assistantSinceNeed.playbackClaim, false); assert.equal(enriched.supportRevision, 3);
  const firstNeed = withEarlyNeedContext({ ...f.tracker.snapshot(), contributionOutputOriginRevision: 0 }, null);
  assert.equal(firstNeed.assistantSinceNeed.text, 'Hola.Puedes comenzar con una clase.');
});

test('new caller need observes output during classification without an earlier support record', () => {
  const snapshot = { contributionOutputOriginRevision: 5, assistantOutputRevision: 7,
    assistantOutputStartedForContribution: true, assistantEvidence: [
      { revision: 5, text: 'Earlier explanation.', sourceEventId: 'before' },
      { revision: 6, text: 'A new example ', sourceEventId: 'after-one' },
      { revision: 7, text: 'for your latest question.', sourceEventId: 'after-two' },
    ] };
  const first = withEarlyNeedContext(snapshot, null);
  assert.equal(first.assistantSinceNeed.text, 'A new example for your latest question.');
  assert.equal(first.assistantSinceNeed.evidenceComplete, true);
  assert.equal(first.assistantSinceNeed.originOutputRevision, 5);
  const followup = withEarlyNeedContext(snapshot, { originOutputRevision: 2 });
  assert.deepEqual(followup.assistantSinceNeed, first.assistantSinceNeed);
});

test('missing or future output origin cannot claim no output after the caller began', () => {
  assert.equal(withEarlyNeedContext({ assistantOutputRevision: 7,
    assistantOutputStartedForContribution: true }, null).assistantSinceNeed.evidenceComplete, false);
  assert.equal(withEarlyNeedContext({ assistantOutputRevision: 7, contributionOutputOriginRevision: 8,
    assistantEvidence: [] }, null).assistantSinceNeed.evidenceComplete, false);
});
test('missing output interval is unknown, never an already-addressed assertion', () => {
  const snapshot = { assistantOutputRevision: 3, assistantEvidence: [{ revision: 3, text: 'tail', sourceEventId: 'tail' }] };
  const enriched = withEarlyNeedContext(snapshot, { originOutputRevision: 0 }, 1);
  assert.equal(enriched.assistantSinceNeed.evidenceComplete, false);
  assert.equal(enriched.assistantSinceNeed.text, ''); assert.deepEqual(enriched.assistantSinceNeed.sourceEventIds, []);
  assert.equal(withEarlyNeedContext({ assistantOutputRevision: 3, assistantEvidence: [] }, { originOutputRevision: 0 }).assistantSinceNeed.evidenceComplete, false);
});

test('late reclassification includes the full post-caller output even after a deferred cue created a later anchor', () => {
  const snapshot = { triggerBasis: 'settled_late_experiment', contributionOutputOriginRevision: 4,
    assistantOutputRevision: 6, assistantEvidence: [
      { revision: 5, text: 'An initial thought. ', sourceEventId: 'first' },
      { revision: 6, text: 'And its continuation.', sourceEventId: 'second' },
    ] };
  const context = withEarlyNeedContext(snapshot, { originOutputRevision: 5 });
  assert.equal(context.assistantSinceNeed.evidenceComplete, true);
  assert.equal(context.assistantSinceNeed.originOutputRevision, 4);
  assert.deepEqual(context.assistantSinceNeed.sourceEventIds, ['first', 'second']);
});
