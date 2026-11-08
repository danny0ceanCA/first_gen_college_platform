import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTestTurnMayStart } from './validation-quiet-window.mjs';

test('a resumed answer during the synthetic caller pause prevents the next question', () => {
  const base = { now: 7000, notBefore: 7000, since: 0,
    playback: [{ at: 2000, rms: .02 }],
    events: [{ type: 'session.output_transcript.delta', delta: 'Let me clarify.', at: 1800 }] };
  assert.equal(nextTestTurnMayStart(base), true);
  const resumed = { ...base, playback: [...base.playback, { at: 6900, rms: .02 }],
    events: [...base.events, { type: 'session.output_transcript.delta', delta: 'The answer is', at: 6800 }] };
  assert.equal(nextTestTurnMayStart(resumed), false);
  assert.equal(nextTestTurnMayStart({ ...resumed, now: 9000 }), true);
});
test('fresh transcript, missing audio evidence, and the minimum caller pause all prevent advancement', () => {
  const base = { now: 8000, notBefore: 7000, since: 0, playback: [{ at: 2000, rms: .02 }],
    events: [{ type: 'session.output_transcript.delta', delta: 'More context.', at: 7500 }] };
  assert.equal(nextTestTurnMayStart(base), false);
  assert.equal(nextTestTurnMayStart({ ...base, now: 10000, playback: [] }), false);
  assert.equal(nextTestTurnMayStart({ ...base, now: 10000, notBefore: 11000 }), false);
  assert.equal(nextTestTurnMayStart({ ...base, now: 10000 }), true);
});
