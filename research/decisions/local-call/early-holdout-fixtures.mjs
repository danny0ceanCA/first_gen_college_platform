// Independently authored fictional holdout: 12 EN/ES pairs and four code-switch
// cases. Keep separate from development examples and prompt tuning. Freeze this
// file's hash before the first model run; report failures without editing cases.
// These snapshots test classification, not whether Live may speak or play audio.
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

function fixture(id, language, text, action, eligible, options = {}) {
  const { sourceText, assistantText = '', kind = 'simpler_explanation',
    status = 'validated', retainedPrefix = false, clearSupport = false,
    supportKind = null } = options;
  const scope = { callId: 'fictional-holdout-call', studentId: 'fictional-holdout-student',
    language, connectionEpoch: 0, scopeEpoch: 0 };
  const currentId = id + '-current';
  const sourceId = retainedPrefix ? currentId + '-1' : id + '-need-1';
  const currentIds = retainedPrefix ? [sourceId, currentId + '-2'] : [currentId + '-1'];
  const originOutputRevision = sourceText ? 4 : 0;
  const assistantOutputRevision = originOutputRevision + (assistantText ? 1 : 0);
  const snapshot = {
    provisional: true, complete: false, language, text,
    stamp: { ...scope, contributionId: currentId, revision: currentIds.length },
    sourceEventIds: currentIds,
    sourceTextEnds: retainedPrefix ? [sourceText.length, text.length] : [text.length],
    supportRevision: sourceText ? 1 : 0,
    assistantOutputRevision,
    recentDialogue: [
      ...(sourceText && !retainedPrefix ? [{ role: 'user', text: sourceText, complete: true }] : []),
      ...(assistantText ? [{ role: 'assistant', text: assistantText, complete: true }] : []),
    ],
    assistantSinceNeed: { text: assistantText,
      sourceEventIds: assistantText ? [id + '-assistant-5'] : [],
      revision: assistantOutputRevision, evidenceComplete: true, playbackClaim: false },
  };
  if (sourceText) snapshot.activeSupport = {
    kind, status, sourceText,
    stamp: { ...scope, contributionId: retainedPrefix ? currentId : id + '-need', revision: 1 },
    sourceEventIds: [sourceId], supportRevision: 1, originOutputRevision,
  };
  return { id, snapshot, expected: { action, eligible, clearSupport,
    ...(supportKind ? { supportKind } : {}) } };
}

const deposit = {
  en: 'I do not understand whether the enrollment deposit is an extra fee or part of tuition.',
  es: 'No entiendo si el depósito de matrícula es un cobro adicional o parte de la colegiatura.',
};
const depositAnswer = {
  en: 'The enrollment deposit is credited toward your first tuition bill. It is part of that bill, not a second tuition charge.',
  es: 'El depósito de matrícula se descuenta de tu primera factura de colegiatura. Forma parte de esa factura; no es otro cobro de colegiatura.',
};

export const earlyHoldoutFixtures = deepFreeze([
  fixture('holdout-en-background', 'en',
    "I can't tell what the enrollment deposit covers. The message I received yesterday was",
    'simplify', true, { supportKind: 'simpler_explanation' }),
  fixture('holdout-es-background', 'es',
    'No me queda claro qué cubre el depósito de matrícula. El correo que recibí ayer decía',
    'simplify', true, { supportKind: 'simpler_explanation' }),

  fixture('holdout-en-pending-correction', 'en',
    "I don't understand how transfer credits are counted. Wait, what I'm trying to ask is",
    'unclear', false),
  fixture('holdout-es-pending-correction', 'es',
    'No entiendo cómo se cuentan los créditos transferidos. Espera, lo que intento preguntar es',
    'unclear', false),

  fixture('holdout-en-corrected-subject', 'en',
    'I understand the deposit now; my actual question is why the fee waiver can be denied. Could you explain that simply?',
    'simplify', true, { sourceText: deposit.en, supportKind: 'simpler_explanation' }),
  fixture('holdout-es-corrected-subject', 'es',
    'Ya entiendo el depósito; mi pregunta en realidad es por qué pueden negar la exención de la cuota. ¿Me lo explicas de forma sencilla?',
    'simplify', true, { sourceText: deposit.es, supportKind: 'simpler_explanation' }),

  fixture('holdout-en-resolved', 'en',
    'Now I see it: the deposit is applied to the first bill. That settles my question.',
    'clear', false, { sourceText: deposit.en, clearSupport: true }),
  fixture('holdout-es-resolved', 'es',
    'Ahora lo veo: el depósito se aplica a la primera factura. Con eso queda resuelta mi duda.',
    'clear', false, { sourceText: deposit.es, clearSupport: true }),

  fixture('holdout-en-quoted', 'en',
    "My cousin wrote, 'I don't understand course credits.' I understand mine and only want the upload address.",
    'none', false),
  fixture('holdout-es-quoted', 'es',
    "Mi prima escribió: 'No entiendo los créditos de las materias'. Yo sí entiendo los míos y solo quiero la dirección para subir el documento.",
    'none', false),

  fixture('holdout-en-conditional', 'en',
    "If the prerequisites confuse me later, I'll ask for help. Today I just need the deadline.",
    'none', false),
  fixture('holdout-es-conditional', 'es',
    'Si más adelante me confunden los requisitos previos, pediré ayuda. Hoy solo necesito la fecha límite.',
    'none', false),

  fixture('holdout-en-example', 'en',
    'Could you show me one everyday example of how a transfer credit works?',
    'example', true, { supportKind: 'concrete_example' }),
  fixture('holdout-es-example', 'es',
    '¿Me muestras un ejemplo cotidiano de cómo funciona un crédito transferido?',
    'example', true, { supportKind: 'concrete_example' }),

  fixture('holdout-en-starting-point', 'en',
    "There are so many enrollment tasks that I don't know where to begin. What is one first step I can take?",
    'starting_point', true, { supportKind: 'starting_point' }),
  fixture('holdout-es-starting-point', 'es',
    'Hay tantos trámites de inscripción que no sé por dónde comenzar. ¿Cuál sería un primer paso que pueda dar?',
    'starting_point', true, { supportKind: 'starting_point' }),

  fixture('holdout-en-already-addressed', 'en',
    'The deposit line on my portal bill is the one I meant.',
    'none', false, { sourceText: deposit.en, assistantText: depositAnswer.en, clearSupport: true }),
  fixture('holdout-es-already-addressed', 'es',
    'Me refería al renglón del depósito que aparece en mi factura del portal.',
    'none', false, { sourceText: deposit.es, assistantText: depositAnswer.es, clearSupport: true }),

  fixture('holdout-en-acknowledgment', 'en',
    'The deposit line on my portal bill is the one I meant.',
    'continue_simplifying', true, { sourceText: deposit.en,
      assistantText: "I'm listening. Tell me more.", supportKind: 'simpler_explanation' }),
  fixture('holdout-es-acknowledgment', 'es',
    'Me refería al renglón del depósito que aparece en mi factura del portal.',
    'continue_simplifying', true, { sourceText: deposit.es,
      assistantText: 'Te escucho. Cuéntame un poco más.', supportKind: 'simpler_explanation' }),

  fixture('holdout-en-renewed-confusion', 'en',
    "I still can't connect those two amounts. Could you explain that in simpler words?",
    'simplify', true, {
      sourceText: 'I do not understand how my deposit changes the amount due.',
      assistantText: 'The deposit is subtracted from the tuition total, which lowers the balance due.',
      supportKind: 'simpler_explanation',
    }),
  fixture('holdout-es-renewed-confusion', 'es',
    'Todavía no entiendo cómo se relacionan esas dos cantidades. ¿Me lo explicas con palabras más sencillas?',
    'simplify', true, {
      sourceText: 'No entiendo cómo cambia mi depósito la cantidad que debo pagar.',
      assistantText: 'El depósito se resta del total de la colegiatura y por eso baja el saldo pendiente.',
      supportKind: 'simpler_explanation',
    }),

  fixture('holdout-en-elaborative-actually', 'en',
    "I don't understand residency rules. I actually read the handbook yesterday, and",
    'simplify', true, { supportKind: 'simpler_explanation' }),
  fixture('holdout-es-elaborative-actually', 'es',
    'No entiendo las reglas de residencia. De hecho, ayer leí el manual y',
    'simplify', true, { supportKind: 'simpler_explanation' }),

  fixture('holdout-mixed-incomplete', 'en',
    "I don't understand whether los créditos de",
    'unclear', false),
  fixture('holdout-mixed-topic-change', 'es',
    'Eso ya quedó claro. Let us switch topics: ¿cuándo abre la biblioteca?',
    'clear', false, { sourceText: deposit.es, clearSupport: true }),
  fixture('holdout-mixed-exception', 'es',
    "Sí entiendo las fechas y los formularios, but I don't understand the placement test.",
    'simplify', true, { supportKind: 'simpler_explanation' }),
  fixture('holdout-mixed-retained-example', 'en',
    'Could you give me a concrete example of a prerequisite? Es que the course list on my screen',
    'example', true, {
      sourceText: 'Could you give me a concrete example of a prerequisite?',
      kind: 'concrete_example', status: 'provisional', retainedPrefix: true,
      supportKind: 'concrete_example',
    }),
]);
