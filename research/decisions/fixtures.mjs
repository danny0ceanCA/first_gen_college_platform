// Fictional observer fixtures only. Expected labels and split assignments are
// evaluation metadata: never include them in a provider request.
const turn = (role, text, complete = true) => ({ role, text, complete });
const user = (text, complete = true) => turn('user', text, complete);
const assistant = (text, complete = true) => turn('assistant', text, complete);
const expected = (supportNeed, alreadyAddressed = false) => ({ supportNeed, alreadyAddressed });

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function fixture({ id, language, role = 'student', split, turns, ...details }) {
  const transcripts = turns.map((entry, index) => ({
    id: `${id}-turn-${index + 1}`,
    ...entry,
    startMs: index * 6_000,
    endMs: index * 6_000 + 4_000,
  }));
  return freeze({
    id, language, role, split, transcripts,
    question: transcripts.findLast((entry) => entry.role === 'user').text,
    ...details,
  });
}

// Fixed before any model calls: 18 calibration cases and 18 holdout cases.
// Languages and family/student roles do not determine the expected support need.
export const fixtures = freeze([
  fixture({
    id: 'en-exploration-start', language: 'en', role: 'family', split: 'calibration',
    turns: [user('My daughter Mira is curious about college. Could you help us figure out where to begin?')],
    expected: expected('starting_point'),
  }),
  fixture({
    id: 'en-application-simplify', language: 'en', split: 'calibration',
    turns: [user('The application says prerequisite. Can you explain that in simpler words?')],
    expected: expected('simpler_explanation'),
  }),
  fixture({
    id: 'en-office-next', language: 'en', split: 'calibration',
    turns: [
      user('The admissions office emailed me asking for my transcript.'),
      assistant('They are asking for your school record of classes and grades.'),
      user('What should I do next to get it to them?'),
    ],
    expected: expected('next_step'),
  }),
  fixture({
    id: 'en-paying-factual', language: 'en', split: 'calibration',
    turns: [user('What is the published tuition for fictional Cedar College for 2027?')],
    expected: expected('none'),
  }),
  fixture({
    id: 'en-brief-ack', language: 'en', split: 'calibration',
    turns: [
      user('Could you explain what a grant means in simple words?'),
      assistant('A grant is money for school that usually does not need to be paid back, as long as you meet its conditions.'),
      user('Okay, thanks.'),
    ],
    expected: expected('none'),
  }),
  fixture({
    id: 'en-interrupted-request', language: 'en', split: 'calibration',
    turns: [user('Could you help me with the, um—', false)],
    expected: expected('unclear'),
  }),
  fixture({
    id: 'en-changed-question', language: 'en', split: 'holdout',
    turns: [
      user('Could you help me decide where to begin with housing?'),
      user('Actually, just tell me whether fictional Cedar College lists an application fee for housing.'),
    ],
    expected: expected('none'),
  }),
  fixture({
    id: 'en-quoted-request', language: 'en', split: 'holdout',
    turns: [user('My friend said, "Please tell me where to begin with college." I am quoting her for my essay, not asking for a plan for myself.')],
    expected: expected('none'),
  }),
  fixture({
    id: 'en-declined-help', language: 'en', split: 'holdout',
    turns: [
      assistant('Would a small first step help?'),
      user('No, please do not give me a plan right now. I only want to talk about how the visit felt.'),
    ],
    expected: expected('none'),
    opportunities: [{ id: 'en-declined-plan', kind: 'starting_point', status: 'declined' }],
  }),
  fixture({
    id: 'en-start-already-addressed', language: 'en', role: 'family', split: 'calibration',
    turns: [
      user('Our son Leo is interested in college. Can you help us choose a first step?'),
      assistant('A good first step is to ask Leo what he wants from college: something he wants to learn, a career he is curious about, or an experience he wants to try. You can start with just one of those.'),
    ],
    expected: expected('starting_point', true),
    opportunities: [{ id: 'en-first-step-given', kind: 'starting_point', status: 'addressed' }],
  }),
  fixture({
    id: 'en-incomplete-next', language: 'en', split: 'holdout',
    turns: [user('Can you tell me the next step after I—', false)],
    expected: expected('unclear'),
  }),
  fixture({
    id: 'en-research-mid-explanation', language: 'en', split: 'holdout',
    turns: [
      user('What does fictional Cedar College charge for housing?'),
      assistant('I can check the published housing costs.'),
      user('While that is being checked, can you explain in simple words why a housing deposit is different from rent?'),
      assistant('A deposit is—', false),
    ],
    expected: expected('simpler_explanation'),
    researchFindings: [{ id: 'fictional-en-housing', jobId: 'fictional-en-job', revision: 1, fact: 'The fictional source lists a housing deposit separately from monthly rent.', year: '2027', scenario: 'Synthetic campus housing example', limitation: 'Fictional test evidence; no actual prices or campus policy.', sourceIds: ['fictional-en-source'] }],
  }),
  fixture({
    id: 'en-adult-learner-start', language: 'en', split: 'holdout',
    turns: [user('I am Rowan. I work evenings and want to return to school. Could you help me find a manageable place to start?')],
    expected: expected('starting_point'),
  }),
  fixture({
    id: 'en-campus-support-next', language: 'en', split: 'holdout',
    turns: [
      user('I found the student support office email address.'),
      assistant('That gives you a way to reach them.'),
      user('Could you help me choose what to do next to ask about tutoring?'),
    ],
    expected: expected('next_step'),
  }),

  fixture({
    id: 'es-exploration-start', language: 'es', role: 'family', split: 'holdout',
    turns: [user('Mi hijo Tomás tiene interés en la universidad. ¿Nos ayudas a saber por dónde empezar?')],
    expected: expected('starting_point'),
  }),
  fixture({
    id: 'es-application-simplify', language: 'es', split: 'calibration',
    turns: [user('En la solicitud dice requisito previo. ¿Me lo explicas con palabras más sencillas?')],
    expected: expected('simpler_explanation'),
  }),
  fixture({
    id: 'es-office-next', language: 'es', split: 'holdout',
    turns: [
      user('La oficina de admisiones me pidió mi historial escolar por correo.'),
      assistant('Se refieren al registro de tus clases y calificaciones.'),
      user('¿Me ayudas a elegir el siguiente paso para enviarlo?'),
    ],
    expected: expected('next_step'),
  }),
  fixture({
    id: 'es-paying-factual', language: 'es', split: 'calibration',
    turns: [user('¿Cuál es la matrícula publicada de la universidad ficticia Monte Claro para 2027?')],
    expected: expected('none'),
  }),
  fixture({
    id: 'es-brief-ack', language: 'es', split: 'holdout',
    turns: [
      user('¿Puedes explicar de forma sencilla qué es una beca?'),
      assistant('Es dinero para estudiar que normalmente no se devuelve, siempre que cumplas sus condiciones.'),
      user('Sí, gracias.'),
    ],
    expected: expected('none'),
  }),
  fixture({
    id: 'es-interrupted-request', language: 'es', split: 'holdout',
    turns: [user('¿Me puedes ayudar con lo de, este—', false)],
    expected: expected('unclear'),
  }),
  fixture({
    id: 'es-changed-question', language: 'es', split: 'calibration',
    turns: [
      user('¿Me orientas para empezar con las solicitudes?'),
      user('Mejor, por ahora solo dime la fecha de cierre publicada para la universidad ficticia Monte Claro.'),
    ],
    expected: expected('none'),
  }),
  fixture({
    id: 'es-quoted-request', language: 'es', split: 'calibration',
    turns: [user('Mi prima escribió: "Ayúdame a saber por dónde empezar". Es una cita de su historia; yo no estoy pidiendo que me hagas un plan.')],
    expected: expected('none'),
  }),
  fixture({
    id: 'es-declined-help', language: 'es', role: 'family', split: 'calibration',
    turns: [
      assistant('¿Les serviría escoger un primer paso?'),
      user('No, gracias. Ahora no queremos pasos ni consejos, solo conversar sobre la visita.'),
    ],
    expected: expected('none'),
    opportunities: [{ id: 'es-declined-plan', kind: 'starting_point', status: 'declined' }],
  }),
  fixture({
    id: 'es-start-already-addressed', language: 'es', role: 'family', split: 'holdout',
    turns: [
      user('Nuestra hija Sol quiere estudiar. ¿Nos ayudas con un primer paso?'),
      assistant('Pueden empezar preguntándole a Sol qué le gustaría aprender o qué tipo de trabajo le da curiosidad. Basta elegir una cosa para comenzar.'),
    ],
    expected: expected('starting_point', true),
    opportunities: [{ id: 'es-first-step-given', kind: 'starting_point', status: 'addressed' }],
  }),
  fixture({
    id: 'es-incomplete-next', language: 'es', split: 'calibration',
    turns: [user('¿Cuál sería el siguiente paso después de que yo—', false)],
    expected: expected('unclear'),
  }),
  fixture({
    id: 'es-research-mid-explanation', language: 'es', split: 'holdout',
    turns: [
      user('¿Cuánto cuesta vivir en la universidad ficticia Monte Claro?'),
      assistant('Puedo revisar los costos publicados.'),
      user('Mientras revisas, ¿puedes explicarme de forma sencilla la diferencia entre un depósito y la renta?'),
      assistant('El depósito es—', false),
    ],
    expected: expected('simpler_explanation'),
    researchFindings: [{ id: 'fictional-es-housing', jobId: 'fictional-es-job', revision: 1, fact: 'La fuente ficticia separa el depósito de vivienda de la renta mensual.', year: '2027', scenario: 'Ejemplo ficticio de vivienda universitaria', limitation: 'Evidencia sintética; no describe precios ni reglas reales.', sourceIds: ['fictional-es-source'] }],
  }),
  fixture({
    id: 'es-adult-learner-start', language: 'es', split: 'calibration',
    turns: [user('Soy Inés. Trabajo por las tardes y quiero volver a estudiar. ¿Me ayudas a encontrar un punto de partida que sea manejable?')],
    expected: expected('starting_point'),
  }),
  fixture({
    id: 'es-campus-support-next', language: 'es', split: 'holdout',
    turns: [
      user('Ya encontré el correo de la oficina de apoyo estudiantil.'),
      assistant('Ya tienes una forma de comunicarte con ellos.'),
      user('¿Me ayudas a decidir el siguiente paso para pedir tutorías?'),
    ],
    expected: expected('next_step'),
  }),

  fixture({
    id: 'mixed-paying-simplify', language: 'mixed', split: 'calibration',
    turns: [user('Can you explain "satisfactory academic progress" con palabras más sencillas? I want to understand that phrase.')],
    expected: expected('simpler_explanation'),
  }),
  fixture({
    id: 'mixed-demographics-not-request', language: 'mixed', split: 'calibration',
    turns: [user('Soy primera generación en mi familia, and I like art. I am just telling you a little about myself.')],
    expected: expected('none'),
  }),
  fixture({
    id: 'mixed-family-next', language: 'mixed', role: 'family', split: 'calibration',
    turns: [
      user('La oficina nos mandó una lista de documentos para Niko.'),
      assistant('They sent you a document checklist.'),
      user('What should we do next para organizar lo que tenemos?'),
    ],
    expected: expected('next_step'),
  }),
  fixture({
    id: 'mixed-brief-ack', language: 'mixed', split: 'holdout',
    turns: [
      assistant('You can ask the office whether the form arrived. Puedes preguntar si ya lo recibieron.'),
      user('Okay, sí, gracias.'),
    ],
    expected: expected('none'),
  }),
  fixture({
    id: 'mixed-declined-after-request', language: 'mixed', split: 'holdout',
    turns: [
      user('Help me choose a first step para empezar la universidad.'),
      user('Actually, no advice right now. Solo quiero contar lo que pasó.'),
    ],
    expected: expected('none'),
    opportunities: [{ id: 'mixed-declined-plan', kind: 'starting_point', status: 'declined' }],
  }),
  fixture({
    id: 'mixed-explanation-already-addressed', language: 'mixed', split: 'calibration',
    turns: [
      user('What does office hours mean? ¿Puedes explicarlo más sencillo?'),
      assistant('It is time a teacher sets aside to meet with students. Puedes ir para hacer preguntas sobre la clase; no necesitas tener un problema grande.'),
    ],
    expected: expected('simpler_explanation', true),
    opportunities: [{ id: 'mixed-explanation-given', kind: 'simpler_explanation', status: 'addressed' }],
  }),
  fixture({
    id: 'mixed-interrupted-question', language: 'mixed', split: 'holdout',
    turns: [user('Can you help me decidir si debo, um—', false)],
    expected: expected('unclear'),
  }),
  fixture({
    id: 'mixed-earlier-help-new-fact', language: 'mixed', split: 'holdout',
    turns: [
      user('Antes pregunté por dónde empezar and you already helped me make a first step. Now, what is the published application deadline for fictional Riverstone University?'),
    ],
    expected: expected('none'),
  }),
]);
