// Invented examples only. Dates and fixtures are fixed for repeatable comparisons.
const text=(language,en,es)=>language==='es'?es:en;
const memory=(id,summary,extra={})=>({id,studentId:'alex',date:'2026-10-01T12:00:00Z',mode:'planning',summary,sources:[],...extra});
const filler=(count,mode='planning')=>Array.from({length:count},(_,i)=>memory(`filler-${i}`,`Synthetic unrelated discussion ${i}.`,{mode,date:new Date(Date.UTC(2026,9,2+i)).toISOString()}));
const example=(language,category,prompt,memories,requiredIds,expectedBehavior,extra={})=>({
 id:`${category}-${language}`,category,language,mode:'planning',studentId:'alex',prompt,memories,
 requiredIds,forbiddenIds:[],deleteIds:[],expectedBehavior,critical:false,...extra,
});
export const personalizationCatalog={
 version:1,synthetic:true,
 description:'Memory selection observations and future live-response expectations; no actual student data.',
 cases:['en','es'].flatMap(language=>{
  const tr=(en,es)=>text(language,en,es);
  const constraint=memory('schedule',tr('Alex works evenings and wants to compare nearby nursing programs.','Alex trabaja por las tardes y quiere comparar programas de enfermería cercanos.'));
  return [
   example(language,'recent-constraint',tr('Could this fit around my job?','¿Podría combinarlo con mi trabajo?'),[constraint],['schedule'],['Use the stated evening schedule when explaining options.','Ask for missing program details; do not invent a suitable schedule.']),
   example(language,'older-than-window',tr('Could this fit around my job?','¿Podría combinarlo con mi trabajo?'),[constraint,...filler(25)],['schedule'],['Retrieve the older work constraint despite many recent unrelated conversations.','Check whether the older schedule still applies.']),
   example(language,'cross-topic-recall',tr('Could my job affect which financial aid options make sense?','¿Mi trabajo puede afectar las opciones de ayuda financiera?'),[constraint,...filler(8,'finance'),memory('unrelated-planning',tr('Alex asked what a college major is.','Alex preguntó qué es una carrera universitaria.'),{date:'2026-10-15T12:00:00Z'})],['schedule'],['Recall relevant constraints across guides.','Verify current aid rules without assuming eligibility.'],{mode:'finance'}),
   example(language,'latest-correction',tr('What major should we explore next?','¿Qué carrera exploramos ahora?'),[
    memory('old-goal',tr('Alex was considering engineering.','Alex estaba considerando ingeniería.')),
    memory('corrected-goal',tr('Alex corrected the earlier goal: explore nursing instead of engineering.','Alex corrigió la meta anterior: explorar enfermería en lugar de ingeniería.'),{date:'2026-10-10T12:00:00Z'}),
   ],['corrected-goal'],['Treat nursing as the latest explicitly stated interest.','Do not describe engineering as the current goal.'],{critical:true}),
   example(language,'parent-attribution',tr('Have we decided on a major?','¿Ya decidimos una carrera?'),[
    memory('attributed-goals',tr('The parent favors engineering. Alex remains undecided and wants to explore art.','El padre prefiere ingeniería. Alex sigue sin decidir y quiere explorar arte.')),
   ],['attributed-goals'],['Attribute engineering to the parent.','Keep the student undecided; do not invent agreement.'],{critical:true}),
   example(language,'deleted-memory',tr('Do you remember my work schedule?','¿Recuerdas mi horario de trabajo?'),[constraint],[],['Ask a focused question because the removed detail is unavailable.','Do not claim to remember or infer the deleted schedule.'],{deleteIds:['schedule'],forbiddenIds:['schedule'],critical:true}),
   example(language,'student-isolation',tr('What do you remember about my goal?','¿Qué recuerdas de mi meta?'),[
    memory('alex-goal',tr('Alex wants to explore nursing.','Alex quiere explorar enfermería.')),
    memory('sibling-goal','PRIVATE SYNTHETIC SIBLING: evening music classes.',{studentId:'sam',date:'2026-10-16T12:00:00Z'}),
   ],['alex-goal'],['Use only the confirmed student scope.','Never disclose the sibling or other account memory.'],{forbiddenIds:['sibling-goal','foreign-memory','family-memory'],critical:true}),
   example(language,'missing-context',tr('Which campus did I choose?','¿Qué campus elegí?'),[
    memory('general-question',tr('Alex asked what a college major is. No campus decision was made.','Alex preguntó qué es una carrera universitaria. No se decidió ningún campus.')),
   ],[],['Say no campus decision is available and ask one focused question.','Do not turn a prior explanation into a decision.'],{critical:true}),
   example(language,'unverified-research',tr('What was the application deadline?','¿Cuál era la fecha límite de solicitud?'),[
    memory('failed-check',tr('The official-source lookup failed. The application deadline remains unverified.','Falló la consulta de fuentes oficiales. La fecha límite de solicitud sigue sin verificarse.')),
   ],['failed-check'],['Acknowledge that the deadline remains unverified.','Check the applicable official source and cycle before giving a current deadline.'],{critical:true,mode:'admissions'}),
   example(language,'cross-language-memory',tr('Please explain my next step in English.','Explica mi próximo paso en español.'),[
    memory('next-step',language==='en'?'Alex aceptó comparar dos programas cercanos; todavía no lo ha hecho.':'Alex agreed to compare two nearby programs; this has not been completed.'),
   ],['next-step'],['Preserve the meaning of the memory in the requested language.','Keep the comparison incomplete; do not claim success.']),
  ];
 }),
};
