// Independently authored fictional classifier cases. Freeze before the first
// provider run. These labels are separate from outcome/playback labels and do
// not establish improved conversation or actual student understanding.
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const pairs = [
  { id: 'older-explanation-renewed-confusion', action: 'simplify', eligible: true,
    en: { history: [['user', 'What is an academic advisor?'], ['assistant', 'An academic advisor helps you choose classes and understand your program.'],
      ['user', 'My school sent me two welcome emails.'], ['assistant', 'We can look at the message you need first.']],
    text: 'I am still confused about what the academic advisor does. Could you explain that more simply?' },
    es: { history: [['user', '¿Qué es un asesor académico?'], ['assistant', 'Un asesor académico te ayuda a elegir materias y entender tu programa.'],
      ['user', 'Mi escuela me mandó dos correos de bienvenida.'], ['assistant', 'Podemos ver primero el mensaje que necesites.']],
    text: 'Todavía me confunde qué hace el asesor académico. ¿Me lo explicas con palabras más sencillas?' } },
  { id: 'clear-old-idea-new-example', action: 'example', eligible: true, replaceNeed: true,
    en: { need: 'I do not understand office hours.', history: [['user', 'I do not understand office hours.'],
      ['assistant', 'That is time your teacher sets aside for students to ask questions.'], ['user', 'Now I understand office hours.']],
    text: 'Office hours are clear now. Can you give me an example of what a first-year seminar is like?' },
    es: { need: 'No entiendo las horas de consulta.', history: [['user', 'No entiendo las horas de consulta.'],
      ['assistant', 'Es un horario que tu profesora reserva para las preguntas de los estudiantes.'], ['user', 'Ahora entiendo las horas de consulta.']],
    text: 'Ya me quedaron claras las horas de consulta. ¿Me das un ejemplo de cómo es un seminario de primer año?' } },
  { id: 'bare-ack-not-understanding', action: 'none', eligible: false,
    en: { need: 'I do not understand what orientation means.', history: [['user', 'I do not understand what orientation means.'],
      ['assistant', 'Orientation is an introduction to the school, its people and the things you need to get started.']], text: 'Okay.' },
    es: { need: 'No entiendo qué significa orientación.', history: [['user', 'No entiendo qué significa orientación.'],
      ['assistant', 'La orientación es una presentación de la escuela, su gente y lo que necesitas para comenzar.']], text: 'Sí.' } },
  { id: 'explicit-clarity', action: 'clear', eligible: false, clearSupport: true,
    en: { need: 'I do not understand the difference between a lecture and a lab.', history: [['user', 'I do not understand the difference between a lecture and a lab.'],
      ['assistant', 'A lecture explains ideas. A lab lets you practice or investigate them.']],
    text: 'Now I understand the difference: the lab is where I practice the ideas from the lecture. That answers my question.' },
    es: { need: 'No entiendo la diferencia entre una clase teórica y un laboratorio.', history: [['user', 'No entiendo la diferencia entre una clase teórica y un laboratorio.'],
      ['assistant', 'En la clase teórica se explican ideas. En el laboratorio las practicas o investigas.']],
    text: 'Ahora entiendo la diferencia: en el laboratorio practico las ideas de la clase teórica. Eso responde mi pregunta.' } },
  { id: 'corrected-subject', action: 'simplify', eligible: true, replaceNeed: true,
    en: { need: 'I do not understand course credits.', history: [['user', 'I do not understand course credits.'],
      ['assistant', 'Course credits describe how much a class counts toward your program.']],
    text: 'I meant the credit balance on my school bill, not course credits. I do not understand what that balance means.' },
    es: { need: 'No entiendo los créditos de las materias.', history: [['user', 'No entiendo los créditos de las materias.'],
      ['assistant', 'Los créditos indican cuánto cuenta una materia para tu programa.']],
    text: 'Me refería al saldo a favor en mi factura de la escuela, no a los créditos de las materias. No entiendo qué significa ese saldo.' } },
  { id: 'unfinished-correction', action: 'unclear', eligible: false,
    en: { need: 'I am confused about orientation.', history: [['user', 'I am confused about orientation.'],
      ['assistant', 'Orientation helps you become familiar with the school.']], text: 'Wait, I did not mean orientation. What I meant was' },
    es: { need: 'Me confunde la orientación.', history: [['user', 'Me confunde la orientación.'],
      ['assistant', 'La orientación te ayuda a conocer la escuela.']], text: 'Espera, no me refería a la orientación. Lo que quería decir era' } },
  { id: 'ordinary-factual-followup', action: 'none', eligible: false,
    en: { history: [['user', 'What are office hours?'], ['assistant', 'They are time your teacher sets aside for students to ask questions.'],
      ['user', 'Now I know what office hours are.']], text: 'Can a parent come with me to the first visit?' },
    es: { history: [['user', '¿Qué son las horas de consulta?'], ['assistant', 'Es un horario que tu profesora reserva para las preguntas de los estudiantes.'],
      ['user', 'Ahora sé qué son las horas de consulta.']], text: '¿Puede acompañarme mi mamá en la primera visita?' } },
  { id: 'leave-need-change-topic', action: 'clear', eligible: false, clearSupport: true,
    en: { need: 'I do not know where to begin with my class schedule.', history: [['user', 'I do not know where to begin with my class schedule.'],
      ['assistant', 'We can start with the classes your program lists for new students.']], kind: 'starting_point',
    text: 'Let us leave the schedule for another day. I want to talk about how nervous I feel about moving away.' },
    es: { need: 'No sé por dónde comenzar con mi horario de clases.', history: [['user', 'No sé por dónde comenzar con mi horario de clases.'],
      ['assistant', 'Podemos empezar con las materias que tu programa indica para estudiantes nuevos.']], kind: 'starting_point',
    text: 'Dejemos el horario para otro día. Quiero hablar de los nervios que me da irme de casa.' } },
  { id: 'acknowledgment-is-not-explanation', action: 'continue_simplifying', eligible: true,
    en: { need: 'I do not understand a prerequisite.', history: [['user', 'I do not understand a prerequisite.'],
      ['assistant', 'Of course, I am here with you.']], text: 'Does that mean something I have to do before I take the class?' },
    es: { need: 'No entiendo qué es un requisito previo.', history: [['user', 'No entiendo qué es un requisito previo.'],
      ['assistant', 'Claro, aquí estoy para ayudarte.']], text: '¿Eso quiere decir algo que debo hacer antes de tomar la materia?' } },
  { id: 'new-part-still-confusing', action: 'simplify', eligible: true, replaceNeed: true,
    en: { need: 'I do not understand a major.', history: [['user', 'I do not understand a major.'],
      ['assistant', 'A major is the main subject you study for your degree.']],
    text: 'The major makes sense now, but I do not understand what a minor is. Please explain that simply.' },
    es: { need: 'No entiendo qué es una especialidad principal.', history: [['user', 'No entiendo qué es una especialidad principal.'],
      ['assistant', 'Es el tema principal que estudias para tu título.']],
    text: 'Ya entiendo la especialidad principal, pero no entiendo qué es una especialidad secundaria. Explícamelo de forma sencilla.' } },
  { id: 'older-clear-new-confusion-overrides', action: 'simplify', eligible: true,
    en: { history: [['user', 'What is a syllabus?'], ['assistant', 'It is your class guide, including assignments and expectations.'],
      ['user', 'I understand what the syllabus is now.'], ['assistant', 'Good, we can use it when you need it.'],
      ['user', 'I found the class website.'], ['assistant', 'That sounds like a useful start.']],
    text: 'After reading my syllabus, I am confused again about what it expects from me. Could we go through that more simply?' },
    es: { history: [['user', '¿Qué es un programa de la materia?'], ['assistant', 'Es la guía de tu clase, con tareas y expectativas.'],
      ['user', 'Ahora entiendo qué es el programa de la materia.'], ['assistant', 'Bien, podemos usarlo cuando lo necesites.'],
      ['user', 'Encontré la página de la clase.'], ['assistant', 'Parece un buen comienzo.']],
    text: 'Después de leer el programa de mi materia, vuelvo a estar confundida sobre lo que se espera de mí. ¿Lo vemos con palabras más sencillas?' } },
  { id: 'current-need-already-answered', action: 'none', eligible: false, clearSupport: true,
    en: { need: 'I do not understand office hours.', history: [['user', 'I do not understand office hours.']],
    text: 'Could you explain what office hours are?', after: 'Office hours are a regular time when your teacher welcomes questions. You can bring one homework question or ask for help getting started.' },
    es: { need: 'No entiendo las horas de consulta.', history: [['user', 'No entiendo las horas de consulta.']],
    text: '¿Me explicas qué son las horas de consulta?', after: 'Las horas de consulta son un horario habitual en el que tu profesora recibe preguntas. Puedes llevar una duda de la tarea o pedir ayuda para comenzar.' } },
];

function build(pair, language) {
  const sample = pair[language], id = `history-${language}-${pair.id}`;
  const scope = { callId: id + '-call', studentId: 'fictional-student', language, connectionEpoch: 0, scopeEpoch: 0 };
  const rows = sample.history.map(([role, text], index) => ({ id: id + '-past-' + index, role, text,
    sourceEventIds: [id + '-native-' + index], startMs: index * 2000, endMs: index * 2000 + 1500,
    complete: true, source: 'application_estimate' }));
  const revision = rows.filter(row => row.role === 'assistant').length;
  const snapshot = { ...scope, text: sample.text, provisional: true, complete: false,
    stamp: { ...scope, contributionId: id + '-current', revision: 1 }, sourceEventIds: [id + '-current-native'],
    sourceTextEnds: [sample.text.length], supportRevision: sample.need ? 1 : 0, assistantOutputRevision: revision + (sample.after ? 1 : 0),
    recentDialogue: rows.slice(-6), explanationHistory: { version: 'explanation-evidence-1', evidenceType: 'bounded_raw_transcript',
      rows, comprehension: 'unknown', playback: 'unknown', omittedRows: 0, selectionTruncated: false, fullTranscript: false },
    assistantSinceNeed: { text: sample.after ?? '', sourceEventIds: sample.after ? [id + '-after-native'] : [],
      revision: revision + (sample.after ? 1 : 0), evidenceComplete: true, playbackClaim: false } };
  if (sample.need) snapshot.activeSupport = { kind: sample.kind ?? 'simpler_explanation', status: 'validated',
    sourceText: sample.need, sourceEventIds: rows[0].sourceEventIds,
    stamp: { ...scope, contributionId: rows[0].id, revision: 1 }, originOutputRevision: revision, supportRevision: 1 };
  const expected = { action: pair.action, eligible: pair.eligible, clearSupport: pair.clearSupport ?? false,
    ...(pair.replaceNeed ? { replaceNeed: true } : {}) };
  return { id, language, snapshot, expected, labelSource: 'independently_authored_fictional_case' };
}

export const needHistoryFixtures = freeze(pairs.flatMap(pair => ['en', 'es'].map(language => build(pair, language))));
