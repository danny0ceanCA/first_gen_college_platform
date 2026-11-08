// Fictional text-only cases; labels are kept outside the classifier input.
const pair = (id, en, es, expected, options = {}) => ['en', 'es'].map(language => ({
  id: `${language}-preference-${id}`, language, expected: { plain_language: 'unchanged', one_step_at_a_time: 'unchanged', ...expected },
  turns: (language === 'en' ? en : es).map((turn, index) => ({
    id: `turn-${index + 1}`, role: turn.role ?? 'user', text: turn.text ?? turn, complete: turn.complete !== false,
    startMs: index * 5000, endMs: index * 5000 + 3000, connectionEpoch: 0,
  })), ...options,
}));
export const preferenceFixtures = Object.freeze([
  ...pair('plain', ['From now on, please use everyday words whenever we talk about college.'],
    ['De ahora en adelante, usa palabras cotidianas siempre que hablemos de la universidad.'], { plain_language: 'enable' }),
  ...pair('pacing', ['For the rest of this call, please guide me one manageable step at a time.'],
    ['Durante el resto de esta llamada, guíame con un solo paso manejable a la vez.'], { one_step_at_a_time: 'enable' }),
  ...pair('both', ['As we keep talking, I prefer plain language and one idea at a time.'],
    ['Mientras seguimos conversando, prefiero palabras sencillas y una idea a la vez.'], { plain_language: 'enable', one_step_at_a_time: 'enable' }),
  ...pair('general-preference', ['I generally prefer everyday language when we talk about college.'],
    ['En general prefiero palabras cotidianas cuando hablamos de la universidad.'], { plain_language: 'enable' }),
  ...pair('retract-plain', ['From now on, stop simplifying the wording for me; use the normal technical language again.'],
    ['De ahora en adelante, deja de simplificar las palabras para mí; vuelve a usar el lenguaje técnico habitual.'], { plain_language: 'disable' }),
  ...pair('retract-pacing', ['For the rest of our conversation, no need to take one step at a time. Give me the whole set of steps together.'],
    ['Para el resto de la conversación, ya no hace falta ir paso a paso. Dame todos los pasos juntos.'], { one_step_at_a_time: 'disable' }),
  ...pair('reset', ['Please drop my earlier requests for simpler words and one step at a time. From now on, use your normal conversation style.'],
    ['Deja mis peticiones anteriores de palabras sencillas y un paso a la vez. De ahora en adelante, usa tu estilo normal de conversación.'], { plain_language: 'disable', one_step_at_a_time: 'disable' }),
  ...pair('one-off-definition', ['Could you explain what a syllabus means in simpler words?'],
    ['¿Puedes explicar qué significa un programa de curso con palabras más sencillas?'], {}),
  ...pair('one-off-step', ['What is the next step to submit my application?'],
    ['¿Cuál es el siguiente paso para enviar mi solicitud?'], {}),
  ...pair('demographics', ['I am first in my family to attend college and I feel nervous about orientation.'],
    ['Soy la primera persona de mi familia en ir a la universidad y me pone nerviosa la orientación.'], {}),
  ...pair('quoted', ['For my essay, I am quoting: "Always use simple language and one idea at a time." That is just the quote, not a request about our conversation.'],
    ['En mi ensayo cito: "Usa siempre palabras sencillas y una idea a la vez". Es solo una cita, no una petición sobre nuestra conversación.'], {}),
  ...pair('older-request', [
    'From now on, please use plain language.', { role: 'assistant', text: 'Of course. We can take this at your pace.' }, 'What is orientation?',
  ], [
    'De ahora en adelante, usa palabras sencillas.', { role: 'assistant', text: 'Claro. Podemos ir a tu ritmo.' }, '¿Qué es la orientación?',
  ], {}),
  ...pair('assistant-started', [
    'For the rest of this call, please use everyday words.', { role: 'assistant', text: 'A syllabus is the guide for a class.' },
  ], [
    'Para el resto de esta llamada, usa palabras cotidianas.', { role: 'assistant', text: 'El programa de curso es la guía de una clase.' },
  ], { plain_language: 'enable' }),
  ...pair('unfinished', [{ text: 'From now on, could you always—', complete: false }],
    [{ text: 'De ahora en adelante, ¿podrías siempre—', complete: false }], {}),
  ...pair('topic-only', ['For this explanation of housing costs, just give me one simple idea at a time.'],
    ['Para esta explicación de costos de vivienda, dame solo una idea sencilla a la vez.'], {}),
  ...pair('assistant-suggestion', [
    { role: 'assistant', text: 'I can use simple words and one step at a time for the rest of our talk.' }, 'What does financial aid mean?',
  ], [
    { role: 'assistant', text: 'Puedo usar palabras sencillas e ir paso a paso durante toda la conversación.' }, '¿Qué significa ayuda financiera?',
  ], {}),
]);

export function preferenceFixtureSnapshot(fixture) {
  return { fictional: true, isolatedLocal: true, dataKind: 'fictional', authorized: true, closed: false,
    accountId: 'fictional-preference-account', callId: fixture.id, studentId: 'fictional-preference-student',
    permissionRevision: 0, connectionEpoch: 0, scopeEpoch: 0, questionRevision: 1, inputRevision: 1,
    language: fixture.language, role: 'student', brief: null,
    currentQuestion: { text: [...fixture.turns].reverse().find(turn => turn.role === 'user')?.text ?? '' },
    recentTranscripts: structuredClone(fixture.turns), researchFindings: [], researchTasks: [], opportunities: [],
    connectionGaps: [], playbackEvidence: [], contextAcknowledgments: [],
  };
}
