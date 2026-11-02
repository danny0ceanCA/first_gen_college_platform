import test from 'node:test';
import assert from 'node:assert/strict';
import {followUpOpeningPlayback,followUpOpeningText,declinesCheckIn} from './followUpOpening.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const claim={studentId:'alex',conversationId:'conversation',claimId:'claim',presentation:followUpOpeningText('Call the insurance office','en')};
function fixture(){const calls=[];let audible=true,current=true,status='current',unavailable=0;const controller=followUpOpeningPlayback({claim,canHear:()=>audible,isCurrent:()=>current,onUnavailable:()=>unavailable++,post:async body=>{calls.push(body);return {status:body.action==='verify'?status:body.action==='present'?'presented':body.action==='defer'?'paused':'released'};}});return {controller,calls,setAudible:v=>audible=v,setCurrent:v=>current=v,setStatus:v=>status=v,unavailable:()=>unavailable};}
const events=text=>[{type:'response.created',response:{id:'one'}},{type:'output_audio_buffer.started',response_id:'one'},{type:'response.output_audio_transcript.done',response_id:'one',item_id:'part',transcript:text},{type:'response.done',response:{id:'one',status:'completed'}},{type:'output_audio_buffer.stopped',response_id:'one'}];

test('only an independently heard complete matching response records a presentation, once',async()=>{
 const f=fixture();assert.equal(await f.controller.verify(),true);for(const e of events(claim.presentation).slice(0,-1))f.controller.event(e);assert.equal(f.calls.filter(x=>x.action==='present').length,0);
 f.controller.event(events(claim.presentation).at(-1));await flush();assert.equal(f.controller.presented(),true);assert.equal(f.calls.filter(x=>x.action==='present').length,1);
 for(const e of events(claim.presentation))f.controller.event(e);assert.equal(f.calls.filter(x=>x.action==='present').length,1);assert.equal(await f.controller.verify(),false);
});

test('muted, interrupted, forced, partial, failed and unverified output never counts as heard',async t=>{
 for(const mode of ['unverified','muted','interrupted','forced','partial','failed','current-question','stale-account'])await t.test(mode,async()=>{
  const f=fixture();if(mode!=='unverified')await f.controller.verify();let stream=events(mode==='partial'?'Call the office':claim.presentation);
  if(mode==='muted')f.setAudible(false);if(mode==='stale-account')f.setCurrent(false);
  if(mode==='interrupted')stream.splice(2,0,{type:'output_audio_buffer.cleared'});
  if(mode==='forced')stream[stream.length-1]={...stream.at(-1),liveBoundary:'forced_flush'};
  if(mode==='failed')stream[3]={type:'response.done',response:{id:'one',status:'failed'}};
  if(mode==='current-question')stream.splice(2,0,{type:'input_audio_buffer.speech_started'});
  for(const e of stream)f.controller.event(e);await flush();assert.equal(f.calls.filter(x=>x.action==='present').length,0);
  if(mode==='failed'){for(const e of events(claim.presentation).map(e=>({...e,...(e.response?{response:{...e.response,id:'second'}}:{}),...(e.response_id?{response_id:'second'}:{})})))f.controller.event(e);await flush();assert.equal(f.calls.filter(x=>x.action==='present').length,0,'A failed response must not retry the check-in in the same conversation.');}
  f.controller.stop();
 });
});

test('stale verification releases once and never arms a replacement opening',async()=>{
 const f=fixture();f.setStatus('unavailable');assert.equal(await f.controller.verify(),false);assert.equal(await f.controller.verify(),false);assert.equal(f.calls.filter(x=>x.action==='release').length,1);assert.equal(f.unavailable(),1);
 for(const e of events(claim.presentation))f.controller.event(e);assert.equal(f.calls.filter(x=>x.action==='present').length,0);
});

test('a not-now answer must be explicit and carries the independently registered turn, never a completion claim',async()=>{
 for(const text of ['Not now','Maybe later.','Ahora no','Más tarde','Quizás después.'])assert.equal(declinesCheckIn(text),true);
 for(const text of ['','Yes','I finished it','Not now, I need to call the office later','Maybe','No sé'])assert.equal(declinesCheckIn(text),false);
 const f=fixture();assert.equal(await f.controller.notNow({sequence:1,turnId:'one',transcript:'I finished it'}),false);assert.equal(f.calls.length,0);
 assert.equal(await f.controller.notNow({sequence:1,turnId:'one',transcript:'Ahora no'}),true);assert.deepEqual(f.calls[0],{studentId:'alex',conversationId:'conversation',claimId:'claim',action:'defer',sequence:1,turnId:'one',transcript:'Ahora no'});
});

test('delivery settles before the next captured decline is submitted, even on a slow connection',async()=>{
 let acknowledge;const calls=[];const controller=followUpOpeningPlayback({claim,canHear:()=>true,post:async body=>{calls.push(body.action);if(body.action==='present')await new Promise(resolve=>{acknowledge=resolve;});return {status:body.action==='verify'?'current':body.action==='present'?'presented':'paused'};}});
 await controller.verify();for(const e of events(claim.presentation))controller.event(e);
 const paused=controller.notNow({sequence:1,turnId:'one',transcript:'Not now'});await flush();assert.deepEqual(calls,['verify','present']);acknowledge();await controller.settled();assert.equal(await paused,true);assert.deepEqual(calls,['verify','present','defer']);
});
