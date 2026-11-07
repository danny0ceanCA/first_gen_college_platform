// Recorded output regression: public research figures only, no account data.
// Figures are test evidence, not assertions about currently published costs.
export const discussionExamples={
 en:{answer:'For new California-resident UC Berkeley undergraduates in 2026–27, published before-aid budgets are US$49,692 off campus versus US$39,428 with relatives, including parents, per academic year. Neither total is a university bill. [1]',
 spoken:'Here’s the comparison. For 2026 and ’27, Berkeley’s published before-aid budget for California residents is 49,692 dollars if living off campus, and 39,428 if living with parents or relatives. Those estimates include health insurance and nine-month living costs, and they’re not an exact bill from the university. The off-campus number, for example, is an estimate and can vary. Does that top-line difference help so far?'},
 es:{answer:'Para estudiantes nuevos de California en UC Berkeley, los presupuestos publicados antes de ayuda de 2026–27 son US$49,692 fuera del campus y US$39,428 con familiares, incluidos los padres, por año académico. No son una factura de la universidad. [1]',
 spoken:'Aquí está la comparación. En Berkeley, para residentes de California en 2026 y 27, el presupuesto antes de ayuda es de cuarenta y nueve mil seiscientos noventa y dos dólares fuera del campus, o treinta y nueve mil cuatrocientos veintiocho con padres o familiares. Incluye seguro y gastos de vida estimados, no una factura exacta. ¿Te ayuda esa diferencia?'},
};

// Public research regression only. Scripted speech, not playback evidence.
export const correctedBudgetExamples={
 en:{question:'What is Berkeley’s off-campus total for 2026–27?',
  finding:{subject:'UC Berkeley California-resident undergraduate, off-campus apartment',aspect:'total_budget',status:'partial',
   answer:'UC Berkeley’s published 2026–27 California-resident undergraduate off-campus budget is $49,692 before aid. Tuition and fees are $18,214. [1]',
   qualification:'The table is for undergraduates, not a separate transfer-only estimate; 2027–28 is unconfirmed. [1]'},
  spoken:'For Berkeley, the published off-campus total for 2026–27 is forty-nine thousand six hundred and ninety-two dollars before aid. It’s an undergraduate estimate, rather than a separate transfer-only figure.',
  wrongScenario:'For Berkeley, the published on-campus total for 2026–27 is $49,692 before aid.',
  limitation:'I could not verify Berkeley’s off-campus total for 2026–27.',
  wrongLimitation:'I could not verify Berkeley’s on-campus total for 2026–27.',
  concern:'That sounds like a lot. I am worried about it.',
 },
 es:{question:'¿Cuál es el presupuesto total de Berkeley fuera del campus para 2026–27?',
  finding:{subject:'UC Berkeley estudiantes de pregrado, fuera del campus',aspect:'total_budget',status:'partial',
   answer:'El presupuesto de UC Berkeley fuera del campus para estudiantes de pregrado de California en 2026–27 es $49,692 antes de ayuda. La matrícula y las cuotas son $18,214. [1]',
   qualification:'Es una tabla general de pregrado, no una cifra exclusiva para transferencias; 2027–28 no está confirmado. [1]'},
  spoken:'En Berkeley, el presupuesto total fuera del campus para 2026–27 es de cuarenta y nueve mil seiscientos noventa y dos dólares antes de ayuda. Es una estimación general de pregrado, no una cifra exclusiva para estudiantes de transferencia.',
  wrongScenario:'En Berkeley, el presupuesto total dentro del campus para 2026–27 es de $49,692 antes de ayuda.',
  limitation:'No pude verificar el presupuesto total de Berkeley fuera del campus para 2026–27.',
  wrongLimitation:'No pude verificar el presupuesto total de Berkeley dentro del campus para 2026–27.',
  concern:'Eso parece mucho. Me preocupa.',
 },
};
