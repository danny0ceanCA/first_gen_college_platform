// Fictional evaluation cases for an offline second-model semantic verifier.
// Expected decisions, expected extractions, mechanism tags, and rubrics are
// evaluation-only. Never send them to either extraction or verification model.
// Development cases may inform implementation; heldout cases must remain
// unread by prompt authors until the evaluated prompt/configuration is frozen.

const item = (key, kind, status, quote, options = {}) => ({
  key, kind, status, quote, statement: options.statement ?? quote,
  barrier: options.barrier ?? null, linksTo: options.linksTo ?? null,
  corrects: null, ...options,
});

const rows = [
  {
    id: 'verify-dev-en-01', split: 'development', language: 'en', topic: 'finding_help',
    text: 'I tried to send a question through the college help form. It rejected the message because the required subject box was blank, and nothing was sent.',
    initial: [item('send_question', 'action', 'attempted', 'I tried to send a question through the college help form.')],
    expected: [
      item('send_question', 'action', 'attempted', 'I tried to send a question through the college help form.'),
      item('message_not_sent', 'outcome', 'unsuccessful', 'It rejected the message because the required subject box was blank, and nothing was sent.', {
        barrier: 'The required subject box was blank, so the form rejected the message.', linksTo: 'send_question',
      }),
    ],
    mechanisms: ['omitted_unsuccessful_result', 'omitted_barrier'],
    required: [['action', ['attempted']], ['outcome', ['unsuccessful'], true]],
    notes: 'The attempted contact and its failed result both matter. Add the stated barrier; do not claim the college received the question.',
  },
  {
    id: 'verify-dev-en-02', split: 'development', language: 'en', topic: 'practical_needs',
    text: 'I emailed the campus office to ask about a bus pass. They have not replied, so I still do not know whether I can get one.',
    initial: [
      item('bus_pass_request', 'action', 'attempted', 'I emailed the campus office to ask about a bus pass.'),
      item('bus_pass_pending', 'outcome', 'pending', 'They have not replied, so I still do not know whether I can get one.', { linksTo: 'bus_pass_request' }),
    ],
    expected: [
      item('bus_pass_request', 'action', 'completed', 'I emailed the campus office to ask about a bus pass.'),
      item('bus_pass_pending', 'outcome', 'pending', 'They have not replied, so I still do not know whether I can get one.', { linksTo: 'bus_pass_request' }),
    ],
    mechanisms: ['completed_request_understated'],
    required: [['action', ['completed']], ['outcome', ['pending']]],
    forbidden: [['outcome', 'positive']],
    notes: 'Sending the email is complete; obtaining a bus pass remains pending. Repair the action without upgrading the requested benefit.',
  },
  {
    id: 'verify-dev-en-03', split: 'development', language: 'en', topic: 'college_basics', decision: 'keep',
    text: 'I understand that a syllabus describes a class. I still cannot tell which assignments count most toward the grade. Could someone help me read that part?',
    initial: [
      item('syllabus_known', 'understanding', 'reported', 'I understand that a syllabus describes a class.'),
      item('grading_question', 'question', 'open', 'I still cannot tell which assignments count most toward the grade. Could someone help me read that part?', {
        barrier: 'Cannot tell which assignments count most toward the grade.',
      }),
    ],
    mechanisms: ['clean_partial_understanding', 'supported_open_question'],
    required: [['understanding', ['reported']], ['question', ['open'], true]],
    notes: 'Preserve the narrow known fact and unresolved question. Do not erase supported understanding merely because another part remains unclear or rewrite open into partial unnecessarily.',
  },
  {
    id: 'verify-dev-es-01', split: 'development', language: 'es', topic: 'costs',
    text: 'Reconozco la palabra préstamo en la carta, pero no entiendo cuándo tendría que devolver ese dinero. ¿Me pueden explicar cuándo se empieza a pagar?',
    initial: [item('prestamo_comprendido', 'understanding', 'reported', 'Reconozco la palabra préstamo en la carta, pero no entiendo cuándo tendría que devolver ese dinero.', {
      statement: 'La persona entiende cuándo tendría que devolver el préstamo.',
    })],
    expected: [
      item('prestamo_comprendido', 'understanding', 'uncertain', 'Reconozco la palabra préstamo en la carta, pero no entiendo cuándo tendría que devolver ese dinero.', {
        barrier: 'No entiende cuándo tendría que devolver el préstamo.',
      }),
      item('pregunta_pago', 'question', 'open', '¿Me pueden explicar cuándo se empieza a pagar?', {
        statement: 'Pide una explicación de cuándo comienza a pagar el préstamo.', barrier: 'No entiende cuándo comienza el pago.', linksTo: 'prestamo_comprendido',
      }),
    ],
    mechanisms: ['false_understanding', 'omitted_question', 'omitted_barrier'],
    required: [['understanding', ['uncertain'], true], ['question', ['open', 'partial'], true]],
    forbidden: [['understanding', 'reported']],
    notes: 'Reconocer una palabra no establece que se entienda el proceso. Mantener la incertidumbre explícita y la petición de ayuda.',
  },
  {
    id: 'verify-dev-es-02', split: 'development', language: 'es', topic: 'family_support', reporter: 'parent',
    text: 'Soy el papá. Yo entiendo dónde está el enlace para la reunión de familias. Mi hija todavía no sabe qué le van a pedir cuando se conecte.',
    initial: [
      item('enlace_conocido', 'understanding', 'reported', 'Yo entiendo dónde está el enlace para la reunión de familias.', {
        statement: 'La hija entiende dónde está el enlace para la reunión de familias.', reportedBy: 'unknown',
      }),
    ],
    expected: [
      item('enlace_conocido', 'understanding', 'reported', 'Yo entiendo dónde está el enlace para la reunión de familias.', {
        statement: 'El padre informa que él entiende dónde está el enlace para la reunión de familias.',
      }),
      item('hija_incierta', 'understanding', 'uncertain', 'Mi hija todavía no sabe qué le van a pedir cuando se conecte.', {
        statement: 'El padre informa que su hija todavía no sabe qué le van a pedir al conectarse.', barrier: 'La hija no sabe qué le pedirán al conectarse.',
      }),
    ],
    mechanisms: ['wrong_actor', 'unknown_reporter_despite_explicit_parent', 'omitted_child_uncertainty'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    notes: 'El padre es quien reporta ambos hechos. El conocimiento del padre no se puede atribuir a la hija; reportedBy identifica al informante, no a la persona descrita.',
  },
  {
    id: 'verify-dev-es-03', split: 'development', language: 'es', topic: 'enrollment', decision: 'keep',
    text: 'La escuela confirmó que recibió mi petición para cambiar la hora de orientación. Todavía no ha aprobado el cambio; debo esperar la respuesta.',
    initial: [
      item('peticion_recibida', 'outcome', 'positive', 'La escuela confirmó que recibió mi petición para cambiar la hora de orientación.', {
        episodeKey: 'recepcion_peticion', statement: 'La escuela confirmó la recepción de la petición de cambio de hora.',
      }),
      item('cambio_pendiente', 'outcome', 'pending', 'Todavía no ha aprobado el cambio; debo esperar la respuesta.', {
        episodeKey: 'cambio_hora', statement: 'El cambio de hora de orientación sigue pendiente de aprobación.',
      }),
    ],
    mechanisms: ['clean_narrow_receipt_success', 'separate_pending_requested_result'],
    required: [['outcome', ['positive']], ['outcome', ['pending']]],
    notes: 'La recepción sí se confirmó; la aprobación no. Conservar los resultados separados. No borrar todo resultado positivo por la existencia de otra parte pendiente.',
  },
  {
    id: 'verify-dev-mixed-01', split: 'development', language: 'mixed', topic: 'applications',
    text: 'I have not pressed submit en la solicitud. I only plan to review it with my cousin this weekend; todavía no la revisamos.',
    initial: [item('application_review', 'action', 'completed', 'I only plan to review it with my cousin this weekend; todavía no la revisamos.', {
      statement: 'The student reviewed the application with their cousin.',
    })],
    expected: [item('application_review', 'action', 'intended', 'I only plan to review it with my cousin this weekend; todavía no la revisamos.', {
      statement: 'The student plans to review the application with their cousin this weekend; they have not reviewed it yet.',
    })],
    mechanisms: ['negated_completion', 'future_intent'],
    required: [['action', ['intended']]], forbidden: [['action', 'completed'], ['outcome', 'positive']],
    notes: 'An explicit plan is not a completed review or submission. Do not invent an unsuccessful result for an action that was not attempted.',
  },
  {
    id: 'verify-dev-mixed-02', split: 'development', language: 'mixed', topic: 'family_support', reporter: 'parent',
    text: 'I joined that online family welcome gathering y me quedé hasta el final. We discussed how parents can ask the school for help.',
    prior: {
      text: 'I requested a family welcome gathering. Todavía no me han dicho cuándo será.',
      items: [item('waiting', 'outcome', 'pending', 'Todavía no me han dicho cuándo será.', { statement: 'The parent is waiting for the family welcome gathering to be scheduled.' })],
    },
    initial: [item('family_attendance', 'action', 'completed', 'I joined that online family welcome gathering y me quedé hasta el final.')],
    expected: [
      item('family_attendance', 'action', 'completed', 'I joined that online family welcome gathering y me quedé hasta el final.'),
      item('family_gathering_occurred', 'outcome', 'positive', 'I joined that online family welcome gathering y me quedé hasta el final.', {
        linksTo: 'prior:waiting', statement: 'The family welcome gathering that the parent was waiting for took place.',
      }),
    ],
    mechanisms: ['omitted_pending_fulfillment', 'missing_existing_prior_link'],
    required: [['action', ['completed']], ['outcome', ['positive']]], requirePriorLink: true,
    notes: 'Actual attendance resolves the narrow wait for this event. Add a positive event result linked to the provided pending item; this is ordinary progress, not correction or proof of improved understanding.',
  },
  {
    id: 'verify-dev-mixed-03', split: 'development', language: 'mixed', topic: 'finding_help', decision: 'keep',
    text: 'I called the number for college support y nadie contestó. I did complete the call, but I did not reach a person.',
    initial: [
      item('phone_call', 'action', 'completed', 'I did complete the call, but I did not reach a person.', { statement: 'The student completed dialing and making the call, but reached no person.' }),
      item('contact_failed', 'outcome', 'unsuccessful', 'I called the number for college support y nadie contestó.', {
        barrier: 'No one answered the college support number.', linksTo: 'phone_call',
      }),
    ],
    mechanisms: ['clean_completed_narrow_action', 'unsuccessful_goal'],
    required: [['action', ['completed']], ['outcome', ['unsuccessful'], true]],
    notes: 'Do not downgrade the explicitly completed phone call just because reaching staff failed. The action scope and unsuccessful outcome are already correctly separated.',
  },

  // Untouched holdout: do not inspect or expose these rows to prompt authors
  // until the verifier prompt and model configuration have been frozen.
  {
    id: 'verify-held-en-01', split: 'heldout', language: 'en', topic: 'costs',
    text: 'I want to ask the school to explain the charges on my bill. I have not contacted anyone yet; I will write the question after work.',
    initial: [item('bill_question', 'action', 'completed', 'I have not contacted anyone yet; I will write the question after work.', {
      statement: 'The student contacted the school about the charges on the bill.',
    })],
    expected: [item('bill_question', 'action', 'intended', 'I have not contacted anyone yet; I will write the question after work.', {
      statement: 'The student plans to write a question about the bill after work and has not contacted the school yet.',
    })],
    mechanisms: ['negated_completion', 'future_intent'],
    required: [['action', ['intended']]], forbidden: [['action', 'completed'], ['outcome', 'positive']],
    notes: 'The completed-contact claim is contradicted. Retain only the plan; do not invent a failed attempt or a sent question.',
  },
  {
    id: 'verify-held-en-02', split: 'heldout', language: 'en', topic: 'practical_needs', decision: 'keep',
    text: 'I need to correct what I said about the housing interest form: I have only started it. Nothing has been submitted yet.',
    initial: [item('housing_form_started', 'action', 'attempted', 'I need to correct what I said about the housing interest form: I have only started it. Nothing has been submitted yet.', {
      statement: 'The student has started the housing interest form but has not submitted it.',
    })],
    mechanisms: ['clean_no_prior_correction_target', 'no_invented_reference'],
    required: [['action', ['attempted']]], forbidden: [['action', 'completed'], ['outcome', 'positive']],
    notes: 'No prior saved observation was supplied. Preserve the supported current statement without inventing a correction or link target. A statement that the student is correcting an earlier report is allowed, but an absent record cannot be superseded.',
  },
  {
    id: 'verify-held-en-03', split: 'heldout', language: 'en', topic: 'family_support', reporter: 'parent',
    text: 'I am her mother. I know which office receives the school records, but my daughter says she still does not know what an official record means.',
    initial: [item('record_office_known', 'understanding', 'reported', 'I know which office receives the school records, but my daughter says she still does not know what an official record means.', {
      statement: 'The daughter knows which office receives the records and understands what an official record means.', reportedBy: 'unknown',
    })],
    expected: [
      item('record_office_known', 'understanding', 'reported', 'I know which office receives the school records', {
        statement: 'The mother reports that she knows which office receives the school records.',
      }),
      item('daughter_record_uncertainty', 'understanding', 'uncertain', 'my daughter says she still does not know what an official record means.', {
        statement: 'The mother reports that her daughter does not yet understand what an official record means.', barrier: 'The daughter does not understand what an official record means.',
      }),
    ],
    mechanisms: ['wrong_actor', 'unknown_reporter_despite_explicit_parent', 'false_child_understanding'],
    required: [['understanding', ['reported']], ['understanding', ['uncertain'], true]],
    notes: 'Attribute both observations to the parent reporter while preserving the distinct actors and the child uncertainty. The parent knowledge is not evidence that the daughter understands records.',
  },
  {
    id: 'verify-held-es-01', split: 'heldout', language: 'es', topic: 'practical_needs',
    text: 'Intenté pedir una cita para conocer el servicio de cuidado infantil del campus. La página me sacó antes de confirmar y no quedó ninguna cita reservada.',
    initial: [item('pedir_cita', 'action', 'attempted', 'Intenté pedir una cita para conocer el servicio de cuidado infantil del campus.')],
    expected: [
      item('pedir_cita', 'action', 'attempted', 'Intenté pedir una cita para conocer el servicio de cuidado infantil del campus.'),
      item('reserva_fallida', 'outcome', 'unsuccessful', 'La página me sacó antes de confirmar y no quedó ninguna cita reservada.', {
        barrier: 'La página cerró el proceso antes de confirmar la reserva.', linksTo: 'pedir_cita',
      }),
    ],
    mechanisms: ['omitted_unsuccessful_result', 'omitted_barrier'],
    required: [['action', ['attempted']], ['outcome', ['unsuccessful'], true]],
    notes: 'Debe conservar el resultado fallido y el obstáculo explícito, además del intento. No hay cita confirmada.',
  },
  {
    id: 'verify-held-es-02', split: 'heldout', language: 'es', topic: 'finding_help',
    text: 'Envié mi pregunta sobre dónde encontrar el calendario escolar al correo de ayuda. Aún no me han contestado y sigo sin encontrarlo.',
    initial: [
      item('pregunta_enviada', 'action', 'attempted', 'Envié mi pregunta sobre dónde encontrar el calendario escolar al correo de ayuda.'),
      item('respuesta_pendiente', 'outcome', 'pending', 'Aún no me han contestado y sigo sin encontrarlo.', { linksTo: 'pregunta_enviada', barrier: 'Todavía no encuentra el calendario escolar.' }),
    ],
    expected: [
      item('pregunta_enviada', 'action', 'completed', 'Envié mi pregunta sobre dónde encontrar el calendario escolar al correo de ayuda.'),
      item('respuesta_pendiente', 'outcome', 'pending', 'Aún no me han contestado y sigo sin encontrarlo.', { linksTo: 'pregunta_enviada', barrier: 'Todavía no encuentra el calendario escolar.' }),
    ],
    mechanisms: ['completed_request_understated'],
    required: [['action', ['completed']], ['outcome', ['pending'], true]], forbidden: [['outcome', 'positive']],
    notes: 'Enviar la pregunta ya sucedió; encontrar el calendario o recibir respuesta no. Conservar el obstáculo y el resultado pendiente.',
  },
  {
    id: 'verify-held-es-03', split: 'heldout', language: 'es', topic: 'college_basics', decision: 'keep',
    text: 'Ya fui a esa charla de introducción a las clases universitarias y me quedé hasta que terminó. Todavía tengo preguntas sobre las tareas.',
    prior: {
      text: 'Pedí ir a una charla sobre las clases universitarias. Sigo esperando que me asignen una fecha para la charla.',
      items: [item('espera_charla', 'outcome', 'pending', 'Sigo esperando que me asignen una fecha para la charla.')],
    },
    initial: [
      item('asistencia_charla', 'action', 'completed', 'Ya fui a esa charla de introducción a las clases universitarias y me quedé hasta que terminó.'),
      item('charla_realizada', 'outcome', 'positive', 'Ya fui a esa charla de introducción a las clases universitarias y me quedé hasta que terminó.', {
        statement: 'La charla que esperaba ya ocurrió y la persona asistió hasta el final.', linksTo: 'prior:espera_charla',
      }),
      item('dudas_tareas', 'question', 'open', 'Todavía tengo preguntas sobre las tareas.', { barrier: 'Persisten preguntas sobre las tareas.' }),
    ],
    mechanisms: ['clean_pending_fulfillment', 'remaining_question', 'ordinary_progress_not_correction'],
    required: [['action', ['completed']], ['outcome', ['positive']], ['question', ['open'], true]], requirePriorLink: true,
    notes: 'La charla sí terminó, aunque quedan dudas. Preservar el resultado positivo limitado y el enlace previo; no cambiarlo a pendiente ni convertirlo en una corrección del estado histórico.',
  },
  {
    id: 'verify-held-mixed-01', split: 'heldout', language: 'mixed', topic: 'college_basics',
    text: 'I can find the words student portal en la página. Pero todavía no entiendo para qué tengo que usarlo ni qué debo revisar allí.',
    initial: [item('portal_understood', 'understanding', 'reported', 'I can find the words student portal en la página. Pero todavía no entiendo para qué tengo que usarlo ni qué debo revisar allí.', {
      statement: 'The student understands how and why to use the student portal.',
    })],
    expected: [item('portal_understood', 'understanding', 'uncertain', 'I can find the words student portal en la página. Pero todavía no entiendo para qué tengo que usarlo ni qué debo revisar allí.', {
      statement: 'The student can find the words but does not yet understand the purpose of the student portal or what to check there.',
      barrier: 'Does not understand why to use the portal or what to review there.',
    })],
    mechanisms: ['false_understanding', 'omitted_barrier'],
    required: [['understanding', ['uncertain'], true]], forbidden: [['understanding', 'reported']],
    notes: 'Finding a label is not operational understanding. Keep the explicit uncertainty; do not invent a completed portal action.',
  },
  {
    id: 'verify-held-mixed-02', split: 'heldout', language: 'mixed', topic: 'family_support', reporter: 'parent',
    text: 'We have a date for la sesión de preguntas para familias, but we have not attended it yet. La reunión será después de mi turno de trabajo.',
    initial: [
      item('family_session_attended', 'action', 'completed', 'We have a date for la sesión de preguntas para familias, but we have not attended it yet.', { statement: 'The family attended the scheduled question session.' }),
      item('family_session_done', 'outcome', 'positive', 'We have a date for la sesión de preguntas para familias, but we have not attended it yet.', { statement: 'The family question session has taken place.', linksTo: 'family_session_attended' }),
    ],
    expected: [item('family_session_pending', 'outcome', 'pending', 'We have a date for la sesión de preguntas para familias, but we have not attended it yet.', {
      statement: 'The family has a date for the question session but has not attended yet; attendance is still pending.',
    })],
    mechanisms: ['negated_attendance', 'false_positive_result'],
    required: [['outcome', ['pending']]], forbidden: [['action', 'completed']],
    notes: 'Having a scheduled date does not establish attendance. A separate narrowly phrased scheduling success can be supported, but neither completed attendance nor a positive attendance result may survive.',
  },
  {
    id: 'verify-held-mixed-03', split: 'heldout', language: 'mixed', topic: 'family_support', reporter: 'parent', decision: 'keep',
    text: 'The school sent me the family guide en español, y ya la recibí. I can read the language, but todavía no entiendo el paso sobre autorizaciones.',
    initial: [
      item('spanish_guide_received', 'outcome', 'positive', 'The school sent me the family guide en español, y ya la recibí.', { episodeKey: 'guide_delivery', statement: 'The parent received the family guide in Spanish.' }),
      item('authorization_uncertain', 'understanding', 'uncertain', 'I can read the language, but todavía no entiendo el paso sobre autorizaciones.', {
        episodeKey: 'authorization_meaning', statement: 'The parent can read the language but does not yet understand the authorization step.', barrier: 'The parent does not understand the authorization step.',
      }),
    ],
    mechanisms: ['clean_narrow_delivery_success', 'remaining_uncertainty', 'parent_attribution'],
    required: [['outcome', ['positive']], ['understanding', ['uncertain'], true]], forbidden: [['understanding', 'reported']],
    notes: 'Delivery is complete even though understanding is not. Retain both scoped facts and parent attribution. Do not erase delivery or infer that readable language means full understanding.',
  },
];

export const verificationVersion = 'first-generation-verification-18-v1';

function sourceFor(row, index, prior = false) {
  return {
    id: `cal-${row.id}${prior ? '-prior' : ''}`, version: 1,
    accountId: `fictional-${row.id}`, studentId: 'student-one',
    reporter: row.reporter ?? 'student', language: row.language, kind: 'transcript',
    recordedAt: new Date(Date.UTC(2026, 10, 6, prior ? 9 : 10, index)).toISOString(),
    text: prior ? row.prior.text : row.text, synthetic: true,
  };
}

function canonicalItems(items, row, source) {
  return items.map(value => ({
    key: value.key, episodeKey: value.episodeKey ?? row.id, topic: value.topic ?? row.topic,
    barrier: value.barrier, kind: value.kind, status: value.status,
    statement: value.statement, quote: value.quote,
    reportedBy: value.reportedBy ?? source.reporter, language: source.language,
    occurredAt: null,
    linksTo: value.linksTo?.startsWith('prior:') ? `cal-${row.id}-prior@1#${value.linksTo.slice(6)}` : value.linksTo,
    corrects: value.corrects,
  }));
}

export function verificationCases() {
  return rows.map((row, index) => {
    const source = sourceFor(row, index);
    const priorSources = row.prior ? [sourceFor(row, index, true)] : [];
    const existingItems = row.prior ? canonicalItems(row.prior.items, row, priorSources[0]).map(value => ({
      ...value, id: `${priorSources[0].id}@1#${value.key}`, sourceId: priorSources[0].id,
      sourceVersion: 1, accountId: source.accountId, studentId: source.studentId, state: 'current',
    })) : [];
    const initialCandidate = { schemaVersion: 1, items: canonicalItems(row.initial, row, source) };
    const expectedExtraction = { schemaVersion: 1, items: canonicalItems(row.expected ?? row.initial, row, source) };
    return {
      id: row.id, split: row.split, source, initialCandidate, existingItems, priorSources,
      expected: { decision: row.decision ?? 'revise', extraction: expectedExtraction },
      rubric: {
        mechanisms: [...row.mechanisms],
        requiredObservations: row.required.map(([kind, statuses, requireBarrier = false]) => ({ kind, statuses: [...statuses], requireBarrier })),
        forbiddenKindStatuses: (row.forbidden ?? []).map(pair => [...pair]), noCorrection: true,
        requirePriorLink: row.requirePriorLink ?? false,
        preserveInitialKeys: row.decision === 'keep' ? row.initial.map(value => value.key) : [],
        notes: row.notes, humanReview: 'pending',
        labelProvenance: 'independently authored fictional verifier evaluation; not independently adjudicated',
      },
    };
  });
}
