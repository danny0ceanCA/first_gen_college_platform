import test from 'node:test';
import assert from 'node:assert/strict';
import {createPauseDelivery,typedPortionObserved,scoutSpokenUnit} from './pause-delivery.mjs';
import {publicRecord,publicFact} from '../../server/research-record.fixtures.mjs';
import {createPrimaryDeliveryGate} from './primary-delivery-gate.mjs';

function fixture(language='en',options={}){
 let time=0,seq=0,autoAck=false;const tasks=new Map(),sent=[],events=[];
 const ack=e=>{if(e.type==='session.thinking.append'){const id=++seq;tasks.set(id,{at:time+10,fn:()=>adapter.receive({type:'session.thinking.appended',client_event_id:e.event_id})});}};
 const adapter=createPauseDelivery({send:e=>{sent.push(e);if(autoAck)ack(e);},log:e=>events.push(e),now:()=>time,id:()=>`id-${++seq}`,
  schedule:(fn,ms)=>{const id=++seq;tasks.set(id,{fn,at:time+ms});return id;},cancel:id=>tasks.delete(id),...options});
 const advance=ms=>{const end=time+ms;while(true){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=end;};
 const es=language==='es',finding={subject:'Eastview College',aspect:'other',status:'verified',
  answer:es?'Eastview ofrece un autobús gratuito. [1]':'Eastview has a free bus. [1]',qualification:es?'Se necesita una tarjeta estudiantil vigente. [1]':'A current student card is required. [1]'};
 const event={jobId:'scout',question:es?'¿Qué autobús ofrece Eastview College?':'What bus does Eastview College offer?',result:{status:'source_check_completed',sources:[{url:'https://eastview.edu/bus'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}}};
 return {adapter,sent,events,advance,event,
  ready:()=>adapter.ready(event,{key:'transit'}),
  ack(){autoAck=true;for(const e of sent)ack(e);},
  output(text){adapter.receive({type:'session.output_transcript.delta',delta:text});},
  announcements:()=>sent.filter(e=>e.type==='session.commentary.append'),
 };
}
for(const language of ['en','es']){
 const es=language==='es';
 test(`${language}: the real task gate releases a ready supplement only after the qualified primary thought and idle audio`,()=>{
  const gate=createPrimaryDeliveryGate(),question=es?'¿Cuál es la matrícula de Eastview College?':'What is the tuition at Eastview College?';
  const answer=es?'La matrícula anual de Eastview College es de 12000 dólares.':'Eastview College annual tuition is 12000 dollars.';
  const qualification=es?'La vivienda no está incluida.':'Housing is not included.';
  const result={sources:[{url:'https://eastview.edu/fees'}],voiceBrief:{status:'verified',answer:answer+' [1]',qualification:qualification+' [1]',findings:[{subject:'Eastview College',aspect:'tuition_fees',status:'verified',answer:answer+' [1]',qualification:qualification+' [1]'}]}};
  gate.start('primary',{question,language});gate.ready('primary',{result});
  const f=fixture(language,{supplementalOnly:true,canDeliver:()=>gate.canDeliver()});f.adapter.playback({idle:true});f.ready();
  const observed={jobId:'primary',revision:1,evidenceVersion:1,playbackObserved:true,completedPortions:1,speechOutcome:'acknowledgment_overlap'};
  f.output(answer);gate.speech(observed,answer);f.advance(1500);assert.equal(f.sent.length,0,'a missing condition keeps even quiet context staged');
  f.adapter.playback({idle:false});f.output(' '+qualification);gate.speech(observed,qualification);assert.equal(gate.canDeliver(),true);
  f.advance(1500);assert.equal(f.sent.length,0,'the task gate does not bypass playing audio');
  f.adapter.playback({idle:true});f.advance(1100);f.ack();f.advance(1500);
  assert.equal(f.announcements().length,1);f.advance(3000);assert.equal(f.announcements().length,1);f.adapter.close();
 });
 test(`${language}: a shorter primary thought still finishes its qualification before a queued supplement`,()=>{
  let primaryFinished=false;
  const f=fixture(language,{supplementalOnly:true,canDeliver:()=>primaryFinished});
  f.adapter.callerStarted();f.adapter.callerStopped(es?'¿Cuál es el costo total? Necesita el autobús.':'What is the total cost? She needs the bus.');
  f.adapter.playback({idle:true});f.ready();f.ack();
  f.output(es?'El total publicado es de 40 mil dólares':'The published total is 40 thousand dollars');f.advance(2000);
  primaryFinished=true;f.advance(1000);assert.equal(f.sent.length,0,'an unfinished clause cannot release the supplement');
  f.output(es?'. Es una estimación, no una factura.':'. It is an estimate, not a bill.');f.advance(1800);
  assert.equal(f.announcements().length,1);assert.ok(f.sent.some(e=>/bus|autobús/u.test(e.content)));
  assert.ok(f.sent.every(e=>['session.thinking.append','session.commentary.append'].includes(e.type)),'no forced stop, new backend response or instruction pivot');
  f.advance(5000);assert.equal(f.announcements().length,1);f.adapter.close();
 });
 test(`${language}: optional research cannot overtake the primary answer and rechecks novelty at the actual pause`,()=>{
  let primaryFinished=false,newFact=true,preparations=0;
  const f=fixture(language,{supplementalOnly:true,canDeliver:()=>primaryFinished,prepare:event=>{preparations++;return newFact?event:null;}});
  f.adapter.playback({idle:true});f.output(es?'Te puedo ayudar.':'I can help.');f.ready();f.ack();f.advance(5000);
  assert.equal(f.sent.length,0);assert.equal(preparations,0);
  assert.equal(f.events.filter(e=>e.stage==='first_eligible_pause').length,0,'a primary hold is not an eligible delivery pause');
  assert.ok(f.events.some(e=>e.stage==='delivery_hold_changed'&&e.reason==='primary_or_formal_owner'));
  newFact=false;primaryFinished=true;f.advance(1000);assert.equal(preparations,1);assert.equal(f.sent.length,0);
  assert.ok(f.events.some(e=>e.stage==='result_withheld'&&e.reason==='no_new_applicable_evidence'));f.adapter.close();
 });
 test(`${language}: the primary cost question cannot strip a supplemental bus fact from the fallback context`,()=>{
  const f=fixture(language,{supplementalOnly:true});
  f.adapter.playback({idle:true});f.adapter.callerStarted();f.adapter.callerStopped(es?'¿Cuál es el costo total de Eastview College? También necesita autobús.':'What is the total cost at Eastview College? She also needs the bus.');
  f.output(es?'El presupuesto publicado es una estimación, no una factura.':'The published budget is an estimate, not a bill.');f.advance(1100);
  f.ready();f.ack();f.advance(2500);
  const packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
  assert.ok(packets.some(p=>p.unit==='finding'||p.unit==='finding-part'||p.group?.includes('finding')),'the qualified supplemental fact, not just its state, is supplied');
  assert.ok(f.sent.some(e=>e.content.includes('bus')||e.content.includes('autobús')));
  f.adapter.close();
 });
 test(`${language}: an oversized finding-wide caveat is retained in the full path instead of dropped for inline speech`,()=>{
  const f=fixture(language);f.event.result.voiceBrief.findings[0].evidence=publicRecord('student_support',language);f.event.question='What is the contact at Eastview College?';
  f.event.result.voiceBrief.findings[0].qualification='Material condition '.repeat(35);
  assert.equal(scoutSpokenUnit(f.event),undefined);f.adapter.close();
 });
 test(`${language}: a short amount cannot detach from a sibling eligibility rule`,()=>{
  const f=fixture(language),record=publicRecord('student_support',language);
  record.facts.push(publicFact({key:'eligibility',label:'Eligibility',kind:'rule',value:'A current student card is required.',date:null,time:null,timeZone:null}));record.expectedFacts.push('eligibility');
  f.event.result.voiceBrief.findings[0].evidence=record;f.event.question='What is the contact at Eastview College?';
  assert.equal(scoutSpokenUnit(f.event),undefined);f.adapter.close();
 });
 test(`${language}: a result waits for completed thought AND idle audio, then gets one spoken opportunity`,()=>{
  const f=fixture(language);f.adapter.playback({idle:false});f.output(es?'Podemos probar la ruta.':'We can practice the route.');f.ready();f.ack();f.advance(2000);
  assert.equal(f.announcements().length,0);
  f.adapter.playback({idle:true});f.advance(1100);assert.equal(f.announcements().length,1);
  assert.match(f.announcements()[0].content,/card|tarjeta|Reference/);
  f.advance(5000);assert.equal(f.announcements().length,1);f.adapter.close();
 });
 test(`${language}: transcript punctuation without audio idle, or audio idle with unfinished clause, cannot cut speech`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.output(es?'Podemos empezar con':'We can start with');f.ready();f.ack();f.advance(5000);
  assert.equal(f.announcements().length,0);f.output(es?' una ruta.':' one route.');f.advance(1100);
  assert.equal(f.announcements().length,1);f.adapter.close();
 });
 test(`${language}: latest caller question gets an answer first; ACK alone never proves speech`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.adapter.callerStarted();f.adapter.callerStopped(es?'¿Cómo empezamos la rutina?':'How do we start the routine?');
  f.ready();f.ack();f.advance(7000);assert.equal(f.announcements().length,0);
  f.output(es?'Prueben la ruta juntos primero.':'Try the route together first.');f.advance(1100);assert.equal(f.announcements().length,1);f.adapter.close();
 });
 test(`${language}: unrelated new topic and a late ACK do not wake the old result`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.ready();
  f.adapter.callerStarted();f.adapter.callerStopped(es?'Cambiemos de tema. Ayúdame con mi ensayo.':'Change topics. Help me with my essay.');f.ack();
  f.output(es?'Empecemos con una experiencia importante para ti.':'Start with an experience that matters to you.');f.advance(5000);
  assert.equal(f.announcements().length,0);f.adapter.close();
 });
 test(`${language}: joined formal job shares the scout identity and does not announce twice`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.ready();f.ack();f.advance(1100);
  f.adapter.ready({...f.event,jobId:'formal-job',requestId:'formal-request',revision:5},{key:'transit'});f.advance(5000);
  assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryReason==='repeated_version'));f.adapter.close();
 });
 test(`${language}: complete native finding and caveat suppress an extra research recital`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.ready();f.ack();
  f.output(f.event.result.voiceBrief.answer+' '+f.event.result.voiceBrief.qualification);f.advance(1100);
  assert.equal(f.announcements().length,0);f.adapter.close();
 });
 test(`${language}: unknown ACK and active backend do not release speech`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.ready();f.adapter.receive({type:'session.thinking.appended',client_event_id:'wrong'});f.advance(1500);
  assert.equal(f.announcements().length,0);f.ack();
  f.adapter.receive({type:'response.event',delegation_id:'d',event:{type:'response.created',response:{id:'r'}}});f.advance(1100);
  assert.equal(f.announcements().length,0);
  f.adapter.receive({type:'response.event',delegation_id:'d',event:{type:'response.completed',response:{id:'r'}}});f.advance(500);
  assert.equal(f.announcements().length,1);f.adapter.close();
 });
 test(`${language}: typed clause dedup rejects a different institution, uncertainty, opposite polarity, and missing facts`,()=>{
  const f=fixture(language),evidence=publicRecord('student_support',language);
  evidence.scope={cycle:null,term:null,population:es?'Estudiantes de pregrado':'Undergraduate students',program:null,jurisdiction:null,enrollment:null,delivery:null,validThrough:null};
  const value=es?'Eastview ofrece un autobús gratuito para estudiantes de pregrado.':'Eastview offers a free bus benefit for undergraduate students.';
  evidence.facts[0].value=value;evidence.facts[0].qualification=es?'Se necesita una tarjeta vigente.':'A current card is required.';
  f.event.result.voiceBrief.findings[0].evidence=evidence;
  assert.equal(typedPortionObserved(f.event.result,value),false,'benefit alone cannot retire its required condition');
  const qualified=value+' '+evidence.facts[0].qualification+' '+f.event.result.voiceBrief.findings[0].qualification;
  assert.equal(typedPortionObserved(f.event.result,qualified),true);
  assert.equal(typedPortionObserved(f.event.result,value.replace('Eastview','Pine Valley')),false);
  assert.equal(typedPortionObserved(f.event.result,(es?'Tal vez ':'Maybe ')+value),false);
  assert.equal(typedPortionObserved(f.event.result,(es?'No, ':'No, ')+value),false);
  assert.equal(typedPortionObserved(f.event.result,value.replace('.','?')),false);
  f.event.result.voiceBrief.findings[0].status='partial';assert.equal(typedPortionObserved(f.event.result,value),false);
  f.adapter.close();
 });
 test(`${language}: an unanswered invitation gets caller space before optional speech`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.output(es?'¿Ya saben dónde vivirá?':'Do you know where she will live?');f.ready();f.ack();
  f.advance(2500);assert.equal(f.announcements().length,0);f.advance(1000);assert.equal(f.announcements().length,1);f.adapter.close();
 });
 test(`${language}: even quiet context stays staged during speech, and close prevents late delivery`,()=>{
  const f=fixture(language);f.adapter.playback({idle:false});f.output(es?'Lo que podemos hacer es':'What we can do is');f.ready();f.ack();f.advance(5000);
  assert.equal(f.sent.filter(e=>e.type==='session.thinking.append').length,0);
  f.adapter.playback({idle:true});f.advance(3000);assert.equal(f.sent.length,0,'unfinished clause is not a safe context boundary');
  f.output(es?' probar una ruta.':' try a route.');f.advance(1200);assert.ok(f.sent.some(e=>e.type==='session.thinking.append'));
  const count=f.sent.length;f.adapter.close();f.advance(40000);assert.equal(f.sent.length,count);
 });
 test(`${language}: a staged result expires instead of speaking after an unbounded wait`,()=>{
  const f=fixture(language);f.adapter.playback({idle:false});f.ready();f.ack();f.advance(120100);
  f.adapter.playback({idle:true});f.advance(5000);assert.equal(f.sent.length,0);
  assert.ok(f.events.some(e=>e.stage==='pending_expired'));f.adapter.close();
 });
 test(`${language}: a self-contained typed unit speaks once at the pause, with scope and complete qualification`,()=>{
  const f=fixture(language),record=publicRecord('student_support',language);
  const finding=f.event.result.voiceBrief.findings[0];finding.evidence=record;
  f.event.question=es?'¿Cuál es el contacto de Eastview College?':'What is the contact at Eastview College?';f.event.language=language;
  const unit=scoutSpokenUnit(f.event);assert.ok(unit);assert.ok(unit.bytes<=500);
  const data=JSON.parse(unit.content).sourceFact;
  assert.ok(data.q.includes(record.facts[0].qualification));assert.equal(data.v,record.facts[0].value);
  assert.match(data.c,/2027/);assert.match(data.c,/2027-01-15/);assert.equal(data.refs,'[1]');
  f.adapter.playback({idle:false});f.output(es?'Empecemos por un paso sencillo.':'Let us start with one simple step.');f.ready();f.advance(1500);assert.equal(f.sent.length,0);
  f.adapter.playback({idle:true});f.advance(1100);
  assert.equal(f.announcements().length,1);assert.equal(f.sent.filter(e=>e.type==='session.thinking.append').length,0,'complete unit needs no packet reassembly/ACK before speaking');
  f.adapter.ready({...f.event,jobId:'formal'},{key:'transit'});f.advance(5000);assert.equal(f.announcements().length,1);
  const outgoing=f.announcements()[0];f.adapter.receive({type:'session.commentary.appended',client_event_id:outgoing.event_id});
  assert.ok(f.events.some(e=>e.stage==='inline_commentary_acknowledged'&&e.playbackConfirmed===false));f.adapter.close();
 });
 test(`${language}: setting a task aside rejects its delayed formal join`,()=>{
  const f=fixture(language);f.adapter.playback({idle:true});f.ready();f.adapter.callerStarted();f.adapter.callerStopped(es?'Dejemos eso y hablemos de mi ensayo.':'Set that aside and talk about my essay.');
  f.output(es?'Empecemos con una experiencia personal.':'Start with a personal experience.');f.adapter.ready({...f.event,jobId:'late-formal'},{key:'transit'});f.advance(5000);
  assert.equal(f.sent.length,0);assert.ok(f.events.some(e=>e.stage==='result_discarded'&&e.reason==='retired_task'));f.adapter.close();
 });
 test(`${language}: oversized, step-sequence and unrelated units use the full existing delivery path`,()=>{
  const f=fixture(language),record=publicRecord('student_support',language);f.event.result.voiceBrief.findings[0].evidence=record;
  f.event.question='What is the contact at Eastview College?';
  record.facts[0].value='A'.repeat(490);record.facts[0].qualification='B'.repeat(290);assert.equal(scoutSpokenUnit(f.event),undefined);
  f.event.result.voiceBrief.findings[0].evidence=publicRecord('process',language);assert.equal(scoutSpokenUnit(f.event),undefined);
  f.event.result.voiceBrief.findings[0].evidence=publicRecord('student_support',language);f.event.question='What is the application deadline?';assert.equal(scoutSpokenUnit(f.event),undefined);f.adapter.close();
 });
 test(`${language}: inline receipt failure is logged without a second speech request or lookup`,()=>{
  const f=fixture(language);f.event.result.voiceBrief.findings[0].evidence=publicRecord('student_support',language);f.event.question='What is the contact at Eastview College?';
  f.adapter.playback({idle:true});f.ready();f.advance(1100);const event=f.announcements()[0];assert.ok(event);
  f.adapter.receive({type:'error',error:{event_id:event.event_id}});f.advance(35000);
  assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.stage==='inline_delivery_unconfirmed'));f.adapter.close();
 });
}
