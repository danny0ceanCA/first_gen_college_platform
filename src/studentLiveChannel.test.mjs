import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveChannel,liveBackendDeadlineMs} from './studentLiveChannel.mjs';
import {voiceProfileSaveConsent} from './voiceProfileSave.mjs';
import {voiceHandoff,deferredVoiceHandoff} from './voiceHandoff.mjs';
import {capturePayload} from './voiceCapture.mjs';
import {voiceTargetResult} from './voiceTargetResult.mjs';
import {selectionRecoveryDelayMs,selectionRecoveryStartDeadlineMs} from './liveSelectionRecovery.mjs';
import {decodedResearchContext} from './researchContext.fixture.mjs';
import {correctedBudgetExamples} from './researchDiscussion.fixture.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

for(const [language,example] of Object.entries(correctedBudgetExamples)){
 const ready={type:'origen.research.ready',jobId:'quiet-job',question:example.question,result:{
  sources:[{url:'https://example.edu/costs'}],voiceBrief:{status:'verified',answer:example.finding.answer,
   qualification:example.finding.qualification,nextStep:'',findings:[{...example.finding,status:'verified'}]},
 }};
 test(`${language}: a verified result uses the confirmed playback pause without a second silence wait`,async()=>{
  const clock=fakeClock();let idle=false,version=0;
  const f=fixture({...clock,researchDeliveryV2:true,isPlaybackIdle:()=>idle,getPlaybackVersion:()=>version});
  try{
   f.receive({type:'session.input_transcript.delta',delta:language==='en'?'What does an off-campus budget cover?':'¿Qué incluye un presupuesto fuera del campus?'});
   await pause(0);
   version=1;
   f.receive({type:'session.output_transcript.delta',delta:language==='en'?'Housing and meals are usually included.':'Suele incluir vivienda y comida.'});
   await pause(0);
   f.channel.send(JSON.stringify(ready));await pause(0);
   clock.advance(1100);await pause(0);clock.advance(500);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
   idle=true;clock.advance(200);await pause(0);clock.advance(250);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
  }finally{f.channel.close();}
 });
 test(`${language}: a playback boundary releases research after a complete thought without transcript punctuation`,async()=>{
  const clock=fakeClock();let idle=false;
  const f=fixture({...clock,researchDeliveryV2:true,isPlaybackIdle:()=>idle});
  try{
   f.receive({type:'session.output_transcript.delta',delta:language==='en'?'We can take this one step at a time':'Podemos entenderlo paso a paso'});await pause(0);
   f.channel.send(JSON.stringify(ready));await pause(0);
   clock.advance(5000);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
   idle=true;clock.advance(250);await pause(0);clock.advance(250);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
   clock.advance(5000);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
  }finally{f.channel.close();}
 });
 test(`${language}: a ready verified answer gets the turn ahead of reply recovery with Decisions off`,async()=>{
  const clock=fakeClock(),f=fixture({...clock,researchDeliveryV2:true,canRecoverReply:()=>true});
  try{
   f.receive({type:'session.output_transcript.delta',delta:language==='en'?'Do you want to talk through those housing costs?':'¿Quieres que te explique los gastos de vivienda?'});await pause(0);
   clock.advance(1800);await pause(0);
   await selectionQuiet(f,clock,language==='en'?'Sure.':'Sí.');
   f.channel.send(JSON.stringify(ready));await pause(0);
   clock.advance(950);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
   clock.advance(2050);await pause(0);
   const appends=f.sent.filter(e=>e.type==='session.commentary.append');
   assert.equal(appends.length,1);
   assert.match(appends[0].content,/Completed research/);
   assert.ok(!f.events.some(e=>e.type==='origen.reply.recovery'));
  }finally{f.channel.close();}
 });
}

for(const [prompt,reply] of [
 ['Do you want to talk through those housing costs?','Sure.'],
 ['¿Quieres que te explique los gastos de vivienda?','Sí.'],
])test('a missed acceptance resumes an explanation once',async()=>{
 const clock=fakeClock(),f=fixture({...clock,canRecoverReply:()=>true});
 try{
  f.receive({type:'session.output_transcript.delta',delta:prompt,end_ms:2000});await pause(0);
  clock.advance(1800);await pause(0);
  await selectionQuiet(f,clock,reply);clock.advance(950);await pause(0);
  assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
  assert.equal(f.events.find(e=>e.type==='origen.reply.recovery')?.source,'rules');
  await selectionQuiet(f,clock,reply);clock.advance(4000);await pause(0);
  assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 }finally{f.channel.close();}
});

for(const [reply,action] of [['Sure','clarify'],['Actually, could you explain the difference for students living with family?','continue']])
test('Decisions can recover a stalled short or longer reply after the native response window',async()=>{
 const clock=fakeClock(),f=fixture({...clock,canRecoverReply:()=>true,classifyReply:async()=>action});
 try{
  f.receive({type:'session.output_transcript.delta',delta:'Berkeley or Davis?',end_ms:2000});await pause(0);
  clock.advance(1800);await pause(0);
  await selectionQuiet(f,clock,reply);assert.equal(f.sent.length,0);
  clock.advance(950);await pause(0);
  assert.equal(f.events.find(e=>e.type==='origen.reply.recovery')?.action,action);
 }finally{f.channel.close();}
});

test('a native reply suppresses recovery while Decisions is outstanding',async()=>{
 const clock=fakeClock();let complete;
 const f=fixture({...clock,canRecoverReply:()=>true,classifyReply:()=>new Promise(resolve=>{complete=resolve;})});
 try{
  f.receive({type:'session.output_transcript.delta',delta:'Berkeley or Davis?'});await pause(0);
  clock.advance(1800);await pause(0);
  await selectionQuiet(f,clock,'Sure');clock.advance(950);await pause(0);
  assert.equal(typeof complete,'function');
  f.receive({type:'session.output_transcript.delta',delta:'Which campus should we start with?'});await pause(0);
  complete('clarify');await pause(0);
  assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
 }finally{f.channel.close();}
});

test('a short acknowledgment overlapping an offer never starts recovery',async()=>{
 const clock=fakeClock(),f=fixture({...clock,canRecoverReply:()=>true,classifyReply:async()=>assert.fail('overlap must not reach Decisions')});
 try{
  f.receive({type:'session.output_transcript.delta',delta:'Want me to explain the housing costs?',end_ms:2100});await pause(0);
  f.receive({type:'session.input_transcript.delta',delta:'Sure',start_ms:1900});await pause(0);
  clock.advance(1100);await pause(0);clock.advance(4000);await pause(0);
  assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
 }finally{f.channel.close();}
});

function pendingSelection(f,language='en',liveContext){
 f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Scope pending',selectionRecovery:{pending:true,names:['Aiden','Elodie']},tools:[{name:'request_conversation_target'}],...(liveContext?{liveContext}:{})}});
}
async function selectionQuiet(f,clock,text='Aiden'){
 f.receive({type:'session.input_transcript.delta',delta:text});await pause(0);clock.advance(1100);await pause(0);
}
for(const [language,choice,ack]of [['en','Aiden','Of course.'],['es','Hablemos de Aiden','Claro.']])test(`${language}: missed selection wakes the guarded backend once without changing speech`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f,language);
 await selectionQuiet(f,clock,choice);
 f.receive({type:'session.output_transcript.delta',delta:ack});await pause(0);
 clock.advance(selectionRecoveryDelayMs-1);await pause(0);assert.equal(f.sent.length,0);
 clock.advance(1);await pause(0);
 assert.equal(f.sent.length,1);assert.deepEqual(Object.keys(f.sent[0]).sort(),['event_id','type']);assert.equal(f.sent[0].type,'response.create');
 assert.deepEqual(f.events.filter(e=>e.type==='origen.selection.recovery').map(e=>e.stage),['scheduled','requested']);
 assert.ok(!f.events.some(e=>e.type==='response.done'&&e.response.output.some(i=>i.type==='function_call')),'no student is selected by the timer');
 clock.advance(selectionRecoveryStartDeadlineMs);await pause(0);
 assert.equal(f.events.filter(e=>e.type==='origen.selection.recovery').at(-1).reason,'backend_not_observed');
 await selectionQuiet(f,clock,choice);clock.advance(30000);await pause(0);
 assert.equal(f.sent.length,1,'unobserved request is logged, never retried');f.channel.close();
});
for(const native of ['delegation','response'])test(`${native}: a normal provider handoff suppresses missed-selection recovery`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock);
 if(native==='delegation')f.receive({type:'session.delegation.created',delegation:{id:'d',target:'responses'},response_id:'native'});
 else f.backend('response.created','native');
 await pause(0);clock.advance(selectionRecoveryDelayMs+100);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);
 assert.ok(f.events.some(e=>e.type==='origen.selection.recovery'&&e.stage==='suppressed'&&e.reason==='native_delegation'));
 f.channel.close();
});
test('delegation observed before input quiet prevents recovery even when nested start is delayed',async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);
 f.receive({type:'session.input_transcript.delta',delta:'Aiden'});await pause(0);
 f.receive({type:'session.delegation.created',delegation:{id:'d',target:'responses'},response_id:'native'});await pause(0);
 clock.advance(1100);await pause(0);clock.advance(8000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);f.channel.close();
});
for(const text of ['Okay.','Hola.','Can you hear me?','¿Puedes oírme?','I feel overwhelmed.','Aidenberg'])test(`ordinary opening speech never triggers selection recovery: ${text}`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock,text);clock.advance(2000);await pause(0);
 assert.equal(f.sent.length,0);f.channel.close();
});
for(const variation of ['confirmed','onboarding','no-tool','no-metadata'])test(`${variation}: selection recovery is not a general conversation timer`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);
 const session={selectionRecovery:{pending:variation!=='confirmed',names:['Aiden']},onboarding:variation==='onboarding',tools:variation==='no-tool'?[]:[{name:'request_conversation_target'}]};
 if(variation==='no-metadata')delete session.selectionRecovery;
 f.channel.configure({voiceProvider:'live',voiceSession:session});await selectionQuiet(f,clock);clock.advance(2000);await pause(0);
 assert.equal(f.sent.length,0);f.channel.close();
});
for(const [language,correction]of [['en','No, Elodie instead.'],['es','No, mejor Elodie.']])test(`${language}: continued speech cancels the earlier candidate before requesting latest context`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f,language);await selectionQuiet(f,clock);
 clock.advance(500);f.receive({type:'session.input_transcript.delta',delta:correction});await pause(0);
 clock.advance(1100);await pause(0);assert.equal(f.sent.length,0);
 clock.advance(selectionRecoveryDelayMs);await pause(0);assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.ok(f.events.some(e=>e.type==='origen.selection.recovery'&&e.reason==='new_input'));
 assert.equal(f.events.filter(e=>e.type==='origen.selection.recovery'&&e.stage==='requested').at(-1).item_id,f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').at(-1).item_id);
 f.channel.close();
});
for(const stop of ['close','farewell','configuration'])test(`${stop}: pending recovery cannot run after its lifetime ends`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock);
 if(stop==='close')f.channel.close();
 if(stop==='farewell')f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_farewell'}}}));
 if(stop==='configuration')f.channel.send(JSON.stringify({type:'session.update',event_id:'u',session:{selectionRecovery:{pending:false,names:[]},tools:[]}}));
 const before=f.sent.length;clock.advance(3000);await pause(0);assert.equal(f.sent.length,before);f.channel.close();
});
test('recovery request rejection is logged once without another request or spoken warning',async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock);clock.advance(selectionRecoveryDelayMs);await pause(0);
 const event=f.sent[0];f.receive({type:'error',error:{code:'responses_validation_failed',client_event_id:event.event_id}});await pause(0);
 clock.advance(10000);await pause(0);
 assert.equal(f.events.filter(e=>e.type==='origen.selection.recovery'&&e.stage==='unconfirmed').length,1);
 assert.equal(f.sent.length,1);f.channel.close();
});
for(const language of ['en','es'])test(`${language}: recovery keeps the quick acknowledgment and excludes the old scope-question tail`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f,language);
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'Is this about Elodie, Aiden, or':'¿Es sobre Elodie, Aiden o'});await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:'Aiden'});await pause(0);
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?' college in general?':' la universidad en general?'});await pause(0);
 const ack=language==='en'?' Of course.':' Claro.';
 f.receive({type:'session.output_transcript.delta',delta:ack});await pause(0);
 clock.advance(1100);await pause(0);clock.advance(selectionRecoveryDelayMs);await pause(0);
 f.backend('response.created','recovery');await pause(0);
 f.backend('response.output_item.done','recovery',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','recovery');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}}));
 const receipt=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);
 assert.equal(receipt.selectionDelivery.mode,'conditional_recap');assert.equal(receipt.selectionDelivery.recentAssistantSpeech,ack);
 f.channel.close();
});
test('failed recovered selection does not expose a brief, repeat the choice, or request another recovery',async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock);clock.advance(selectionRecoveryDelayMs);await pause(0);
 f.backend('response.created','recovery');await pause(0);
 f.backend('response.output_item.done','recovery',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{}'}});
 f.backend('response.completed','recovery');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify({status:'target_update_failed'})}}));
 assert.equal(f.events.filter(e=>e.type==='origen.selection.recovery').at(-1).reason,'target_update_failed');
 assert.ok(!f.sent.some(e=>e.content?.includes('confirmed-student-brief')));
 await selectionQuiet(f,clock,'Aiden');clock.advance(10000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);f.channel.close();
});
for(const status of ['target_update_failed','callback_unconfirmed'])test(`late native selection receives the original ${status} result without authorizing context`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock);clock.advance(selectionRecoveryDelayMs);await pause(0);
 for(const responseId of ['recovery','native']){
  f.backend('response.created',responseId);await pause(0);
  f.backend('response.output_item.done',responseId,{item:{type:'function_call',name:'request_conversation_target',call_id:responseId,arguments:'{"scope":"student:aiden"}'}});
  f.backend('response.completed',responseId);await pause(0);
 }
 assert.equal(f.events.filter(e=>e.type==='response.done'&&e.response.output.some(i=>i.type==='function_call')).length,1);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'recovery',output:JSON.stringify({status})}}));
 for(const callId of ['recovery','native'])assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id===callId).item.output).status,status);
 assert.ok(!f.sent.some(e=>e.content?.includes('confirmed-student-brief')));f.channel.close();
});
for(const change of ['other-student','unconfirmed','same-student','unchanged-pending-scope'])test(`late recovery alias respects ${change} configuration before acknowledgment`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false}),unchanged=change==='unchanged-pending-scope';pendingSelection(f,'en',unchanged?{scope:{confirmed:false,studentId:null}}:undefined);await selectionQuiet(f,clock);clock.advance(selectionRecoveryDelayMs);await pause(0);
 f.backend('response.created','first');await pause(0);
 f.backend('response.output_item.done','first',{item:{type:'function_call',name:'request_conversation_target',call_id:'first',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','first');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'first',output:JSON.stringify({status:'target_confirmed'})}}));
 f.channel.send(JSON.stringify({type:'session.update',event_id:'changed-scope',session:unchanged?{language:'en'}:{liveContext:{scope:{confirmed:change!=='unconfirmed',studentId:change==='other-student'?'elodie':'aiden'}}}}));
 // A late result must respect even an unacknowledged newer scope, without
 // invoking another callback or pretending the old choice is still current.
 f.backend('response.created','late');await pause(0);
 f.backend('response.output_item.done','late',{item:{type:'function_call',name:'request_conversation_target',call_id:'late',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','late');await pause(0);
 const receipt=JSON.parse(f.sent.find(e=>e.item?.call_id==='late').item.output);
 assert.equal(receipt.status,change==='same-student'||unchanged?'target_confirmed':'target_update_failed');
 assert.equal(f.events.filter(e=>e.type==='response.done'&&e.response.output.some(i=>i.type==='function_call')).length,1);
 assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel'].includes(e.type)));f.channel.close();
});
for(const change of ['different-scope','new-input'])test(`recovery never coalesces a ${change} selection`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock);clock.advance(selectionRecoveryDelayMs);await pause(0);
 f.backend('response.created','first');await pause(0);
 f.backend('response.output_item.done','first',{item:{type:'function_call',name:'request_conversation_target',call_id:'first',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','first');await pause(0);
 if(change==='new-input')await selectionQuiet(f,clock,'No, Aiden after all.');
 f.backend('response.created','second');await pause(0);
 f.backend('response.output_item.done','second',{item:{type:'function_call',name:'request_conversation_target',call_id:'second',arguments:JSON.stringify({scope:change==='different-scope'?'student:elodie':'student:aiden'})}});
 f.backend('response.completed','second');await pause(0);
 assert.equal(f.events.filter(e=>e.type==='response.done'&&e.response.output.some(i=>i.type==='function_call')).length,2,'genuine choices still require their own guarded handler');f.channel.close();
});
for(const [text,invitation,mode]of [['Aiden','','conditional_recap'],['Aiden','What matters most today?','leave_floor'],['Aiden, can you help with his essay?','','caller_first'],['Aiden, ¿podemos hablar de su ensayo?','','caller_first']])test(`recovered selection preserves existing delivery mode: ${mode} / ${text}`,async()=>{
 const clock=fakeClock(),f=fixture(clock);pendingSelection(f);await selectionQuiet(f,clock,text);
 if(invitation){f.receive({type:'session.output_transcript.delta',delta:invitation});await pause(0);}
 clock.advance(selectionRecoveryDelayMs);await pause(0);
 f.backend('response.created','recovery');await pause(0);
 f.backend('response.output_item.done','recovery',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','recovery');await pause(0);
 assert.ok(f.events.some(e=>e.type==='response.done'&&e.response.output.some(i=>i.call_id==='choose')));
 const context={scope:{confirmed:true,studentId:'aiden'},openingBrief:{profile:{name:'Aiden',school:'Synthetic College'}}};
 f.channel.send(JSON.stringify({type:'session.update',event_id:'u',session:{selectionRecovery:{pending:false,names:[]},liveContext:context,tools:[]}}));
 f.receive({type:'session.updated',client_event_id:'u'});await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 const result=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);assert.equal(result.selectionDelivery.mode,mode);
 assert.equal(f.events.filter(e=>e.type==='origen.selection.recovery').at(-1).reason,'target_confirmed');
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,2,'one recovery plus one required tool continuation');
 assert.ok(!f.sent.some(e=>['session.instructions.append','session.commentary.append','response.cancel','session.input_audio.mute'].includes(e.type)));
 f.channel.close();
});

for(const language of ['en','es'])for(const callerFirst of [false,true])test(`${language}: selected brief stays off the voice stream until its successful receipt (${callerFirst?'caller first':'short recap'})`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});
 f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Scope pending',tools:[{name:'request_conversation_target'}]}});
 f.backend('response.created','selection');await pause(0);
 f.backend('response.output_item.done','selection',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','selection');await pause(0);
 const context={scope:{confirmed:true,studentId:'aiden'},openingBrief:{studentId:'aiden',profile:{name:'Aiden',school:'SAVED_SCHOOL'},records:[{content:'Private detailed history. '.repeat(50)}]}};
 f.channel.send(JSON.stringify({type:'session.update',event_id:'selection-config',session:{language,instructions:'AUTHORIZED_BACKEND_HISTORY',tools:[],liveContext:context}}));
 assert.equal(f.sent.filter(e=>e.type==='session.thinking.append').length,0,'pending selection and staged facts remain off the voice stream');
 assert.ok(!f.sent.filter(e=>e.type==='session.thinking.append').some(e=>e.content.includes('SAVED_SCHOOL')));
 if(callerFirst){f.receive({type:'session.input_transcript.delta',delta:language==='en'?'Could we talk about his essay':'¿Podemos hablar de su ensayo'});await pause(0);}
 f.receive({type:'session.updated',client_event_id:'selection-config'});await pause(0);
 assert.equal(f.events.find(e=>e.type==='origen.configuration.applied').contextDelivery,'staged_for_selection');
 assert.ok(!f.sent.some(e=>e.type==='response.create'));
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 const packet=f.sent.find(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='confirmed-student-brief');
 assert.ok(packet);assert.ok(new TextEncoder().encode(packet.content).length<=480);
 assert.equal(JSON.parse(packet.content).profile.school,'SAVED_SCHOOL');
 const result=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);
 assert.deepEqual(result.selectionContext,context);assert.equal(result.selectionDelivery.mode,callerFirst?'caller_first':'conditional_recap');
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.ok(!f.events.some(e=>e.type==='origen.selection.context'&&e.stage==='acknowledged'));
 f.receive({type:'session.thinking.appended',client_event_id:packet.event_id,start_ms:1200,end_ms:1500});await pause(0);
 const acknowledged=f.events.find(e=>e.type==='origen.selection.context'&&e.stage==='acknowledged');
 assert.equal(capturePayload(acknowledged).endMs,1500);
 f.receive({type:'session.output_transcript.delta',delta:'A brief continuation.',start_ms:1600,end_ms:2400});await pause(0);
 const speech=f.events.find(e=>e.type==='response.output_audio_transcript.delta');assert.equal(capturePayload(speech).startMs,1600);
 assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel','session.input_audio.mute','output_audio_buffer.clear'].includes(e.type)));
 f.channel.close();
});

for(const [language,head,tail]of [['en','Of ','course.'],['es','Por ','supuesto.']])test(`${language}: selection dispatch during an acknowledgment does not redirect speech before its delayed receipt`,async()=>{
 const clock=fakeClock();let idle=false;
 const f=fixture({...clock,autoAcknowledge:false,isPlaybackIdle:()=>idle});
 try{
  f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Scope pending',tools:[{name:'request_conversation_target'}]}});
  f.receive({type:'session.input_transcript.delta',delta:'Aiden'});await pause(0);clock.advance(1100);await pause(0);
  f.backend('response.created','selection');await pause(0);
  f.receive({type:'session.output_transcript.delta',delta:head});await pause(0);
  f.backend('response.output_item.done','selection',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});
  f.backend('response.completed','selection');await pause(0);
  assert.deepEqual(f.sent,[],'dispatch cannot inject a pending cue into the unfinished acknowledgment');
  clock.advance(2800);await pause(0);
  assert.ok(!f.events.some(e=>e.type==='response.output_audio_transcript.done'),'active playback is not force-finished while context loads');
  f.receive({type:'session.output_transcript.delta',delta:tail});await pause(0);
  const context={scope:{confirmed:true,studentId:'aiden'},openingBrief:{studentId:'aiden',profile:{name:'Aiden',school:'SAVED_SCHOOL'}}};
  f.channel.send(JSON.stringify({type:'session.update',event_id:'selection-config',session:{language,instructions:'Authorized backend',tools:[],liveContext:context}}));
  clock.advance(800);await pause(0);
  f.receive({type:'session.updated',client_event_id:'selection-config'});await pause(0);
  assert.deepEqual(f.sent.map(e=>e.type),['session.update'],'only backend configuration is sent before the successful receipt');
  assert.ok(!f.events.some(e=>e.type==='response.output_audio_transcript.done'));
  idle=true;clock.advance(1800);await pause(0);
  const finished=f.events.filter(e=>e.type==='response.output_audio_transcript.done');
  assert.equal(finished.length,1);assert.equal(finished[0].transcript,head+tail);
  f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}}));
  f.channel.send(JSON.stringify({type:'response.create'}));
  const packet=f.sent.find(e=>e.type==='session.thinking.append'),result=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);
  assert.equal(JSON.parse(packet.content).kind,'confirmed-student-brief');assert.equal(JSON.parse(packet.content).profile.school,'SAVED_SCHOOL');
  assert.equal(result.selectionDelivery.recentAssistantSpeech,head+tail);assert.equal(result.selectionDelivery.mode,'conditional_recap');
  assert.deepEqual(result.selectionContext,context);
  assert.deepEqual(f.sent.map(e=>e.type),['session.update','session.thinking.append','response.item.create','response.create']);
  f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});await pause(0);
  clock.advance(2000);await pause(0);
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1,'context acknowledgment cannot start another native continuation');
  assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel','session.input_audio.mute','output_audio_buffer.clear'].includes(e.type)));
 }finally{f.channel.close();}
});

for(const failure of ['backend-error','timeout','superseded','failed-receipt','close'])test(`staged selection facts are discarded on ${failure}`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});
 f.backend('response.created','select');await pause(0);
 f.backend('response.output_item.done','select',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','select');await pause(0);
 const config={instructions:'Backend',tools:[],liveContext:{scope:{confirmed:true,studentId:'aiden'},openingBrief:{studentId:'aiden',profile:{school:'PRIVATE_SCHOOL'}}}};
 f.channel.send(JSON.stringify({type:'session.update',event_id:'config',session:config}));
 if(failure==='backend-error')f.receive({type:'error',error:{code:'responses_validation_failed',client_event_id:'config'}});
 if(failure==='timeout')clock.advance(10000);
 if(failure==='superseded')f.channel.send(JSON.stringify({type:'session.update',event_id:'new-config',session:{...config,liveContext:{scope:{confirmed:true,studentId:'elodie'}}}}));
 if(failure==='close')f.channel.close();
 f.receive({type:'session.updated',client_event_id:'config'});await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(failure!=='failed-receipt','Aiden'))}}));
 assert.ok(!f.sent.filter(e=>e.type==='session.thinking.append'||e.type==='response.item.create').some(e=>JSON.stringify(e).includes('PRIVATE_SCHOOL')));
 if(failure!=='close')assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output).status,'target_update_failed');
 f.channel.close();
});

test('changing language during selection keeps the staged brief and waits for the newest configuration',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});
 f.channel.configure({voiceProvider:'live',voiceSession:{language:'en',tools:[]}});
 f.backend('response.created','select');await pause(0);
 f.backend('response.output_item.done','select',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});
 f.backend('response.completed','select');await pause(0);
 f.channel.send(JSON.stringify({type:'session.update',event_id:'context',session:{instructions:'Authorized backend',liveContext:{scope:{confirmed:true,studentId:'aiden'},openingBrief:{studentId:'aiden',profile:{name:'Aiden'}}}}}));
 f.channel.send(JSON.stringify({type:'session.update',event_id:'spanish',session:{language:'es'}}));
 assert.equal(f.sent.find(e=>e.type==='session.update'&&e.event_id==='spanish').session.delegation.responses.instructions,'Authorized backend','a language change cannot restore the old unconfirmed backend');
 f.receive({type:'session.updated',client_event_id:'context'});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'));
 f.receive({type:'session.updated',client_event_id:'spanish'});
 const direction=f.sent.find(e=>e.type==='session.instructions.append');f.receive({type:'session.instructions.appended',client_event_id:direction.event_id});await pause(0);
 assert.equal(f.events.find(e=>e.type==='session.updated').session.liveContext.scope.studentId,'aiden');
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}}));
 const result=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);
 assert.equal(result.status,'target_confirmed');assert.equal(result.selectionContext.openingBrief.profile.name,'Aiden');
 const packet=f.sent.find(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='confirmed-student-brief');
 clock.advance(10000);await pause(0);
 assert.ok(f.events.some(e=>e.type==='origen.selection.context'&&e.stage==='acknowledgment_timeout'));
 f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='origen.selection.context'&&e.stage==='acknowledged'),'a late ack cannot manufacture a delivery confirmation');
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'),'a missing brief ack never starts a second opening');f.channel.close();
});

for(const language of ['en','es'])test(`${language}: a fast student choice cannot mistake the old scope question for a new invitation`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,isPlaybackIdle:()=>false});
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'Aiden, Elodie, or college in general?':'¿Aiden, Elodie o la universidad en general?'});await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:'Aiden'});await pause(0);
 clock.advance(1100);await pause(0);
 f.backend('response.created','selection');await pause(0);
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?' Thanks, let me take a look.':' Gracias, déjame ver.'});await pause(0);
 f.backend('response.output_item.done','selection',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{}'}});
 f.backend('response.completed','selection');await pause(0);
 const pending=f.sent.filter(e=>e.type==='session.thinking.append');
 assert.equal(pending.length,0,'tracking the choice does not inject a pending status into live speech');
 assert.equal(f.events.filter(e=>e.type==='response.output_audio_transcript.done').length,0,'the displayed transcript still combines both utterances');
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 const result=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);
 assert.equal(result.selectionDelivery.mode,'conditional_recap');assert.equal(result.selectionDelivery.assistantQuestionObserved,false);
 assert.doesNotMatch(result.selectionDelivery.recentAssistantSpeech,/Elodie/);
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel','session.input_audio.mute'].includes(e.type)));
 f.channel.close();
});

test('private diagnostics preserve request state without copying the question',()=>{
 const payload=capturePayload({type:'origen.research.state_changed',requestId:'r',jobId:'j',state:'running',question:'PRIVATE'});
 assert.equal(payload.state,'running');assert.equal(payload.jobId,'j');assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
});
for(const language of ['en','es'])test(`${language}: selection keeps speech flowing and confirms only after voice context and backend acknowledgments`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});
 f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Initial backend',tools:[]}});
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'What would you like':'¿Qué te gustaría'});await pause(0);
 const context={scope:{confirmed:true,studentId:'aiden'},openingBrief:{profile:{name:'Aiden',school:'SAVED_SCHOOL'},records:[{content:'A useful qualified note. '.repeat(40)}]}};
 f.channel.send(JSON.stringify({type:'session.update',event_id:'selected',session:{language,instructions:'Authorized Aiden backend',tools:[],liveInstructions:'Use the newest confirmed scope. Continue the current conversation.',liveContext:context}}));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append'),directions=f.sent.filter(e=>e.type==='session.instructions.append');
 assert.ok(packets.length>1);assert.equal(directions.length,1);
 assert.ok(!directions[0].content.includes('SAVED_SCHOOL'));
 assert.deepEqual(JSON.parse(packets.map(e=>JSON.parse(e.content).text).join('')),context);
 assert.ok(!f.sent.some(e=>['response.cancel','session.commentary.append','output_audio_buffer.clear'].includes(e.type)));
 f.receive({type:'session.updated',client_event_id:'selected'});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'),'backend ready is not voice context delivery');
 for(const packet of [...packets,directions[0]].slice(0,-1))f.receive({type:packet.type+'ed',client_event_id:packet.event_id});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'));
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?' to focus on?':' conversar?'});await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'His college options.':'Sus opciones universitarias.'});await pause(0);
 clock.advance(200);
 f.receive({type:'session.instructions.appended',client_event_id:directions[0].event_id});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.updated').length,1);
 const timing=f.events.find(e=>e.type==='origen.configuration.applied');assert.equal(timing.contextPacketCount,packets.length);assert.equal(timing.instructionPacketCount,1);assert.equal(timing.durationMs,200);
 assert.ok(!f.sent.some(e=>e.type==='response.create'||e.type==='session.commentary.append'),'configuration is not a second speaking cue');
 f.channel.close();
});
test('failed selection context reports the configuration failure and cannot later confirm scope',async()=>{
 const f=fixture({autoAcknowledge:false});
 f.channel.send(JSON.stringify({type:'session.update',event_id:'scope',session:{instructions:'New backend',tools:[],liveContext:{scope:{studentId:'aiden'}}}}));
 const packet=f.sent.find(e=>e.type==='session.thinking.append');
 f.receive({type:'error',error:{code:'context_rejected',client_event_id:packet.event_id}});await pause(0);
 f.receive({type:'session.updated',client_event_id:'scope'});f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});await pause(0);
 assert.ok(f.events.some(e=>e.type==='error'&&e.error.event_id==='scope'));
 assert.ok(!f.events.some(e=>e.type==='session.updated'));f.channel.close();
});
test('missing selection acknowledgment expires, permits a fresh update and rejects late acknowledgments',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false,researchDeliveryV2:true});
 const session={instructions:'Same backend',tools:[],liveContext:{scope:{studentId:'aiden'}}};
 f.channel.send(JSON.stringify({type:'session.update',event_id:'expired',session}));
 const oldPacket=f.sent.find(e=>e.type==='session.thinking.append');
 f.receive({type:'session.updated',client_event_id:'expired'});await pause(0);clock.advance(10000);await pause(0);
 assert.ok(f.events.some(e=>e.type==='error'&&e.error.event_id==='expired'&&e.error.code==='configuration_context_timeout'));
 f.channel.send(JSON.stringify({type:'session.update',event_id:'fresh',session}));
 f.receive({type:'session.thinking.appended',client_event_id:oldPacket.event_id});
 f.receive({type:'session.updated',client_event_id:'expired',session:{delegation:{responses:{instructions:'Same backend'}}}});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'));
 const packet=f.sent.filter(e=>e.type==='session.thinking.append').at(-1);
 f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'),'old backend acknowledgment cannot complete fresh retry');
 f.receive({type:'session.updated',client_event_id:'fresh'});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.updated').length,1);f.channel.close();
});
test('late older context acknowledgments never restore a superseded configuration',async()=>{
 const f=fixture({autoAcknowledge:false});
 for(const studentId of ['aiden','elodie'])f.channel.send(JSON.stringify({type:'session.update',event_id:studentId,session:{instructions:studentId,tools:[],liveContext:{scope:{studentId}}}}));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append');
 for(const eventId of ['elodie','aiden']){
  f.receive({type:'session.updated',client_event_id:eventId});
  for(const packet of packets.filter(p=>JSON.parse(p.content).resultId===eventId))f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});
  await pause(0);
 }
 assert.deepEqual(f.events.filter(e=>e.type==='session.updated').map(e=>e.session.instructions),['elodie']);f.channel.close();
});
test('same-scope language change does not resend the student brief or unchanged direction',async()=>{
 const f=fixture();const same={liveInstructions:'Confirmed scope; continue.',liveContext:{scope:{studentId:'aiden'}}};
 f.channel.configure({voiceProvider:'live',voiceSession:{...same,language:'en',instructions:'Backend',tools:[]}});
 f.channel.send(JSON.stringify({type:'session.update',event_id:'language',session:{...same,language:'es',instructions:'Backend in Spanish',tools:[]}}));await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.thinking.append').length,0);
 assert.equal(f.sent.filter(e=>e.type==='session.instructions.append').length,1);
 assert.match(f.sent.find(e=>e.type==='session.instructions.append').content,/Respond in Spanish/);f.channel.close();
});
test('an old pending configuration cannot replace an already-applied newer student during a language change',async()=>{
 const f=fixture({autoAcknowledge:false});
 f.channel.configure({voiceProvider:'live',voiceSession:{language:'en',instructions:'Scope pending',tools:[]}});
 for(const studentId of ['aiden','elodie'])f.channel.send(JSON.stringify({type:'session.update',event_id:studentId,session:{language:'en',instructions:studentId,tools:[{name:studentId}],liveContext:{scope:{confirmed:true,studentId}}}}));
 f.receive({type:'session.updated',client_event_id:'elodie'});
 for(const packet of f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).resultId==='elodie'))f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});
 await pause(0);
 assert.equal(f.events.find(e=>e.type==='session.updated').session.instructions,'elodie');
 f.channel.send(JSON.stringify({type:'session.update',event_id:'spanish',session:{language:'es'}}));
 const configuration=f.sent.find(e=>e.type==='session.update'&&e.event_id==='spanish').session.delegation.responses;
 assert.equal(configuration.instructions,'elodie');assert.equal(configuration.tools[0].name,'elodie');
 assert.equal(f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).resultId==='spanish').length,0,'the current student does not change');
 f.receive({type:'session.updated',client_event_id:'spanish'});
 const direction=f.sent.find(e=>e.type==='session.instructions.append');f.receive({type:'session.instructions.appended',client_event_id:direction.event_id});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.updated').at(-1).session.liveContext.scope.studentId,'elodie');
 f.receive({type:'session.updated',client_event_id:'aiden'});
 for(const packet of f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).resultId==='aiden'))f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});await pause(0);
 assert.deepEqual(f.events.filter(e=>e.type==='session.updated').map(e=>e.session.instructions),['elodie','elodie']);f.channel.close();
});
for(const language of ['en','es'])test(`${language}: speech before a target proposal triggers one reevaluation without asking for the name again`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Scope must be confirmed',tools:[{name:'request_conversation_target'}]}});
 f.receive({type:'session.input_transcript.delta',delta:'Aiden'});await pause(0);clock.advance(1100);await pause(0);
 f.backend('response.created','selecting');await pause(0);
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'What would you like help with?':'¿Con qué te gustaría recibir ayuda?'});await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'His college options.':'Sus opciones universitarias.'});await pause(0);clock.advance(1100);await pause(0);
 const proposal={type:'function_call',name:'request_conversation_target',call_id:'old-selection',arguments:'{"scope":"student:aiden"}'};
 f.backend('response.output_item.done','selecting',{item:proposal});f.backend('response.completed','selecting');await pause(0);
 assert.ok(!f.events.some(e=>e.response?.output?.some(i=>i.call_id==='old-selection')),'stale selection may be a correction: re-evaluate safely');
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.match(JSON.parse(f.sent.find(e=>e.item?.call_id==='old-selection').item.output).instruction,/do not ask them to repeat/);
 f.backend('response.created','current');await pause(0);
 f.backend('response.output_item.done','current',{item:{...proposal,call_id:'current-selection'}});f.backend('response.completed','current');await pause(0);
 assert.ok(f.events.some(e=>e.response?.output?.some(i=>i.call_id==='current-selection')));
 assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel'].includes(e.type)));f.channel.close();
});
for(const language of ['en','es'])test(`${language}: delivery v2 waits through an ordinary reply and then introduces completed research once`,async()=>{
 const clock=fakeClock();let audible=0;
 const f=fixture({...clock,researchDeliveryV2:true,getPlaybackVersion:()=>audible});
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'Can we discuss essays?':'¿Podemos hablar de los ensayos?'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'job',requestId:'request',revision:1,question:'Costs',result:{text:'The verified annual tuition is 12345 dollars.\nHousing is separate.'}}));
 clock.advance(1100);await pause(0);clock.advance(1000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'We can start with the story you want to share.':'Podemos empezar con la historia que quieres compartir.'});await pause(0);audible++;
 clock.advance(1800);await pause(0);clock.advance(1000);await pause(0);clock.advance(1000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.ok(f.events.some(e=>e.deliveryStage==='reply_observed'));
 assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
 clock.advance(10000);await pause(0);assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.ok(!f.sent.some(e=>['response.cancel','response.create','session.instructions.append'].includes(e.type)));f.channel.close();
});
for(const language of ['en','es'])for(const interrupted of [false,true])test(`${language}: fast native research answer ${interrupted?'still respects a subsequent interruption':'retires its announcement before the input grouping timer closes'}`,async()=>{
 const clock=fakeClock();let playbackVersion=0;
 const f=fixture({...clock,researchDeliveryV2:true,getPlaybackVersion:()=>playbackVersion});
 const answer=language==='en'?'The published annual tuition is 12345 dollars at Example University.':'La matrícula anual publicada es de 12345 dólares en la Universidad Ejemplo.';
 try{
  f.receive({type:'session.input_transcript.delta',delta:language==='en'?'What did you find?':'¿Qué encontraste?'});await pause(0);
  f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'job',requestId:'request',revision:1,question:'Tuition',result:{text:answer}}));await pause(0);
  clock.advance(200);await pause(0);
  assert.ok(!f.events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'));
  f.receive({type:'session.output_transcript.delta',delta:interrupted?answer.slice(0,-1):answer});await pause(0);playbackVersion++;
  if(interrupted){f.receive({type:'session.input_transcript.delta',delta:language==='en'?'Wait, stop.':'Espera, para.'});await pause(0);}
  clock.advance(1800);await pause(0);
  assert.equal(f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'),!interrupted);
  if(!interrupted){
   f.receive({type:'session.input_transcript.delta',delta:language==='en'?'That was helpful.':'Eso fue útil.'});await pause(0);
   clock.advance(1100);await pause(0);clock.advance(6000);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
  }
  assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append'].includes(e.type)));
 }finally{f.channel.close();}
});

for(const language of ['en','es'])test(`${language}: a short acknowledgment preserves completed research and forwards native overlap timing`,async()=>{
 const clock=fakeClock();let playbackVersion=0;
 const f=fixture({...clock,researchDeliveryV2:true,getPlaybackVersion:()=>playbackVersion});
 const answer=language==='en'?'The published annual tuition is 12345 dollars at Example University.':'La matrícula anual publicada es de 12345 dólares en la Universidad Ejemplo.';
 try{
  f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'job',requestId:'request',revision:1,question:'Tuition',result:{text:answer}}));await pause(0);
  f.receive({type:'session.output_transcript.delta',delta:answer,start_ms:100,end_ms:2000});await pause(0);playbackVersion++;
  const native={type:'session.input_transcript.delta',event_id:'native-input',delta:language==='en'?'Yes, okay.':'Sí, entiendo.',start_ms:1800,end_ms:2200};
  f.receive(native);await pause(0);clock.advance(1100);await pause(0);clock.advance(1000);await pause(0);
  const observed=f.events.find(e=>e.type==='origen.research.speech_observed');
  assert.equal(observed.speechOutcome,'acknowledgment_overlap');assert.equal(observed.completedPortions,1);
  assert.equal(observed.playbackObserved,true);assert.equal(observed.overlapCount,1);assert.equal(observed.unfinishedPortion,false);
  assert.deepEqual(f.events.find(e=>e.type==='session.input_transcript.delta'),native);
  assert.ok(f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
  clock.advance(10000);await pause(0);assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
  assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append'].includes(e.type)));
 }finally{f.channel.close();}
});

test('delivery v2 survives a same-scope language update but waits for its acknowledgment',async()=>{
 const clock=fakeClock(),f=fixture({...clock,researchDeliveryV2:true});
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'job',question:'Costs',result:{text:'The verified annual tuition is 12345 dollars.'}}));await pause(0);
 f.channel.send(JSON.stringify({type:'session.update',event_id:'language',session:{instructions:'Current conversation language: Spanish',tools:[]}}));
 clock.advance(5000);await pause(0);assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
 f.receive({type:'session.updated',client_event_id:'language'});await pause(0);clock.advance(1000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});
for(const text of ['How much does it cost to go to UC Santa Cruz?','How much is that?','What does residency mean?','Okay.','Yes.','¿Cuánto cuesta ir a UC Santa Cruz?','¿Cuánto es?','¿Qué significa residencia?','Gracias.'])test('native conversation has no keyword or silence-triggered second decision: '+text,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.receive({type:'session.input_transcript.delta',delta:text});await pause(0);clock.advance(1100);await pause(0);clock.advance(30000);await pause(0);
 assert.ok(f.events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'&&e.transcript===text));
 assert.ok(!f.sent.some(e=>['response.create','session.commentary.append'].includes(e.type)));
 // Native requests remain executable, including affirmative workflow replies.
 f.backend('response.created','native');await pause(0);
 f.backend('response.output_item.done','native',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:'{"institution":"UC Santa Cruz","question":"Published costs"}'}});
 f.backend('response.completed','native');await pause(0);
 assert.equal(f.events.find(e=>e.type==='response.done').response.output[0].call_id,'lookup');f.channel.close();
});
test('active research does not generate repeated backend calls on conversational follow-ups',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{requestId:'r',jobId:'j',state:'running',question:'Santa Cruz costs'}}));
 for(const text of ['What does tuition residency mean?','Okay.','How much is that?']){
  f.receive({type:'session.input_transcript.delta',delta:text});await pause(0);clock.advance(1100);await pause(0);clock.advance(6000);await pause(0);
 }
 assert.ok(!f.sent.some(e=>e.type==='response.create'||e.type==='session.commentary.append'));
 assert.equal(f.events.filter(e=>e.type==='origen.research.state_changed').length,1);f.channel.close();
});

for(const language of ['en','es'])test(`${language}: completed partial research replaces pending state without interrupting conversation or starting a lookup`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,researchDeliveryV2:true});
 const request={requestId:'request',jobId:'job',revision:1,question:'Published cost of attendance with the requested scenario. '.repeat(25)};
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{...request,state:'running'}}));
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'The budget is an estimate':'El presupuesto es una estimación'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{...request,state:'completed'}}));
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{...request,state:'completed',elapsedMs:90000}}));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 assert.equal(packets.length,2,'one compact state packet per change; elapsed time is not another update');
 const states=packets.map(p=>JSON.parse(p.text));
 assert.equal(states[0].researchPending,true);assert.equal(states[1].researchPending,false);
 assert.equal(states[1].state,'completed');assert.match(states[1].meaning,/No lookup is running/);
 const backend=f.sent.filter(e=>e.type==='response.item.create');
 assert.equal(backend.length,1,'the backend pending receipt receives the terminal update once');
 assert.equal(backend[0].item.role,'developer');assert.equal(backend[0].item.type,'message');
 assert.match(backend[0].item.content[0].text,/"requestId":"request".*"state":"completed".*"researchPending":false/);
 assert.ok(!backend[0].item.content[0].text.includes(request.question),'sourced/user text is never elevated into app instructions');
 f.receive({type:'session.output_transcript.delta',delta:'.'});await pause(0);clock.advance(2000);await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'What does a budget mean?':'¿Qué significa un presupuesto?'});await pause(0);clock.advance(1100);await pause(0);clock.advance(4000);await pause(0);
 assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append','session.commentary.append','output_audio_buffer.clear'].includes(e.type)));
 f.channel.close();
});
test('a superseded research result cannot be announced as the current answer',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{requestId:'new',jobId:'new-job',state:'running'}}));
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'old-job',question:'Old costs',result:{status:'completed',answer:'OLD_FIGURE'}}));
 clock.advance(5000);await pause(0);
 assert.ok(!JSON.stringify(f.sent).includes('OLD_FIGURE'));assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});

for(const language of ['en','es'])test(`${language}: ordinary new speech preserves an authorized pending research call without flushing that speech`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'Check Berkeley costs.':'Consulta los costos de Berkeley.'});await pause(0);clock.advance(1100);await pause(0);
 f.backend('response.created','research');await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'I feel overwhelmed':'Me siento abrumado'});await pause(0);
 f.backend('response.output_item.done','research',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:'{}'}});f.backend('response.completed','research');await pause(0);
 assert.ok(f.events.some(e=>e.type==='response.done'&&e.response.output?.some(i=>i.call_id==='lookup')));
 assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').length,1,'do not prematurely flush a follow-up');
 assert.equal(f.events.find(e=>e.type==='response.done').response.metadata.origen_user_turn,'superseded-live-turn');
 assert.ok(!f.sent.some(e=>e.type==='response.create'||e.type==='session.commentary.append'));f.channel.close();
});
for(const barrier of ['cancel','scope_changed','configuration'])test(`${barrier}: an old read-only request cannot restart research`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.backend('response.created','research');await pause(0);
 if(barrier!=='configuration'){
  const before=f.sent.length;
  f.channel.send(JSON.stringify({type:'origen.research.cancel',reason:barrier}));
  assert.equal(f.sent.length,before,'cleanup before a task exists must not invent a research status');
 }
 else f.channel.send(JSON.stringify({type:'session.update',event_id:'new-scope',session:{instructions:'New scope',tools:[]}}));
 f.backend('response.output_item.done','research',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'old',arguments:'{}'}});f.backend('response.completed','research');await pause(0);
 assert.ok(!f.events.some(e=>e.type==='response.done'&&e.response.output?.some(i=>i.call_id==='old')));f.channel.close();
});

for(const researchDeliveryV2 of [false,true])test(`research cleanup preserves accurate task state (delivery v2=${researchDeliveryV2})`,()=>{
 const f=fixture({researchDeliveryV2});
 try{
  const state=state=>f.channel.send(JSON.stringify({type:'origen.research.state',request:{requestId:'request',jobId:'job',revision:1,state}}));
  const reset=reason=>f.channel.send(JSON.stringify({type:'origen.research.cancel',reason}));
  const contextSince=offset=>f.sent.slice(offset).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
  state('running');let offset=f.sent.length;reset();
  let context=contextSince(offset);
  assert.ok(context.length>0);
  assert.ok(context.every(p=>p.kind==='research-state'&&p.resultId==='request'));
  assert.equal(JSON.parse(context.map(p=>p.text).join('')).state,'cancelled');
  offset=f.sent.length;reset();assert.equal(f.sent.length,offset,'duplicate cleanup stays silent');
  for(const terminal of ['completed','failed','cancelled']){
   state(terminal);offset=f.sent.length;reset();
   assert.equal(f.sent.length,offset,'terminal outcomes cannot be relabeled as a new cancellation');
  }
  state('running');offset=f.sent.length;reset('scope_changed');
  context=contextSince(offset);
  const snapshot=JSON.parse(context.map(p=>p.text).join(''));
  assert.equal(snapshot.state,'scope_changed');assert.equal(snapshot.acceptedActiveJob,false);
  assert.match(snapshot.meaning,/previous student scope/);
  assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'||e.type==='session.instructions.append'));
 }finally{f.channel.close();}
});
test('a mixed stale tool batch preserves research but never a write or sharing approval',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'},{name:'save_next_step'},{name:'confirm_coordinator_review_request'}]}});
 f.backend('response.created','mixed');await pause(0);f.receive({type:'session.input_transcript.delta',delta:'Also, I am worried.'});await pause(0);
 for(const name of ['lookup_financial_aid','save_next_step','confirm_coordinator_review_request'])f.backend('response.output_item.done','mixed',{item:{type:'function_call',name,call_id:name,arguments:'{}'}});
 f.backend('response.completed','mixed');clock.advance(1100);await pause(0);
 assert.deepEqual(f.events.find(e=>e.type==='response.done').response.output.map(i=>i.name),['lookup_financial_aid']);
 assert.deepEqual(f.sent.filter(e=>e.type==='response.item.create').map(e=>e.item.call_id),['save_next_step','confirm_coordinator_review_request']);f.channel.close();
});
test('research commentary waits for every matching context acknowledgment and deduplicates the result',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});
 const event={type:'origen.research.ready',jobId:'job',question:'Costs',result:{text:'A fact with a necessary qualification. '.repeat(40)}};
 f.channel.send(JSON.stringify(event));f.channel.send(JSON.stringify(event));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append');assert.ok(packets.length>1);
 clock.advance(3000);await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 f.receive({type:'session.thinking.appended',client_event_id:'unmatched'});
 for(const packet of packets.slice(0,-1))f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});
 await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 f.receive({type:'session.thinking.appended',client_event_id:packets.at(-1).event_id});await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.equal(f.events.filter(e=>e.type==='origen.research.context_acknowledged').length,1);
 f.channel.send(JSON.stringify(event));clock.advance(3000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});
test('a rejected context update never triggers a result announcement',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Costs',result:{text:'Verified'}}));
 const packet=f.sent.find(e=>e.type==='session.thinking.append');f.receive({type:'error',error:{code:'context_rejected',client_event_id:packet.event_id}});await pause(0);clock.advance(10000);await pause(0);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));assert.ok(f.events.some(e=>e.type==='origen.research.context_failed'));f.channel.close();
});
test('missing context acknowledgments expire without treating supplied facts as heard speech',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Costs',result:{text:'Verified'}}));
 clock.advance(30000);await pause(0);
 assert.ok(f.events.some(e=>e.type==='origen.research.context_failed'&&e.reason==='acknowledgment_timeout'));
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));assert.ok(!f.events.some(e=>e.type==='origen.research.announced'));f.channel.close();
});
for(const language of ['en','es'])test(`${language}: Live can integrate delivered context without a second application speech request`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Costs',result:{text:'Verified budget; this is not an individual bill.'}}));
 await pause(0);f.receive({type:'session.output_transcript.delta',delta:language==='en'?'I found the published budget.':'Encontré el presupuesto publicado.'});await pause(0);
 clock.advance(10000);await pause(0);clock.advance(1000);await pause(0);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 assert.ok(f.events.some(e=>e.type==='origen.research.native_reply_observed'));
 assert.ok(!f.events.some(e=>e.type==='origen.research.announced'),'native speech observed is not a claim of verified spoken delivery');f.channel.close();
});

for(const text of ['How much does UC Santa Cruz cost?','¿Cuánto cuesta ir a UC Santa Cruz?'])test('an empty native backend outcome produces one clarification, no automatic tool retry: '+text,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.receive({type:'session.input_transcript.delta',delta:text});await pause(0);clock.advance(1100);await pause(0);
 for(const id of ['empty','same-turn-empty']){f.backend('response.created',id);await pause(0);f.backend('response.completed',id);await pause(0);}
 assert.equal(f.events.filter(e=>e.type==='origen.backend.empty').length,1);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.match(f.sent.find(e=>e.type==='session.commentary.append').content,/one short, concrete clarification/);
 assert.ok(!f.sent.some(e=>e.type==='response.create'),'no auto-retry of writes or research');f.channel.close();
});

test('a completed native tool continuation may be silent without another clarification',async()=>{
 const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[]}});
 f.channel.send(JSON.stringify({type:'response.create'}));
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'verified',output:'{"status":"research_pending","jobId":"job"}'}}));
 f.channel.send(JSON.stringify({type:'response.create'}));f.backend('response.created','continued');await pause(0);f.backend('response.completed','continued');await pause(0);
 assert.ok(!f.events.some(e=>e.type==='origen.backend.empty'));
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1,'opening only');f.channel.close();
});

test('a useful backend text answer does not trigger empty-result recovery',async()=>{
 const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[]}});
 f.backend('response.created','text');await pause(0);f.backend('response.output_item.done','text',{item:{type:'message',content:[{type:'output_text',text:'A useful explanation.'}]}});f.backend('response.completed','text');await pause(0);
 assert.ok(!f.events.some(e=>e.type==='origen.backend.empty'));assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});
test('a failed source check never announces verified findings or asks to share them',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.ready',result:{status:'research_failed'},question:'Costs?'}));
 clock.advance(2000);await pause(0);
 const prompt=f.sent.find(e=>e.type==='session.commentary.append').content;
 assert.match(prompt,/source check failed/);assert.match(prompt,/no verified findings/);assert.doesNotMatch(prompt,/source check is ready|explain the verified finding/);f.channel.close();
});
for(const language of ['en','es'])test(`${language}: end call drains current audio before requesting a separate farewell`,async()=>{
 const clock=fakeClock();let idle=false;
 const f=fixture({...clock,isPlaybackIdle:()=>idle});let ready;
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'The housing budget':'El presupuesto de vivienda'});await pause(0);
 void f.channel.prepareClose().then(value=>ready=value);
 await pause(0);clock.advance(2000);await pause(0);
 assert.equal(ready,undefined);assert.ok(!f.events.some(e=>e.type==='response.done'));
 f.receive({type:'session.input_transcript.delta',delta:'No, give me a straight answer.'});await pause(0);
 f.receive({type:'session.output_transcript.delta',delta:'.'});await pause(0);idle=true;
 clock.advance(2000);await pause(0);clock.advance(100);await pause(0);
 assert.equal(ready,true);assert.ok(!f.events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'));
 const previous=f.events.find(e=>e.type==='response.output_audio_transcript.done').response_id;
 f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_farewell'},instructions:'A warm goodbye only.'}}));
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'Take care!':'¡Hasta luego!'});await pause(0);
 clock.advance(3000);await pause(0);
 const goodbye=f.events.filter(e=>e.type==='response.output_audio_transcript.done').at(-1);
 assert.notEqual(goodbye.response_id,previous);assert.doesNotMatch(goodbye.transcript,/budget|presupuesto|straight answer/);
 assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'));f.channel.close();
});
test('caller reference text is never injected as assistant thinking',()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'conversation.item.create',item:{role:'user',type:'message',content:[{text:'No, give me a straight answer.'}]}}));
 assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'));assert.match(f.sent.find(e=>e.type==='session.instructions.append').content,/Caller reference data/);f.channel.close();
});

for(const status of ['target_confirmed','target_update_failed'])test(`scope continuation ${status} always completes the backend tool loop`,async()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create'}));
 f.backend('response.created','scope');await pause(0);
 f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'target',output:JSON.stringify({status})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});
for(const barrier of ['pending-configuration','multiple-tools'])test(`scope continuation retains backend checks for ${barrier}`,async()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create'}));
 f.backend('response.created','scope');await pause(0);
 f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:'{}'}});
 if(barrier==='multiple-tools')f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'recall_student_context',call_id:'memory',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 if(barrier==='pending-configuration')f.channel.send(JSON.stringify({type:'session.update',event_id:'pending',session:{instructions:'New scope',tools:[]}}));
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'target',output:JSON.stringify({status:'target_confirmed'})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);f.channel.close();
});

test('closing drain has a bounded fallback without declaring unfinished audio complete',async()=>{
 const clock=fakeClock(),f=fixture({...clock,isPlaybackIdle:()=>false});let ready;
 f.receive({type:'session.output_transcript.delta',delta:'Unfinished explanation'});await pause(0);
 void f.channel.prepareClose().then(value=>ready=value);await pause(0);
 clock.advance(12000);await pause(0);
 assert.equal(ready,false);assert.ok(!f.events.some(e=>e.type==='output_audio_buffer.stopped'));
 assert.ok(f.sent.some(e=>e.type==='session.instructions.append'&&e.content.includes('speech boundary')));f.channel.close();
});

test('student handoff is context to answer, never a thinking transcript',()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:voiceHandoff('What about Elodie?')}]}}));
 const handoff=f.sent.filter(e=>e.type==='session.instructions.append').map(e=>e.content).join('');
 assert.ok(handoff.includes('Pending caller question: '+JSON.stringify('What about Elodie?')));
 assert.ok(handoff.includes('listen until they finish, then answer it directly'));
 assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'));f.channel.close();
});
test('background evidence waits for a quiet boundary before a natural continuation',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Cost?',result:{sources:[{url:'https://studentaid.gov'}],answer:'Verified'}}));
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 clock.advance(2000);await pause(0);
 assert.ok(f.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Verified')));
 assert.ok(f.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('If the topic has moved on')));
 assert.ok(!f.sent.some(e=>e.type==='response.cancel'));f.channel.close();
});

for(const [language,head,tail,question] of [
 ['en','And if it helps,',' we can start with that example.','What does the cost include?'],
 ['es','Y si te sirve,',' podemos empezar con ese ejemplo.','¿Qué incluye ese costo?'],
]){
 test(`${language}: research cannot splice into an unfinished sentence, even after a long pause`,async()=>{
  const clock=fakeClock();let idle=false;
  // Playback can continue long after transcript text has arrived.
  const g=fixture({...clock,isPlaybackIdle:()=>idle});
  g.receive({type:'session.output_transcript.delta',delta:head});await pause(0);
  g.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Cost?',result:{answer:'Verified'}}));
  clock.advance(5000);await pause(0);assert.ok(!g.sent.some(e=>e.type==='session.commentary.append'));
  idle=true;clock.advance(5000);await pause(0);clock.advance(5000);await pause(0);
  assert.ok(!g.sent.some(e=>e.type==='session.commentary.append'),'a quiet comma is not a completed thought');
  g.receive({type:'session.output_transcript.delta',delta:tail});await pause(0);
  clock.advance(1800);await pause(0);clock.advance(250);await pause(0);
  assert.equal(g.sent.filter(e=>e.type==='session.commentary.append').length,1);
  clock.advance(5000);await pause(0);assert.equal(g.sent.filter(e=>e.type==='session.commentary.append').length,1);
  assert.equal(g.events.filter(e=>e.type==='origen.research.announced').length,1);g.channel.close();
 });
 test(`${language}: a new caller turn receives evidence without a competing announcement`,async()=>{
  const clock=fakeClock(),f=fixture(clock);
  f.receive({type:'session.output_transcript.delta',delta:head});await pause(0);
  f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Cost?',result:{answer:'Verified'}}));
  f.receive({type:'session.input_transcript.delta',delta:question});await pause(0);
  assert.ok(f.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Verified')));
  clock.advance(5000);await pause(0);
  assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
  assert.equal(f.events.filter(e=>e.type==='origen.research.supplied').length,1);f.channel.close();
 });
 test(`${language}: a student handoff waits for audible acknowledgment without closing or muting the call`,async()=>{
  const clock=fakeClock();let idle=false;
  const f=fixture({...clock,isPlaybackIdle:()=>idle});let result;
  f.receive({type:'session.output_transcript.delta',delta:language==='en'?"Let's talk about Elodie.":'Hablemos de Elodie.'});await pause(0);
  void f.channel.settle().then(value=>{result=value;});
  clock.advance(4000);await pause(0);assert.equal(result,undefined);
  assert.equal(f.raw.readyState,'open');assert.ok(!f.sent.some(e=>e.type==='session.input_audio.mute'));
  idle=true;clock.advance(250);await pause(0);clock.advance(100);await pause(0);
  assert.equal(result,true);f.channel.close();
 });
 test(`${language}: an interruption supersedes a pending student switch and retains the complete question`,async()=>{
  const clock=fakeClock(),f=fixture(clock);let result;
  f.receive({type:'session.output_transcript.delta',delta:head});await pause(0);
  const turn=f.consent.token();void f.channel.settle({isCurrent:()=>f.consent.token()===turn}).then(value=>{result=value;});
  f.receive({type:'session.input_transcript.delta',delta:question});await pause(0);
  clock.advance(1100);await pause(0);
  assert.equal(result,false);assert.equal(f.raw.readyState,'open');
  assert.equal(f.events.find(e=>e.type==='conversation.item.input_audio_transcription.completed').transcript,question);
  assert.ok(!f.sent.some(e=>e.type==='session.close'));f.channel.close();
 });
}

for(const question of ['What matters most to you?','¿Qué es lo más importante para ti?'])test(`research leaves room for an answer without indefinitely stranding the finding: ${question}`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.receive({type:'session.output_transcript.delta',delta:question});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Costs',result:{answer:'Verified'}}));
 clock.advance(2000);await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 clock.advance(4500);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});

test('a deferred handoff preserves the request without claiming a technical failure or confirmed scope',()=>{
 const result=deferredVoiceHandoff();assert.equal(result.status,'target_switch_deferred');
 assert.match(result.instruction,/latest complete caller request/);assert.match(result.instruction,/do not ask them to repeat/);
 assert.match(result.instruction,/Do not use the proposed student context/);assert.doesNotMatch(result.instruction,/loading problem|failed technically/);
});

for(const reason of ['cancel','close','transport','session','farewell'])test(`${reason} discards queued research rather than speaking it later`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Cost?',result:{answer:'Verified'}}));
 if(reason==='cancel')f.channel.send(JSON.stringify({type:'origen.research.cancel'}));
 if(reason==='close')f.channel.close();
 if(reason==='transport')f.raw.onclose({});
 if(reason==='session')f.receive({type:'session.closed'});
 if(reason==='farewell')f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_farewell'}}}));
 await pause(0);const count=f.sent.length;clock.advance(10000);await pause(0);
 assert.equal(f.sent.length,count);assert.ok(!f.sent.some(e=>e.type==='session.instructions.append'&&e.content.includes('Verified')));f.channel.close();
});

test('handoff timeout and aborted/closed calls never authorize forced audio teardown',async()=>{
 for(const action of ['timeout','abort','close','transport']){
  const clock=fakeClock(),f=fixture({...clock,isPlaybackIdle:()=>false}),abort=new AbortController();let result;
  void f.channel.settle({signal:abort.signal,timeoutMs:2000}).then(value=>{result=value;});
  if(action==='abort')abort.abort();if(action==='close')f.channel.close();if(action==='transport')f.raw.onclose({});
  clock.advance(2000);await pause(0);assert.equal(result,false);f.channel.close();
 }
});

test('research waits for application tool handling even after model generation finished',async()=>{
 const clock=fakeClock(),f=fixture(clock);let release;
 const pending=new Promise(resolve=>release=resolve),original=f.channel.onmessage;
 f.channel.onmessage=async event=>{original(event);if(JSON.parse(event.data).type==='response.done')await pending;};
 f.backend('response.created','scope');f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'switch',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Costs',result:{answer:'Verified'}}));
 clock.advance(5000);await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 release();await pause(0);clock.advance(250);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});

test('superseded queued evidence never becomes the next research announcement',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Old',result:{answer:'Old evidence'}}));
 f.channel.send(JSON.stringify({type:'origen.research.cancel'}));
 const afterCancellation=f.sent.length;
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'New',result:{answer:'New evidence'}}));
 clock.advance(2000);await pause(0);
 const context=f.sent.slice(afterCancellation).filter(e=>e.type==='session.thinking.append').map(e=>e.content).join('');
 assert.doesNotMatch(context,/Old evidence/);assert.match(context,/New evidence/);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});

test('results arriving during the caller turn are available to that reply without a spoken interruption',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.receive({type:'session.input_transcript.delta',delta:'¿Qué incluye ese costo?'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Costs',result:{answer:'Verified'}}));
 assert.ok(f.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Verified')));
 clock.advance(5000);await pause(0);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});
// Exercise the transport ordering, not only the delivery controller: caller
// transcript -> accepted task state -> quiet evidence -> native spoken answer
// -> recovery. Playback versions here are fixture observations, not real audio.
for(const language of ['en','es']){
 const es=language==='es';
 const question=es
  ?'En comparación con UC Berkeley y UC Irvine, ¿cuál es la matrícula de UC Riverside para 2026–27? Separa la matrícula del costo total de asistencia.'
  :'For comparison with UC Berkeley and UC Irvine, what is UC Riverside tuition for 2026–27? Separate tuition from total cost of attendance.';
 const primary={subject:'UC Riverside',aspect:'tuition_fees',status:'verified',
  answer:es?'La matrícula y las cuotas anuales de UC Riverside para 2026–27 son $16,790. [1]':'UC Riverside annual tuition and fees for 2026–27 are $16,790. [1]',
  qualification:es?'Estimación publicada antes de ayuda; la vivienda es aparte. [1]':'Published estimate before aid; housing is separate. [1]'};
 const comparator={subject:'UC Irvine',aspect:'tuition_fees',status:'unverified',
  answer:es?'No pude verificar la matrícula de UC Irvine para 2026–27.':'I could not verify UC Irvine tuition for 2026–27.',
  qualification:es?'Esta comprobación no confirmó una cifra; no significa que no esté publicada.':'This check did not confirm a figure; that does not mean it is unpublished.'};
 const result={status:'source_check_completed',sources:[{url:'https://example.edu/tuition-fixture',title:'Historical test fixture'}],
  voiceBrief:{status:'partial',answer:primary.answer,qualification:primary.qualification,nextStep:'',findings:[primary,comparator]}};
 const task={requestId:'tuition-request',revision:1,jobId:'tuition-job',question,state:'running'};
 const ready=(version,pending)=>({type:'origen.research.ready',jobId:task.jobId,requestId:task.requestId,revision:task.revision,question,evidenceVersion:version,researchPending:pending,result});
 const evidence=f=>decodedResearchContext(f.sent.filter(e=>e.type==='session.thinking.append')
  .map(e=>JSON.parse(e.content)).filter(packet=>packet.kind==='untrusted-research-evidence'));

 test(`${language}: accepted caller focus survives the adapter handoff and answered recovery stays quiet`,async()=>{
  const clock=fakeClock();let playback=0;
  const f=fixture({...clock,researchDeliveryV2:true,getPlaybackVersion:()=>playback});
  try{
   f.receive({type:'session.input_transcript.delta',delta:es?'¿Qué pasa con la matrícula de UCR?':'What about UCR tuition?'});await pause(0);
   clock.advance(1100);await pause(0);
   assert.ok(f.events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'));
   f.channel.send(JSON.stringify({type:'origen.research.state',request:task}));await pause(0);
   f.receive({type:'session.output_transcript.delta',delta:es?'Claro, podemos ver ese costo juntos.':'Of course, we can look at that cost together.'});await pause(0);playback++;
   clock.advance(1800);await pause(0);
   f.receive({type:'session.input_transcript.delta',delta:es?'Me imagino que será parecido a Irvine.':'I imagine it will be similar to Irvine.'});await pause(0);
   clock.advance(1100);await pause(0);
   f.receive({type:'session.output_transcript.delta',delta:es?'Podemos ponerlo en perspectiva. ':'We can put it in perspective. '});await pause(0);playback++;
   f.channel.send(JSON.stringify(ready(1,true)));await pause(0);
   assert.deepEqual(evidence(f).findings.map(finding=>[finding.subject,finding.aspect]),[['UC Riverside','tuition_fees']]);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0,'research arriving during a native answer must remain quiet');
   f.receive({type:'session.output_transcript.delta',delta:primary.answer+' '+primary.qualification});await pause(0);playback++;
   clock.advance(1800);await pause(0);clock.advance(1000);await pause(0);
   assert.ok(f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'||e.deliveryStage==='native_portion_observed'));
   f.receive({type:'session.input_transcript.delta',delta:es?'Entiendo.':'I see.'});await pause(0);
   clock.advance(1100);await pause(0);
   f.receive({type:'session.output_transcript.delta',delta:es?'Sí, podemos seguir desde ahí.':'Yes, we can go from there.'});await pause(0);playback++;
   clock.advance(1800);await pause(0);
   f.channel.send(JSON.stringify({type:'origen.research.state',request:{...task,state:'completed'}}));
   f.channel.send(JSON.stringify(ready(2,false)));await pause(0);
   clock.advance(1000);await pause(0);clock.advance(10000);await pause(0);
   assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0,'unchanged recovery must not announce the irrelevant comparator gap');
   assert.ok(f.events.some(e=>e.deliveryReason==='recovery_context_only'));
   assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append'].includes(e.type)));
  }finally{f.channel.close();}
 });

 test(`${language}: an actual comparison remains a comparison after the adapter accepts a narrowed research question`,async()=>{
  const clock=fakeClock(),f=fixture({...clock,researchDeliveryV2:true});
  try{
   f.receive({type:'session.input_transcript.delta',delta:es?'Compara la matrícula de UC Riverside y UC Irvine.':'Compare UC Riverside and UC Irvine tuition.'});await pause(0);
   clock.advance(1100);await pause(0);
   f.channel.send(JSON.stringify({type:'origen.research.state',request:task}));await pause(0);
   f.channel.send(JSON.stringify(ready(1,false)));await pause(0);
   assert.deepEqual(new Set(evidence(f).findings.map(finding=>finding.subject)),new Set(['UC Riverside','UC Irvine']),'the accepted caller request must preserve both subjects despite a narrower generated question');
  }finally{f.channel.close();}
 });

 for(const shortFollowup of [es?'¿Y UCI?':'And UC Irvine?','No, UC Irvine.'])test(`${language}: short follow-up "${shortFollowup}" after task acceptance replaces saved caller focus`,async()=>{
  const clock=fakeClock(),f=fixture({...clock,researchDeliveryV2:true});
  try{
   f.receive({type:'session.input_transcript.delta',delta:es?'¿Cuál es la matrícula de UC Riverside?':'What is UC Riverside tuition?'});await pause(0);
   clock.advance(1100);await pause(0);
   f.channel.send(JSON.stringify({type:'origen.research.state',request:task}));await pause(0);
   f.receive({type:'session.output_transcript.delta',delta:es?'Claro, estoy contigo.':'Of course, I am with you.'});await pause(0);
   clock.advance(1800);await pause(0);
   f.receive({type:'session.input_transcript.delta',delta:shortFollowup});await pause(0);
   clock.advance(1100);await pause(0);
   f.channel.send(JSON.stringify(ready(1,false)));await pause(0);
   assert.deepEqual(evidence(f).findings.map(finding=>finding.subject),['UC Irvine'],'the latest correction must win over the accepted Riverside question');
   assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append'].includes(e.type)));
  }finally{f.channel.close();}
 });
}

function fixture(options={}){
 const {autoAcknowledge=true,...channelOptions}=options;
 const sent=[],events=[],consent=voiceProfileSaveConsent();
 const raw={readyState:'open',send:value=>{const event=JSON.parse(value);sent.push(event);if(autoAcknowledge&&['session.thinking.append','session.instructions.append'].includes(event.type))queueMicrotask(()=>receive({type:event.type+'ed',client_event_id:event.event_id}));},close(){this.readyState='closed';}};
 const channel=studentLiveChannel(raw,{getTurn:()=>consent.token(),isPlaybackIdle:()=>true,...channelOptions});
 channel.onmessage=({data})=>{const e=JSON.parse(data);events.push(e);if(e.type==='input_audio_buffer.speech_started')consent.begin(e.item_id);if(e.type==='conversation.item.input_audio_transcription.completed')consent.transcript(e.item_id,e.transcript);};
 channel.configure({voiceProvider:'live',voiceSession:{instructions:'Backend policy',tools:[]}});
 const receive=e=>raw.onmessage({data:JSON.stringify(e)});
 receive({type:'session.started'});
 const backend=(type,responseId,fields={})=>receive({type:'response.event',delegation_id:'d',event:{type,...(type==='response.created'?{response:{id:responseId}}:{response_id:responseId}),...fields}});
 return {sent,events,consent,channel,receive,backend,raw};
}
test('Realtime remains an unchanged pass-through',()=>{const sent=[];const raw={send:value=>sent.push(value)};const dc=studentLiveChannel(raw);dc.send('{"type":"response.create"}');assert.deepEqual(sent,['{"type":"response.create"}']);});

for(const [type,closeOn]of [['session.input_transcript.delta','input_audio_buffer.speech_started'],['session.output_transcript.delta','response.output_audio_transcript.delta']])test(`closing during ${type} cannot restart transcript timers`,async()=>{
 let scheduled=0;const timers=new Map();
 const f=fixture({isPlaybackIdle:()=>false,schedule:(fn,ms)=>{const id=++scheduled;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
 await pause(0);f.channel.onmessage=({data})=>{if(JSON.parse(data).type===closeOn)f.channel.close();};
 f.receive({type,delta:'Synthetic words.'});await pause(0);
 assert.equal(f.raw.readyState,'closed');assert.equal(timers.size,0);assert.equal(scheduled,0,'no timers are created by continuations after close');
});
test('routing policy reaches timing metadata but is not an unsupported provider session option',async()=>{
 const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',instructions:'Backend',tools:[]}});
 f.receive({type:'session.started'});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.created').at(-1).session.routingPolicy,'bounded-follow-up-v1');
 f.channel.send(JSON.stringify({type:'session.update',event_id:'reset',session:{routingPolicy:'backend-first',instructions:'New backend',tools:[],liveInstructions:'Replace earlier delegation policy.'}}));
 const update=f.sent.find(e=>e.type==='session.update');assert.equal(update.session.routingPolicy,undefined);assert.equal(update.session.delegation.responses.routingPolicy,undefined);
 assert.ok(f.sent.some(e=>e.type==='session.instructions.append'&&e.content.includes('Replace earlier delegation policy.')));
 f.receive({type:'session.updated',client_event_id:'reset'});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.updated').at(-1).session.routingPolicy,'backend-first');f.channel.close();
});

test('model timing ends before quiet-window and async tool handling; Live boundaries are labeled estimates',async()=>{
 const clock=fakeClock(),f=fixture(clock);let release;
 const pending=new Promise(resolve=>release=resolve),original=f.channel.onmessage;
 f.channel.onmessage=async event=>{original(event);if(JSON.parse(event.data).type==='response.done')await pending;};
 f.receive({type:'session.input_transcript.delta',delta:'Recall my earlier plan.'});await pause(0);
 f.backend('response.created','b');await pause(0);
 const started=f.events.find(e=>e.type==='origen.backend.started');assert.ok(started.item_id);
 f.backend('response.output_item.done','b',{item:{type:'function_call',name:'recall_student_context',call_id:'c',arguments:'{}'}});
 f.backend('response.completed','b');await pause(0);
 assert.ok(f.events.some(e=>e.type==='origen.backend.model_finished'));assert.ok(!f.events.some(e=>e.type==='origen.backend.finished'));
 clock.advance(1100);await pause(0);
 assert.equal(f.events.find(e=>e.type==='input_audio_buffer.speech_stopped').liveBoundary,'transcript_quiet_estimate');
 assert.ok(f.events.some(e=>e.type==='response.done'));assert.ok(!f.events.some(e=>e.type==='origen.backend.finished'));
 release();await pause(0);assert.ok(f.events.some(e=>e.type==='origen.backend.finished'));f.channel.close();
});
test('Live opening waits for session startup; regular response requests do not duplicate speech',()=>{const f=fixture();f.channel.send(JSON.stringify({type:'response.create',response:{instructions:'Introduce yourself as Origen'}}));f.channel.send(JSON.stringify({type:'response.create'}));assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);f.channel.close();});
test('opening transport follows familiar context and preserves exact approved check-ins',()=>{
 for(const language of ['en','es'])for(const onboarding of [true,false]){
  const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{language,onboarding,instructions:'Scoped policy',tools:[]}});
  f.channel.send(JSON.stringify({type:'response.create'}));
  const opening=f.sent.find(e=>e.type==='session.commentary.append').content;
  assert.match(opening,new RegExp(language==='es'?'Spanish':'English'));
  assert.match(opening,onboarding?/approved onboarding welcome/:/familiar context already supplied/);
  assert.doesNotMatch(opening,/introduce yourself as Origen/);f.channel.close();
 }
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_follow_up'},instructions:'Do you want to revisit your saved question?'}}));
 assert.match(f.sent.find(e=>e.type==='session.commentary.append').content,/Speak only the exact application-provided check-in/);f.channel.close();
});
test('An explicit complete save request retains consent through delegated function completion',async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'Yes, save my profile now.'});f.backend('response.created','r');
 f.backend('response.output_item.done','r',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'c',arguments:'{}'}});f.backend('response.completed','r');await pause(1200);
 const done=f.events.find(e=>e.type==='response.done');assert.equal(done.response.output[0].call_id,'c');assert.equal(f.consent.consume(done.response.metadata.origen_user_turn),true);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'c',output:'{"saved":true}'}}));f.channel.send(JSON.stringify({type:'response.create'})); // Opening has not been requested yet.
 assert.equal(f.sent.find(e=>e.type==='response.item.create').item.call_id,'c');f.channel.close();
});
test('A newer user turn cannot authorize an older backend write',async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'Save my profile.'});f.backend('response.created','old');await pause(1200);
 f.receive({type:'session.input_transcript.delta',delta:'No, do not save it yet.'});f.backend('response.output_item.done','old',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'old-c',arguments:'{}'}});f.backend('response.completed','old');await pause(1200);
 const done=f.events.find(e=>e.type==='response.done');assert.equal(done.response.metadata.origen_user_turn,'superseded-live-turn');assert.equal(f.consent.consume(done.response.metadata.origen_user_turn),false);f.channel.close();
});
for(const name of ['remember_student_detail','recall_student_context','prepare_coordinator_connection','prepare_coordinator_review_request','confirm_coordinator_review_request','set_conversation_language'])test(`Stale ${name} never reaches a current-turn handler`,async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'An earlier request.'});f.backend('response.created','old');await pause(1200);
 f.receive({type:'session.input_transcript.delta',delta:'Stop. I changed my mind.'});f.backend('response.output_item.done','old',{item:{type:'function_call',name,call_id:'stale-call',arguments:'{}'}});f.backend('response.completed','old');await pause(1200);
 assert.ok(!f.events.some(event=>event.type==='response.done'&&event.response.output?.some(item=>item.type==='function_call')));
 const reply=f.sent.find(event=>event.type==='response.item.create');assert.equal(reply.item.call_id,'stale-call');assert.equal(JSON.parse(reply.item.output).status,'superseded_turn');assert.match(JSON.parse(reply.item.output).instruction,/not a hearing failure/);assert.match(JSON.parse(reply.item.output).instruction,/do not ask them to repeat/);assert.match(JSON.parse(reply.item.output).instruction,/retry writes automatically/);assert.equal(f.sent.filter(event=>event.type==='response.create').length,1);f.channel.close();
});
test('Partial save phrase followed by not yet never grants save consent',async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'Save my profile'});f.backend('response.created','r');f.receive({type:'session.input_transcript.delta',delta:'? No, not yet.'});f.backend('response.output_item.done','r',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'c',arguments:'{}'}});f.backend('response.completed','r');await pause(1200);
 const done=f.events.find(e=>e.type==='response.done');assert.equal(f.consent.consume(done.response.metadata.origen_user_turn),false);f.channel.close();
});
test('All chunks preserve complete teaching text and have bounded UTF-8 lengths',()=>{const f=fixture(),text='Warmly acknowledge uncertainty. '.repeat(100);f.channel.send(JSON.stringify({type:'session.update',event_id:'u',session:{instructions:'Backend updated',tools:[],liveInstructions:text}}));const parts=f.sent.filter(e=>e.type==='session.instructions.append').map(e=>e.content);assert.equal(parts.join(''),text);assert.ok(parts.every(part=>Buffer.byteLength(part)<=440));f.channel.close();});

test('End-of-call flush labels output completion as forced, never played consent',async()=>{
 const f=fixture();f.receive({type:'session.output_transcript.delta',delta:'An unfinished readback.'});await pause(0);await f.channel.flush();
 assert.equal(f.events.find(e=>e.type==='output_audio_buffer.stopped').liveBoundary,'forced_flush');f.channel.close();
});

test('Live guide updates keep the workflow response budget and preserve it on partial updates',()=>{
  const f=fixture();
  f.channel.configure({voiceProvider:'live',voiceSession:{instructions:'Full sharing policy',tools:[],max_output_tokens:3000}});
  f.channel.send(JSON.stringify({type:'session.update',event_id:'budget',session:{instructions:'Updated sharing policy',max_output_tokens:3000,tools:[]}}));
  assert.equal(f.sent.find(e=>e.type==='session.update').session.delegation.responses.max_output_tokens,3000);
  assert.deepEqual(f.sent.find(e=>e.type==='session.update').session.delegation.responses.reasoning,{effort:'low'});
  f.receive({type:'session.updated',client_event_id:'budget'});
  f.channel.send(JSON.stringify({type:'session.update',event_id:'partial',session:{tools:[]}}));
  assert.equal(f.sent.filter(e=>e.type==='session.update').at(-1).session.delegation.responses.max_output_tokens,3000);
  assert.deepEqual(f.sent.filter(e=>e.type==='session.update').at(-1).session.delegation.responses.reasoning,{effort:'low'});
  f.channel.close();
 });

function fakeClock(){
 let time=0,next=0;const jobs=new Map();
 return {now:()=>time,schedule:(fn,ms)=>{const id=++next;jobs.set(id,{fn,at:time+ms});return id;},cancel:id=>jobs.delete(id),
  advance(ms){time+=ms;for(const [id,job]of [...jobs])if(job.at<=time){jobs.delete(id);job.fn();}}};
}
for(const [language,head,tail]of [['es','Guarda un próximo paso sobre estudios',' ambientales.'],['en','Save a next step about environmental',' studies.']])test(`A brief ${language} pause preserves the complete request while fencing earlier work`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.receive({type:'session.input_transcript.delta',delta:head});await pause(0);
 f.backend('response.created','fragment');clock.advance(1100);await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:tail});await pause(0);
 f.backend('response.output_item.done','fragment',{item:{type:'function_call',name:'save_next_step',call_id:'old',arguments:'{}'}});
 f.backend('response.completed','fragment');clock.advance(1100);await pause(0);
 assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').at(-1).transcript,head+tail);
 assert.equal(f.events.filter(e=>e.type==='input_audio_buffer.speech_started').at(-1).liveBoundary,'transcript_continuation');
 assert.equal(JSON.parse(f.sent.find(e=>e.type==='response.item.create').item.output).status,'superseded_turn');
 assert.ok(!f.events.some(e=>e.type==='response.done'&&e.response.output?.some(i=>i.type==='function_call')));f.channel.close();
});
test('Transcript stitching never crosses an assistant reply or a long pause',async()=>{
 for(const boundary of ['reply','reply-before-flush','silence']){
  const clock=fakeClock(),f=fixture(clock);
  f.receive({type:'session.input_transcript.delta',delta:'Save an earlier step.'});await pause(0);
  if(boundary==='reply-before-flush')f.receive({type:'session.output_transcript.delta',delta:'Do you want to save it?'});
  await pause(0);clock.advance(1100);await pause(0);
  if(boundary==='reply')f.receive({type:'session.output_transcript.delta',delta:'Do you want to save it?'});else if(boundary==='silence')clock.advance(1500);
  await pause(0);f.receive({type:'session.input_transcript.delta',delta:'No, do not save it.'});await pause(0);clock.advance(1100);await pause(0);
  assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').at(-1).transcript,'No, do not save it.');f.channel.close();
 }
});
for(const language of ['en','es'])test(`A stalled ${language} backend is bounded and late write proposals never execute`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Policy',tools:[]}});
 f.backend('response.created','slow');
 f.backend('response.output_item.done','slow',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'late',arguments:'{}'}});
 clock.advance(liveBackendDeadlineMs-1);await pause(0);assert.equal(f.sent.filter(e=>e.type==='response.cancel').length,0);
 clock.advance(1);await pause(0);
 assert.equal(f.sent.find(e=>e.type==='response.cancel').response_id,'slow');
 assert.equal(f.events.find(e=>e.type==='origen.backend.finished').outcome,'timed_out');
 assert.match(f.sent.find(e=>e.type==='session.commentary.append').content,language==='es'?/no pude completarla/:/couldn’t finish it/);
 // Even after a new turn, a delayed terminal event or replayed creation cannot
 // execute the old write, release a second hold, or schedule another attempt.
 f.receive({type:'session.input_transcript.delta',delta:'No, do not save.'});
 f.backend('response.created','slow');f.backend('response.completed','slow');await pause(0);
 assert.equal(f.events.filter(e=>e.type==='origen.backend.started').length,1);
 assert.equal(f.events.filter(e=>e.type==='origen.backend.finished').length,1);
 assert.ok(!f.events.some(e=>e.type==='response.done'));
 assert.ok(!f.sent.some(e=>e.type==='response.create'));f.channel.close();
});
test('A completed response clears its deadline before application tools run',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','ok');
 f.backend('response.output_item.done','ok',{item:{type:'function_call',name:'highlight_binder_topics',call_id:'ok',arguments:'{"topics":["transfer"]}'}});
 f.backend('response.completed','ok');await pause(0);clock.advance(liveBackendDeadlineMs);await pause(0);
 assert.ok(f.events.some(e=>e.type==='response.done'&&e.response.output[0]?.call_id==='ok'));
 assert.ok(!f.sent.some(e=>e.type==='response.cancel'||e.type==='session.commentary.append'));f.channel.close();
});
test('A timed-out turn cannot silently restart; a new caller turn can still delegate',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','slow');
 clock.advance(liveBackendDeadlineMs);await pause(0);f.backend('response.created','automatic-retry');
 f.backend('response.output_item.done','automatic-retry',{item:{type:'function_call',name:'remember_student_detail',call_id:'retry-write',arguments:'{}'}});
 f.backend('response.completed','automatic-retry');await pause(0);
 assert.ok(f.sent.some(e=>e.type==='response.cancel'&&e.response_id==='automatic-retry'));
 assert.ok(!f.events.some(e=>e.type==='response.done'));
 f.receive({type:'session.input_transcript.delta',delta:'Please try that again.'});f.backend('response.created','requested-retry');
 assert.ok(f.events.some(e=>e.type==='origen.backend.started'&&e.response_id==='requested-retry'));f.channel.close();
});
test('An expired old turn does not interrupt a newer turn with a failure announcement',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','old');clock.advance(1000);
 f.receive({type:'session.input_transcript.delta',delta:'Instead, discuss my essay.'});f.backend('response.created','new');
 clock.advance(liveBackendDeadlineMs-1000);await pause(0);
 assert.deepEqual(f.sent.filter(e=>e.type==='response.cancel').map(e=>e.response_id),['old']);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});
for(const ending of ['close','transport','session','farewell'])test(`${ending} clears the pending backend deadline`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','pending');
 if(ending==='close')f.channel.close();
 if(ending==='transport')f.raw.onclose({});
 if(ending==='session')f.receive({type:'session.closed'});
 if(ending==='farewell')f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_farewell'},instructions:'Say goodbye'}}));
 await pause(0);const sent=f.sent.length;clock.advance(liveBackendDeadlineMs);await pause(0);
 assert.equal(f.sent.length,sent);assert.ok(!f.events.some(e=>e.outcome==='timed_out'));f.channel.close();
});

test('configuration timing spans send through matching acknowledgment only',async()=>{const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'session.update',event_id:'scope-ready',session:{instructions:'New scope',tools:[]}}));clock.advance(2500);f.receive({type:'session.updated',client_event_id:'unknown'});await pause(0);assert.equal(f.events.filter(e=>e.type==='origen.configuration.applied').length,0);clock.advance(450);f.receive({type:'session.updated',client_event_id:'scope-ready'});await pause(0);assert.equal(f.events.find(e=>e.type==='origen.configuration.applied').durationMs,2950);f.channel.close();});

for(const name of ['Aiden','Hablemos de Aiden'])test(`scope confirmation resumes its native backend before the next research question: ${name}`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'response.create'}));
 f.receive({type:'session.input_transcript.delta',delta:name});await pause(0);clock.advance(1100);await pause(0);
 f.backend('response.created','scope');await pause(0);
 f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'target',output:JSON.stringify({status:'target_confirmed'})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));clock.advance(6000);await pause(0);
 assert.ok(!f.events.some(e=>e.type==='origen.speech.silence_recovered'));
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1,'scope receipts must complete the same backend tool loop');f.channel.close();
});
for(const status of ['research_pending','research_failed'])test(`single research receipt ${status} resumes its native backend exactly once`,async()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create'}));
 f.backend('response.created','research');await pause(0);
 f.backend('response.output_item.done','research',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:'{}'}});
 f.backend('response.completed','research');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'lookup',output:JSON.stringify({status})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);f.channel.close();
});
test('quiet research evidence retains uncertainty and is never a behavioral instruction',async()=>{
 const f=fixture();
 f.receive({type:'session.input_transcript.delta',delta:'Tell me more'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'r',question:'Berkeley costs',result:{status:'completed',answer:'Could not verify the next year.'}}));
 const parts=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 assert.ok(parts.every(p=>p.kind==='untrusted-research-evidence'));
 assert.match(parts.map(p=>p.text).join(''),/Could not verify the next year/);
 assert.ok(!f.sent.some(e=>e.type==='session.instructions.append'));f.channel.close();
});
