import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceControlSession} from './voice-control.mjs';
import {studentLiveUpdate,studentSelectionRecovery} from './student-live-session.mjs';
import {scopeRouting} from './voice-scope.mjs';
import {buildOpeningBrief} from './voice-opening-brief.mjs';
import {voiceTargetResult} from '../src/voiceTargetResult.mjs';
import {selectionRecoveryDelayMs} from '../src/liveSelectionRecovery.mjs';

const drain=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<40;i++){if(check())return;await drain();}assert.fail('expected server event was not emitted');}
const parsedContent=event=>{try{return JSON.parse(event.content);}catch{return null;}};

// Full server controller + Live adapter + guarded browser callback. Provider
// events are synthetic; these tests establish ordering, not heard audio quality.
for(const language of ['en','es'])for(const callerContinues of [false,true])for(const greeting of ['finished','overlapping','interrupted'])test(`${language}: missing initial handoff recovers once with ${callerContinues?'caller-first context':'the existing natural recap'} (${greeting} scope question)`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let clock=10000,jobs=0;const sent=[],events=[],logs=[];
 const input={language,role:'parent',mode:'planning',routeConversations:true,targetConfirmed:false,
  students:[{id:'aiden',name:'Aiden'},{id:'elodie',name:'Elodie'}]};
 const tools=[scopeRouting(input).tool];
 const config={language,instructions:'Authorized backend',routingPolicy:'bounded-follow-up-v1',tools,
  selectionRecovery:studentSelectionRecovery(input,tools)};
 const engine=voiceControlSession({provider:{send:text=>sent.push(JSON.parse(text))},config,
  scope:{sessionId:'synthetic-call',studentId:null,confirmed:false},now:()=>clock,
  emit:event=>events.push(event),log:record=>logs.push(record),jobRequest:async()=>{jobs++;throw Error('unexpected research');}});
 const advance=async ms=>{clock+=ms;t.mock.timers.tick(ms);await drain();};
 const backend=(type,id,extra={})=>engine.receive({type:'response.event',delegation_id:`delegation-${id}`,event:{type,response:{id},...extra}});
 const creates=()=>sent.filter(event=>event.type==='response.create');
 engine.start();
 try{
  await until(()=>events.some(event=>event.type==='session.created'));
  if(greeting!=='finished'){
   engine.receive({type:'session.output_transcript.delta',delta:language==='en'?'Is this about Elodie, Aiden':'¿Hablamos de Elodie, Aiden',start_ms:600,end_ms:1900});
   await until(()=>events.some(event=>event.type==='response.output_audio_transcript.delta'));
  }
  engine.receive({type:'session.input_transcript.delta',delta:'Aiden',start_ms:2000,end_ms:2400});
  await until(()=>events.some(event=>event.type==='input_audio_buffer.speech_started'));
  const acknowledgment=language==='en'?'Of course.':'Claro.';
  if(greeting==='overlapping'){
   engine.receive({type:'session.output_transcript.delta',delta:language==='en'?', or college in general?':', o de la universidad en general?',start_ms:1900,end_ms:2450});
   await drain();
  }
  engine.receive({type:'session.output_transcript.delta',delta:acknowledgment,start_ms:2500,end_ms:2900});
  await drain();
  await advance(1099);assert.equal(creates().length,0,'no backend request while the selection transcript is settling');
  await advance(1);await until(()=>events.some(event=>event.type==='origen.selection.recovery'&&event.stage==='scheduled'));
  await advance(selectionRecoveryDelayMs-1);assert.equal(creates().length,0,'native delegation retains its head start');
  await advance(1);assert.equal(creates().length,1,'one bounded request wakes the existing backend');
  assert.deepEqual(Object.keys(creates()[0]).sort(),['event_id','type'],'uses managed Live contract, without replaying input or forcing tools');
  assert.equal(events.filter(event=>event.controlLease).length,0,'recovery does not execute a selection itself');
  assert.ok(!sent.some(event=>parsedContent(event)?.kind==='confirmed-student-brief'),'no private brief before authorized callback');
  await advance(1500);assert.equal(creates().length,1,'no duplicate request while waiting for the provider');

  engine.receive({type:'session.delegation.created',delegation:{id:'delegation-select',target:'responses'}});
  backend('response.created','select');
  backend('response.output_item.done','select',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});
  backend('response.completed','select');
  await until(()=>events.some(event=>event.controlLease));
  const lease=events.find(event=>event.controlLease).controlLease;
  const receipt={type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}};
  assert.equal(engine.command(receipt,'incorrect-lease'),false,'a backend proposal does not bypass the existing guarded callback');

  const selected={...input,targetConfirmed:true,studentId:'aiden',profile:{id:'aiden',name:'Aiden',school:'Synthetic Community College',goals:'Transfer; no campus decided.'}};
  selected.openingBrief=buildOpeningBrief(selected);
  await engine.configure({...config,...studentLiveUpdate(selected,[],tools)}, {sessionId:'synthetic-call',studentId:'aiden',confirmed:true},'selected');
  if(callerContinues){
   engine.receive({type:'session.input_transcript.delta',delta:language==='en'?'What should we start with?':'¿Por dónde empezamos?',start_ms:6500,end_ms:7600});
   await until(()=>events.filter(event=>event.type==='input_audio_buffer.speech_started').length===2);
  }
  engine.receive({type:'session.updated',client_event_id:'selected'});
  await until(()=>events.some(event=>event.type==='session.updated'));
  assert.equal(engine.command(receipt,lease),true);
  await until(()=>creates().length===2);
  assert.equal(engine.command(receipt,lease),false,'a used callback cannot replay the selection');
  const returned=JSON.parse(sent.find(event=>event.item?.call_id==='choose').item.output);
  assert.equal(returned.status,'target_confirmed');
  assert.equal(returned.selectionDelivery.mode,callerContinues?'caller_first':'conditional_recap');
  assert.ok(returned.selectionDelivery.recentAssistantSpeech.includes(acknowledgment),'the fast acknowledgment remains visible, avoiding a second acknowledgment');
  assert.deepEqual(returned.selectionContext.openingBrief,selected.openingBrief);
  const brief=sent.find(event=>parsedContent(event)?.kind==='confirmed-student-brief');
  assert.ok(brief);assert.equal(parsedContent(brief).profile.name,'Aiden');
  assert.equal(brief.type,'session.thinking.append','the brief arrives as quiet context');
  engine.receive({type:'session.thinking.appended',client_event_id:brief.event_id,start_ms:8000,end_ms:8100});
  await until(()=>events.some(event=>event.type==='origen.selection.context'&&event.stage==='acknowledged'));
  await advance(15000);assert.equal(creates().length,2,'only the recovery request and one required tool continuation are sent');
  assert.equal(jobs,0);
  assert.ok(!sent.some(event=>['session.instructions.append','session.commentary.append','response.cancel','session.input_audio.mute','output_audio_buffer.clear'].includes(event.type)),'no speech restart, second greeting, or forced interruption');
  assert.ok(!events.some(event=>event.type==='error'));
  const recovery=events.filter(event=>event.type==='origen.selection.recovery');
  assert.deepEqual(recovery.map(event=>event.stage),['scheduled','requested','backend_started','selection_dispatched','selection_completed']);
  assert.equal(recovery.at(-1).reason,'target_confirmed');
  const measured=logs.filter(record=>record.measurementStage==='selection_recovery');
  assert.deepEqual(measured.map(record=>record.recoveryStage),recovery.map(event=>event.stage));
  assert.ok(measured.every(record=>Number.isFinite(record.durationMs)));
  assert.ok(!JSON.stringify(measured).includes('Aiden'),'production measurements contain no student name or transcript');
 }finally{engine.close();}
});

for(const language of ['en','es'])for(const accepted of [true,false])test(`${language}: late native selection shares ${accepted?'successful':'failed'} recovery without duplicate loading or recap`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let clock=10000,jobs=0;const sent=[],events=[];
 const input={language,role:'parent',mode:'planning',routeConversations:true,targetConfirmed:false,
  students:[{id:'aiden',name:'Aiden'},{id:'elodie',name:'Elodie'}]};
 const tools=[scopeRouting(input).tool];
 const config={language,instructions:'Authorized backend',routingPolicy:'bounded-follow-up-v1',tools,
  selectionRecovery:studentSelectionRecovery(input,tools)};
 const engine=voiceControlSession({provider:{send:text=>sent.push(JSON.parse(text))},config,
  scope:{sessionId:'synthetic-race',studentId:null,confirmed:false},now:()=>clock,
  emit:event=>events.push(event),jobRequest:async()=>{jobs++;throw Error('unexpected research');}});
 const advance=async ms=>{clock+=ms;t.mock.timers.tick(ms);await drain();};
 const backend=(type,id,extra={})=>engine.receive({type:'response.event',delegation_id:`delegation-${id}`,event:{type,response:{id},...extra}});
 engine.start();
 try{
  await until(()=>events.some(event=>event.type==='session.created'));
  engine.receive({type:'session.input_transcript.delta',delta:'Aiden',start_ms:2000,end_ms:2400});
  await until(()=>events.some(event=>event.type==='input_audio_buffer.speech_started'));
  engine.receive({type:'session.output_transcript.delta',delta:language==='en'?'Of course.':'Claro.',start_ms:2500,end_ms:2900});
  await drain();await advance(1100);await advance(selectionRecoveryDelayMs);
  assert.equal(sent.filter(event=>event.type==='response.create').length,1);
  // The native decision was already in flight but became observable only after
  // the bounded request. Both responses propose the same initial operation.
  for(const [responseId,callId]of [['recovery','choose-recovery'],['late-native','choose-native']]){
   engine.receive({type:'session.delegation.created',delegation:{id:`delegation-${responseId}`,target:'responses'}});
   backend('response.created',responseId);
   backend('response.output_item.done',responseId,{item:{type:'function_call',name:'request_conversation_target',call_id:callId,arguments:'{"scope":"student:aiden"}'}});
   backend('response.completed',responseId);await drain();
  }
  await until(()=>events.some(event=>event.controlLease));
  const callbacks=events.filter(event=>event.controlLease);
  assert.equal(callbacks.length,1,'the same initial operation has one guarded application callback');
  const callback=callbacks[0],firstCall=callback.response.output.find(item=>item.name==='request_conversation_target');
  if(accepted){
   const selected={...input,targetConfirmed:true,studentId:'aiden',profile:{id:'aiden',name:'Aiden',school:'Synthetic Community College',goals:'Explore college options.'}};
   selected.openingBrief=buildOpeningBrief(selected);
   await engine.configure({...config,...studentLiveUpdate(selected,[],tools)}, {sessionId:'synthetic-race',studentId:'aiden',confirmed:true},'selected-once');
   engine.receive({type:'session.updated',client_event_id:'selected-once'});
   await until(()=>events.some(event=>event.type==='session.updated'));
  }
  assert.equal(engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:firstCall.call_id,output:JSON.stringify(voiceTargetResult(accepted,'Aiden'))}},callback.controlLease),true);
  await until(()=>sent.filter(event=>event.item?.type==='function_call_output').length===2);
  const outputs=sent.filter(event=>event.item?.type==='function_call_output');
  assert.deepEqual(outputs.map(event=>event.item.call_id).sort(),['choose-native','choose-recovery']);
  assert.ok(outputs.every(event=>JSON.parse(event.item.output).status===(accepted?'target_confirmed':'target_update_failed')),'both original call IDs receive the actual operation result');
  assert.equal(outputs.filter(event=>JSON.parse(event.item.output).selectionDelivery?.mode==='conditional_recap').length,accepted?1:0,'only one successful result offers a recap');
  assert.equal(sent.filter(event=>parsedContent(event)?.kind==='confirmed-student-brief').length,accepted?1:0,'the authorized quiet brief is supplied once, and never on failure');
  await until(()=>sent.filter(event=>event.type==='response.create').length===2);
  const continuationIndex=sent.findLastIndex(event=>event.type==='response.create');
  assert.ok(outputs.every(event=>sent.indexOf(event)<continuationIndex),'every pending call receives its own result before continuation');
  await advance(5000);
  assert.equal(sent.filter(event=>event.type==='response.create').length,2,'one recovery request and one required continuation, without competing retries');
  assert.equal(jobs,0);assert.ok(!events.some(event=>event.type==='error'));
  assert.ok(!sent.some(event=>['session.instructions.append','session.commentary.append','response.cancel','session.input_audio.mute','output_audio_buffer.clear'].includes(event.type)));
 }finally{engine.close();}
});
