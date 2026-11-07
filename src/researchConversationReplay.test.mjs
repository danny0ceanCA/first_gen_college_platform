import {decodedResearchContext} from './researchContext.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {researchDelivery} from './researchDelivery.mjs';

// Offline replay of the public research pattern in the November 5 conversation.
// These figures are test fixtures, not assertions about current college costs.
// The caller/assistant turns are scripted: this tests delivery decisions, not
// model-generated speech, acoustic warmth, or real provider latency.
const sources=[{url:'https://financialaid.berkeley.edu/costs/',title:'Official cost fixture'}];
const scripts={
 en:{
  broad:'What does Berkeley cost for the 2026–27 year?',
  tuition:'Just tuition and fees at Berkeley, please.',
  tuitionAnswer:'UC Berkeley tuition and mandatory fees are 18214 dollars for the 2026–27 academic year.',
  budgetAnswer:'UC Berkeley total budgets range from 39428 to 56334 dollars for 2026–27.',
  qualification:'These are published new-undergraduate scenarios, before aid, not a personal bill.',
  compare:'How does UC Santa Cruz compare with Berkeley?',
  ucsc:'But what about UC Santa Cruz?',ack:'I see.',
  limitation:'I could not verify the current tuition and fees for UC Santa Cruz.',
  missingReason:'The official cost page could not be read, and the alternate official source did not establish the requested figures.',
  stillChecking:'I could not verify the current tuition and fees for UC Santa Cruz, but I am still checking.',
  pendingCheck:"I can't confirm UC Santa Cruz's tuition and fees yet; I'm checking the official page.",
  differentLimitation:"I could not verify UC Santa Cruz's housing policy.",
  reaction:'It is a lot to take in. We can work through the pieces together.',
  unrelated:'The essay can begin with a moment that matters to you.',
 },
 es:{
  broad:'¿Cuánto cuesta Berkeley para el año 2026–27?',
  tuition:'Solo la matrícula y las cuotas de Berkeley, por favor.',
  tuitionAnswer:'La matrícula y las cuotas obligatorias de UC Berkeley son 18214 dólares para el año académico 2026–27.',
  budgetAnswer:'Los presupuestos totales de UC Berkeley van de 39428 a 56334 dólares para 2026–27.',
  qualification:'Son escenarios publicados para estudiantes nuevos, antes de ayuda, no una factura personal.',
  compare:'¿Cómo se compara UC Santa Cruz con Berkeley?',
  ucsc:'¿Pero qué pasa con UC Santa Cruz?',ack:'Entiendo.',
  limitation:'No pude verificar la matrícula y las cuotas actuales de UC Santa Cruz.',
  missingReason:'No se pudo leer la página oficial de costos y la otra fuente oficial no confirmó las cifras solicitadas.',
  stillChecking:'No pude verificar la matrícula y las cuotas actuales de UC Santa Cruz, pero todavía estoy revisando.',
  pendingCheck:'No pude confirmar la matrícula y las cuotas de UC Santa Cruz; voy a revisar otra fuente oficial.',
  differentLimitation:'No pude verificar la política de alojamiento de UC Santa Cruz.',
  reaction:'Es mucho que asimilar. Podemos ir entendiendo cada parte juntos.',
  unrelated:'El ensayo puede empezar con un momento importante para ti.',
 },
};
function result(language,{comparison=false}={}){
 const s=scripts[language],tuition={subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:s.tuitionAnswer+' [1]',qualification:s.qualification+' [1]'},
  budget={...tuition,aspect:'total_budget',answer:s.budgetAnswer+' [1]'},
  unknown={subject:'UC Santa Cruz',aspect:'tuition_fees',status:'unverified',answer:s.limitation,qualification:s.missingReason};
 return {status:'source_check_completed',checkedAt:'2026-11-05T17:00:00.000Z',sources,
  text:[s.tuitionAnswer,s.budgetAnswer,s.qualification,...(comparison?[s.limitation,s.missingReason]:[])].join('\n'),
  voiceBrief:{status:comparison?'partial':'verified',answer:comparison?s.limitation+' '+s.tuitionAnswer+' [1]':s.tuitionAnswer+' '+s.budgetAnswer+' [1]',
   qualification:s.qualification+' [1]',nextStep:'',findings:comparison?[tuition,budget,unknown]:[tuition,budget]}};
}
function replay(){
 let time=0,sequence=0,quiet=true;const tasks=new Map(),sent=[],events=[];
 const delivery=researchDelivery({send:e=>sent.push(e),emit:e=>events.push(e),canAnnounce:()=>quiet,now:()=>time,
  schedule:(fn,ms)=>{const id=++sequence;tasks.set(id,{fn,at:time+ms});return id;},cancel:id=>tasks.delete(id),id:()=>`replay-${++sequence}`});
 const advance=ms=>{const end=time+ms;while(true){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=end;};
 const acknowledge=()=>{for(const e of sent.filter(e=>e.type==='session.thinking.append'))delivery.receive({type:'session.thinking.appended',client_event_id:e.event_id});};
 const caller=text=>{quiet=false;delivery.caller();delivery.callerStopped(text);};
 const answer=(text,options={})=>{delivery.reply(text,{audible:true,...options});quiet=true;};
 return {delivery,sent,events,tasks,advance,acknowledge,caller,answer,
  ready:(id,language,comparison=false)=>delivery.ready({jobId:id,requestId:id,revision:1,question:comparison?scripts[language].compare:scripts[language].broad,result:result(language,{comparison})},{awaitingReply:true}),
  announcements:()=>sent.filter(e=>e.type==='session.commentary.append'),
  assertNoConversationControls(){assert.ok(!sent.some(e=>['response.create','response.cancel','session.instructions.append','session.input_audio.mute','session.close'].includes(e.type)));},
 };
}

for(const language of ['en','es']){
 const s=scripts[language];
 test(`${language}: continuous Berkeley-to-UCSC replay retires answered portions and preserves campus focus through acknowledgment`,()=>{
  const r=replay();r.caller(s.broad);r.advance(1000);r.caller(s.tuition);
  r.ready('berkeley',language);r.acknowledge();r.advance(2500);
  assert.equal(r.announcements().length,0,'arrival must not speak over the caller');
  r.answer(s.tuitionAnswer+' '+s.qualification);r.advance(1000);
  assert.ok(r.events.some(e=>e.jobId==='berkeley'&&e.deliveryReason==='requested_portion_answered'));
  assert.equal(r.announcements().length,0,'tuition answer does not require reciting every housing budget');

  r.caller(s.compare);r.answer(s.reaction);r.caller(s.ucsc);r.answer(s.ack);r.caller(s.ack);
  r.ready('comparison',language,true);r.acknowledge();r.advance(2500);
  assert.equal(r.announcements().length,0);
  r.answer(s.limitation+' '+s.missingReason);r.advance(1000);
  assert.ok(r.events.some(e=>e.jobId==='comparison'&&e.deliveryReason==='requested_portion_answered'));
  assert.equal(r.announcements().length,0,'an explained UCSC limitation does not trigger another Berkeley recital');
  r.advance(60000);assert.equal(r.announcements().length,0);
  r.assertNoConversationControls();r.delivery.clear();assert.equal(r.tasks.size,0);
 });

 test(`${language}: a finished partial check offers its limitation once at a natural pause`,()=>{
  const r=replay();r.caller(s.ucsc);r.ready('comparison',language,true);r.acknowledge();r.advance(5000);
  assert.equal(r.announcements().length,0);
  r.answer(s.reaction);r.advance(500);
  assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/requested gap, then useful verified context/);
  assert.match(r.announcements()[0].content,/check has ended/);
  const parts=r.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
  const context=decodedResearchContext(parts);
  assert.equal(context.taskState,'completed');assert.equal(context.researchPending,false);
  assert.ok(context.findings.some(f=>f.subject==='UC Santa Cruz'&&f.status==='unverified'));
  assert.ok(context.findings.every(f=>f.subject==='UC Santa Cruz'),'latest campus focus excludes previously supplied Berkeley findings');
  assert.deepEqual(context.sources,[],'Berkeley sources must not appear to support the unverified UCSC finding');
  r.delivery.receive({type:'session.commentary.appended',client_event_id:r.announcements()[0].event_id});
  assert.ok(!r.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),'append acknowledgment is not proof of speech');
  r.caller(s.ack);r.answer(s.unrelated);r.advance(60000);
  assert.equal(r.announcements().length,1,'interrupted contribution must not be replayed');
  r.assertNoConversationControls();r.delivery.clear();
 });

 test(`${language}: interrupted or still-checking speech cannot count as a completed UCSC limitation`,()=>{
  for(const [reply,options] of [[s.limitation,{interrupted:true}],[s.limitation,{forced:true}],[s.limitation,{audible:false}],[s.stillChecking,{}],[s.pendingCheck,{}],[s.differentLimitation,{}],[s.tuitionAnswer,{}]]){
   const r=replay();r.caller(s.ucsc);r.ready('comparison',language,true);r.acknowledge();r.answer(reply,options);
   assert.ok(!r.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),reply);
   r.assertNoConversationControls();r.delivery.clear();assert.equal(r.tasks.size,0);
  }
 });
}
