// Validation only. Keep provider transcript timing, browser playback activity,
// and prerecorded caller injection separate; none proves comprehension or cause.
export function turnDeliveryEvidence(turn, { nextInputStartedAt = Infinity, events = [], playback = [] } = {}) {
  const start = turn.startedAt, end = turn.inputEndedAt;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw Error('invalid_caller_audio_window');
  const inTurn = event => Number.isFinite(event.at) && event.at >= start && event.at < nextInputStartedAt;
  const inputs = events.filter(event => event.type === 'session.input_transcript.delta' && inTurn(event));
  const outputs = events.filter(event => event.type === 'session.output_transcript.delta' && inTurn(event));
  const spans = inputs.filter(event => Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms) && event.end_ms >= event.start_ms);
  const inputSpan = spans.length ? { startMs: Math.min(...spans.map(event => event.start_ms)),
    endMs: Math.max(...spans.map(event => event.end_ms)), sourceEventIds: spans.map(event => event.event_id) } : null;
  const intersecting = inputSpan ? outputs.filter(event => Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms)
    && event.start_ms < inputSpan.endMs && event.end_ms > inputSpan.startMs) : [];
  const hot = playback.filter(value => inTurn(value) && Number.isFinite(value.rms) && value.rms > .004).sort((a,b) => a.at-b.at);
  const during = hot.filter(value => value.at < end);
  const before = outputs.filter(event => event.at < end);
  return {
    callerInjectionWindow: { startedAt: start, endedAt: end, durationMs: end-start },
    nativeCallerTranscriptSpan: inputSpan,
    fullTurnOutputTranscript: outputs.map(event => event.delta ?? '').join(''),
    nativeOutputIntersectingCallerTranscript: { text: intersecting.map(event => event.delta ?? '').join(''),
      events: intersecting.map(event => ({ eventId: event.event_id, startMs: event.start_ms, endMs: event.end_ms, text: event.delta })) },
    outputReceivedDuringCallerInjection: { text: before.map(event => event.delta ?? '').join(''), eventIds: before.map(event => event.event_id) },
    browserPlaybackDuringCallerInjection: { active: during.length > 0, sampleCount: during.length,
      firstAt: during[0]?.at ?? null, lastAt: during.at(-1)?.at ?? null },
    firstPlaybackFromCallerEndMs: hot.length ? hot[0].at-end : null,
    firstOutputReceiptFromCallerEndMs: outputs.length ? outputs[0].at-end : null,
    timingInterpretation: during.length ? 'playback_started_before_caller_audio_ended_not_response_latency' : 'first_playback_activity_after_caller_audio_ended',
    evidenceLimit: 'Provider transcript intervals, wall-clock receipt, and browser playback are separate evidence. Caller injection includes recorded silence. Overlap does not identify cause, intelligibility, or whether an interjection was appropriate.',
  };
}
