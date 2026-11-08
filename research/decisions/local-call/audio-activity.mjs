// This local wrapper receives reflected sideband audio: mono PCM16LE/24kHz.
// Transport frames continue through silence. Do not mistake all-zero PCM for
// speech; unknown/malformed audio remains activity, never evidence of silence.
export function silentSidebandAudio(event) {
  if (event?.type !== 'session.output_audio.delta' || typeof event.delta !== 'string'
    || !event.delta.length || event.delta.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.delta)) return false;
  const bytes = Buffer.from(event.delta, 'base64');
  return bytes.length > 0 && bytes.length % 2 === 0 && bytes.toString('base64') === event.delta
    && bytes.every(value => value === 0);
}
