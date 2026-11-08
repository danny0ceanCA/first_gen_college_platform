// Test-driver pacing only. This is an observed quiet interval, not proof of
// semantic completion; it never controls or delays the actual voice model.
export function nextTestTurnMayStart({ now, notBefore, since, playback, events, quietMs = 2000 }) {
  if (![now, notBefore, since, quietMs].every(Number.isFinite) || quietMs < 0 || now < notBefore) return false;
  const audio = playback.filter(row => Number.isFinite(row.at) && row.at >= since && row.rms > .004);
  const text = events.filter(row => row.type === 'session.output_transcript.delta' && row.delta
    && Number.isFinite(row.at) && row.at >= since);
  if (!audio.length || !text.length) return false;
  const lastObserved = Math.max(...audio.map(row => row.at), ...text.map(row => row.at));
  return lastObserved <= now && now - lastObserved >= quietMs;
}
