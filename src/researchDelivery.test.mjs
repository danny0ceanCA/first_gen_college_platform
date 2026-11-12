import {decodedResearchContext} from './researchContext.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {researchDelivery,researchAnswerOverlap} from './researchDelivery.mjs';
import {capturePayload} from './voiceCapture.mjs';
import {discussionExamples,correctedBudgetExamples} from './researchDiscussion.fixture.mjs';
import {researchEvidence} from './voiceResearchProgress.mjs';
import {publicRecord} from '../server/research-record.fixtures.mjs';

const examples={
 en:{answer:'The published annual tuition is 12345 dollars at Example University.',qualification:'Housing is separate, and this is not a personalized aid award.',reply:'We can take this one step at a time.',caller:'Can we talk about the essays while you check?',ack:'Mm-hmm.'},
 es:{answer:'La matrícula anual publicada es de 12345 dólares en la Universidad Ejemplo.',qualification:'La vivienda es aparte y no es una oferta de ayuda personal.',reply:'Podemos avanzar juntos un paso a la vez.',caller:'¿Podemos hablar de los ensayos mientras investigas?',ack:'Claro.'},
};
function fixture(){
 let time=0,sequence=0,quiet=true;const tasks=new Map(),sent=[],events=[];
 const delivery=researchDelivery({send:e=>sent.push(e),emit:e=>events.push(e),canAnnounce:()=>quiet,now:()=>time,
  schedule:(fn,ms)=>{const id=++sequence;tasks.set(id,{fn,at:time+ms});return id;},cancel:id=>tasks.delete(id),id:()=>`id-${++sequence}`});
 const advance=ms=>{const end=time+ms;while(true){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=end;};
 return {delivery,sent,events,tasks,advance,quiet:value=>quiet=value,
  ready(language='en',overrides={},options){const x=examples[language];delivery.ready({jobId:'job',requestId:'request',revision:1,question:x.caller,result:{text:x.answer+'\n'+x.qualification,status:'source_check_completed'},...overrides},options);},
  ack(){for(const e of sent.filter(e=>e.type==='session.thinking.append'))delivery.receive({type:'session.thinking.appended',client_event_id:e.event_id});},
  announcements:()=>sent.filter(e=>e.type==='session.commentary.append'),
 };
}

for(const language of ['en','es'])for(const progress of [false,true])test(`${language}: a completed ${progress?'checking acknowledgment':'courtesy acknowledgment'} releases ready research at the next pause`,()=>{
 const f=fixture(),question=language==='es'?'¿Cuál es la matrícula?':'What is the tuition?';
 f.delivery.supersede('new_request',question);f.delivery.caller();f.delivery.callerStopped();
 f.ready(language,{question},{awaitingReply:true});f.ack();
 // The result arrives after the caller finishes, while a native reply
 // is still pending. Its completed acknowledgment releases the opportunity.
 f.quiet(false);
 f.delivery.reply(progress?(language==='es'?'Claro. Voy a revisar eso.':"Sure. I’ll check that."):(language==='es'?'Claro.':'Sure.'),{audible:true});
 f.advance(1000);assert.equal(f.announcements().length,0,'never talk over playback');
 f.quiet(true);f.advance(250);
 assert.equal(f.announcements().length,1,'no extra three-second reply wait');
 assert.ok(f.events.some(e=>e.deliveryReason==='acknowledgment_only'));
 assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),'progress is not delivery');
 f.ack();f.advance(2000);assert.equal(f.announcements().length,1,'only one result contribution');
 f.delivery.clear();
});

for(const language of ['en','es'])test(`${language}: an interrupted progress fragment cannot release a pending ordinary reply`,()=>{
 const f=fixture();f.delivery.caller();f.ready(language,{}, {awaitingReply:true});f.ack();
 f.delivery.reply(language==='es'?'Voy a revisar eso.':"I’ll check that.",{audible:true,interrupted:true,completedText:''});
 f.advance(1500);assert.equal(f.announcements().length,0);f.delivery.clear();
});

for(const language of ['en','es'])test(`${language}: a completed contact and hours limitation is not announced twice`,()=>{
 const f=fixture(),es=language==='es',evidence=publicRecord('student_support',language);
 evidence.complete=false;
 evidence.facts=['contact','hours'].map(key=>({...evidence.facts[0],key,label:key==='contact'?'Contact email':'Office hours',status:'unverified',value:null}));
 evidence.expectedFacts=['contact','hours'];
 const finding={subject:'Eastview College',aspect:'other',status:'partial',answer:'Contact email and office hours are unverified. [1]',qualification:'Official pages did not establish these details. [1]',evidence};
 const result={status:'source_check_completed',sources:[{url:'https://eastview.edu/support'}],voiceBrief:{status:'partial',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 const question=es?'¿Cuál es el correo de contacto y el horario de Eastview?':'What are the contact email and office hours for Eastview?';
 f.delivery.supersede('new_request',question);f.quiet(false);
 f.ready(language,{question,result});f.ack();
 f.delivery.reply(es?'El correo de contacto y el horario de Eastview siguen sin verificar.':'Eastview contact email and office hours are still unverified.',{audible:true});
 f.quiet(true);f.advance(4000);
 assert.equal(f.announcements().length,0);
 assert.ok(f.events.some(event=>event.deliveryStage==='evidence_overlap_observed'&&event.deliveryReason==='requested_portion_answered'));
 const context=decodedResearchContext(f.sent.filter(event=>event.type==='session.thinking.append').map(event=>JSON.parse(event.content)));
 assert.deepEqual(context.continuation,{pending:false,statusIsSilent:true,announceOnlyNewUsefulFacts:true});
});

for(const language of ['en','es'])test(`${language}: a typed verified application fee does not hide the requested unverified deadline`,()=>{
 const f=fixture(),es=language==='es',evidence=publicRecord('scholarships',language);
 evidence.topic='admissions';evidence.scope.cycle=null;evidence.scope.term=null;
 evidence.expectedFacts=['application_fee'];
 evidence.facts=[{...evidence.facts[0],key:'application_fee',label:es?'Tarifa de solicitud':'Application fee',amount:100,bound:'exact',unit:'per application',qualification:'Nonrefundable. Current policy; entry cycle not specified.'}];
 const findings=[
  {subject:'Eastview College',aspect:'deadline',status:'unverified',answer:'The fall 2027 deadline is unverified.',qualification:'Requested entry cycle not confirmed.'},
  {subject:'Eastview College',aspect:'other',status:'verified',answer:'Application fee: $100. [1]',qualification:'Nonrefundable. Current policy; entry cycle not specified. [1]',evidence},
 ];
 const question=es?'¿Cuál es la fecha límite y tarifa de solicitud de Eastview College para otoño de 2027?':'What are the fall 2027 application deadline and application fee for Eastview College?';
 const result={status:'source_check_completed',sources:[{url:'https://eastview.edu/admissions'}],voiceBrief:{status:'partial',answer:findings[1].answer,qualification:findings[1].qualification,nextStep:'',findings}};
 f.delivery.supersede('new_request',question);f.quiet(false);f.ready(language,{question,result});
 const context=decodedResearchContext(f.sent.filter(event=>event.type==='session.thinking.append').map(event=>JSON.parse(event.content)));
 assert.equal(context.findings.length,2);
 assert.ok(context.findings.some(finding=>finding.aspect==='deadline'&&finding.status==='unverified'));
 assert.ok(context.findings.some(finding=>finding.answer.includes('$100')&&finding.qualification.includes('entry cycle not specified')));
 f.delivery.clear();
});

for(const language of ['en','es'])test(`${language}: saved-trace scoped gap does not trigger a second announcement after the native answer`,()=>{
 const es=language==='es',evidence=publicRecord('scholarships',language);
 evidence.topic='admissions';evidence.scope.cycle=null;evidence.scope.term=null;
 evidence.expectedFacts=['application_fee'];
 evidence.facts=[{...evidence.facts[0],key:'application_fee',label:es?'Tarifa de solicitud':'Application fee',amount:100,bound:'exact',unit:'per application',qualification:'Nonrefundable. Current policy; entry cycle not specified.'}];
 const subject=es?'Eastview College — primer año, otoño de 2027':'Eastview College — fall 2027 first-year';
 const question=es?'¿Cuál es la fecha límite y tarifa de solicitud de Eastview College para otoño de 2027?':'What are the fall 2027 application deadline and application fee for Eastview College?';
 const missing={subject,aspect:'deadline',status:'unverified',answer:es?'La fecha límite solicitada aún no se pudo confirmar.':'The fall 2027 first-year deadline could not be confirmed.',qualification:es?`La información disponible no establece este dato para ${subject}.`:'The requested entry cycle remains unverified.'};
 const fee={subject:'Eastview College',aspect:'other',status:'verified',answer:'Application fee: $100. [1]',qualification:'Nonrefundable. Current policy; entry cycle not specified. [1]',evidence};
 const result={status:'source_check_completed',sources:[{url:'https://eastview.edu/admissions'}],voiceBrief:{status:'partial',answer:fee.answer,qualification:fee.qualification,nextStep:'',findings:[missing,fee]}};
 const spoken=es?'Buena pregunta. Permíteme comprobar eso y te cuento. Estoy revisando fuentes oficiales y algo no se pudo confirmar. La fecha límite para primer año en otoño de 2027 aún no la tengo verificada, pero la tarifa sí está publicada: 100 dólares por solicitud, no reembolsable, con posibilidad de pedir una exención si cumples los requisitos. Esa política se actualizó en septiembre de 2026.':
  'I am checking official sources. The first-year deadline for fall 2027 is still unverified, but the application fee is 100 dollars, nonrefundable. A fee waiver is possible.';
 for(const variant of ['native','new_question','two_subjects','unconfirmed_audio','interrupted']){
  const f=fixture(),current=structuredClone(result);
  if(variant==='two_subjects')current.voiceBrief.findings.push({...missing,subject:'Pine Valley College'});
  f.delivery.supersede('new_request',question);f.quiet(false);f.ready(language,{question,result:current});f.ack();
  if(variant==='new_question'){f.delivery.caller();f.delivery.callerStopped(es?'¿Qué incluye la tarifa?':'What does the fee include?');}
  f.delivery.reply(spoken,{audible:variant!=='unconfirmed_audio',interrupted:variant==='interrupted',completedText:variant==='interrupted'?'':spoken});
  f.quiet(true);f.advance(1500);
  assert.equal(f.events.some(event=>event.deliveryReason==='contextual_gap_observed'),variant==='native',variant);
  if(variant==='native'){
   assert.equal(f.announcements().length,0);
   assert.ok(!f.events.some(event=>event.deliveryStage==='evidence_overlap_observed'),'a scoped gap is not proof the whole answer was heard');
   const updated=structuredClone(current);updated.voiceBrief.findings[0]={...missing,status:'verified',answer:'Eastview College fall 2027 deadline: January 15, 2027. [1]',qualification:'First-year applicants only. [1]'};
   f.ready(language,{question,evidenceVersion:2,result:updated});f.ack();f.advance(500);
   assert.equal(f.announcements().length,1,'new verified evidence remains eligible');
   assert.match(f.announcements()[0].content,/January 15|finding/);
  }
  f.delivery.clear();
 }
});

for(const language of ['en','es'])test(`${language}: unavailable attendance total shares only the supported fee subtotal at the next quiet opportunity`,()=>{
 const f=fixture(),question=language==='es'?'Costo total de asistencia de UC Santa Cruz fuera del campus':'Total cost of attendance for UC Santa Cruz off campus';
 const subject='UC Santa Cruz',amount=language==='es'?'La matrícula y cuotas obligatorias suman USD 17,432.36. [1]':'Tuition and mandatory fees add up to USD 17,432.36. [1]';
 const caveat=language==='es'?'2026–27; excluye el alojamiento.':'2026–27; excludes housing.';
 const result={sources:[{url:'https://ucsc.edu/fees'}],voiceBrief:{status:'partial',answer:amount,qualification:caveat,nextStep:'',findings:[
  {subject,aspect:'total_budget',status:'unverified',answer:'The attendance total is unverified.',qualification:'The off-campus budget is unconfirmed.'},
  {subject,aspect:'housing',status:'unverified',answer:'Rent estimate is unverified.',qualification:'No verified rent allowance.'},
  {subject,aspect:'tuition_fees',status:'partial',answer:amount,qualification:caveat},
 ]}};
 f.delivery.supersede('new_request',question);
 f.quiet(false);
 f.ready(language,{question,researchPending:true,result:researchEvidence(result,false)});
 f.ack();f.advance(500);assert.equal(f.announcements().length,0);
 f.quiet(true);f.advance(500);
 const announcement=f.announcements()[0];
 assert.match(announcement.content,/attendance total is not verified/);
 assert.match(announcement.content,/sourced tuition and fees in finding .*scope and caveat/);
 assert.match(announcement.content,/no overall amount/);
 assert.ok(f.sent.some(event=>event.type==='session.thinking.append'&&event.content.includes('17,432.36')));
 f.ready(language,{question,evidenceVersion:2,researchPending:false,result:researchEvidence(result,false)});
 f.ack();f.advance(2000);assert.equal(f.announcements().length,1);
});

test('a caller asking if the result is ready gets the concise scoped total at the first safe pause',()=>{
 const f=fixture(),question='For comparison with UC Berkeley, verify UC Davis cost of attendance.';
 const answer='UC Davis publishes a 2026–27 California-resident, new-undergraduate budget of USD $49,009 for three quarters in a residence hall, before aid. This is a general undergraduate scenario, not a verified transfer-specific budget. [1]';
 const qualification='The published budget omits the separately required new-student orientation fee; its amount remains unverified. Tuition uses rounded budget figures rather than the precise billing schedule. [2]';
 const result={sources:[{url:'https://ucdavis.edu/budget'},{url:'https://ucdavis.edu/fees'}],
  voiceBrief:{status:'partial',answer,qualification,nextStep:'',findings:[
   {subject:'UC Davis',aspect:'tuition_fees',status:'partial',answer:'Annual tuition and fees: $18,077.13. [2]',qualification},
   {subject:'UC Davis',aspect:'total_budget',status:'partial',answer:'Residence hall budget: $49,009. [1]',qualification},
   {subject:'UC Berkeley',aspect:'total_budget',status:'verified',answer:'Residence hall budget: $54,674. [1]',qualification},
  ]}};
 f.delivery.supersede('new_request',question);
 f.delivery.caller();
 f.delivery.callerStopped('So do you have it?');
 f.quiet(false);
 f.ready('en',{question,result:researchEvidence(result,false)},{awaitingReply:true});
 f.advance(500);
 assert.equal(f.sent.length,0);
 f.quiet(true);
 f.advance(250);
 assert.equal(f.sent[0].type,'session.commentary.append');
 assert.match(f.sent[0].content,/49,009.*orientation fee/s);
 assert.doesNotMatch(f.sent[0].content,/18,077|54,674|UC Berkeley/);
 assert.ok(f.sent.some(event=>event.type==='session.thinking.append'));
 f.ack();f.advance(3500);
 assert.equal(f.announcements().length,1);
});

test('a verified comparison change uses the first quiet boundary without recapping the retained college',()=>{
 const f=fixture(),question='Verify only the requested change for Eastview College (deadline): spring 2028.';
 const findings=[
  {subject:'Eastview College',aspect:'deadline',status:'verified',answer:'Spring 2028 deadline: September 1 [1].',qualification:'First-year applicants only.'},
  {subject:'Pine Valley College',aspect:'deadline',status:'verified',answer:'Fall 2027 deadline: February 1 [2].',qualification:'First-year applicants only.'},
 ];
 const result={sources:[{url:'https://eastview.edu'},{url:'https://pinevalley.edu'}],
  voiceBrief:{status:'verified',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings}};
 f.quiet(false);
 f.delivery.supersede('new_request',question);
 f.ready('en',{question,comparisonSubject:'Eastview College',result});
 f.advance(1000);
 assert.equal(f.announcements().length,0);
 f.quiet(true);
 f.advance(250);
 assert.equal(f.announcements().length,1);
 assert.match(f.announcements()[0].content,/September 1.*First-year applicants only/);
 assert.doesNotMatch(f.announcements()[0].content,/Pine Valley|February 1/);
 f.ack();
 f.advance(3000);
 assert.equal(f.announcements().length,1);
});

for(const [language,ack,followUp,answer,qualification] of [
 ['en','Alright','Alright, what is the difference between a budget and a bill?',
  '2026–27 off-campus budget before aid: $49,692. [1]','California-resident undergraduate estimate. It is not a bill. [1]'],
 ['es','Ajá','Ajá, ¿qué diferencia hay entre un presupuesto y una factura?',
  'Presupuesto 2026–27 fuera del campus antes de la ayuda: $49,692. [1]','Estimado para residentes de California. No es una factura. [1]'],
])test(language+': an acknowledgment releases the finished scoped result at the first quiet tick',()=>{
 const f=fixture(),question=language==='en'?'Verify the cost of attendance and tuition for off-campus housing.':'Verifica el costo de asistencia y la matrícula para vivienda fuera del campus.';
 const findings=[
  {subject:'Example University',aspect:'tuition_fees',status:'verified',answer:'Tuition: $18,214. [1]',qualification},
  {subject:'Example University',aspect:'total_budget',status:'verified',answer,qualification},
 ];
 const result={sources:[{url:'https://example.edu/budget'}],voiceBrief:{status:'verified',answer:findings[0].answer,qualification,nextStep:'',findings}};
 for(const completedTurn of [ack,followUp]){
  const run=completedTurn===ack?f:fixture();
  run.delivery.supersede('new_request',question);
  run.delivery.caller();run.quiet(false);
  run.ready(language,{question,result},{awaitingReply:true,pendingCallerText:ack});
  run.advance(1000);assert.equal(run.sent.length,0);
  run.delivery.callerStopped(completedTurn);run.quiet(true);run.advance(250);
  if(completedTurn===ack){
   assert.equal(run.sent[0].type,'session.commentary.append');
   assert.match(run.sent[0].content,/49,692/);
   assert.ok(run.sent[0].content.includes(qualification.replace(' [1]','')));
   assert.doesNotMatch(run.sent[0].content,/18,214/);
   assert.ok(run.events.some(event=>event.deliveryReason==='after_acknowledgment'));
   run.ack();run.advance(3500);assert.equal(run.announcements().length,1);
  }else{
   assert.equal(run.announcements().length,0);
   run.delivery.reply(language==='en'?'A bill lists charges you actually owe.':'La factura indica los cargos que debes pagar.',{audible:true});
   run.advance(250);run.ack();run.advance(250);
   assert.equal(run.announcements().length,1);
  }
  run.delivery.clear();
 }
});

test('a long qualified budget can speak once its own context arrives without waiting for secondary context',()=>{
 const f=fixture(),question='Verify cost of attendance and tuition for an off-campus student.';
 const qualification='California resident undergraduate, before aid and separate from what the university bills. '.repeat(5);
 const findings=[
  {subject:'Example University',aspect:'tuition_fees',status:'verified',answer:'Tuition: $18,214. [1]',qualification:'Annual recurring tuition and fees.'},
  {subject:'Example University',aspect:'total_budget',status:'verified',answer:'2026–27 off-campus total: $49,692. [1]',qualification},
 ];
 f.delivery.supersede('new_request',question);
 f.delivery.caller();f.quiet(false);
 f.ready('en',{question,result:{sources:[{url:'https://example.edu/budget'}],voiceBrief:{status:'verified',answer:findings[0].answer,qualification:'One academic year.',nextStep:'',findings}}},
  {awaitingReply:true,pendingCallerText:'Alright'});
 f.delivery.callerStopped('Alright');f.quiet(true);
 const lead=f.sent.filter(event=>event.type==='session.thinking.append'&&JSON.parse(event.content).group==='1-finding-1');
 assert.ok(lead.length>1);
 for(const event of lead.slice(0,-1))f.delivery.receive({type:'session.thinking.appended',client_event_id:event.event_id});
 f.advance(250);assert.equal(f.announcements().length,0);
 f.delivery.receive({type:'session.thinking.appended',client_event_id:lead.at(-1).event_id});
 f.advance(250);
 assert.equal(f.announcements().length,1);
 assert.match(f.announcements()[0].content,/Lead with finding.*No status preamble/);
 assert.ok(!f.events.some(event=>event.type==='origen.research.context_acknowledged'));
 f.ack();f.advance(3500);assert.equal(f.announcements().length,1);
 f.delivery.clear();
});

for(const [language,status] of [['en','Okay, how about now?'],['es','¿Y ahora?']])test(language+': a completed check can answer an explicit status question after a stray fragment',()=>{
 const f=fixture(),question='2026–27 off-campus cost of attendance for UC Davis';
 const answer='UC Davis published off-campus cost before aid is $44,760. [1]';
 const qualification='Academic-year planning estimate, not a bill. [1]';
 const result={sources:[{url:'https://ucdavis.edu/budget'}],voiceBrief:{status:'verified',answer,qualification,nextStep:'',findings:[
  {subject:'UC Davis',aspect:'total_budget',status:'verified',answer,qualification},
 ]}};
 f.delivery.supersede('new_request',question);f.quiet(false);
 f.ready(language,{question,result});f.ack();
 f.delivery.caller();f.delivery.callerStopped('if');
 f.delivery.reply('I am waiting for the check.',{interrupted:true,completedText:''});
 f.advance(10000);assert.equal(f.announcements().length,0);
 f.delivery.caller();f.delivery.callerStopped(status);f.quiet(true);f.advance(250);
 assert.equal(f.announcements().length,1);
 assert.match(f.announcements()[0].content,/44,760.*not a bill/s);
 f.advance(4000);assert.equal(f.announcements().length,1);
 f.delivery.clear();
});

for(const language of ['en','es'])test(`${language}: a qualified off-campus benchmark asks housing once across campus additions`,()=>{
 const f=fixture(),es=language==='es';
 const question=es?'¿Alquilaría o viviría con familiares?':'Would the student rent or live with family?';
 const makeResult=subject=>({sources:[{url:'https://example.edu/costs'}],voiceBrief:{status:'partial',
  answer:'Published off-campus budget: $40,000. [1]',qualification:'Published classification and components do not reconcile. [1]',nextStep:question,
  findings:['off_campus','with_family'].map(housing=>({subject:subject+' '+housing,aspect:'total_budget',status:'partial',
   answer:'Published budget: $40,000. [1]',qualification:'Published classification and components do not reconcile. [1]',
   budget:{year:'2026-27',population:'California resident undergraduate',currency:'USD',period:'academic_year',housing,assumed:false,total:40000,sourceCitation:'[1]',complete:true,
    expectedCategories:['tuition_fees','housing','food'],components:[['tuition_fees',10000],['housing',25000],['food',5085]].map(([key,amount])=>({key,sourceLabel:key,amount,role:'component',qualification:''}))}}))}});
 f.ready(language,{question:'Cost of attendance off campus',result:makeResult('Eastview')});f.advance(250);
 assert.equal(f.announcements().length,1);assert.ok(f.announcements()[0].content.includes(question));
 assert.doesNotMatch(f.announcements()[0].content,/checking|revisando/);
 f.delivery.supersede('new_request','Cost of attendance off campus');
 f.ready(language,{jobId:'next',requestId:'next',question:'Cost of attendance off campus',result:makeResult('Pine Valley')});
 f.advance(250);
 assert.equal(f.announcements().filter(e=>e.content.includes(question)).length,1,'no repeated housing question for the next college');
 f.delivery.clear();
});

for(const [language,question,spoken,ambiguous,tuition] of [
 ['en','Will Aiden rent an apartment or stay with relatives?','Is he renting or living with family?','Yeah, off campus.','Berkeley’s annual tuition and required fees are $18,214. [1]'],
 ['es','¿Va a alquilar un apartamento o vivir con familiares?','¿Alquilará o vivirá con familiares?','Sí, fuera del campus.','La matrícula y cuotas anuales de Berkeley son $18,214. [1]'],
])test(language+': unresolved housing asks once and then gives tuition after a broad off-campus reply',()=>{
 for(const native of [false,true]){
  const f=fixture(),lookup='UC Berkeley annual off-campus cost of attendance and tuition';
  const qualification='The overall estimate depends on the housing arrangement. [1]';
  const result={sources:[{url:'https://berkeley.edu/budget'}],voiceBrief:{status:'partial',answer:tuition,qualification,nextStep:question,findings:[
   {subject:'UC Berkeley',aspect:'total_budget',status:'partial',answer:'The source distinguishes two off-campus living arrangements. [1]',qualification:question+' [1]'},
   {subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:tuition,qualification},
  ]}};
  f.delivery.supersede('new_request',lookup);
  f.quiet(!native);f.ready(language,{question:lookup,result});
  if(native){f.delivery.reply(spoken,{audible:true});f.quiet(true);}
  f.advance(250);f.ack();
  assert.equal(f.announcements().length,native?0:1);
  if(!native)assert.ok(f.announcements()[0].content.includes(question));
  f.delivery.caller();f.delivery.callerStopped(ambiguous);f.advance(250);
  const fallback=f.announcements().at(-1).content;
  assert.match(fallback,/18,214/);assert.match(fallback,/leave the overall total open/);
  assert.ok(!fallback.includes(question));
  for(const reply of ['Okay',ambiguous,'Go ahead']){f.delivery.caller();f.delivery.callerStopped(reply);f.advance(5000);}
  assert.equal(f.announcements().length,native?1:2);
  assert.equal(f.sent.some(e=>['response.create','session.instructions.append'].includes(e.type)),false);
  f.delivery.clear();
 }
});

const topicRequests=[
 ['en','What is the annual tuition?','Actually as for off, how do I transfer my course credits?',true],
 ['en','When is the admissions application due?','How do I apply for financial aid?',true],
 ['en','How much financial aid is available?','Can you help me choose a major?',true],
 ['en','What are the transfer requirements?','How much is off-campus housing?',true],
 ['en','What is the total budget?','How much is rent off campus?',false],
 ['en','What scholarships are available?','While you check, how do I choose a major?',false],
 ['en','What is tuition?','My daughter asked how do I start the application essay.',false],
 ['en','How much is tuition?','How do scholarships affect tuition?',false],
 ['es','¿Cuánto cuesta la matrícula?','Mejor cable, ¿cómo puedo convalidar mis créditos?',true],
 ['es','¿Cuándo cierra la solicitud de admisión?','¿Cómo solicito ayuda financiera?',true],
 ['es','¿Qué becas están disponibles?','¿Cómo elijo mi carrera?',true],
 ['es','¿Cuáles son los requisitos de transferencia?','¿Cuánto cuesta la vivienda fuera del campus?',true],
 ['es','¿Cuánto cuesta la vivienda?','¿Cuál es el alquiler fuera del campus?',false],
 ['es','¿Cuándo cierra la solicitud de admisión?','Mientras investigas, ¿cómo elijo una carrera?',false],
 ['es','¿Cuánto cuesta la matrícula?','Ella dijo cómo empiezo mi ensayo de admisión.',false],
 ['es','¿Cuál es el costo de asistencia?','¿Cómo afectan las becas al costo total?',false],
];
for(const [language,previous,request,moved] of topicRequests){
 test(`${language}: ${moved?'follows new request':'preserves pending research'} — ${request}`,()=>{
  const f=fixture();
  f.delivery.supersede('new_request',previous);
  f.delivery.caller();
  assert.equal(f.delivery.topicChanged(request),moved);
  f.delivery.callerStopped(request);
  assert.equal(f.delivery.topicChanged(),moved);
  f.ready(language,{question:previous});
  const packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
  assert.equal(packets.some(p=>p.findingsWithheld===true),moved);
  f.delivery.clear();
 });
}

for(const [language,example]of Object.entries(correctedBudgetExamples)){
 const result={sources:[{url:'https://example.edu/costs'}],voiceBrief:{status:'partial',answer:example.finding.answer,qualification:example.finding.qualification,nextStep:'',findings:[example.finding]}};
 test(`${language}: a complete paraphrased total retires the optional announcement even with a rich subject`,()=>{
  const f=fixture();f.delivery.supersede('new_request',example.question);f.quiet(false);
  f.ready(language,{question:example.question,result});f.ack();f.delivery.reply(example.spoken,{audible:true});f.quiet(true);f.advance(5000);
  assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryStage==='native_portion_observed'));
  assert.ok(!f.events.some(e=>e.deliveryStage==='commentary_requested'));f.delivery.clear();
 });
 test(`${language}: a supplied total waits for mid-answer speech and then asks for the answer before its caveat`,()=>{
  const f=fixture();f.delivery.supersede('new_request',example.question);f.quiet(false);
  f.ready(language,{question:example.question,result});f.ack();f.advance(3000);
  assert.equal(f.announcements().length,0);
  f.delivery.reply(language==='en'?'We can work through the costs together.':'Podemos entender los costos juntos.',{audible:true});
  f.quiet(true);f.advance(500);assert.equal(f.announcements().length,1);
  const prompt=f.announcements()[0].content;assert.match(prompt,/Answer with all supplied conditions/);
  assert.match(prompt,/State each caveat once or refer back to it/);
  assert.doesNotMatch(prompt,/unverified part first/);assert.ok(Buffer.byteLength(prompt)<=480);
  const evidence=decodedResearchContext(f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
  assert.ok(JSON.stringify(evidence).includes(example.finding.qualification));
  assert.equal(f.sent.some(e=>['session.instructions.append','response.create'].includes(e.type)),false);f.delivery.clear();
 });
 test(`${language}: an interrupted unfinished total stays quietly available without a forced replay`,()=>{
  const f=fixture();f.delivery.supersede('new_request',example.question);f.quiet(false);f.ready(language,{question:example.question,result});f.ack();
  f.delivery.reply(example.spoken,{audible:true,interrupted:true,completedText:''});f.quiet(true);f.advance(5000);
  assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryReason==='interrupted_tail'));
  assert.ok(f.sent.some(e=>e.type==='session.thinking.append'));f.delivery.clear();
 });
 test(`${language}: a limitation about a different scenario does not retire the requested finding`,()=>{
  const f=fixture(),finding={...example.finding,status:'unverified',answer:example.limitation,qualification:''};
  f.delivery.supersede('new_request',example.question);f.quiet(false);
  f.ready(language,{question:example.question,result:{...result,voiceBrief:{...result.voiceBrief,status:'unverified',answer:finding.answer,qualification:'',findings:[finding]}}});f.ack();
  f.delivery.reply(example.wrongLimitation,{audible:true});
  assert.ok(!f.events.some(e=>['evidence_overlap_observed','native_portion_observed'].includes(e.deliveryStage)));
  f.delivery.reply(example.limitation,{audible:true});f.quiet(true);f.advance(1000);
  assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));f.delivery.clear();
 });
}

for(const language of ['en','es']){
 const x=examples[language];
 test(`${language}: topic changes before or during completion send only state, with no announcement`,()=>{
  const phrases=language==='en'?['Different question. Can we talk about essays?','Actually, let’s switch topics. Can we talk about the application essay?','actually as for off How do I start my application essay']:
   ['Otra pregunta. ¿Podemos hablar de los ensayos?','Mejor cambiemos de tema. ¿Podemos hablar del ensayo de admisión?','mejor cable Cómo empiezo mi ensayo de admisión'];
  for(const phrase of phrases)for(const stillSpeaking of [false,true]){
   const f=fixture();f.delivery.supersede('new_request','Tuition');f.delivery.caller();
   if(!stillSpeaking)f.delivery.callerStopped(phrase);
   f.ready(language,{},stillSpeaking?{awaitingReply:true,pendingCallerText:phrase}:undefined);
   f.ack();f.advance(10000);
   const packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
   assert.deepEqual(packets.map(p=>p.unit),['state']);
   assert.equal(packets[0].taskState,'completed');
   assert.equal(packets[0].deliveryDisposition,'caller_changed_topic');
   assert.equal(packets[0].findingsWithheld,true);
   assert.equal(f.announcements().length,0);
   assert.ok(f.events.some(e=>e.deliveryReason==='different_requested_portion'));
   f.delivery.supersede('new_request','Tuition for a new school');f.ready(language,{jobId:'new-job',requestId:'new-request'});
   f.delivery.reply(x.reply,{audible:true});f.ack();f.advance(500);
   assert.equal(f.announcements().length,1);
   f.delivery.clear();
  }
 });
 test(`${language}: background findings wait while the caller's explanatory answer finishes`,()=>{
  const f=fixture(),question=language==='en'?'While you check, what does that budget usually include?':'Mientras lo revisas, ¿qué suele incluir ese presupuesto?';
  f.delivery.caller();f.delivery.callerStopped(question);f.quiet(false);
  f.ready(language);
  f.advance(4000);
  assert.equal(f.sent.length,0);
  f.delivery.caller();f.delivery.callerStopped(x.ack);
  f.advance(1000);
  assert.equal(f.sent.length,0);
  f.delivery.reply(x.reply,{audible:true});f.quiet(true);
  f.advance(500);f.ack();f.advance(500);
  assert.equal(f.announcements().length,1);
  assert.ok(f.sent.some(e=>e.type==='session.thinking.append'));
  f.delivery.clear();
 });
 test(`${language}: caller speech and an unrelated reply postpone, then release one research contribution`,()=>{
  const f=fixture();f.ready(language);f.ack();f.delivery.caller();f.advance(5000);assert.equal(f.announcements().length,0);
  f.delivery.reply(x.ack,{audible:true});f.advance(1000);assert.equal(f.announcements().length,0);
  f.delivery.reply(x.reply,{audible:true});f.advance(500);assert.equal(f.announcements().length,1);
  f.advance(60000);assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryStage==='delivery_unconfirmed'));
  assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append','session.input_audio.mute'].includes(e.type)));
 });
 test(`${language}: findings arriving during caller speech wait for the actual reply`,()=>{
  const f=fixture();f.ready(language,{}, {awaitingReply:true});f.ack();f.advance(5000);assert.equal(f.announcements().length,0);
  f.delivery.reply(x.reply,{audible:true});f.advance(500);assert.equal(f.announcements().length,1);
 });
 test(`${language}: audible findings suppress a duplicate; an unrelated acknowledgment does not count as delivery`,()=>{
  const f=fixture();f.ready(language);f.ack();f.delivery.caller();
  f.delivery.reply(x.answer+' '+x.qualification,{audible:true});f.advance(4000);
  assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
  assert.equal(f.tasks.size,0);
 });
 for(const condition of [{audible:false},{audible:true,forced:true},{audible:true,interrupted:true}])test(`${language}: incomplete playback is not counted as delivered ${JSON.stringify(condition)}`,()=>{
  const f=fixture();f.ready(language);f.ack();f.delivery.caller();f.delivery.reply(x.answer,condition);
  assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));f.delivery.clear();assert.equal(f.tasks.size,0);
 });
 test(`${language}: a late completion cannot resurrect a cancelled or superseded result`,()=>{
  const f=fixture();f.ready(language);f.delivery.supersede();f.ack();f.advance(5000);assert.equal(f.announcements().length,0);
  f.ready(language);f.advance(5000);assert.equal(f.announcements().length,0,'duplicate completion remains retired');
  f.ready(language,{jobId:'new',requestId:'new',revision:2});f.ack();f.advance(500);assert.equal(f.announcements().length,1);f.delivery.clear();
 });
 test(`${language}: long briefs keep complete qualifications in quiet context and never exceed append bounds`,()=>{
  const f=fixture(),text=x.answer+'\n'+x.qualification.repeat(50);f.ready(language,{result:{text}});f.ack();f.advance(500);
  const packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
  const evidence=decodedResearchContext(packets);
  assert.equal(evidence.text,text);assert.equal(evidence.taskState,'completed');assert.equal(evidence.researchPending,false);
  assert.ok(f.sent.every(e=>Buffer.byteLength(e.content)<=480));assert.match(f.announcements()[0].content,/Give the useful finding naturally/);f.delivery.clear();
 });
}
test('a partial context acknowledgment cannot produce an announcement',()=>{
 const f=fixture();f.ready('en',{result:{text:examples.en.answer.repeat(20)}});const context=f.sent.filter(e=>e.type==='session.thinking.append');assert.ok(context.length>1);
 f.delivery.receive({type:'session.thinking.appended',client_event_id:context[0].event_id});f.advance(30000);f.ack();f.advance(1000);
 assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryReason==='context_timeout'));assert.equal(f.tasks.size,0);
});
test('commentary acknowledgment is not spoken delivery and does not trigger retries',()=>{
 const f=fixture();f.ready();f.ack();f.advance(500);const request=f.announcements()[0];
 f.delivery.receive({type:'session.commentary.appended',client_event_id:request.event_id});f.advance(30000);
 assert.ok(f.events.some(e=>e.deliveryStage==='commentary_acknowledged'));assert.ok(f.events.some(e=>e.deliveryReason==='speech_not_observed'));
 assert.equal(f.announcements().length,1);assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
});
for(const language of ['en','es'])test(`${language}: an acknowledgment alone cannot strand a finished result after the caller stops`,()=>{
 const f=fixture();f.ready(language);f.ack();f.delivery.caller();f.delivery.callerStopped();f.delivery.reply(examples[language].ack,{audible:true});
 f.advance(250);assert.equal(f.announcements().length,1,'completed acknowledgment needs no additional reply hold');
 f.advance(10000);assert.equal(f.announcements().length,1);f.delivery.clear();
});
test('resumed caller speech revokes the pending result opportunity until that speech ends',()=>{
 const f=fixture();f.ready();f.ack();f.delivery.caller();f.delivery.callerStopped();f.advance(2000);f.delivery.caller();f.advance(5000);
 assert.equal(f.announcements().length,0);f.delivery.callerStopped();f.advance(3000);assert.equal(f.announcements().length,1);f.delivery.clear();
});
test('interrupting a requested update never queues a repeated announcement',()=>{
 const f=fixture();f.ready();f.ack();f.advance(500);f.delivery.caller();f.delivery.reply(examples.en.reply,{audible:true});f.advance(10000);
 assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryStage==='interrupted'));assert.equal(f.tasks.size,0);
});
for(const kind of ['context','commentary'])test(`${kind} provider errors retire delivery without replay`,()=>{
 const f=fixture();f.ready();if(kind==='commentary'){f.ack();f.advance(500);}
 const event=kind==='context'?f.sent[0]:f.announcements()[0];
 f.delivery.receive({type:'error',error:{client_event_id:event.event_id}});f.ack();f.advance(60000);
 assert.equal(f.announcements().length,kind==='context'?0:1);assert.ok(f.events.some(e=>e.deliveryReason===kind+'_error'));assert.equal(f.tasks.size,0);
});
test('failure speaks no fabricated findings and never restarts research',()=>{
 const f=fixture();f.ready('en',{result:{status:'research_failed'}});f.ack();f.advance(500);
 assert.match(f.announcements()[0].content,/unavailable information.*No verified findings/);assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);f.delivery.clear();
});
test('long ongoing conversation explicitly defers unsolicited delivery without a silence prompt',()=>{
 const f=fixture();f.ready();f.ack();f.delivery.caller();f.advance(120000);
 assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryReason==='opportunity_expired'));assert.equal(f.tasks.size,0);
});
test('overlap does not infer success from topic words, progress promises, or a different figure',()=>{
 const answer=examples.en.answer;
 assert.equal(researchAnswerOverlap(answer,'Mm-hmm. I am still checking tuition at Example University.'),false);
 assert.equal(researchAnswerOverlap(answer,answer.replace('12345','99999')),false);
 assert.equal(researchAnswerOverlap(answer,answer),true);
 assert.equal(researchAnswerOverlap(answer,examples.en.qualification),false);
});
for(const [language,example] of Object.entries({
 en:{
  answer:'For Eastview College, the 2027–28 off-campus budget is $13,647 before financial aid. [1]',
  caveat:'It is a planning estimate, not a bill. [1]',
  spoken:'For Eastview College, the twenty twenty-seven to twenty twenty-eight off-campus budget is thirteen thousand six hundred forty seven dollars, before financial aid and that is a planning estimate, not a bill.',
  differentYear:text=>text.replace('twenty twenty-eight','twenty twenty-nine'),
  differentAmount:text=>text.replace('forty seven','forty nine'),
 },
 es:{
  answer:'En Eastview College, el presupuesto de 2027–28 fuera del campus es de $13,647 antes de la ayuda financiera. [1]',
  caveat:'Es una estimación para planificar, no una factura. [1]',
  spoken:'En Eastview College, la estimación para vivir fuera del campus en 2027–28 es de 13 mil 647 dólares antes de la ayuda financiera, y es una guía para planificar, no una factura.',
  differentYear:text=>text.replace('2027–28','2028–29'),
  differentAmount:text=>text.replace('13 mil 647','13 mil 649'),
 },
}))test(`${language}: native number formatting and an attached caveat do not queue a duplicate announcement`,()=>{
 const finding={subject:'Eastview College',aspect:'total_budget',status:'verified',answer:example.answer,qualification:example.caveat};
 const result={sources:[{url:'https://example.edu/costs'}],voiceBrief:{...finding,nextStep:'',findings:[finding]}};
 for(const [spoken,shouldAnnounce] of [[example.spoken,false],[example.differentYear(example.spoken),true],[example.differentAmount(example.spoken),true]]){
  const f=fixture();f.ready(language,{question:example.answer,result},{awaitingReply:true});f.ack();
  f.delivery.reply(spoken,{audible:true});f.advance(1000);
  assert.equal(f.announcements().length,Number(shouldAnnounce));
  f.delivery.clear();
 }
});
test('private delivery diagnostics retain correlation and stage without copied content',()=>{
 const payload=capturePayload({type:'origen.research.delivery',jobId:'job',revision:1,deliveryStage:'deferred',deliveryReason:'caller_turn',durationMs:123,question:'PRIVATE',text:'PRIVATE'});
 assert.equal(payload.jobId,'job');assert.equal(payload.deliveryStage,'deferred');assert.doesNotMatch(JSON.stringify(payload),/PRIVATE/);
});

for(const [language,example]of Object.entries({
 en:{subject:'North Campus',answer:'For 2026–27 entering transfers, the admission application serves as the campus-scholarship application; the published minimum GPA is 3.25. Current awards range from USD 100–17,000 per academic year. [1]',spoken:'North Campus scholarships use the admission application, and they say the published minimum GPA is three point two five.',thanks:'Yeah, that is all helpful.'},
 es:{subject:'Campus Norte',answer:'Para los estudiantes de transferencia de 2026–27, la solicitud de admisión sirve como solicitud de becas; el promedio mínimo publicado es 3.25. Los premios actuales varían entre USD 100–17,000 por año académico. [1]',spoken:'Las becas de Campus Norte usan la solicitud de admisión y el promedio mínimo publicado es tres punto veinticinco.',thanks:'Sí, todo eso me ayuda.'},
}))test(`${language}: a native scholarship explanation retires an optional award-range addendum`,()=>{
 const f=fixture(),finding={subject:example.subject,aspect:'eligibility',status:'verified',answer:example.answer,qualification:'Published program rules do not establish an individual award. [1]'};
 const result={sources:[{url:'https://example.edu/scholarships'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 f.ready(language,{question:'Scholarship requirements',result},{awaitingReply:true});f.ack();
 f.delivery.reply(example.spoken,{audible:true});
 assert.ok(f.events.some(e=>e.deliveryStage==='native_portion_observed'));
 f.delivery.caller();f.delivery.callerStopped(example.thanks);f.delivery.reply(examples[language].reply,{audible:true});f.advance(10000);
 assert.equal(f.announcements().length,0,'unused award figures do not create an unsolicited second turn');
 f.ready(language,{question:'Scholarship requirements',evidenceVersion:2,researchPending:false,result});f.ack();f.advance(10000);
 assert.equal(f.announcements().length,0,'a final revision with the same findings cannot revive the addendum');
 f.delivery.clear();
});
test('ordinary conversation without completed research creates no model work or timed speech',()=>{
 const f=fixture();f.delivery.caller();f.delivery.callerStopped();f.advance(60000);f.delivery.reply(examples.en.reply,{audible:true});f.advance(60000);
 assert.equal(f.sent.length,0);assert.equal(f.tasks.size,0);
});

for(const language of ['en','es'])test(`${language}: new course research does not inherit an earlier tuition focus`,()=>{
 const f=fixture();f.delivery.caller();f.delivery.callerStopped(language==='en'?'What is Berkeley tuition?':'¿Cuál es la matrícula de Berkeley?');
 f.delivery.supersede('new_request',language==='en'?'Does my statistics class transfer to UCSC?':'¿Se transfiere mi clase de estadística a UCSC?');
 const finding={subject:'UC Santa Cruz',aspect:'other',status:'verified',answer:'The statistics course requires an official articulation review [1].',qualification:'Transfer credit is not guaranteed [1].'};
 f.ready(language,{jobId:'course',question:'Statistics transfer credit',result:{sources:[{url:'https://example.edu/transfer'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}}});
 f.ack();f.delivery.reply(examples[language].reply,{audible:true});f.advance(500);
 assert.equal(f.announcements().length,1);assert.ok(!f.events.some(e=>e.deliveryReason==='different_requested_portion'));f.delivery.clear();
});
for(const [language,{answer,spoken}] of Object.entries(discussionExamples))test(`${language}: a paraphrased native answer before context ack retires the opportunity without a redundant caveat`,()=>{
 const f=fixture();f.ready(language,{result:{text:answer}}, {awaitingReply:true});
 // Live can use context before its final acknowledgment. Recognition must work
 // on that actual reply, not depend on the order of the context ACK.
 f.delivery.reply(spoken,{audible:true});f.ack();f.advance(4000);
 f.delivery.caller();f.delivery.callerStopped();f.delivery.reply(examples[language].ack,{audible:true});f.advance(10000);
 assert.equal(f.announcements().length,0);assert.equal(f.events.filter(e=>e.deliveryStage==='evidence_overlap_observed').length,1);
 assert.equal(f.tasks.size,0);assert.ok(f.sent.every(e=>e.type==='session.thinking.append'));
});
for(const reason of ['cancelled','scope_changed','call_ended'])test(`${reason} clears a pending delivery and rejects its late acknowledgment`,()=>{
 const f=fixture();f.ready();f.delivery.clear(reason);f.ack();f.advance(60000);
 assert.equal(f.announcements().length,0);assert.equal(f.tasks.size,0);assert.ok(f.events.some(e=>e.deliveryReason===reason));
});

for(const language of ['en','es'])test(`${language}: initial findings are usable during recovery; final context cannot repeat a native partial answer`,()=>{
 const f=fixture(),finding={subject:'UC Santa Cruz — entering undergraduates, 2026–27',aspect:'tuition_fees',status:'partial',answer:'Annual tuition $17,490; additional nonresident tuition $39,270. [1]',qualification:'The fee subtotal remains unresolved. [1]'};
 const result={sources:[{url:'https://example.edu/costs'}],voiceBrief:{status:'partial',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 f.ready(language,{question:'UC Santa Cruz tuition',evidenceVersion:1,researchPending:true,result});f.ack();
 let packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 let context=decodedResearchContext(packets);assert.equal(context.researchPending,true);assert.equal(context.taskState,'running');
 f.delivery.reply(language==='en'?'UC Santa Cruz tuition is about seventeen thousand four hundred dollars annually.':'La matrícula de UC Santa Cruz es de unos diecisiete mil cuatrocientos dólares al año.',{audible:true});
 f.advance(1000);assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryStage==='native_portion_observed'));
 const count=f.sent.length;
 f.ready(language,{question:'UC Santa Cruz tuition',evidenceVersion:2,researchPending:false,result});f.ack();f.advance(10000);
 assert.equal(f.announcements().length,0);packets=f.sent.slice(count).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 context=decodedResearchContext(packets);assert.equal(context.researchPending,false);assert.equal(context.evidenceVersion,2);
 f.ready(language,{evidenceVersion:1,researchPending:true,result});assert.equal(f.sent.length,count+packets.length,'late initial revision cannot replace final facts');f.delivery.clear();
});

test('initial evidence can announce before recovery and final revision only refreshes context',()=>{
 const f=fixture();f.ready('en',{evidenceVersion:1,researchPending:true});f.ack();f.advance(500);
 assert.equal(f.announcements().length,1);assert.match(f.announcements()[0].content,/Give the useful finding naturally/);
 f.ready('en',{evidenceVersion:2,researchPending:false});f.ack();f.advance(5000);assert.equal(f.announcements().length,1);f.delivery.clear();
});

test('quiet recovery updates still report failed context delivery without replaying speech',()=>{
 const f=fixture();f.ready('en',{evidenceVersion:1,researchPending:true});f.ack();f.advance(500);
 f.ready('en',{evidenceVersion:2,researchPending:false});
 const packet=f.sent.filter(e=>e.type==='session.thinking.append').at(-1);
 f.delivery.receive({type:'error',client_event_id:packet.event_id});f.advance(5000);
 assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.evidenceVersion===2&&e.deliveryReason==='context_error'));f.delivery.clear();
});

const budgetScripts={
 en:{question:'What is Berkeley’s total cost of attendance?',scenario:'He will be living off campus.',housingOnly:'Just the housing cost, please.',
  answer:'UC Berkeley’s 2026–27 off-campus total is $49,692. [1]',qualification:'Published undergraduate budget before aid; not a personal bill. [1]',
  unknown:'I could not verify UC Berkeley’s off-campus total budget.',ack:'Thanks. We can talk about the essay while that runs.'},
 es:{question:'¿Cuál es el presupuesto total de Berkeley?',scenario:'Estaría viviendo fuera del campus.',housingOnly:'Solo el costo de la vivienda, por favor.',
  answer:'El total de UC Berkeley fuera del campus en 2026–27 es $49,692. [1]',qualification:'Presupuesto publicado antes de ayuda; no una factura personal. [1]',
  unknown:'No pude verificar el presupuesto total de UC Berkeley fuera del campus.',ack:'Gracias. Podemos hablar del ensayo mientras se revisa eso.'},
};
function budgetResult(script,{unknown=false,extra=[]}={}){
 const finding={subject:'UC Berkeley',aspect:'total_budget',status:unknown?'unverified':'verified',answer:unknown?script.unknown:script.answer,qualification:unknown?'The source did not establish this requested figure.':script.qualification};
 return {sources:[{url:'https://example.edu/budget'}],voiceBrief:{status:unknown?'partial':'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding,...extra]}};
}
for(const [language,s] of Object.entries(budgetScripts)){
 test(`${language}: housing scenario preserves the requested total and commentary includes its complete qualified finding`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);f.delivery.caller();f.delivery.callerStopped(s.scenario);
  f.ready(language,{question:s.question,result:budgetResult(s)});f.ack();f.delivery.reply(s.ack,{audible:true});f.advance(500);
  assert.equal(f.announcements().length,1);const content=f.announcements()[0].content;
  assert.ok(content.includes(s.answer));assert.ok(content.includes(s.qualification));assert.match(content,/UC Berkeley/);
  assert.doesNotMatch(content,/check has ended|still checking/);assert.match(content,/No task-status or completion announcement/);
  assert.ok(Buffer.byteLength(content)<=480);assert.ok(!f.events.some(e=>e.deliveryReason==='different_requested_portion'));f.delivery.clear();
 });
 test(`${language}: explicit housing-only follow-up is not satisfied by a total-budget finding`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);f.delivery.caller();f.delivery.callerStopped(s.housingOnly);
  f.ready(language,{question:s.question,result:budgetResult(s)});f.ack();f.delivery.reply(s.ack,{audible:true});f.advance(500);
  assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryReason==='different_requested_portion'));f.delivery.clear();
 });
 for(const initial of ['native','commentary'])test(`${language}: ${initial} partial answer does not suppress newly verified requested total`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s,{unknown:true})});f.ack();
  if(initial==='native')f.delivery.reply(s.unknown,{audible:true});
  else f.advance(500);
  const before=f.announcements().length;
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:false,result:budgetResult(s)});f.ack();f.advance(500);
  assert.equal(f.announcements().length,before+1);const content=f.announcements().at(-1).content;
  assert.ok(content.includes(s.answer));assert.ok(content.includes(s.qualification));assert.doesNotMatch(content,/recovery is running/);
  f.delivery.reply(s.answer+' '+s.qualification,{audible:true});f.advance(60000);
  assert.equal(f.announcements().length,before+1);assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append'].includes(e.type)));f.delivery.clear();
 });
 test(`${language}: an unchanged completed finding remains quiet after its initial contribution`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s)});f.ack();f.advance(500);
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:false,result:budgetResult(s)});f.ack();f.advance(5000);
  assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryReason==='recovery_context_only'));f.delivery.clear();
 });
 test(`${language}: unrelated recovery finding does not repeat the already supplied total`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s)});f.ack();f.advance(500);
  const housing={subject:'UC Berkeley',aspect:'housing',status:'verified',answer:'Housing allowance is $15000. [1]',qualification:'Estimated allowance, not billed tuition. [1]'};
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:false,result:budgetResult(s,{extra:[housing]})});f.ack();f.advance(5000);
  assert.equal(f.announcements().length,1);f.delivery.clear();
 });
 test(`${language}: pending new evidence stays eligible across a terminal status-only refresh`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s,{unknown:true})});f.ack();f.advance(500);
  assert.equal(f.announcements().length,0,'an unresolved initial pass remains quiet while recovery runs');
  f.quiet(false);
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:true,result:budgetResult(s)});f.ack();f.advance(1000);
  f.ready(language,{question:s.question,evidenceVersion:3,researchPending:false,result:budgetResult(s)});f.ack();f.quiet(true);f.advance(500);
  assert.equal(f.announcements().length,1);assert.ok(f.announcements().at(-1).content.includes(s.answer));f.delivery.clear();
 });
}

test('source-index and confidence-label changes alone do not repeat the same qualified facts',()=>{
 const f=fixture(),s=budgetScripts.en,initial=budgetResult(s);initial.voiceBrief.findings[0].status='partial';
 f.delivery.supersede('new_request',s.question);f.ready('en',{question:s.question,evidenceVersion:1,researchPending:true,result:initial});f.ack();f.advance(500);
 const final=budgetResult(s);final.sources.unshift({url:'https://example.edu/other'});final.voiceBrief.findings[0].answer=final.voiceBrief.findings[0].answer.replace('[1]','[2]');final.voiceBrief.findings[0].qualification=final.voiceBrief.findings[0].qualification.replace('[1]','[2]');
 f.ready('en',{question:s.question,evidenceVersion:2,researchPending:false,result:final});f.ack();f.advance(1000);
 assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryReason==='recovery_context_only'));f.delivery.clear();
});

test('the reviewed off-campus result fits inline with its entire population, year, amount and qualification',()=>{
 // Public historical research fixture; these figures are not current-cost advice.
 const f=fixture(),finding={subject:'UC Berkeley — new California-resident undergraduate, off-campus apartment',aspect:'total_budget',status:'verified',
  answer:'2026–27 published academic-year cost of attendance: USD $49,692 before aid. [1]',
  qualification:'An estimated attendance budget, not an individual amount owed. [1]'};
 const question='UC Berkeley off-campus total cost of attendance';
 f.delivery.supersede('new_request',question);
 f.ready('en',{question,result:{sources:[{url:'https://financialaid.berkeley.edu/how-aid-works/student-budgets-cost-of-attendance/'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}}});
 f.ack();f.advance(500);const content=f.announcements()[0].content;
 assert.ok(content.includes(finding.subject));assert.ok(content.includes(finding.answer));assert.ok(content.includes(finding.qualification));
 assert.ok(Buffer.byteLength(content)<=480);assert.doesNotMatch(content,/Use only the relevant/,'the actual figure must not fall back to an opaque reference');f.delivery.clear();
});

for(const language of ['en','es']) {
 const script=budgetScripts[language];
 test(`${language}: a completed portion survives overlap without counting the unfinished tail`,()=>{
  const f=fixture();
  f.ready(language,{question:script.question,result:budgetResult(script)});f.ack();
  f.delivery.caller();f.delivery.callerStopped(language==='en'?'Which is higher?':'¿Cuál es más alto?');
  f.delivery.reply(script.answer+' '+script.qualification+' An unfinished tail',{
   audible:true,interrupted:true,completedText:script.answer+' '+script.qualification,
  });
  f.advance(5000);
  assert.equal(f.announcements().length,0);
  assert.ok(f.events.some(e=>e.deliveryReason==='requested_portion_answered'));
  f.delivery.clear();
 });
 test(`${language}: a cut-off fact remains quietly available across a final status update`,()=>{
  const f=fixture();
  f.ready(language,{question:script.question,evidenceVersion:1,researchPending:true,result:budgetResult(script)});f.ack();
  f.delivery.caller();f.delivery.callerStopped(language==='en'?'Wait, explain that term.':'Espera, explícame ese término.');
  f.delivery.reply(script.answer,{audible:true,interrupted:true,completedText:''});
  f.advance(5000);
  assert.equal(f.announcements().length,0);
  assert.ok(f.events.some(e=>e.deliveryReason==='interrupted_tail'));
  assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
  const before=f.sent.length;
  f.ready(language,{question:script.question,evidenceVersion:2,researchPending:false,result:budgetResult(script)});f.ack();f.advance(5000);
  const context=decodedResearchContext(f.sent.slice(before).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
  assert.equal(context.taskState,'completed');
  assert.equal(context.findings.length,0,'acknowledged facts are retained, not resent');
  assert.equal(f.announcements().length,0);
  f.delivery.clear();
 });
 test(`${language}: final context sends only changed qualifications and preserves version diagnostics`,()=>{
  const f=fixture(),result=budgetResult(script);
  f.ready(language,{question:script.question,evidenceVersion:1,researchPending:true,result});f.ack();
  let before=f.sent.length;
  f.ready(language,{question:script.question,evidenceVersion:2,researchPending:false,result});f.ack();
  const status=decodedResearchContext(f.sent.slice(before).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
  assert.equal(status.findings.length,0);
  const changed=structuredClone(result);
  changed.voiceBrief.findings[0].qualification+=' This year is provisional. [1]';
  before=f.sent.length;
  f.ready(language,{question:script.question,evidenceVersion:3,result:changed});
  const update=decodedResearchContext(f.sent.slice(before).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
  assert.equal(update.findings.length,1);
  assert.match(update.findings[0].qualification,/provisional/);
  f.ready(language,{question:script.question,evidenceVersion:2,result});
  assert.ok(f.events.some(e=>e.deliveryReason==='repeated_version'));
  f.delivery.clear();
 });
}

test('unacknowledged earlier evidence is supplied again on final update',()=>{
 const f=fixture(),script=budgetScripts.en,result=budgetResult(script);
 f.ready('en',{question:script.question,evidenceVersion:1,researchPending:true,result});
 const before=f.sent.length;
 f.ready('en',{question:script.question,evidenceVersion:2,result});
 const context=decodedResearchContext(f.sent.slice(before).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
 assert.equal(context.findings.length,1);
 f.delivery.clear();
});

test('findings omitted by the three-unit limit are supplied when the caller selects them',()=>{
 const f=fixture(),result=budgetResult(budgetScripts.en);
 result.voiceBrief.findings=Array.from({length:5},(_,index)=>({subject:`Campus${index}`,aspect:'total_budget',status:'verified',answer:`Campus${index} annual budget is $${40000+index}. [1]`,qualification:'2026–27 undergraduate estimate before aid. [1]'}));
 f.ready('en',{question:'Compare college budgets',evidenceVersion:1,researchPending:true,result});f.ack();
 f.delivery.caller();f.delivery.callerStopped('What is the total budget for Campus4?');
 const before=f.sent.length;
 f.ready('en',{question:'Compare college budgets',evidenceVersion:2,result});
 const context=decodedResearchContext(f.sent.slice(before).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
 assert.equal(context.findings.length,1);assert.equal(context.findings[0].subject,'Campus4');f.delivery.clear();
});

test('a newly selected unsupplied finding cannot use another finding context acknowledgment',()=>{
 const f=fixture(),result=budgetResult(budgetScripts.en);
 result.voiceBrief.findings=Array.from({length:5},(_,index)=>({subject:`Campus${index}`,aspect:'total_budget',status:'verified',answer:`Campus${index} annual budget is $${40000+index}. [1]`,qualification:'2026–27 estimate before aid. [1]'}));
 f.quiet(false);f.ready('en',{question:'Compare college budgets',result});f.ack();
 f.delivery.caller();f.delivery.callerStopped('What is the total budget for Campus4?');
 f.delivery.reply('We can compare those costs together.',{audible:true});f.quiet(true);f.advance(500);
 assert.equal(f.announcements().length,0);
 assert.ok(f.events.some(e=>e.deliveryStage==='context_supplement_requested'&&e.deliveryReason==='requested_evidence_not_supplied'));
 const supplement=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 assert.ok(decodedResearchContext(supplement).findings.some(finding=>finding.subject==='Campus4'));
 f.advance(1000);assert.equal(f.announcements().length,0,'old acknowledgments do not acknowledge the additional unit');
 f.ack();f.advance(250);assert.equal(f.announcements().length,1);
 assert.match(f.announcements()[0].content,/Campus4|finding/);f.delivery.clear();
});

for(const [language,request] of [['en','Where is the tutoring center?'],['es','¿Dónde está el centro de tutoría?']])test(`${language}: a clear support request keeps old cost research quiet`,()=>{
 const f=fixture();f.delivery.supersede('new_request','What is the cost of attendance?');
 assert.equal(f.delivery.topicChanged(request),true);
 f.delivery.caller();f.delivery.callerStopped(request);
 f.ready(language,{question:'What is the cost of attendance?',result:budgetResult(budgetScripts.en)});
 f.ack();f.advance(4000);
 assert.equal(f.announcements().length,0);
 assert.ok(f.events.some(event=>event.deliveryReason==='different_requested_portion'));
 f.delivery.clear();
});

for(const language of ['en','es'])test(`${language}: a newly requested contact within an existing record is supplied before its optional answer`,()=>{
 const f=fixture(),es=language==='es',evidence=publicRecord('admissions',language);
 evidence.facts.push(publicRecord('student_support',language).facts[0]);evidence.expectedFacts.push('contact');
 const question=es?'¿Cuál es la fecha límite de solicitud?':'What is the application deadline?';
 const finding={subject:'Eastview College',aspect:'other',status:'verified',answer:'A source-backed overview is available. [1]',qualification:'First-year applicants; the source conditions apply. [1]',evidence};
 const result={sources:[{url:'https://eastview.edu/policy'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 f.delivery.supersede('new_request',question);f.quiet(false);f.ready(language,{question,result,language});f.ack();
 const before=f.sent.length;
 f.delivery.caller();f.delivery.callerStopped(es?'¿Con quién puedo hablar?':'Who can I contact?');
 f.delivery.reply(es?'Sí, podemos revisar el contacto adecuado.':'Yes, we can review the right contact.',{audible:true});
 f.quiet(true);f.advance(250);
 const additional=f.sent.slice(before).filter(event=>event.type==='session.thinking.append');
 assert.ok(additional.length>0);assert.equal(f.announcements().length,0);
 const context=decodedResearchContext(additional.map(event=>JSON.parse(event.content)));
 assert.deepEqual(context.findings[0].focusedFacts.map(fact=>fact.key),['contact']);
 assert.equal(context.findings[0].focusedFacts[0].qualification,evidence.facts[1].qualification);
 f.advance(500);assert.equal(f.announcements().length,0);
 f.ack();f.advance(250);assert.equal(f.announcements().length,1);
 assert.match(f.announcements()[0].content,/requested fact keys \["contact"\]/);
 assert.match(f.announcements()[0].content,/scope and caveats/);
 const count=f.sent.length;f.advance(500);assert.equal(f.sent.length,count,'the same supplemental fact is not repeatedly sent');
 f.delivery.clear();
});

for(const language of ['en','es'])test(`${language}: a reflection about another fact does not replace the requested deadline`,()=>{
 const f=fixture(),es=language==='es',question=es?'¿Cuál es la fecha límite de la beca?':'What is the scholarship deadline?';
 const evidence=publicRecord('scholarships',language);
 const finding={subject:'Eastview College',aspect:'other',status:'verified',answer:'A source-backed overview is available. [1]',qualification:'The published conditions apply. [1]',evidence};
 const result={sources:[{url:'https://eastview.edu/policy'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 f.delivery.supersede('new_request',question);f.delivery.caller();
 f.delivery.callerStopped(es?'Me pregunto cuál es el monto de la beca.':'I was thinking about the scholarship amount.');
 f.quiet(false);f.ready(language,{question,result,language});
 const context=decodedResearchContext(f.sent.filter(event=>event.type==='session.thinking.append').map(event=>JSON.parse(event.content)));
 assert.deepEqual(context.findings[0].focusedFacts.map(fact=>fact.key),['deadline']);
 f.delivery.clear();
});

test('long multibyte finding names use an acknowledged opaque reference within append bounds',()=>{
 const f=fixture(),result=budgetResult(budgetScripts.es),finding=result.voiceBrief.findings[0];
 finding.subject='Universidad '+ '學'.repeat(140);finding.answer+=' '+ 'é'.repeat(500);
 f.ready('es',{question:'¿Cuál es el presupuesto total?',result});f.ack();f.advance(500);
 const context=decodedResearchContext(f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
 assert.equal(context.findings[0].subject,finding.subject);
 assert.equal(context.findings[0].qualification,finding.qualification);
 assert.ok(f.announcements()[0].content.includes('finding '+context.findings[0].findingId));
 assert.ok(f.sent.every(e=>Buffer.byteLength(e.content)<=480));
 assert.equal(f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),false);f.delivery.clear();
});

test('updated verification and source provenance reach quiet context without repeating speech',()=>{
 const f=fixture(),result=budgetResult(budgetScripts.en);result.voiceBrief.findings[0].status='partial';
 f.ready('en',{evidenceVersion:1,researchPending:true,result});f.ack();f.advance(500);
 const final=structuredClone(result);final.voiceBrief.findings[0].status='verified';final.sources[0].url='https://example.edu/corrected-budget';
 const before=f.sent.length;
 f.ready('en',{evidenceVersion:2,result:final});f.ack();f.advance(500);
 const context=decodedResearchContext(f.sent.slice(before).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
 assert.equal(context.findings[0].status,'verified');assert.equal(context.sources[0].url,final.sources[0].url);
 assert.equal(f.announcements().length,1);f.delivery.clear();
});

test('context references stay connected across changed selections and later reuse',()=>{
 const f=fixture(),result=budgetResult(budgetScripts.en);
 result.voiceBrief.findings.push({...result.voiceBrief.findings[0],subject:'UCLA',answer:'UCLA annual total is $47,800. [1]'});
 const update=(version,question)=>{
  f.delivery.caller();f.delivery.callerStopped(question);const before=f.sent.length;
  f.ready('en',{question:'Compare Berkeley and UCLA',evidenceVersion:version,result});f.ack();
  return decodedResearchContext(f.sent.slice(before).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
 };
 const first=update(1,'What is Berkeley’s total?');
 const second=update(2,'What is UCLA’s total?');
 const third=update(3,'What was Berkeley’s total?');
 assert.equal(first.findings[0].subject,'UC Berkeley');assert.equal(second.findings[0].subject,'UCLA');
 assert.ok(second.unchangedEvidenceFrom);assert.ok(third.unchangedEvidenceFrom);assert.equal(third.findings.length,0);
 const states=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)).filter(e=>e.unit==='state');
 assert.equal(second.unchangedEvidenceFrom,states[0].resultId);assert.equal(third.unchangedEvidenceFrom,states[1].resultId);f.delivery.clear();
});

test('a non-interrupted unfinished transcript clause cannot count as a completed finding',()=>{
 const f=fixture(),script=budgetScripts.en;
 f.ready('en',{question:script.question,result:budgetResult(script)});f.ack();
 f.delivery.reply(script.answer,{audible:true,completedText:''});
 assert.ok(!f.events.some(e=>['evidence_overlap_observed','native_portion_observed'].includes(e.deliveryStage)));f.delivery.clear();
});

for(const language of ['en','es'])test(`${language}: recovery quietly retires obsolete references without repeating them or requesting speech`,()=>{
 const f=fixture(),subject='Eastview College',question='2026–27 cost of attendance off campus';
 const qualification='2026–27 rental benchmark before aid; living plan unconfirmed. [1]';
 const fee={subject,aspect:'tuition_fees',status:'verified',answer:'Annual tuition and fees are $10,000 [1].',qualification};
 const missing={subject,aspect:'total_budget',status:'unverified',answer:'Housing and food amounts could not be verified.',qualification:''};
 const result=findings=>({sources:[{url:'https://eastview.edu/budget'}],voiceBrief:{status:'partial',answer:fee.answer,qualification,nextStep:'',findings}});
 f.quiet(false);f.delivery.supersede('new_request',question);
 f.ready(language,{question,evidenceVersion:1,researchPending:true,result:result([fee,missing])});f.ack();
 const prior=decodedResearchContext(f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
 const retired=prior.findings.find(finding=>finding.aspect==='total_budget');assert.ok(retired?.findingId);
 const start=f.sent.length;
 f.ready(language,{question,evidenceVersion:2,researchPending:false,result:result([fee,{subject,aspect:'total_budget',status:'verified',answer:'Annual rental budget $40,000 before aid [1].',qualification}])});
 const current=decodedResearchContext(f.sent.slice(start).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)));
 assert.ok(current.retiredFindingIds.includes(retired.findingId));
 assert.ok(!current.findings.some(finding=>finding.aspect==='housing'));
 assert.ok(current.findings.some(finding=>finding.aspect==='total_budget'));
 f.ack();f.advance(2000);assert.equal(f.announcements().length,0,'quiet context never interrupts the current answer');
});
