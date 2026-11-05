import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceControlSession} from './voice-control.mjs';
import {studentLiveUpdate} from './student-live-session.mjs';
import {buildOpeningBrief} from './voice-opening-brief.mjs';
import {voiceTargetResult} from '../src/voiceTargetResult.mjs';

const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let i=0;i<200;i++){if(check())return;await pause();}assert.fail('condition timed out');}

for(const language of ['en','es'])for(const milestone of ['receipt','context_ack','backend_started','backend_completed'])test(`${language}: caller after ${milestone} keeps the brief without another recap turn`,async()=>{
 const sent=[],events=[];let jobs=0;
 const config={language,instructions:'Authorized backend',routingPolicy:'bounded-follow-up-v1',tools:[{name:'request_conversation_target'}]};
 const engine=voiceControlSession({provider:{send:text=>sent.push(JSON.parse(text))},config,
  scope:{sessionId:'call',studentId:null,confirmed:false},emit:event=>events.push(event),jobRequest:async()=>{jobs++;return {};}});
 const backend=(type,id,extra={})=>engine.receive({type:'response.event',delegation_id:`delegation-${id}`,event:{type,response:{id},...extra}});
 engine.start();
 try{
  engine.receive({type:'session.input_transcript.delta',delta:'Aiden'});
  await until(()=>events.some(e=>e.type==='input_audio_buffer.speech_started'));await engine.flush();
  backend('response.created','select');backend('response.output_item.done','select',{item:{type:'function_call',name:'request_conversation_target',call_id:'choose',arguments:'{"scope":"student:aiden"}'}});backend('response.completed','select');
  await until(()=>events.some(e=>e.controlLease));const lease=events.find(e=>e.controlLease).controlLease;
  engine.receive({type:'session.output_transcript.delta',delta:language==='en'?'Of course.':'Claro.'});
  const input={language,mode:'planning',role:'parent',routeConversations:true,targetConfirmed:true,studentId:'aiden',
   profile:{id:'aiden',name:'Aiden',school:'Synthetic Community College',goals:'Transfer; no campus decided.'}};
  input.openingBrief=buildOpeningBrief(input);
  await engine.configure({...config,...studentLiveUpdate(input)}, {sessionId:'call',studentId:'aiden',confirmed:true},'selected');
  engine.receive({type:'session.updated',client_event_id:'selected'});await until(()=>events.some(e=>e.type==='session.updated'));
  assert.equal(engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(voiceTargetResult(true,'Aiden'))}},lease),true);
  await until(()=>sent.some(e=>e.type==='response.create'));
  const original=JSON.parse(sent.find(e=>e.item?.call_id==='choose').item.output);
  assert.equal(original.selectionDelivery.mode,'conditional_recap');
  const snapshot=sent.find(e=>e.content&&JSON.parse(e.content).kind==='confirmed-student-brief');
  assert.ok(snapshot);assert.equal(JSON.parse(snapshot.content).profile.name,'Aiden');
  const ack=()=>engine.receive({type:'session.thinking.appended',client_event_id:snapshot.event_id,start_ms:14000,end_ms:15000});
  if(milestone!=='receipt'){ack();await until(()=>events.some(e=>e.type==='origen.selection.context'&&e.stage==='acknowledged'));}
  if(['backend_started','backend_completed'].includes(milestone)){backend('response.created','continue');await until(()=>events.some(e=>e.type==='origen.backend.started'&&e.response_id==='continue'));}
  if(milestone==='backend_completed'){backend('response.completed','continue');await until(()=>events.some(e=>e.type==='origen.backend.finished'&&e.response_id==='continue'));}
  const before=sent.length;
  const question=language==='en'?['I want to talk about ','financial planning for him.']:['Quiero hablar de ','cómo planear los gastos de sus estudios.'];
  engine.receive({type:'session.input_transcript.delta',delta:question[0]});
  await until(()=>events.some(e=>e.type==='origen.selection.delivery'&&e.stage==='caller_after_receipt'));
  engine.receive({type:'session.input_transcript.delta',delta:question[1]});
  if(milestone==='receipt')ack();
  await engine.flush();
  const updates=sent.slice(before);
  assert.deepEqual(updates.map(e=>e.type),['session.thinking.append','response.item.create']);
  assert.equal(JSON.parse(updates[0].content).mode,'caller_first');
  assert.equal(updates[1].item.role,'developer');
  assert.equal(sent.filter(e=>e.type==='response.create').length,1,'the original native continuation is the only requested generation');
  assert.deepEqual(original.selectionContext.openingBrief,input.openingBrief,'full private context remains available to the backend');
  assert.deepEqual(events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').map(e=>e.transcript),['Aiden',question.join('')]);
  assert.equal(events.filter(e=>e.type==='origen.selection.delivery'&&e.stage==='caller_after_receipt').length,1);
  assert.equal(jobs,0);assert.ok(!sent.some(e=>['session.instructions.append','session.commentary.append','response.cancel','session.input_audio.mute','output_audio_buffer.clear'].includes(e.type)));
 }finally{engine.close();}
});
