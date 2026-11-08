import { preferenceFixtureSnapshot } from './preference-fixtures.mjs';

// Authored fictional text cases. Expected labels never enter provider input.
const assistant = text => ({ role: 'assistant', text });
const pair = (id, en, es, expected) => ['en', 'es'].map(language => ({
  id: `${language}-conversation-${id}`, language,
  expected: { confusion: 'none', continuation: 'none', ...expected },
  turns: (language === 'en' ? en : es).map((turn, index) => ({
    id: `turn-${index + 1}`, role: turn.role ?? 'user', text: turn.text ?? turn,
    complete: turn.complete !== false, startMs: index * 5000, endMs: index * 5000 + 3000, connectionEpoch: 0,
  })),
}));
export const continuationFixtures = Object.freeze([
  ...pair('confused', [assistant('Office hours are times set aside to meet your instructor.'), 'I still do not understand what office hours means. Can you say it more simply?'],
    [assistant('Las horas de consulta son momentos reservados para reunirte con tu profesor.'), 'Todavía no entiendo qué significa horas de consulta. ¿Puedes decirlo más sencillo?'],
    { confusion: 'needs_simpler_explanation' }),
  ...pair('jargon', [assistant('The prerequisite needs to be satisfied before enrollment.'), 'You lost me at prerequisite. What does that word mean?'],
    [assistant('El prerrequisito debe cumplirse antes de inscribirte.'), 'Me perdí con prerrequisito. ¿Qué significa esa palabra?'],
    { confusion: 'needs_simpler_explanation' }),
  ...pair('resolved', ['I do not understand what orientation is.', assistant('It is a welcome event that helps you get to know the college.'), 'Now I understand. It is a welcome event to help me get started.'],
    ['No entiendo qué es la orientación.', assistant('Es un evento de bienvenida que te ayuda a conocer la universidad.'), 'Ahora sí entiendo. Es una bienvenida para ayudarme a empezar.'],
    { confusion: 'resolved' }),
  ...pair('topic-change', ['I do not understand the aid letter.', assistant('We can go through the aid letter together.'), 'Let us leave the aid letter for later. I want to talk about choosing a major now.'],
    ['No entiendo la carta de ayuda.', assistant('Podemos revisar juntos la carta de ayuda.'), 'Dejemos la carta para después. Ahora quiero hablar de cómo elegir una carrera.'],
    { confusion: 'topic_changed' }),
  ...pair('ordinary-ack', [assistant('Your professor usually lists office hours on the course page.'), 'Okay.'],
    [assistant('Tu profesor suele indicar sus horas de consulta en la página del curso.'), 'Está bien.'], {}),
  ...pair('accept-example', [assistant('Would you like an example of how to introduce yourself to your professor?'), 'Sure.'],
    [assistant('¿Quieres un ejemplo de cómo presentarte a tu profesor?'), 'Claro.'],
    { continuation: 'accepted_conversational_offer' }),
  ...pair('accept-next-step', [assistant('Would you like to talk through the next step for preparing for orientation?'), 'Yes, please.'],
    [assistant('¿Quieres que conversemos sobre el siguiente paso para prepararte para la orientación?'), 'Sí, por favor.'],
    { continuation: 'accepted_conversational_offer' }),
  ...pair('decline', [assistant('Would an example of a personal statement help?'), 'No thanks, I do not want an example.'],
    [assistant('¿Te ayudaría un ejemplo de una declaración personal?'), 'No gracias, no quiero un ejemplo.'],
    { continuation: 'declined' }),
  ...pair('unfinished', [assistant('Would you like a simpler example?'), { text: 'Yes, but I—', complete: false }],
    [assistant('¿Quieres un ejemplo más sencillo?'), { text: 'Sí, pero yo—', complete: false }],
    { confusion: 'unclear', continuation: 'unclear' }),
  ...pair('standalone-okay', ['Okay.'], ['Está bien.'], {}),
  ...pair('research-offer', [assistant('Should I look up the current tuition on the college website?'), 'Yes, please.'],
    [assistant('¿Quieres que busque la matrícula actual en la página de la universidad?'), 'Sí, por favor.'], {}),
  ...pair('save-offer', [assistant('Should I save this plan to your student record?'), 'Sure.'],
    [assistant('¿Quieres que guarde este plan en tu expediente?'), 'Claro.'], {}),
  ...pair('quoted', [assistant('Would you like an example for your essay?'), 'My essay quotes a student saying, "I do not understand; yes, please explain." That is a quotation, not my answer to your offer.'],
    [assistant('¿Quieres un ejemplo para tu ensayo?'), 'Mi ensayo cita a alguien que dice: "No entiendo; sí, explícame". Es una cita, no mi respuesta a tu propuesta.'], {}),
  ...pair('older-offer', [assistant('Would you like an example of a recommendation letter?'), 'Sure.', assistant('A teacher could describe how you helped classmates.'), 'Who can write that letter?'],
    [assistant('¿Quieres un ejemplo de una carta de recomendación?'), 'Claro.', assistant('Un profesor podría describir cómo ayudaste a tus compañeros.'), '¿Quién puede escribir esa carta?'], {}),
  ...pair('already-answered', [assistant('Would you like an example of what to say to a counselor?'), 'Yes.', assistant('You could say: I am new to college and need help choosing my first classes.')],
    [assistant('¿Quieres un ejemplo de qué decirle a un consejero?'), 'Sí.', assistant('Podrías decir: soy nuevo en la universidad y necesito ayuda para elegir mis primeras clases.')],
    { continuation: 'accepted_conversational_offer' }),
  ...pair('followup-question', [assistant('You can bring a family member to many campus visits.'), 'Can my grandmother come along too?'],
    [assistant('En muchas visitas al campus puedes llevar a un familiar.'), '¿También puede venir mi abuela?'], {}),
]);

// Extra chronology regressions stay outside the default paid 32-case suite.
// The separately authorized fixed --refine suite explicitly selects them.
export const continuationContextFixtures = Object.freeze([
  ...pair('repeated-ack', [assistant('Would you like an example of introducing yourself?'), 'Okay.', 'Yes, please.'],
    [assistant('¿Quieres un ejemplo de cómo presentarte?'), 'Claro.', 'Sí, por favor.'],
    { continuation: 'accepted_conversational_offer' }),
  ...pair('changed-question-then-ack', [assistant('Would you like an example of introducing yourself?'), 'What is the deadline for applying?', 'Okay.'],
    [assistant('¿Quieres un ejemplo de cómo presentarte?'), '¿Cuál es la fecha límite para solicitar ingreso?', 'Claro.'], {}),
].map(fixture => ({ ...fixture, turns: fixture.turns.map((turn, index) => ({
  ...turn, startMs: index * 1000, endMs: index * 1000 + 400,
})) })));

export function continuationFixtureSnapshot(fixture) {
  return { ...preferenceFixtureSnapshot(fixture), accountId: 'fictional-conversation-account', studentId: 'fictional-conversation-student' };
}
