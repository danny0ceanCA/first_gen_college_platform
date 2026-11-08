// Authored fictional measurement fixtures. These labels test evidence accounting,
// not classifier accuracy, real playback, or human comprehension.
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};
const lines = {
  en: { need: 'I do not understand what office hours are.',
    answer: 'Office hours are time a teacher sets aside for your questions. You can bring one confusing homework question.',
    clear: 'Now I understand: I can take one homework question to my teacher during that time.',
    unclear: 'I still do not understand whether I need to make an appointment.', acknowledgment: 'Okay.' },
  es: { need: 'No entiendo qué son las horas de consulta.',
    answer: 'Son un horario que tu profesora reserva para tus preguntas. Puedes llevar una duda de la tarea.',
    clear: 'Ahora entiendo: puedo llevar una duda de la tarea a mi profesora durante ese horario.',
    unclear: 'Todavía no entiendo si debo hacer una cita.', acknowledgment: 'Está bien.' },
};

export function makeOutcomeFixture(language = 'en', scenario = 'ack_only') {
  const id = `outcome-${language}-${scenario}`, words = lines[language];
  const scope = { callId: id + '-call', studentId: 'fictional-student', language, connectionEpoch: 0, scopeEpoch: 0 };
  const row = (suffix, role, text, startMs, endMs) => ({ id: id + '-' + suffix, role, text, startMs, endMs,
    complete: true, source: 'application_estimate', scope, sourceEventIds: [id + '-native-' + suffix] });
  const need = row('need', 'user', words.need, 100, 900);
  const answer = row('answer', 'assistant', words.answer, 1400, 5000);
  const caller = row('caller', 'user', scenario === 'caller_unclear' ? words.unclear
    : scenario === 'caller_acknowledgment' ? words.acknowledgment : words.clear, 5500, 7000);
  const cue = { id: id + '-cue', eventId: id + '-append', sent: true, timelineMs: 1000, scope, sourceEventIds: need.sourceEventIds };
  const review = (dimension, label, target) => ({ id: id + '-' + dimension, cueId: cue.id, dimension, label,
    reviewed: true, method: 'fixture_label', reviewerId: 'fictional-fixture-author', scope,
    rowId: target.id, sourceEventIds: target.sourceEventIds, quote: target.text,
    ...(dimension === 'caller_clarity' ? { basis: label === 'acknowledgment_only' ? 'acknowledgment' : 'explicit_self_report' } : {}) });
  const input = { cue, turns: [need], contextAcknowledgments: [{ type: 'session.thinking.appended',
    event_id: id + '-provider-ack', client_event_id: cue.eventId, start_ms: 1050, end_ms: 1200, scope }],
  playback: [], evaluations: [], allowFixtureLabels: true };
  const expected = { receipt: 'acknowledged', adaptation: 'unknown', playback: 'unknown', callerClarity: 'unknown' };
  if (scenario !== 'ack_only') {
    input.turns.push(answer); input.evaluations.push(review('assistant_adaptation', 'adapted', answer));
    expected.adaptation = 'observed';
  }
  if (scenario === 'activity_only') {
    input.playback.push({ id: id + '-rms', kind: 'audio_activity', startMs: 1500, endMs: 5100, scope,
      outputSourceEventIds: answer.sourceEventIds }); expected.playback = 'activity_only';
  }
  if (['played_and_reported_clear', 'caller_unclear', 'caller_acknowledgment'].includes(scenario)) {
    input.turns.push(caller);
    input.evaluations.push(review('caller_clarity', scenario === 'caller_unclear' ? 'reported_unclear'
      : scenario === 'caller_acknowledgment' ? 'acknowledgment_only' : 'reported_clear', caller));
    input.playback.push({ id: id + '-playback', kind: 'client_playback', status: 'completed', coverage: 'complete',
      muted: false, dropped: false, startMs: 1500, endMs: 5100, scope, outputSourceEventIds: answer.sourceEventIds });
    expected.playback = 'confirmed';
    expected.callerClarity = scenario === 'caller_unclear' ? 'reported_unclear'
      : scenario === 'caller_acknowledgment' ? 'unknown' : 'reported_clear';
  }
  return { id, language, scenario, input, expected };
}

export const outcomeFixtures = freeze(['en', 'es'].flatMap(language => [
  'ack_only', 'transcript_only', 'activity_only', 'played_and_reported_clear', 'caller_unclear', 'caller_acknowledgment',
].map(scenario => makeOutcomeFixture(language, scenario))));
