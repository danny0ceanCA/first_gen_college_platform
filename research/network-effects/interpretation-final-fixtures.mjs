// Final untouched fictional interpretation holdout. The source wording is kept
// separate from prompt/configuration selection until the chosen setup freezes.
const rows = [
  ['interpret-final-en-01','en','finding_help','student',
    'I requested a first meeting with a student mentor at the college. No meeting time has been assigned, and I am waiting for them to arrange it.',
    [['action','completed','I requested a first meeting with a student mentor at the college.'],
      ['outcome','pending','No meeting time has been assigned, and I am waiting for them to arrange it.']],
    {scenario:'interpret-final-en-mentor',required:[['action',['completed']],['outcome',['pending']]],forbidden:[['outcome','positive']],pipelineExpected:{outcomeState:'pending'}}],
  ['interpret-final-en-02','en','finding_help','student',
    'I sat down with that student mentor and finished our first meeting. We talked about which college office I could approach for help.',
    [['action','completed','I sat down with that student mentor and finished our first meeting.'],
      ['outcome','positive','I sat down with that student mentor and finished our first meeting.']],
    {scenario:'interpret-final-en-mentor',prior:'interpret-final-en-01',priorItem:2,required:[['action',['completed']],['outcome',['positive']]],fulfillsPendingCaseId:'interpret-final-en-01',
      notes:'The requested first meeting happened, resolving only its narrow scheduling wait. Talking about offices does not establish comprehension or a further completed action.'}],
  ['interpret-final-en-03','en','practical_needs','student',
    'I tried to request a loaner laptop from the college. The request page froze before it could send anything, so my request never reached the equipment office.',
    [['action','attempted','I tried to request a loaner laptop from the college.'],
      ['outcome','unsuccessful','The request page froze before it could send anything, so my request never reached the equipment office.']],
    {barrier:'Frozen request page prevented sending the laptop request',required:[['action',['attempted']],['outcome',['unsuccessful'],true]]}],
  ['interpret-final-en-04','en','costs','student',
    'I understand that the award letter lists money for school. I still do not understand which amounts I would have to pay back. Could someone explain that part to me?',
    [['question','partial','I understand that the award letter lists money for school. I still do not understand which amounts I would have to pay back. Could someone explain that part to me?']],
    {barrier:'Does not understand which award amounts require repayment',required:[['question',['open','partial'],true]],
      notes:'Known purpose of the letter and unresolved repayment question must remain distinct. A separate limited understanding observation is supported, but not full understanding of repayment obligations.'}],

  ['interpret-final-es-01','es','finding_help','student',
    'Solicité una reunión con una persona mentora de la escuela para hablar de cómo empezar. Todavía no me han asignado una hora; sigo esperando que programen la reunión.',
    [['action','completed','Solicité una reunión con una persona mentora de la escuela para hablar de cómo empezar.'],
      ['outcome','pending','Todavía no me han asignado una hora; sigo esperando que programen la reunión.']],
    {scenario:'interpret-final-es-mentor',required:[['action',['completed']],['outcome',['pending']]],forbidden:[['outcome','positive']],pipelineExpected:{outcomeState:'pending'}}],
  ['interpret-final-es-02','es','finding_help','student',
    'Ya tuve esa reunión con la persona mentora y la terminamos. Conversamos sobre las opciones que tengo para comenzar mis estudios.',
    [['action','completed','Ya tuve esa reunión con la persona mentora y la terminamos.'],
      ['outcome','positive','Ya tuve esa reunión con la persona mentora y la terminamos.']],
    {scenario:'interpret-final-es-mentor',prior:'interpret-final-es-01',priorItem:2,required:[['action',['completed']],['outcome',['positive']]],fulfillsPendingCaseId:'interpret-final-es-01',
      notes:'The meeting occurred, so its scheduling wait is fulfilled. Do not infer a chosen program, new understanding or enrollment. Ordinary progress is not a correction.'}],
  ['interpret-final-es-03','es','applications','student',
    'Intenté agregar el nombre de mi preparatoria a la solicitud de visita. El buscador se quedó en blanco y no me permitió guardar ese paso.',
    [['action','attempted','Intenté agregar el nombre de mi preparatoria a la solicitud de visita.'],
      ['outcome','unsuccessful','El buscador se quedó en blanco y no me permitió guardar ese paso.']],
    {barrier:'El buscador en blanco impidió guardar el nombre de la preparatoria',required:[['action',['attempted']],['outcome',['unsuccessful'],true]]}],
  ['interpret-final-es-04','es','college_basics','student',
    'Ya entiendo dónde mirar los horarios de clase. Pero no entiendo qué significa la carga académica que aparece junto al horario. ¿Me pueden explicar esa parte?',
    [['question','partial','Ya entiendo dónde mirar los horarios de clase. Pero no entiendo qué significa la carga académica que aparece junto al horario. ¿Me pueden explicar esa parte?']],
    {barrier:'No entiende el significado de carga académica',required:[['question',['open','partial'],true]],
      notes:'Knowing where to view schedules does not establish understanding of academic load. An additional accurately scoped understanding observation is supported.'}],

  ['interpret-final-mixed-01','mixed','family_support','parent',
    'I asked the school for una conversación para familias sobre cómo ayudar a mi hijo. They have not arranged that conversation yet; todavía espero que me den una hora.',
    [['action','completed','I asked the school for una conversación para familias sobre cómo ayudar a mi hijo.'],
      ['outcome','pending','They have not arranged that conversation yet; todavía espero que me den una hora.']],
    {scenario:'interpret-final-mixed-family',required:[['action',['completed']],['outcome',['pending']]],forbidden:[['outcome','positive']],pipelineExpected:{outcomeState:'pending'}}],
  ['interpret-final-mixed-02','mixed','family_support','parent',
    'I took part in that family conversation y me quedé hasta que terminó. We talked about the different ways families can support a new college student.',
    [['action','completed','I took part in that family conversation y me quedé hasta que terminó.'],
      ['outcome','positive','I took part in that family conversation y me quedé hasta que terminó.']],
    {scenario:'interpret-final-mixed-family',prior:'interpret-final-mixed-01',priorItem:2,required:[['action',['completed']],['outcome',['positive']]],fulfillsPendingCaseId:'interpret-final-mixed-01',
      notes:'Parent attendance fulfills the specific requested conversation. Discussion alone establishes neither parent nor student understanding; no other school step is complete.'}],
  ['interpret-final-mixed-03','mixed','finding_help','student',
    'I tried to leave my question en el buzón de ayuda de la escuela. The system said the mailbox was full, así que no pude dejar la pregunta.',
    [['action','attempted','I tried to leave my question en el buzón de ayuda de la escuela.'],
      ['outcome','unsuccessful','The system said the mailbox was full, así que no pude dejar la pregunta.']],
    {barrier:'Full help mailbox prevented leaving the question',required:[['action',['attempted']],['outcome',['unsuccessful'],true]]}],
  ['interpret-final-mixed-04','mixed','applications','student',
    'I understand that I need to send the application. Pero no entiendo qué quiere decir supporting documents ni cuáles me piden. Can someone explain what that part means?',
    [['question','partial','I understand that I need to send the application. Pero no entiendo qué quiere decir supporting documents ni cuáles me piden. Can someone explain what that part means?']],
    {barrier:'Does not understand supporting documents or which are requested',required:[['question',['open','partial'],true]],
      notes:'Known need to submit an application does not establish understanding of supporting documents. Keep unresolved confusion as a question and barrier.'}],
];

export const finalInterpretationVersion = 'first-generation-interpretation-final-12-v1';

export function finalInterpretationCases() {
  return rows.map(([id,language,topic,reporter,text,observations,options={}],index)=>{
    const scenario=options.scenario||id;
    const source={id:`cal-${id}`,version:1,accountId:`fictional-${scenario}`,studentId:'student-one',reporter,language,kind:'transcript',
      recordedAt:new Date(Date.UTC(2026,10,5,15,index)).toISOString(),text,synthetic:true};
    const expected={schemaVersion:1,items:observations.map(([kind,status,quote],itemIndex)=>({
      key:`expected-${itemIndex+1}`,episodeKey:scenario,topic,barrier:options.barrier||null,kind,status,statement:quote,quote,
      reportedBy:reporter,language,occurredAt:null,linksTo:options.prior?`cal-${options.prior}@1#expected-${options.priorItem||1}`:null,corrects:null,
    }))};
    return {id,scenario,split:'heldout',source,expected,rubric:{
      priorCaseId:options.prior||null,correctionCaseId:null,expectedBarrier:options.barrier||null,
      forbiddenKindStatuses:options.forbidden||[],pipelineExpected:options.pipelineExpected||null,
      interpretationExpected:{requiredObservations:(options.required||[]).map(([kind,statuses,requireBarrier=false])=>({kind,statuses,requireBarrier})),
        forbiddenKindStatuses:options.forbidden||[],noCorrection:true,priorLinkRequired:Boolean(options.prior),fulfillsPendingCaseId:options.fulfillsPendingCaseId||null},
      notes:options.notes||'Preserve source-supported process states, incomplete understanding and obstacles; no inferred completion.',
      humanReview:'pending',labelProvenance:'final untouched author-labelled fictional interpretation holdout; not independently adjudicated',
    }};
  });
}
