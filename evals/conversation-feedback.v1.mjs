// Invented examples only. Never copy student transcripts or summary excerpts here.
const turn=(role,text)=>({role,text});
const pairs=[
 ['correction','summary_correction','planning',
  ['I want engineering.','Actually, I changed my mind. I want nursing.'],['Quiero ingeniería.','En realidad cambié de opinión. Quiero enfermería.'],
  ['The student wants engineering.','The student changed their interest from engineering to nursing.'],['El estudiante quiere ingeniería.','El estudiante cambió su interés de ingeniería a enfermería.']],
 ['open-question','summary_omission','finance',
  ['My main worry is transportation costs. How would I pay for the bus?'],['Mi principal preocupación es el transporte. ¿Cómo pagaría el autobús?'],
  ['The student discussed college.','The student is worried about transportation costs and still needs help finding ways to pay for the bus.'],['El estudiante habló de la universidad.','Al estudiante le preocupa el transporte y todavía necesita explorar cómo pagar el autobús.']],
 ['unsupported','summary_unsupported_claim','admissions',
  ['I am considering applying. I have not received any admission decision.'],['Estoy pensando en solicitar ingreso. No he recibido ninguna decisión de admisión.'],
  ['The student has been accepted by a university.','The student is considering applying and has not received an admission decision.'],['El estudiante fue aceptado en una universidad.','El estudiante considera solicitar ingreso y no ha recibido una decisión de admisión.']],
 ['suggestion','summary_commitment','loans',
  ['I might compare loan options, but I have not decided to borrow.'],['Quizá compare préstamos, pero no he decidido pedir uno.'],
  ['The student agreed to take out a loan.','The student may compare loans but has not decided to borrow.'],['El estudiante acordó pedir un préstamo.','El estudiante quizá compare préstamos, pero no decidió pedir uno.']],
 ['uncertainty','summary_uncertainty','planning',
  ['Is this course approved?','The source check failed. I cannot verify approval; we need to check the official course list.'],['¿Está aprobado este curso?','Falló la consulta. No puedo verificar la aprobación; necesitamos revisar la lista oficial.'],
  ['The course is officially approved.','Course approval remains unverified because the source check failed; the official list needs checking.'],['El curso está oficialmente aprobado.','La aprobación sigue sin verificarse porque falló la consulta; falta revisar la lista oficial.']]
];
export const feedbackCases=pairs.flatMap(([id,category,topic,en,es,enSummaries,esSummaries])=>['en','es'].flatMap(language=>[false,true].map(clean=>({
 id:`${id}-${language}-${clean?'faithful':'defect'}`,kind:'summary',synthetic:true,language,topic,
 turns:(language==='en'?en:es).map((text,i)=>turn(id==='uncertainty'&&i===1?'assistant':'user',text)),
 summary:(language==='en'?enSummaries:esSummaries)[clean?1:0],expected:clean?[]:[category],
 rubric:clean?'Faithful concise meaning; do not require verbatim repetition.':'Flag the material discrepancy; do not treat a discussion as verified fact.'
}))));
feedbackCases.push(
 {id:'english-repeat',kind:'conversation',language:'en',turns:[turn('user','How can I pay for college?'),turn('assistant','We can explore financial aid.'),turn('user','How can I pay for college?'),turn('assistant','Let us consider grants.')],expected:['repeated_question']},
 {id:'spanish-clarity',kind:'conversation',language:'es',turns:[turn('user','No entiendo. Explícamelo otra vez.'),turn('assistant','Vamos paso a paso.')],expected:['clarification_request']},
 {id:'spanish-label',kind:'conversation',language:'es',turns:[turn('user','Mi hija quiere estudiar medicina.'),{...turn('assistant','Work-study. Es una opción que podemos explicar.'),language:'es'}],expected:[]},
 {id:'spanish-drift',kind:'conversation',language:'es',turns:[{...turn('user','Mi hija quiere estudiar medicina.'),language:'es'},turn('assistant','Es una opción para estudiar. You can ask me about college and I will help you.')],expected:['language_drift']},
 {id:'pending-answer',kind:'conversation',language:'en',complete:false,turns:[turn('user','How do I apply?')],expected:[]},
 {id:'missing-answer',kind:'conversation',language:'en',turns:[turn('user','How do I apply?')],expected:['possibly_unanswered']},
 {id:'smooth-topic-change',kind:'conversation',language:'en',turns:[turn('user','Planning'),turn('assistant','We can plan.'),turn('user','Costs'),turn('assistant','Let us talk about costs.')],events:[{event:'guide_update_complete'}],expected:[]},
 {id:'failed-topic-change',kind:'conversation',language:'en',turns:[turn('user','Costs'),turn('assistant','Let us try again.')],events:[{event:'guide_update_failed'},{event:'lookup_failure'}],expected:['topic_transition_failure','tool_failure']}
);
for(const c of feedbackCases){c.synthetic=true;c.topic??='planning';c.complete??=true;}
