// New fictional holdout. Keep labels outside requests and freeze this file's
// hash before a provider run. Passing parser tests is not classifier accuracy.
import { createExplanationHistory } from './local-call/explanation-history.mjs';

const pairs = [
  { id: 'illustrate-definition', need: 'concrete_example', en: {
    before: [['assistant', 'A prerequisite is something you complete before taking a class.']],
    text: 'Could you show me what that would look like with actual classes?' }, es: {
    before: [['assistant', 'Un requisito previo es algo que completas antes de tomar una materia.']],
    text: '¿Me muestras cómo sería eso con materias concretas?' } },
  { id: 'lost-without-question', need: 'simpler_explanation', en: {
    before: [['assistant', 'Your program has required courses and electives.']],
    text: 'You lost me at electives. I cannot tell what that word means here.' }, es: {
    before: [['assistant', 'Tu programa tiene materias obligatorias y optativas.']],
    text: 'Me perdí con lo de optativas. No me queda claro qué significa aquí.' } },
  { id: 'first-step-without-question', need: 'starting_point', en: {
    before: [['assistant', 'There are several ways to explore college before applying.']],
    text: 'I have never done any of this and do not know where to begin.' }, es: {
    before: [['assistant', 'Hay varias maneras de conocer las opciones universitarias antes de solicitar admisión.']],
    text: 'Nunca he hecho nada de esto y no sé por dónde comenzar.' } },
  { id: 'ordinary-detail', need: 'none', en: {
    before: [['assistant', 'An orientation visit can help you learn where things are on campus.']],
    text: 'Can my little brother come along to the visit?' }, es: {
    before: [['assistant', 'Una visita de orientación puede ayudarte a conocer los lugares del campus.']],
    text: '¿Mi hermano menor puede acompañarme a la visita?' } },
  { id: 'different-example', need: 'concrete_example', en: {
    before: [['user', 'What is a syllabus?'], ['assistant', 'Think of it as the roadmap for a class.'],
      ['user', 'Okay.'], ['assistant', 'It usually lists the work you will do.']],
    text: 'The roadmap example does not help me picture it. Could you give a different example?' }, es: {
    before: [['user', '¿Qué es un programa de la materia?'], ['assistant', 'Piensa en él como un mapa de la clase.'],
      ['user', 'Bueno.'], ['assistant', 'Normalmente incluye el trabajo que vas a hacer.']],
    text: 'El ejemplo del mapa no me ayuda a imaginarlo. ¿Puedes darme otro ejemplo?' } },
  { id: 'quoted-need', need: 'none', en: {
    text: 'My friend said, "I am lost and need an example." I understand the enrollment steps; I just need the office phone number.' }, es: {
    text: 'Mi amiga dijo: "Estoy perdida y necesito un ejemplo". Yo entiendo los pasos de inscripción; solo necesito el teléfono de la oficina.' } },
  { id: 'identity-is-not-need', need: 'none', en: {
    text: 'I am the first in my family going to college and I speak Spanish at home. What time does the library open?' }, es: {
    text: 'Soy la primera de mi familia que va a la universidad y hablamos español en casa. ¿A qué hora abre la biblioteca?' } },
  { id: 'corrected-latest-request', need: 'none', en: {
    text: 'I need a simpler explanation of the meal plans. Actually, I understand them now. Just tell me where I can change my plan.' }, es: {
    text: 'Necesito una explicación más sencilla de los planes de comida. En realidad ya los entendí. Solo dime dónde puedo cambiar mi plan.' } },
  { id: 'example-already-given', need: 'concrete_example', addressed: true, en: {
    text: 'Give me an example of how office hours could help me.',
    after: 'For example, you could bring one homework problem you tried and ask your teacher where you got stuck.' }, es: {
    text: 'Dame un ejemplo de cómo me ayudarían las horas de consulta.',
    after: 'Por ejemplo, puedes llevar un problema de tarea que intentaste y preguntarle a tu profesor en qué paso te atoraste.' } },
  { id: 'definition-is-not-example', need: 'concrete_example', en: {
    text: 'Give me an example of how office hours could help me.',
    after: 'Office hours are time a teacher sets aside to meet with students.' }, es: {
    text: 'Dame un ejemplo de cómo me ayudarían las horas de consulta.',
    after: 'Las horas de consulta son un horario que el profesor reserva para hablar con estudiantes.' } },
  { id: 'renewed-after-clarity', need: 'simpler_explanation', en: {
    before: [['assistant', 'A major is your main field of study.'], ['user', 'That makes sense now.'],
      ['assistant', 'You can explore several fields before choosing.']],
    text: 'After seeing the course list, I am confused again about what the major includes. Can you explain it more simply?' }, es: {
    before: [['assistant', 'La especialidad principal es tu área central de estudio.'], ['user', 'Ahora sí me queda claro.'],
      ['assistant', 'Puedes conocer varias áreas antes de elegir.']],
    text: 'Al ver la lista de materias, me volví a confundir sobre qué incluye la especialidad principal. ¿Me lo explicas más sencillo?' } },
  { id: 'missing-referent', need: 'unclear', en: { text: 'Could you give me an example of the thing we have not talked about yet?' },
    es: { text: '¿Me das un ejemplo de eso que todavía no hemos hablado?' } },
];

function fixture(pair, language) {
  const sample = pair[language], id = `recognition-${language}-${pair.id}`;
  const memory = createExplanationHistory();
  const before = (sample.before ?? []).map(([role, text], index) => {
    const row = { id: `${id}-before-${index}`, role, text, complete: true, source: 'application_estimate',
      sourceEventIds: [`${id}-source-${index}`], startMs: index * 3000, endMs: index * 3000 + 2000,
      connectionEpoch: 0 };
    memory.append(row); return row;
  });
  const caller = { id: `${id}-caller`, role: 'user', text: sample.text, complete: true,
    startMs: before.length * 3000, endMs: before.length * 3000 + 2000, connectionEpoch: 0 };
  const after = sample.after ? [{ id: `${id}-after`, role: 'assistant', text: sample.after, complete: true,
    startMs: caller.endMs + 500, endMs: caller.endMs + 2500, connectionEpoch: 0 }] : [];
  return { id, language, split: 'holdout', labelSource: 'independently_authored_fictional_case',
    expected: { supportNeed: pair.need, alreadyAddressed: pair.addressed === true },
    snapshot: { fictional: true, authorized: true, closed: false, language, role: 'family',
      brief: null, currentQuestion: { text: sample.text }, questionRevision: 1,
      recentTranscripts: [...before, caller, ...after], explanationHistory: memory.snapshot({ currentText: sample.text }),
      opportunities: [], researchFindings: [], researchTasks: [], connectionGaps: [] } };
}
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const recognitionFixtures = freeze(pairs.flatMap(pair => ['en', 'es'].map(language => fixture(pair, language))));
