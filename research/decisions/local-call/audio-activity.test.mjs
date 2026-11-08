import test from 'node:test';
import assert from 'node:assert/strict';
import { silentSidebandAudio } from './audio-activity.mjs';

const audio = bytes => ({ type: 'session.output_audio.delta', delta: Buffer.from(bytes).toString('base64'), start_ms: 0, end_ms: 20 });

test('only nonempty complete PCM16 samples containing exact zero are silent transport frames', () => {
  for (const length of [2, 4, 6, 960, 1920]) {
    assert.equal(silentSidebandAudio(audio(Buffer.alloc(length))), true, `zero PCM bytes: ${length}`);
  }
});

test('even the smallest nonzero sample remains audio activity rather than guessed silence', () => {
  for (const bytes of [[1, 0], [0, 1], [255, 255], [0, 128], [0, 0, 1, 0], [0, 0, 0, 1]]) {
    assert.equal(silentSidebandAudio(audio(bytes)), false, String(bytes));
  }
  const long = Buffer.alloc(1920); long[1919] = 1;
  assert.equal(silentSidebandAudio(audio(long)), false);
});

test('empty, partial samples, absent payloads and unrelated events are not silence evidence', () => {
  for (const event of [null, {}, { type: 'session.output_audio.delta' },
    { type: 'session.output_audio.delta', delta: '' }, { type: 'session.output_audio.delta', delta: Buffer.alloc(2) },
    audio([0]), audio([0, 0, 0]), { ...audio([0, 0]), type: 'session.input_audio.append' },
    { ...audio([0, 0]), type: 'session.output_transcript.delta' }]) {
    assert.equal(silentSidebandAudio(event), false);
  }
});

test('malformed base64 remains activity including encodings with noncanonical discarded padding bits', () => {
  for (const delta of ['AAA', 'AAA=\n', ' AAA=', 'AA*A', '=AAA', 'A===', '====', 'AAA===', 'AAB=', 'AAC=', 'AAD=', 'AA-A', 'AA_A']) {
    assert.equal(silentSidebandAudio({ type: 'session.output_audio.delta', delta }), false, delta);
  }
});

test('classification does not mutate payloads or manufacture browser playback evidence', () => {
  const event = Object.freeze(audio([0, 0]));
  assert.equal(silentSidebandAudio(event), true);
  assert.deepEqual(Object.keys(event).sort(), ['delta', 'end_ms', 'start_ms', 'type']);
  assert.equal('idle' in event, false);
});
