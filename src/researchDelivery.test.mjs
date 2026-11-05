import test from 'node:test';
import assert from 'node:assert/strict';
import {researchDelivery,researchAnswerOverlap} from './researchDelivery.mjs';
import {capturePayload} from './voiceCapture.mjs';

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

for(const language of ['en','es']){
 const x=examples[language];
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
  const evidence=JSON.parse(packets.map(p=>p.text).join(''));
  assert.equal(evidence.text,text);assert.equal(evidence.taskState,'completed');assert.equal(evidence.researchPending,false);
  assert.ok(f.sent.every(e=>Buffer.byteLength(e.content)<=480));assert.match(f.announcements()[0].content,/Completed research/);f.delivery.clear();
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
 f.advance(2750);assert.equal(f.announcements().length,0);f.advance(500);assert.equal(f.announcements().length,1);
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
 assert.match(f.announcements()[0].content,/failed.*No verified findings/);assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);f.delivery.clear();
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
test('private delivery diagnostics retain correlation and stage without copied content',()=>{
 const payload=capturePayload({type:'origen.research.delivery',jobId:'job',revision:1,deliveryStage:'deferred',deliveryReason:'caller_turn',durationMs:123,question:'PRIVATE',text:'PRIVATE'});
 assert.equal(payload.jobId,'job');assert.equal(payload.deliveryStage,'deferred');assert.doesNotMatch(JSON.stringify(payload),/PRIVATE/);
});
test('ordinary conversation without completed research creates no model work or timed speech',()=>{
 const f=fixture();f.delivery.caller();f.delivery.callerStopped();f.advance(60000);f.delivery.reply(examples.en.reply,{audible:true});f.advance(60000);
 assert.equal(f.sent.length,0);assert.equal(f.tasks.size,0);
});
for(const reason of ['cancelled','scope_changed','call_ended'])test(`${reason} clears a pending delivery and rejects its late acknowledgment`,()=>{
 const f=fixture();f.ready();f.delivery.clear(reason);f.ack();f.advance(60000);
 assert.equal(f.announcements().length,0);assert.equal(f.tasks.size,0);assert.ok(f.events.some(e=>e.deliveryReason===reason));
});
