import test from 'node:test';
import assert from 'node:assert/strict';
import {researchDelivery} from './researchDelivery.mjs';
import {decodedResearchContext} from './researchContext.fixture.mjs';

// Scripted bilingual regressions for the research focus failure. These public
// figures are historical fixtures, not current college-cost advice. No provider
// audio is generated: transcript observation and playback remain separate.
const scripts={
 en:{
  question:'For UC Irvine, find the total off-campus budget for 2026–27. Compare with UCLA using its existing findings.',
  ask:'What about UC Irvine?',aside:'Makes me wonder if it will be similar to UCLA.',
  reply:'That is a useful comparison. Housing can make a difference.',
  gap:'I could not verify the UC Irvine total budget for 2026–27.',
  limitation:'The official source was unavailable.',
  comparator:'The UCLA total budget for 2026–27 is $47,786. [1]',
  qualification:'Published off-campus estimate before aid. [1]',
  change:'Tell me the UCLA total instead.',ack:'I see.',
  want:'I want the UCLA total now.',
  tuitionAside:'Makes me wonder if tuition will be similar to UCLA.',
  comparisonQuestion:'Compare UC Irvine and UCLA total budgets for 2026–27.',
 },
 es:{
  question:'Para UC Irvine, busca el presupuesto total fuera del campus para 2026–27. Compara con UCLA usando los resultados existentes.',
  ask:'¿Y qué pasa con UC Irvine?',aside:'Me pregunto si será parecido a UCLA.',
  reply:'Es una comparación útil. La vivienda puede hacer una diferencia.',
  gap:'No pude verificar el presupuesto total de UC Irvine para 2026–27.',
  limitation:'La fuente oficial no estaba disponible.',
  comparator:'El presupuesto total de UCLA para 2026–27 es $47,786. [1]',
  qualification:'Estimación fuera del campus antes de ayuda. [1]',
  change:'Mejor dime el total de UCLA.',ack:'Entiendo.',
  want:'Quiero el total de UCLA.',
  tuitionAside:'Me pregunto si la matrícula será parecida a UCLA.',
  comparisonQuestion:'Compara los presupuestos totales de UC Irvine y UCLA para 2026–27.',
 },
};

function result(s,{primary='UC Irvine',comparison='UCLA',aspect='total_budget'}={}){
 return {status:'source_check_completed',sources:[{url:'https://example.edu/verified',title:'Official fixture'}],
  voiceBrief:{status:'partial',answer:s.gap,qualification:s.limitation,nextStep:'',findings:[
   {subject:primary,aspect,status:'unverified',answer:s.gap,qualification:s.limitation},
   {subject:comparison,aspect,status:'verified',answer:s.comparator,qualification:s.qualification},
  ]}};
}

function replay(s,research=result(s)){
 let clock=0,sequence=0,quiet=true;
 const tasks=new Map(),sent=[],events=[];
 const delivery=researchDelivery({send:e=>sent.push(e),emit:e=>events.push(e),canAnnounce:()=>quiet,now:()=>clock,
  schedule:(fn,ms)=>{const key=++sequence;tasks.set(key,{fn,at:clock+ms});return key;},
  cancel:key=>tasks.delete(key),id:()=>`primary-${++sequence}`});
 const advance=ms=>{const end=clock+ms;while(true){
  const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
  if(!next)break;clock=next[1].at;tasks.delete(next[0]);next[1].fn();
 }clock=end;};
 delivery.supersede('new_request',s.question);
 return {delivery,sent,events,advance,
  quiet:value=>{quiet=value;},
  caller:text=>{quiet=false;delivery.caller();delivery.callerStopped(text);},
  answer:(text,options={})=>{delivery.reply(text,{audible:true,...options});quiet=true;},
  ready:(version,pending)=>delivery.ready({jobId:'research-1',requestId:'request-1',revision:1,
   question:s.question,evidenceVersion:version,researchPending:pending,result:research}),
  ack:()=>{for(const e of sent.filter(e=>e.type==='session.thinking.append'))delivery.receive({type:'session.thinking.appended',client_event_id:e.event_id});},
  announcements:()=>sent.filter(e=>e.type==='session.commentary.append'),
  context:()=>decodedResearchContext(sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content))),
  close:()=>{assert.ok(!sent.some(e=>['response.create','response.cancel','session.instructions.append','session.input_audio.mute','session.close'].includes(e.type)),
   'research follow-through must not take control of ordinary speech');delivery.clear();assert.equal(tasks.size,0);},
 };
}

for(const [language,s] of Object.entries(scripts)){
 test(`${language}: a short subject selection changes focus without mistaking a reflection for a selection`,()=>{
  const r=replay(s);r.caller(s.ask);r.answer(s.reply);r.caller(language==='en'?'UCLA, please.':'UCLA, por favor.');
  r.ready(1,false);r.ack();r.answer(s.reply);r.advance(500);
  assert.ok(r.context().findings.every(f=>f.subject==='UCLA'));
  assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/UCLA/);r.close();
 });
 test(`${language}: comparison aside does not replace the outstanding campus, and its final gap waits for the current answer`,()=>{
  const r=replay(s);r.caller(s.ask);r.answer(s.reply);r.caller(s.aside);
  r.ready(1,true);r.ack();r.advance(5000);
  assert.equal(r.announcements().length,0,'pending research cannot interrupt a caller turn');
  const context=r.context();
  assert.ok(context.findings.length>0);
  assert.ok(context.findings.every(f=>f.subject==='UC Irvine'),'the comparator must not replace the requested campus');
  r.answer(s.reply);r.advance(1000);
  assert.equal(r.announcements().length,0,'an initial unverified target must not become a verified comparator announcement');
  r.quiet(false);r.ready(2,false);r.ack();r.advance(5000);
  assert.equal(r.announcements().length,0,'a completed lookup must not cut off the current thought');
  r.answer(s.reply);r.advance(500);
  assert.equal(r.announcements().length,1);
  assert.match(r.announcements()[0].content,/UC Irvine/);
  assert.doesNotMatch(r.announcements()[0].content,/47,786|still checking\.$/);
  r.delivery.receive({type:'session.commentary.appended',client_event_id:r.announcements()[0].event_id});
  assert.ok(!r.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),'append acknowledgment does not prove speech');
  r.answer(s.gap);r.advance(10000);assert.equal(r.announcements().length,1);r.close();
 });

 test(`${language}: a reused comparator answer cannot consume the primary unresolved result`,()=>{
  const r=replay(s);r.caller(s.ask);r.answer(s.reply);r.caller(s.aside);
  r.ready(1,true);r.ack();r.answer(s.comparator+' '+s.qualification);r.advance(500);
  assert.equal(r.announcements().length,0);
  assert.ok(!r.events.some(e=>e.deliveryStage==='native_portion_observed'),'only answering the comparator does not finish the primary request');
  r.ready(2,false);r.ack();r.advance(500);
  assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/UC Irvine/);r.close();
 });

 test(`${language}: a genuinely changed question can select the already verified comparator`,()=>{
  const r=replay(s);r.caller(s.ask);r.answer(s.reply);r.caller(s.change);
  r.ready(1,false);r.ack();r.answer(s.reply);r.advance(500);
  assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/UCLA/);
  assert.ok(r.context().findings.every(f=>f.subject==='UCLA'));
  r.close();
 });

 test(`${language}: a direct statement of what the caller wants can change the requested campus`,()=>{
  const r=replay(s);r.caller(s.ask);r.answer(s.reply);r.caller(s.want);
  r.ready(1,false);r.ack();r.answer(s.reply);r.advance(500);
  assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/UCLA/);
  assert.ok(r.context().findings.every(f=>f.subject==='UCLA'));
  r.close();
 });

 test(`${language}: a tuition reflection keeps the total gap primary while verified partial fees remain useful`,()=>{
  const research=result(s);
  research.voiceBrief.findings.push({subject:'UC Irvine',aspect:'tuition_fees',status:'verified',
   answer:language==='en'?'UC Irvine tuition and fees for 2026–27 are $18,000. [1]':'La matrícula y las cuotas de UC Irvine para 2026–27 son $18,000. [1]',
   qualification:s.qualification});
  const r=replay(s,research);r.caller(s.ask);r.answer(s.reply);r.caller(s.tuitionAside);
  r.ready(1,true);r.ack();r.answer(s.reply);r.advance(500);
  assert.equal(r.announcements().length,1,'the pending total gap can accompany useful verified partial fees');
  assert.match(r.announcements()[0].content,/attendance total is unverified so far.*UC Irvine/s);
  assert.match(r.announcements()[0].content,/sourced tuition and fees/);
  assert.ok(r.context().findings.every(f=>f.subject==='UC Irvine'));
  assert.deepEqual(new Set(r.context().findings.map(f=>f.aspect)),new Set(['total_budget','tuition_fees']));
  r.ready(2,false);r.ack();r.advance(500);
  assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/UC Irvine/);
  assert.doesNotMatch(r.announcements()[0].content,/47,786/);r.close();
 });

 for(const contribution of ['requested','observed'])test(`${language}: ${contribution} comparison contribution does not mark the unspoken target gap as answered`,()=>{
  const comparison={...s,question:s.comparisonQuestion};
  const r=replay(comparison);r.caller(comparison.question);r.ready(1,true);r.ack();
  if(contribution==='requested'){
   r.answer(s.reply);r.advance(500);
   assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/UCLA/);
   r.delivery.receive({type:'session.commentary.appended',client_event_id:r.announcements()[0].event_id});
   assert.ok(!r.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),'a scheduled/acknowledged update is not observed speech');
  }else{
   r.answer(s.comparator+' '+s.qualification);r.advance(500);
   assert.equal(r.announcements().length,0);
  }
  const before=r.announcements().length;
  r.caller(s.ask);r.answer(s.reply);r.ready(2,false);r.ack();r.advance(500);
  assert.equal(r.announcements().length,before+1,'Irvine still needs its own terminal outcome');
  assert.match(r.announcements().at(-1).content,/UC Irvine/);
  assert.doesNotMatch(r.announcements().at(-1).content,/47,786/);r.close();
 });

 test(`${language}: an already explained target limitation is not announced again when recovery ends`,()=>{
  const r=replay(s);r.caller(s.ask);r.ready(1,true);r.ack();r.answer(s.gap);r.advance(500);
  r.ready(2,false);r.ack();r.advance(10000);
  assert.equal(r.announcements().length,0);r.close();
 });

 test(`${language}: an interrupted target announcement remains available without an automatic repeated announcement`,()=>{
  const r=replay(s);r.caller(s.ask);r.ready(1,false);r.ack();r.answer(s.reply);r.advance(500);
  assert.equal(r.announcements().length,1);
  r.caller(language==='en'?'Wait, explain what that means.':'Espera, explica qué significa eso.');
  r.answer(s.gap,{interrupted:true,completedText:''});
  r.ready(2,false);r.ack();r.advance(10000);
  assert.equal(r.announcements().length,1);
  assert.ok(!r.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),'an unfinished statement is not a completed finding');
  r.close();
 });
}

for(const language of ['en','es'])test(`${language}: scholarship deadline research keeps its target through an incidental program comparison`,()=>{
 const spanish=language==='es';
 const s={...scripts[language],
  question:spanish?'Busca el plazo de North Scholars. Compara con City Grant usando resultados existentes.':'Find the North Scholars deadline. Compare with City Grant using existing findings.',
  ask:spanish?'¿Cuál es el plazo de North Scholars?':'What is the North Scholars deadline?',
  aside:spanish?'Me pregunto si será parecido a City Grant.':'Makes me wonder if it will be similar to City Grant.',
  gap:spanish?'No pude verificar el plazo de North Scholars.':'I could not verify the North Scholars deadline.',
  comparator:spanish?'El plazo de City Grant es el 15 de enero de 2027. [1]':'The City Grant deadline is January 15, 2027. [1]',
  qualification:spanish?'Ciclo de becas de 2027. [1]':'2027 scholarship cycle. [1]',
 };
 const r=replay(s,result(s,{primary:'North Scholars',comparison:'City Grant',aspect:'deadline'}));
 r.caller(s.ask);r.answer(s.reply);r.caller(s.aside);r.ready(1,true);r.ack();r.answer(s.reply);r.advance(500);
 assert.equal(r.announcements().length,0);
 r.ready(2,false);r.ack();r.advance(500);
 assert.equal(r.announcements().length,1);assert.match(r.announcements()[0].content,/North Scholars/);
 assert.doesNotMatch(r.announcements()[0].content,/January 15|15 de enero/);r.close();
});

for(const language of ['en','es']){
 const es=language==='es';
 const question=es
  ?'En comparación con UC Berkeley y UC Irvine, ¿cuál es la matrícula y las cuotas anuales de UC Riverside para 2026–27? Separa la matrícula del costo de asistencia.'
  :'For comparison with UC Berkeley and UC Irvine, what are UC Riverside tuition and mandatory fees for 2026–27? Separate tuition from total cost of attendance.';
 const primary={subject:'UC Riverside',aspect:'tuition_fees',status:'verified',
  answer:es?'La matrícula y las cuotas de UC Riverside para 2026–27 son $16,790. [1]':'UC Riverside tuition and fees for 2026–27 are $16,790. [1]',
  qualification:es?'Para nuevos estudiantes residentes; no incluye seguro. [1]':'For new resident undergraduates; excludes insurance. [1]'};
 const comparator={subject:'UC Irvine',aspect:'tuition_fees',status:'unverified',
  answer:es?'No pude verificar la matrícula de UC Irvine.':'I could not verify UC Irvine tuition.',
  qualification:es?'La nueva consulta no recuperó la tabla.':'The new check did not retrieve the table.'};
 const research={status:'source_check_completed',sources:[{url:'https://example.edu/fees',title:'Official fixture'}],
  voiceBrief:{status:'partial',answer:primary.answer,qualification:primary.qualification,nextStep:'',findings:[primary,comparator,
   {...primary,aspect:'total_budget',status:'unverified',answer:es?'No se confirmó el presupuesto total.':'The total budget was not confirmed.',qualification:''}]}};

 for(const useCaller of [true,false])test(`${language}: ${useCaller?'accepted caller request survives the handoff':'comparison preface leaves the primary question intact'}`,()=>{
  const r=replay({...scripts[language],question},research);
  if(useCaller){
   r.caller(es?'¿Y UCR?':'What about UCR?');
   // Production ordering: caller transcript, then application task acceptance.
   r.delivery.supersede('new_request',question);
  }
  r.caller(es?'Me imagino que':'I would think that');
  r.ready(1,true);r.ack();r.answer(es?'Podemos comparar esos costos juntos.':'We can compare those costs together.');r.advance(500);
  assert.equal(r.announcements().length,1);
  const context=r.context();
  assert.equal(context.findings.length,1);
  assert.equal(context.findings[0].subject,'UC Riverside');
  assert.equal(context.findings[0].aspect,'tuition_fees');
  r.close();
 });

 test(`${language}: answering the primary question leaves an unrelated failed recheck quiet after recovery`,()=>{
  const r=replay({...scripts[language],question},research);
  r.caller(es?'¿Y UCR?':'What about UCR?');r.delivery.supersede('new_request',question);
  r.ready(1,true);r.ack();r.answer(primary.answer+' '+primary.qualification);r.advance(500);
  r.caller(es?'Entiendo.':'I see.');r.answer(es?'Sí.':'Yes.');
  r.ready(2,false);r.ack();r.advance(10000);
  assert.equal(r.announcements().length,0,'an Irvine gap must not follow the Riverside answer');
  assert.ok(r.events.some(e=>['requested_portion_answered','recovery_context_only'].includes(e.deliveryReason)));
  r.close();
 });

 test(`${language}: an explicit comparison before task acceptance still requests both outcomes`,()=>{
  const r=replay({...scripts[language],question},research);
  r.caller(es?'Compara la matrícula de UC Riverside y UC Irvine.':'Compare UC Riverside and UC Irvine tuition.');
  r.delivery.supersede('new_request',question);r.ready(1,false);r.ack();
  assert.deepEqual(new Set(r.context().findings.map(f=>f.subject)),new Set(['UC Riverside','UC Irvine']));
  r.close();
 });

 test(`${language}: a new explicit request after acceptance takes priority over the saved caller question`,()=>{
  const r=replay({...scripts[language],question},research);
  r.caller(es?'¿Y UCR?':'What about UCR?');r.delivery.supersede('new_request',question);
  r.caller(es?'Mejor dime la matrícula de UC Irvine.':'Tell me the UC Irvine tuition instead.');
  r.ready(1,false);r.ack();r.answer(scripts[language].reply);r.advance(500);
  assert.equal(r.context().findings.length,1);assert.equal(r.context().findings[0].subject,'UC Irvine');
  assert.equal(r.announcements().length,1);r.close();
 });
}
