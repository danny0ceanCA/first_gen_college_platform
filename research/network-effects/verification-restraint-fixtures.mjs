// Fresh fictional holdout for restrained review and structured obstacle coverage.
// Do not inspect the case text while tuning the evaluated prompt. Expected data,
// rubrics and mechanism tags are evaluation-only and must never enter a request.
const observation = (key, kind, status, quote, options = {}) => ({
  key, kind, status, quote, statement: quote, barrier: null, linksTo: null,
  corrects: null, ...options,
});

const rows = [
  {
    id: 'restraint-en-01', language: 'en', topic: 'paths', decision: 'keep',
    text: 'The college visitor map arrived at our house. That is all I know about it; I do not know who requested it.',
    initial: [observation('map_delivered', 'outcome', 'positive', 'The college visitor map arrived at our house.', {
      statement: 'The college visitor map was delivered to the household.',
    })],
    mechanisms: ['clean_narrow_receipt', 'no_inferred_action', 'attribution_unknown'],
    required: [['outcome', ['positive']]], forbidden: [['action', 'completed'], ['understanding', 'reported']],
    notes: 'Delivery is the narrow result. Do not invent a map request, requester, visit booking or understanding. Unknown requester is not itself a college-navigation obstacle.',
  },
  {
    id: 'restraint-en-02', language: 'en', topic: 'college_basics', decision: 'keep',
    text: 'Do college libraries sometimes host poetry readings? I am just curious; this is not holding up any decision.',
    initial: [observation('library_curiosity', 'question', 'open', 'Do college libraries sometimes host poetry readings?', {
      statement: 'Asks whether college libraries sometimes host poetry readings.',
    })],
    mechanisms: ['clean_optional_question', 'no_invented_barrier'],
    required: [['question', ['open']]],
    notes: 'A curiosity question is not evidence of confusion, inability or a blocked next step. Keep barrier null and do not create an unsuccessful result.',
  },
  {
    id: 'restraint-en-03', language: 'en', topic: 'practical_needs', decision: 'keep',
    text: 'The campus has not assigned a time for my welcome appointment. Until they give me that time, I cannot ask my manager for the right shift off.',
    initial: [observation('welcome_time_pending', 'outcome', 'pending', 'The campus has not assigned a time for my welcome appointment. Until they give me that time, I cannot ask my manager for the right shift off.', {
      statement: 'The welcome appointment time is pending and prevents arranging the corresponding time off work.',
      barrier: 'The missing appointment time prevents asking for the right shift off.',
    })],
    mechanisms: ['clean_waiting_dependency', 'preserve_explicit_barrier'],
    required: [['outcome', ['pending'], true]],
    barrierQuotes: ['Until they give me that time, I cannot ask my manager for the right shift off.'],
    notes: 'This barrier records a concrete downstream dependency, not merely ordinary waiting. Preserve it and the pending result without adding an unreported completed request.',
  },
  {
    id: 'restraint-en-04', language: 'en', topic: 'enrollment',
    text: 'I can read the word accepted in the letter, but I do not understand whether that means I already have a place in classes. I need someone to explain the next step.',
    initial: [observation('acceptance_understood', 'understanding', 'reported', 'I can read the word accepted in the letter, but I do not understand whether that means I already have a place in classes.', {
      statement: 'The student understands that acceptance means they have a place in classes.',
    })],
    expected: [observation('acceptance_understood', 'understanding', 'uncertain', 'I can read the word accepted in the letter, but I do not understand whether that means I already have a place in classes. I need someone to explain the next step.', {
      statement: 'Does not understand whether the acceptance letter means a place in classes and asks for the next step to be explained.',
      barrier: 'Does not understand the difference between acceptance and having a place in classes.',
    })],
    mechanisms: ['false_understanding', 'explicit_knowledge_obstacle'],
    required: [['understanding', ['uncertain'], true]], forbidden: [['understanding', 'reported'], ['outcome', 'positive']],
    barrierQuotes: ['I do not understand whether that means I already have a place in classes.'],
    notes: 'A supported open or partial question can also preserve the uncertainty. The structured barrier must capture the knowledge gap, and no enrollment or seat is confirmed.',
  },
  {
    id: 'restraint-en-05', language: 'en', topic: 'finding_help',
    text: 'I created the school account successfully. Now the sign-in page sends a code to my old phone number, which I no longer have, so I cannot get into the account.',
    initial: [observation('account_created', 'outcome', 'positive', 'I created the school account successfully.')],
    expected: [
      observation('account_created', 'outcome', 'positive', 'I created the school account successfully.'),
      observation('account_access_blocked', 'outcome', 'unsuccessful', 'Now the sign-in page sends a code to my old phone number, which I no longer have, so I cannot get into the account.', {
        barrier: 'The sign-in code goes to an old phone number the student no longer has.', linksTo: 'account_created',
      }),
    ],
    mechanisms: ['obstacle_after_progress', 'omitted_access_barrier', 'omitted_unsuccessful_result'],
    required: [['outcome', ['positive']], ['outcome', ['unsuccessful'], true]],
    barrierQuotes: ['Now the sign-in page sends a code to my old phone number, which I no longer have, so I cannot get into the account.'],
    notes: 'Keep completed account creation and capture the distinct access failure and its obstacle. A mixed result is defensible if it retains both facts; do not invent a successful password reset.',
  },
  {
    id: 'restraint-en-06', language: 'en', topic: 'family_support', reporter: 'parent',
    text: 'I am his dad. I know where the school puts the cost sheet. My son says he cannot tell which amounts are gifts and which ones he would have to pay back.',
    initial: [observation('cost_sheet_known', 'understanding', 'reported', 'I know where the school puts the cost sheet.', {
      statement: 'The son knows where the cost sheet is and understands the gift and repayment amounts.', reportedBy: 'unknown',
    })],
    expected: [
      observation('cost_sheet_known', 'understanding', 'reported', 'I know where the school puts the cost sheet.', {
        statement: 'The father knows where the school puts the cost sheet.',
      }),
      observation('son_amounts_uncertain', 'understanding', 'uncertain', 'My son says he cannot tell which amounts are gifts and which ones he would have to pay back.', {
        statement: 'The father reports that his son cannot distinguish gifts from amounts requiring repayment.',
        barrier: 'The son cannot distinguish gifts from amounts he would need to repay.',
      }),
    ],
    mechanisms: ['family_attribution', 'false_child_understanding', 'omitted_knowledge_barrier'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    barrierQuotes: ['My son says he cannot tell which amounts are gifts and which ones he would have to pay back.'],
    notes: 'The father is the reporter of both observations. His knowledge of the sheet location does not establish the son understands the amounts. Capture the son-specific obstacle separately.',
  },
  {
    id: 'restraint-es-01', language: 'es', topic: 'applications', decision: 'keep',
    text: 'El colegio confirmó que recibió la copia del certificado. El mensaje no dice quién la envió ni que ya aceptaron mi solicitud.',
    initial: [observation('certificado_recibido', 'outcome', 'positive', 'El colegio confirmó que recibió la copia del certificado.', {
      statement: 'Se confirmó la recepción de la copia del certificado, no la aceptación de la solicitud.',
      quote: 'El colegio confirmó que recibió la copia del certificado. El mensaje no dice quién la envió ni que ya aceptaron mi solicitud.',
    })],
    mechanisms: ['clean_narrow_receipt', 'no_inferred_action', 'no_inferred_acceptance'],
    required: [['outcome', ['positive']]], forbidden: [['action', 'completed']],
    notes: 'Conservar la recepción confirmada. No inventar que la persona envió el documento ni una aceptación de la solicitud. La ausencia de esos datos no es por sí sola una barrera.',
  },
  {
    id: 'restraint-es-02', language: 'es', topic: 'paths', decision: 'keep',
    text: 'Por curiosidad, ¿las universidades tienen grupos de ajedrez? No estoy tratando de resolver ningún problema; solo quiero conocer las actividades.',
    initial: [observation('curiosidad_ajedrez', 'question', 'open', 'Por curiosidad, ¿las universidades tienen grupos de ajedrez?', {
      statement: 'Pregunta por curiosidad si hay grupos de ajedrez en las universidades.',
    })],
    mechanisms: ['clean_optional_question', 'no_invented_barrier'],
    required: [['question', ['open']]],
    notes: 'La curiosidad no demuestra confusión, dificultad ni una decisión bloqueada. Conservar la pregunta y barrier:null.',
  },
  {
    id: 'restraint-es-03', language: 'es', topic: 'practical_needs', decision: 'keep',
    text: 'Todavía espero que el colegio me confirme el día de la visita. Sin ese día no puedo reservar a la persona que cuidará a mi hijo.',
    initial: [observation('visita_pendiente', 'outcome', 'pending', 'Todavía espero que el colegio me confirme el día de la visita. Sin ese día no puedo reservar a la persona que cuidará a mi hijo.', {
      statement: 'La confirmación del día de la visita sigue pendiente y bloquea la organización del cuidado del hijo.',
      barrier: 'No puede reservar el cuidado del hijo sin conocer el día de la visita.',
    })],
    mechanisms: ['clean_waiting_dependency', 'preserve_explicit_barrier'],
    required: [['outcome', ['pending'], true]],
    barrierQuotes: ['Sin ese día no puedo reservar a la persona que cuidará a mi hijo.'],
    notes: 'La espera impide concretamente organizar el cuidado. No borrar esta barrera válida ni inferir una reserva ya realizada.',
  },
  {
    id: 'restraint-es-04', language: 'es', topic: 'college_basics',
    text: 'Entiendo que hay clases obligatorias. No sé cómo distinguirlas de las clases que puedo elegir, y por eso no puedo preparar mi lista.',
    initial: [observation('clases_obligatorias', 'understanding', 'reported', 'Entiendo que hay clases obligatorias.')],
    expected: [
      observation('clases_obligatorias', 'understanding', 'reported', 'Entiendo que hay clases obligatorias.'),
      observation('distinguir_clases', 'understanding', 'uncertain', 'No sé cómo distinguirlas de las clases que puedo elegir, y por eso no puedo preparar mi lista.', {
        barrier: 'No distingue las clases obligatorias de las que puede elegir, lo que impide preparar la lista.',
      }),
    ],
    mechanisms: ['partial_understanding', 'omitted_knowledge_barrier', 'blocked_next_step'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    barrierQuotes: ['No sé cómo distinguirlas de las clases que puedo elegir, y por eso no puedo preparar mi lista.'],
    notes: 'Conservar lo que sí entiende y registrar el obstáculo concreto. Una pregunta abierta con el mismo contenido es otra representación válida de la incertidumbre.',
  },
  {
    id: 'restraint-es-05', language: 'es', topic: 'finding_help',
    text: 'Intenté abrir la información sobre cómo pedir ayuda en el campus. El único enlace da un error y no pude leer la información.',
    initial: [observation('abrir_informacion', 'action', 'attempted', 'Intenté abrir la información sobre cómo pedir ayuda en el campus.')],
    expected: [
      observation('abrir_informacion', 'action', 'attempted', 'Intenté abrir la información sobre cómo pedir ayuda en el campus.'),
      observation('enlace_fallido', 'outcome', 'unsuccessful', 'El único enlace da un error y no pude leer la información.', {
        barrier: 'El único enlace da un error e impide leer cómo pedir ayuda.', linksTo: 'abrir_informacion',
      }),
    ],
    mechanisms: ['omitted_access_barrier', 'omitted_unsuccessful_result'],
    required: [['action', ['attempted']], ['outcome', ['unsuccessful'], true]],
    barrierQuotes: ['El único enlace da un error y no pude leer la información.'],
    notes: 'Registrar el resultado fallido y el enlace que bloquea el acceso. No inventar que la persona leyó la información, recibió ayuda o envió una petición.',
  },
  {
    id: 'restraint-es-06', language: 'es', topic: 'family_support', reporter: 'family',
    text: 'Soy su tía. Yo puedo leer la carta en español, pero mi sobrino dice que no entiende para qué sirve el número de identificación del colegio.',
    initial: [observation('carta_legible', 'understanding', 'reported', 'Yo puedo leer la carta en español, pero mi sobrino dice que no entiende para qué sirve el número de identificación del colegio.', {
      statement: 'El sobrino entiende para qué sirve el número de identificación del colegio.', reportedBy: 'unknown',
    })],
    expected: [observation('carta_legible', 'understanding', 'uncertain', 'Yo puedo leer la carta en español, pero mi sobrino dice que no entiende para qué sirve el número de identificación del colegio.', {
      statement: 'La tía informa que su sobrino no entiende para qué sirve el número de identificación del colegio.',
      barrier: 'El sobrino no entiende la función del número de identificación del colegio.',
    })],
    mechanisms: ['family_attribution', 'false_child_understanding', 'omitted_knowledge_barrier'],
    required: [['understanding', ['uncertain'], true]], forbidden: [['understanding', 'reported']],
    barrierQuotes: ['mi sobrino dice que no entiende para qué sirve el número de identificación del colegio.'],
    notes: 'Poder leer un idioma no demuestra comprender este trámite. La tía reporta la incertidumbre del sobrino; no atribuir comprensión al estudiante.',
  },
  {
    id: 'restraint-mixed-01', language: 'mixed', topic: 'enrollment', decision: 'keep',
    text: 'The college email says my seat at the welcome workshop is reserved, pero no dice que ya completé la inscripción. I have not completed enrollment.',
    initial: [
      observation('workshop_seat', 'outcome', 'positive', 'The college email says my seat at the welcome workshop is reserved', {
        episodeKey: 'workshop_reservation', statement: 'The welcome workshop seat is reserved.',
      }),
      observation('enrollment_pending', 'outcome', 'pending', 'I have not completed enrollment.', {
        episodeKey: 'enrollment_completion', statement: 'Enrollment has not been completed.',
      }),
    ],
    mechanisms: ['clean_narrow_success', 'mixed_negation', 'separate_milestones', 'no_inferred_action'],
    required: [['outcome', ['positive']], ['outcome', ['pending']]], forbidden: [['action', 'completed']],
    notes: 'Keep the reserved workshop seat and incomplete enrollment as distinct milestones. Do not infer who booked the seat or invent completed enrollment, a new barrier, or a translation edit.',
  },
  {
    id: 'restraint-mixed-02', language: 'mixed', topic: 'paths', decision: 'keep',
    text: 'Are there college classes about making movies? Solo tengo curiosidad; it is not a problem I need to solve.',
    initial: [observation('film_classes', 'question', 'open', 'Are there college classes about making movies?', {
      statement: 'Asks out of curiosity whether colleges offer classes about making movies.',
    })],
    mechanisms: ['clean_optional_question', 'no_invented_barrier', 'mixed_language_restraint'],
    required: [['question', ['open']]],
    notes: 'The English question and statement are valid within a mixed-language source. Do not translate them or turn curiosity into an obstacle.',
  },
  {
    id: 'restraint-mixed-03', language: 'mixed', topic: 'practical_needs', decision: 'keep',
    text: 'I am waiting for the campus bus schedule. Sin ese horario no puedo decidir si llegaré a tiempo después de mi trabajo.',
    initial: [observation('bus_schedule_pending', 'outcome', 'pending', 'I am waiting for the campus bus schedule. Sin ese horario no puedo decidir si llegaré a tiempo después de mi trabajo.', {
      statement: 'The student is waiting for the campus bus schedule and cannot determine whether arrival after work is feasible.',
      barrier: 'Sin el horario no puede determinar si llegará a tiempo después del trabajo.',
    })],
    mechanisms: ['clean_waiting_dependency', 'preserve_explicit_barrier', 'mixed_language_restraint'],
    required: [['outcome', ['pending'], true]],
    barrierQuotes: ['Sin ese horario no puedo decidir si llegaré a tiempo después de mi trabajo.'],
    notes: 'Preserve the specific planning dependency, not just the generic wait. English statement plus Spanish barrier is valid; do not change language for style.',
  },
  {
    id: 'restraint-mixed-04', language: 'mixed', topic: 'applications',
    text: 'I have not signed the permission page, todavía no. I cannot tell which line needs my signature, so I plan to ask someone before I sign.',
    initial: [observation('permission_signed', 'action', 'completed', 'I have not signed the permission page, todavía no.', {
      statement: 'The student signed the permission page.',
    })],
    expected: [observation('permission_signed', 'action', 'intended', 'I cannot tell which line needs my signature, so I plan to ask someone before I sign.', {
      statement: 'Plans to ask which line needs a signature before signing; the permission page is not signed.',
      barrier: 'Cannot tell which line needs a signature.',
    })],
    mechanisms: ['mixed_negation', 'false_completion', 'omitted_knowledge_barrier'],
    required: [['action', ['intended'], true]], forbidden: [['action', 'completed'], ['outcome', 'positive']],
    barrierQuotes: ['I cannot tell which line needs my signature'],
    notes: 'Repair the false completion and preserve the explicit signature-line obstacle in a field. A linked open question or uncertain understanding with that barrier is also defensible; no attempt or failure is reported.',
  },
  {
    id: 'restraint-mixed-05', language: 'mixed', topic: 'practical_needs',
    text: 'The welcome email arrived, eso sí. But the only way to register for the online introduction needs video, and my internet keeps disconnecting, so I could not finish registering.',
    initial: [observation('welcome_email', 'outcome', 'positive', 'The welcome email arrived, eso sí.')],
    expected: [
      observation('welcome_email', 'outcome', 'positive', 'The welcome email arrived, eso sí.'),
      observation('registration_failed', 'outcome', 'unsuccessful', 'But the only way to register for the online introduction needs video, and my internet keeps disconnecting, so I could not finish registering.', {
        barrier: 'The internet keeps disconnecting during required video registration.', linksTo: 'welcome_email',
      }),
    ],
    mechanisms: ['obstacle_after_progress', 'omitted_access_barrier', 'omitted_unsuccessful_result'],
    required: [['outcome', ['positive']], ['outcome', ['unsuccessful'], true]],
    barrierQuotes: ['my internet keeps disconnecting, so I could not finish registering.'],
    notes: 'Receiving the email does not mean registration finished. Keep delivery and capture the explicit connectivity barrier and failed registration; do not infer an attendance outcome.',
  },
  {
    id: 'restraint-mixed-06', language: 'mixed', topic: 'family_support', reporter: 'parent',
    text: 'I am the parent. I know the campus building name, pero mi hija no entiende cómo encontrar ese edificio en el mapa. She says the symbols confuse her.',
    initial: [observation('building_known', 'understanding', 'reported', 'I know the campus building name, pero mi hija no entiende cómo encontrar ese edificio en el mapa.', {
      statement: 'The daughter knows the building and how to find it on the map.', reportedBy: 'unknown',
    })],
    expected: [
      observation('building_known', 'understanding', 'reported', 'I know the campus building name', {
        statement: 'The parent knows the campus building name.',
      }),
      observation('daughter_map_uncertain', 'understanding', 'uncertain', 'mi hija no entiende cómo encontrar ese edificio en el mapa. She says the symbols confuse her.', {
        statement: 'The parent reports that the daughter cannot find the building on the map because the symbols confuse her.',
        barrier: 'La hija no entiende los símbolos del mapa ni cómo encontrar el edificio.',
      }),
    ],
    mechanisms: ['family_attribution', 'false_child_understanding', 'omitted_knowledge_barrier'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    barrierQuotes: ['mi hija no entiende cómo encontrar ese edificio en el mapa. She says the symbols confuse her.'],
    notes: 'Both observations are reported by the parent, but only the parent knows the building name. Preserve the daughter-specific map obstacle and do not invent successful navigation.',
  },
];

export const restraintVersion = 'first-generation-verifier-restraint-18-v1';

function canonical(items, row, source) {
  return items.map(value => ({
    key: value.key, episodeKey: value.episodeKey ?? row.id, topic: value.topic ?? row.topic,
    barrier: value.barrier, kind: value.kind, status: value.status,
    statement: value.statement, quote: value.quote,
    reportedBy: value.reportedBy ?? source.reporter, language: source.language,
    occurredAt: null, linksTo: value.linksTo, corrects: value.corrects,
  }));
}

export function restraintCases() {
  return rows.map((row, index) => {
    const source = {
      id: `cal-${row.id}`, version: 1, accountId: `fictional-${row.id}`, studentId: 'student-one',
      reporter: row.reporter ?? 'student', language: row.language, kind: 'transcript',
      recordedAt: new Date(Date.UTC(2026, 10, 7, 10, index)).toISOString(), text: row.text, synthetic: true,
    };
    const initialCandidate = { schemaVersion: 1, items: canonical(row.initial, row, source) };
    return {
      id: row.id, split: 'heldout', source, initialCandidate, existingItems: [], priorSources: [],
      expected: { decision: row.decision ?? 'revise', extraction: { schemaVersion: 1, items: canonical(row.expected ?? row.initial, row, source) } },
      rubric: {
        mechanisms: [...row.mechanisms],
        requiredObservations: row.required.map(([kind, statuses, requireBarrier = false]) => ({ kind, statuses: [...statuses], requireBarrier })),
        forbiddenKindStatuses: (row.forbidden ?? []).map(pair => [...pair]), noCorrection: true,
        requirePriorLink: false, preserveInitialKeys: row.decision === 'keep' ? row.initial.map(value => value.key) : [],
        barrierEvidence: [...(row.barrierQuotes ?? [])], notes: row.notes, humanReview: 'pending',
        labelProvenance: 'independently authored fictional restraint holdout; not human adjudicated',
      },
    };
  });
}
