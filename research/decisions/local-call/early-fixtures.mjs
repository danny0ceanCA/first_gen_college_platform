import { EARLY_PREDICATES, parseEarlyResponse } from './early-rubric.mjs';

const expectation = action => ({ action, eligible: ['simplify', 'example', 'starting_point', 'continue_simplifying'].includes(action),
  clearSupport: action === 'clear' });
const support = (sourceText, kind = 'simpler_explanation', status = 'validated') => ({
  sourceText, kind, status, supportRevision: 1, originOutputRevision: 0,
});

export const earlyFixtures = [
  ['en-confusion', 'en', 'I do not understand what an academic advisor does.', 'simplify', true],
  ['es-confusion', 'es', 'No entiendo qué hace un asesor académico.', 'simplify', true],
  ['en-partial', 'en', 'I do not understand whether', 'unclear', false],
  ['es-partial', 'es', 'No entiendo si', 'unclear', false],
  ['en-followup', 'en', 'So would my family have to pay that loan back later?', 'continue_simplifying', true, 'I do not understand which financial aid I would need to repay.'],
  ['es-followup', 'es', 'Entonces, ¿mi familia tendría que devolver ese préstamo después?', 'continue_simplifying', true, 'No entiendo qué ayuda financiera tendría que devolver.'],
  ['en-resolved', 'en', 'That makes sense now. I understand the difference.', 'clear', true, 'I am confused about grants and loans.'],
  ['es-resolved', 'es', 'Ahora sí entiendo la diferencia.', 'clear', true, 'Me confunden las becas y los préstamos.'],
  ['en-changed', 'en', 'Let us change topics. How can Aiden explore different majors?', 'clear', true, 'I do not understand the college housing options.'],
  ['es-changed', 'es', 'Cambiemos de tema. ¿Cómo puede Aiden explorar diferentes carreras?', 'clear', true, 'No entiendo las opciones de alojamiento universitario.'],
  ['en-ordinary', 'en', 'What is the current application deadline at Berkeley?', 'none', true],
  ['es-ordinary', 'es', '¿Cuál es la fecha límite actual para solicitar admisión a Berkeley?', 'none', true],
  ['en-quoted', 'en', 'My friend said she was confused about college. I understand my own next step.', 'none', true],
  ['es-quoted', 'es', 'Mi amiga dijo que estaba confundida sobre la universidad. Yo entiendo mi siguiente paso.', 'none', true],
  ['en-correction', 'en', 'I was confused about grants. Actually, I understand them now; that question is settled.', 'clear', true, 'I am confused about grants.'],
  ['es-correction', 'es', 'Me confundían las becas. En realidad ya las entiendo; esa duda está resuelta.', 'clear', true, 'Me confunden las becas.'],
].map(([id, language, text, action, _ready, sourceText]) => ({ id, expected: expectation(action), snapshot: {
  provisional: true, complete: false, language, text, recentDialogue: [],
  ...(sourceText ? { activeSupport: support(sourceText) } : {}),
} }));

// Focused follow-up to the first real audio trace. These are authored tests,
// not holdout examples; the unfinished elaboration and correction differ.
export const earlyPartialFixtures = [
  ['en-complete-clause', 'en', 'I am confused about grants and loans', 'simplify', true],
  ['es-complete-clause', 'es', 'Me confunden las becas y los préstamos', 'simplify', true],
  ['en-elaboration', 'en', 'I am confused about grants and loans. I have been', 'simplify', true],
  ['es-elaboration', 'es', 'Me confunden las becas y los préstamos. He estado', 'simplify', true],
  ['en-unfinished-correction', 'en', 'I am confused about grants and loans. Actually, what I mean is', 'unclear', false],
  ['es-unfinished-correction', 'es', 'Me confunden las becas y los préstamos. En realidad, lo que quiero decir es', 'unclear', false],
  ['en-unfinished-object', 'en', 'I am confused about grants and', 'unclear', false],
  ['es-unfinished-object', 'es', 'Me confunden las becas y', 'unclear', false],
].map(([id, language, text, action]) => ({ id, expected: expectation(action), snapshot: {
  provisional: true, complete: false, language, text, recentDialogue: [],
} }));

// Development cases for independent evidence and output suppression. These are
// deliberately separate from the authored holdout owned by another reviewer.
export const earlyIndependentFixtures = [
  ['en-example', 'en', 'Could you give me an example of a college prerequisite?', 'example'],
  ['es-example', 'es', '¿Me das un ejemplo de un requisito previo de la universidad?', 'example'],
  ['en-start', 'en', 'I do not know where to begin with choosing classes. What is one small first step?', 'starting_point'],
  ['es-start', 'es', 'No sé por dónde empezar a escoger las clases. ¿Cuál sería un primer paso pequeño?', 'starting_point'],
  ['en-background', 'en', 'I need a simpler explanation of credit hours. My counselor has been', 'simplify'],
  ['es-background', 'es', 'Necesito una explicación más sencilla de los créditos. Mi consejero ha estado', 'simplify'],
  ['en-retract', 'en', 'Never mind, I do not need an example after all.', 'clear', { activeSupport: support('Can you give me an example of a prerequisite?', 'concrete_example') }],
  ['es-retract', 'es', 'Déjalo, ya no necesito un ejemplo.', 'clear', { activeSupport: support('¿Me das un ejemplo de un requisito previo?', 'concrete_example') }],
  ['en-correct', 'en', 'I do not understand credit hours. Actually, what I meant was', 'unclear'],
  ['es-correct', 'es', 'No entiendo los créditos. En realidad, lo que quería decir era', 'unclear'],
  ['en-new-need', 'en', 'I understand the credits now. For housing, could you give me a concrete example of a shared room?', 'example', { activeSupport: support('I do not understand credit hours.') }],
  ['es-new-need', 'es', 'Ya entiendo los créditos. Sobre el alojamiento, ¿me das un ejemplo concreto de un cuarto compartido?', 'example', { activeSupport: support('No entiendo los créditos.') }],
].map(([id, language, text, action, extras = {}]) => ({ id, expected: expectation(action), snapshot: {
  provisional: true, complete: false, language, text, recentDialogue: [], ...extras,
} }));

const assistant = text => ({ text, sourceEventIds: ['fictional-output-1'], revision: 1, playbackClaim: false });
earlyIndependentFixtures.push(...[
  ['en-addressed', 'en', 'Can you give me an example of a prerequisite?', 'A prerequisite is a class you take first. For example, you take Algebra 1 before Algebra 2.', false],
  ['es-addressed', 'es', '¿Me das un ejemplo de un requisito previo?', 'Un requisito previo es una clase que cursas primero. Por ejemplo, cursas Álgebra 1 antes de Álgebra 2.', false],
  ['en-renewed', 'en', 'I still do not understand prerequisites. Can you give me a different example?', 'A prerequisite is a class you take first. For example, you take Algebra 1 before Algebra 2.', true],
  ['es-renewed', 'es', 'Todavía no entiendo los requisitos previos. ¿Me das un ejemplo distinto?', 'Un requisito previo es una clase que cursas primero. Por ejemplo, cursas Álgebra 1 antes de Álgebra 2.', true],
].map(([id, language, text, output, renewed]) => ({ id,
  expected: { action: renewed ? 'example' : 'none', eligible: renewed, clearSupport: !renewed },
  snapshot: { provisional: true, complete: false, language, text, recentDialogue: [],
    activeSupport: support(language === 'es' ? 'No entiendo los requisitos previos.' : 'I do not understand prerequisites.', 'concrete_example'),
    assistantSinceNeed: assistant(output) } })));

// Synthetic typed responses for offline policy/controller tests, never a model
// substitute in live validation. Helpers keep all tests on the current schema.
export function earlyResponseFixture({ need = 'simplify', change = 'unchanged_or_background', addressed = 0,
  needProbability = .99, changeProbability = .99, facts: overrides = {} } = {}) {
  const facts = Object.fromEntries(EARLY_PREDICATES.map(name => [name, 0]));
  const needName = { simplify: 'simplify_requested', example: 'example_requested', starting_point: 'starting_point_requested',
    related_followup: 'related_followup', incomplete: 'need_subject_incomplete' }[need];
  const changeName = { resolved: 'need_resolved_or_left', retracted: 'need_resolved_or_left', topic_changed: 'need_resolved_or_left',
    resolved_or_left: 'need_resolved_or_left', correction_pending: 'correction_pending', revised_need: 'need_revised' }[change];
  if (needName) facts[needName] = needProbability;
  if (changeName) facts[changeName] = changeProbability;
  facts.already_addressed = addressed;
  Object.assign(facts, overrides);
  return { answers: EARLY_PREDICATES.map(name => facts[name] === null ? { name, type: 'refusal' }
    : { name, type: 'predicate', probability: facts[name] }) };
}

export function earlyResultFixture(options = {}, snapshot = {}) {
  return parseEarlyResponse(earlyResponseFixture(options), snapshot).result;
}
