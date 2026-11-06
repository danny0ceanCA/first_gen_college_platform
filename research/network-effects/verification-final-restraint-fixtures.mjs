// Independently authored fictional holdout. Freeze the evaluated configuration
// before reading these cases. Labels, rubrics and mechanism tags are never input.
const item = (key, kind, status, quote, extra = {}) => ({
  key, kind, status, quote, statement: quote, barrier: null, linksTo: null,
  corrects: null, ...extra,
});

const rows = [
  {
    id: 'final-restraint-en-01', language: 'en', topic: 'college_basics', decision: 'keep',
    text: 'I read the welcome email and saved the address for the campus tour. I cannot remember the tour guide’s name, but I have everything I need to get there.',
    initial: [item('tour_information_saved', 'action', 'completed', 'I read the welcome email and saved the address for the campus tour.', {
      statement: 'Read the welcome message and retained the tour location.',
    })],
    mechanisms: ['supported_paraphrase', 'incidental_unknown_not_obstacle', 'no_inferred_understanding'],
    required: [['action', ['completed']]], forbidden: [['understanding', 'uncertain'], ['outcome', 'unsuccessful']],
    notes: 'The paraphrase is supported. Not recalling the guide name does not block anything, and the person explicitly has the needed arrival information. Do not add a barrier or claim attendance.',
  },
  {
    id: 'final-restraint-en-02', language: 'en', topic: 'paths', decision: 'keep',
    text: 'My family and I talked yesterday about whether part-time college could fit our plans. We have not chosen a schedule, and nobody recommended a particular option.',
    initial: [item('part_time_exploration', 'preference', 'exploring', 'My family and I talked yesterday about whether part-time college could fit our plans. We have not chosen a schedule, and nobody recommended a particular option.', {
      statement: 'The family is considering part-time college without selecting a schedule or endorsing an option.',
    })],
    mechanisms: ['supported_paraphrase', 'past_discussion_not_guidance', 'exploration_not_barrier'],
    required: [['preference', ['exploring']]], forbidden: [['guidance', 'offered'], ['action', 'completed']],
    notes: 'Discussion and exploration do not establish advice or a recommendation. A decision not made yet is not automatically a practical obstacle or failed outcome. Preserve the supported paraphrase.',
  },
  {
    id: 'final-restraint-en-03', language: 'en', topic: 'family_support', reporter: 'parent',
    text: 'I went to the family introduction and learned where the advising desk is. My child still cannot tell what an adviser can help with, so they do not know which question to bring.',
    initial: [item('family_desk_known', 'understanding', 'reported', 'I went to the family introduction and learned where the advising desk is.', {
      statement: 'The parent learned the location of the advising desk.',
    })],
    expected: [
      item('family_desk_known', 'understanding', 'reported', 'I went to the family introduction and learned where the advising desk is.', {
        statement: 'The parent learned the location of the advising desk.',
      }),
      item('child_adviser_uncertainty', 'understanding', 'uncertain', 'My child still cannot tell what an adviser can help with, so they do not know which question to bring.', {
        statement: 'The parent reports that the child does not understand the adviser’s role or what question to bring.',
        barrier: 'The child does not understand what an adviser can help with and therefore cannot choose a question to bring.',
      }),
    ],
    mechanisms: ['parent_attribution', 'obstacle_after_progress', 'omitted_knowledge_barrier'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    barrierQuotes: ['My child still cannot tell what an adviser can help with, so they do not know which question to bring.'],
    notes: 'Preserve the parent’s narrow learning and add the distinct child knowledge obstacle. The parent is the reporter of both. An open or partial question with the same obstacle is also acceptable; no general child understanding is established.',
  },
  {
    id: 'final-restraint-en-04', language: 'en', topic: 'finding_help',
    text: 'The email confirmed my account activation. I then tried to open the new-student checklist, but the page said access denied and the checklist never opened.',
    initial: [item('account_activated', 'outcome', 'positive', 'The email confirmed my account activation.')],
    expected: [
      item('account_activated', 'outcome', 'positive', 'The email confirmed my account activation.'),
      item('checklist_unavailable', 'outcome', 'unsuccessful', 'I then tried to open the new-student checklist, but the page said access denied and the checklist never opened.', {
        statement: 'The attempt to open the new-student checklist failed with an access-denied message.',
        barrier: 'An access-denied message prevents opening the checklist.', linksTo: 'account_activated',
      }),
    ],
    mechanisms: ['failure_after_success', 'omitted_access_barrier', 'separate_failure_outcome'],
    required: [['outcome', ['positive']], ['outcome', ['unsuccessful'], true]],
    barrierQuotes: ['the page said access denied and the checklist never opened.'],
    notes: 'Activation succeeded; accessing the checklist explicitly failed. The repair must include a distinct unsuccessful outcome and its barrier, not just attach a barrier to the positive record. Do not invent checklist completion.',
  },
  {
    id: 'final-restraint-es-01', language: 'es', topic: 'enrollment', decision: 'keep',
    text: 'Guardé el correo con las indicaciones para llegar a la bienvenida. No recuerdo el apellido de quien lo mandó, pero eso no me hace falta para seguir las indicaciones.',
    initial: [item('indicaciones_guardadas', 'action', 'completed', 'Guardé el correo con las indicaciones para llegar a la bienvenida.', {
      statement: 'Conservó el mensaje que explica cómo llegar a la bienvenida.',
    })],
    mechanisms: ['supported_paraphrase', 'incidental_unknown_not_obstacle', 'no_inferred_attendance'],
    required: [['action', ['completed']]], forbidden: [['understanding', 'uncertain'], ['outcome', 'unsuccessful']],
    notes: 'La paráfrasis conserva el significado. No recordar un apellido no bloquea el siguiente paso, según el propio texto. No agregar una barrera ni afirmar asistencia.',
  },
  {
    id: 'final-restraint-es-02', language: 'es', topic: 'practical_needs', decision: 'keep',
    text: 'Ayer hablamos en casa de comer en el campus o llevar comida. Seguimos comparando las opciones; nadie dijo que una fuera la mejor ni nos dio una recomendación.',
    initial: [item('comida_en_exploracion', 'preference', 'exploring', 'Ayer hablamos en casa de comer en el campus o llevar comida. Seguimos comparando las opciones; nadie dijo que una fuera la mejor ni nos dio una recomendación.', {
      statement: 'La familia compara comer en el campus con llevar comida, sin elegir ni recomendar una opción.',
    })],
    mechanisms: ['supported_paraphrase', 'past_discussion_not_guidance', 'exploration_not_barrier'],
    required: [['preference', ['exploring']]], forbidden: [['guidance', 'offered'], ['action', 'completed']],
    notes: 'La conversación pasada no demuestra que se ofreció orientación ni que ya hubo una decisión. Conservar el significado y no convertir la comparación voluntaria en una barrera.',
  },
  {
    id: 'final-restraint-es-03', language: 'es', topic: 'family_support', reporter: 'parent',
    text: 'Soy la mamá. Yo sé dónde está el formulario de bienvenida, pero mi hijo no entiende qué significa contacto de emergencia y por eso no sabe a quién poner.',
    initial: [item('formulario_ubicado', 'understanding', 'reported', 'Yo sé dónde está el formulario de bienvenida', {
      statement: 'La madre sabe dónde está el formulario de bienvenida.',
    })],
    expected: [
      item('formulario_ubicado', 'understanding', 'reported', 'Yo sé dónde está el formulario de bienvenida', {
        statement: 'La madre sabe dónde está el formulario de bienvenida.',
      }),
      item('hijo_contacto_incierto', 'understanding', 'uncertain', 'mi hijo no entiende qué significa contacto de emergencia y por eso no sabe a quién poner.', {
        statement: 'La madre informa que su hijo no entiende el concepto de contacto de emergencia y no sabe a quién indicar.',
        barrier: 'El hijo no entiende qué es un contacto de emergencia y no sabe a quién poner.',
      }),
    ],
    mechanisms: ['parent_attribution', 'omitted_knowledge_barrier', 'blocked_next_step'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    barrierQuotes: ['mi hijo no entiende qué significa contacto de emergencia y por eso no sabe a quién poner.'],
    notes: 'La madre conoce la ubicación, pero el hijo tiene una duda concreta que bloquea completar ese dato. Ambos hechos están reportados por la madre. Una pregunta abierta que conserve la barrera también es válida.',
  },
  {
    id: 'final-restraint-es-04', language: 'es', topic: 'college_basics',
    text: 'Ya recibí el enlace para la explicación de los primeros pasos. Intenté verla en la biblioteca, pero el video solo tiene audio, no tiene subtítulos y no tengo audífonos, así que no pude escuchar la explicación.',
    initial: [item('enlace_recibido', 'outcome', 'positive', 'Ya recibí el enlace para la explicación de los primeros pasos.')],
    expected: [
      item('enlace_recibido', 'outcome', 'positive', 'Ya recibí el enlace para la explicación de los primeros pasos.'),
      item('explicacion_no_accesible', 'outcome', 'unsuccessful', 'Intenté verla en la biblioteca, pero el video solo tiene audio, no tiene subtítulos y no tengo audífonos, así que no pude escuchar la explicación.', {
        statement: 'No pudo acceder a la explicación en la biblioteca porque el video no tiene subtítulos y no tiene audífonos.',
        barrier: 'El video no tiene subtítulos y la persona no tiene audífonos para escucharlo en la biblioteca.', linksTo: 'enlace_recibido',
      }),
    ],
    mechanisms: ['failure_after_success', 'omitted_access_barrier', 'separate_failure_outcome'],
    required: [['outcome', ['positive']], ['outcome', ['unsuccessful'], true]],
    barrierQuotes: ['el video solo tiene audio, no tiene subtítulos y no tengo audífonos, así que no pude escuchar la explicación.'],
    notes: 'Recibir el enlace no equivale a escuchar o comprender la explicación. Registrar el resultado fallido por separado con la barrera explícita; no inferir discapacidad ni un resultado positivo de aprendizaje.',
  },
  {
    id: 'final-restraint-mixed-01', language: 'mixed', topic: 'finding_help', decision: 'keep',
    text: 'I found the address for the student welcome desk and wrote it down. No recuerdo qué día lo busqué, but I have the correct address now.',
    initial: [item('welcome_address_saved', 'action', 'completed', 'I found the address for the student welcome desk and wrote it down.', {
      statement: 'Located and recorded the student welcome desk address.',
    })],
    mechanisms: ['supported_paraphrase', 'incidental_unknown_not_obstacle', 'mixed_language_restraint'],
    required: [['action', ['completed']]], forbidden: [['understanding', 'uncertain'], ['outcome', 'unsuccessful']],
    notes: 'The date of the search is unknown but not needed for the current task. Keep the supported English paraphrase within this mixed-language source; do not invent a barrier or timestamp.',
  },
  {
    id: 'final-restraint-mixed-02', language: 'mixed', topic: 'paths', decision: 'keep',
    text: 'We talked about starting with a certificate or a degree, pero no elegimos nada. I am exploring both, and nobody suggested that I should pick one yet.',
    initial: [item('credential_exploration', 'preference', 'exploring', 'We talked about starting with a certificate or a degree, pero no elegimos nada. I am exploring both, and nobody suggested that I should pick one yet.', {
      statement: 'Exploring a certificate and a degree without selecting either or reporting a recommendation.',
    })],
    mechanisms: ['supported_paraphrase', 'past_discussion_not_guidance', 'mixed_language_restraint'],
    required: [['preference', ['exploring']]], forbidden: [['guidance', 'offered'], ['action', 'completed']],
    notes: 'Preserve ordinary exploration. Do not turn a past discussion into guidance, assign a knowledge barrier, or translate an already supported paraphrase for style.',
  },
  {
    id: 'final-restraint-mixed-03', language: 'mixed', topic: 'family_support', reporter: 'parent',
    text: 'I am the parent. The translated message helped me understand the welcome date. Mi hija todavía no entiende qué es el portal estudiantil, so she does not know where to open the message herself.',
    initial: [item('parent_date_understood', 'understanding', 'reported', 'The translated message helped me understand the welcome date.', {
      statement: 'The parent understood the welcome date after reading the translated message.',
    })],
    expected: [
      item('parent_date_understood', 'understanding', 'reported', 'The translated message helped me understand the welcome date.', {
        statement: 'The parent understood the welcome date after reading the translated message.',
      }),
      item('daughter_portal_uncertainty', 'understanding', 'uncertain', 'Mi hija todavía no entiende qué es el portal estudiantil, so she does not know where to open the message herself.', {
        statement: 'The parent reports that the daughter does not understand what the student portal is or where to open the message.',
        barrier: 'La hija no entiende qué es el portal estudiantil ni dónde abrir el mensaje.',
      }),
    ],
    mechanisms: ['parent_attribution', 'obstacle_after_progress', 'omitted_knowledge_barrier'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    barrierQuotes: ['Mi hija todavía no entiende qué es el portal estudiantil, so she does not know where to open the message herself.'],
    notes: 'Parent learning and daughter uncertainty must remain separate. An open/partial question with the daughter-specific structured obstacle is defensible. Do not claim the daughter learned the date or opened the message.',
  },
  {
    id: 'final-restraint-mixed-04', language: 'mixed', topic: 'enrollment',
    text: 'My welcome appointment was confirmed by email. At the desk I tried to check in, pero el código del correo no se pudo leer y no me dejaron entrar a la cita.',
    initial: [item('welcome_confirmed', 'outcome', 'positive', 'My welcome appointment was confirmed by email.')],
    expected: [
      item('welcome_confirmed', 'outcome', 'positive', 'My welcome appointment was confirmed by email.'),
      item('checkin_failed', 'outcome', 'unsuccessful', 'At the desk I tried to check in, pero el código del correo no se pudo leer y no me dejaron entrar a la cita.', {
        statement: 'Check-in failed because the email code could not be read, and the person was not allowed into the appointment.',
        barrier: 'El código del correo no se pudo leer durante el registro de llegada.', linksTo: 'welcome_confirmed',
      }),
    ],
    mechanisms: ['failure_after_success', 'omitted_access_barrier', 'separate_failure_outcome'],
    required: [['outcome', ['positive']], ['outcome', ['unsuccessful'], true]],
    barrierQuotes: ['el código del correo no se pudo leer y no me dejaron entrar a la cita.'],
    notes: 'The appointment was confirmed but access at check-in explicitly failed. Preserve confirmation and add the unsuccessful check-in outcome plus its obstacle; a barrier on the positive alone is incomplete. No attended appointment is established.',
  },
];

export const finalRestraintVersion = 'first-generation-verifier-final-restraint-12-v1';

function canonical(values, row, source) {
  return values.map(value => ({
    key: value.key, episodeKey: value.episodeKey ?? row.id, topic: value.topic ?? row.topic,
    barrier: value.barrier, kind: value.kind, status: value.status,
    statement: value.statement, quote: value.quote, reportedBy: value.reportedBy ?? source.reporter,
    language: source.language, occurredAt: null, linksTo: value.linksTo, corrects: value.corrects,
  }));
}

export function finalRestraintCases() {
  return rows.map((row, index) => {
    const source = {
      id: `cal-${row.id}`, version: 1, accountId: `fictional-${row.id}`, studentId: 'student-one',
      reporter: row.reporter ?? 'student', language: row.language, kind: 'transcript',
      recordedAt: new Date(Date.UTC(2026, 10, 8, 10, index)).toISOString(), text: row.text, synthetic: true,
    };
    return {
      id: row.id, split: 'heldout', source,
      initialCandidate: { schemaVersion: 1, items: canonical(row.initial, row, source) },
      existingItems: [], priorSources: [],
      expected: { decision: row.decision ?? 'revise', extraction: { schemaVersion: 1, items: canonical(row.expected ?? row.initial, row, source) } },
      rubric: {
        mechanisms: [...row.mechanisms],
        requiredObservations: row.required.map(([kind, statuses, requireBarrier = false]) => ({ kind, statuses: [...statuses], requireBarrier })),
        forbiddenKindStatuses: (row.forbidden ?? []).map(pair => [...pair]), noCorrection: true,
        requirePriorLink: false, preserveInitialKeys: row.decision === 'keep' ? row.initial.map(value => value.key) : [],
        barrierEvidence: [...(row.barrierQuotes ?? [])], notes: row.notes, humanReview: 'pending',
        labelProvenance: 'independently authored final fictional restraint holdout; not human adjudicated',
      },
    };
  });
}
