import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reviewResponseContextGuard} from '../src/reviewResponseContext.mjs';
import {voiceMemoryTools} from '../src/voiceMemoryTools.mjs';
import {withRequestDeadline} from '../src/requestDeadline.mjs';

const guard=(id=randomUUID(),version=1,revision='a'.repeat(64))=>({source:{kind:'review-response',requestId:id,responseVersion:version},revision,mode:'question'});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('call guard verifies before use, watches every loaded source and invalidates once',async()=>{
 let valid=true,changes=0,failures=0;const changed=deferred(),seen=[],batches=[];
 const context=reviewResponseContextGuard({intervalMs:5,verify:async values=>{seen.push(...values);batches.push(values.length);return {status:valid?'current':'changed'};},onInvalidate:()=>{changes++;changed.resolve();},onUnavailable:()=>{failures++;}});
 try{
  assert.equal(await context.accept(guard()),true);assert.equal(await context.accept(guard()),true);assert.equal(await context.verifyAll(),true);
  assert.ok(seen.every(x=>Object.keys(x).sort().join(',')==='mode,revision,source'));
  assert.equal(batches.at(-1),2);
  valid=false;await withRequestDeadline(()=>changed.promise,{timeoutMs:1000});assert.equal(changes,1);assert.equal(failures,0);assert.equal(await context.verifyAll(),false);
 }finally{context.stop();}
});

test('unverifiable context ends the affected call; pausing retrieval also invalidates a loaded source',async()=>{
 for(const mode of ['network','paused']){
  let active=true,changed=0,failed=0;const context=reviewResponseContextGuard({verify:async()=>{if(active)return {status:'current'};if(mode==='network')throw new Error('offline');return {status:'unavailable',reason:'paused'};},onInvalidate:()=>{changed++;},onUnavailable:()=>{failed++;}});
  try{assert.equal(await context.accept(guard()),true);active=false;assert.equal(await context.verifyAll(),false);assert.equal(changed,mode==='paused'?1:0);assert.equal(failed,mode==='network'?1:0);}finally{context.stop();}
 }
});

test('late results after cancellation or scope changes cannot reactivate a response',async()=>{
 const pending=deferred();let invalidated=0;const abort=new AbortController();
 const context=reviewResponseContextGuard({signal:abort.signal,verify:()=>pending.promise,onInvalidate:()=>{invalidated++;},onUnavailable:()=>{invalidated++;}});
 const accepting=context.accept(guard());abort.abort();pending.resolve({status:'current'});assert.equal(await accepting,false);assert.equal(invalidated,0);assert.equal(await context.verifyAll(),false);context.stop();
});

test('explicit focus and question guards can coexist only while both permissions and the same version remain current',async()=>{
 const id=randomUUID(),calls=[];let changed=false,invalidations=0;
 const context=reviewResponseContextGuard({maxSources:2,verify:async guards=>{calls.push(guards);return {status:changed&&guards.some(g=>g.mode==='question')?'changed':'current'};},onInvalidate:()=>{invalidations++;},onUnavailable:()=>assert.fail('unexpected verification error')});
 try{
  assert.equal(await context.accept(guard(id)),true);
  const focused={...guard(id,1,'b'.repeat(64)),mode:'focus'};
  assert.equal(await context.accept(focused),true);assert.equal(calls.at(-1).length,2);
  assert.equal(await context.accept(focused),true);assert.equal(calls.at(-1).length,2,'Retry must not exceed the batch bound with a duplicate guard');
  changed=true;assert.equal(await context.verifyAll(),false);assert.equal(invalidations,1);
 }finally{context.stop();}
});

test('linked action confirmation requires playback completion; forced Live flushes, interruptions and muted audio cannot present a readback',async()=>{
 for(const outcome of ['played','muted','interrupted','forced','error']){
  const posts=[],readback='Do you want to save “Ask the office” as a private next step? It will not be shared.';
  const change={kind:'next-step',category:'financial',content:'Ask the office',responseSource:guard().source};
  const memory=voiceMemoryTools({canHear:()=>outcome!=='muted',post:async body=>{posts.push(body);return body.action==='write'?{status:'clarification_required',proposal:change,readback}:{status:'registered'};}});
  try{
   memory.configure({id:randomUUID()});memory.transcript('turn','Save that as my next step.');
   await memory.invoke({name:'save_next_step',call_id:'save',arguments:JSON.stringify(change)});
   memory.event({type:'response.created',response:{id:'readback'}});memory.event({type:'output_audio_buffer.started',response_id:'readback'});
   memory.event({type:'response.output_audio_transcript.done',response_id:'readback',transcript:readback});
   if(outcome==='interrupted')memory.event({type:'input_audio_buffer.speech_started'});
   if(outcome==='error')memory.event({type:'error'});
   memory.event({type:'response.done',response:{id:'readback',status:'completed'}});
   memory.event({type:'output_audio_buffer.stopped',response_id:'readback',...(outcome==='forced'?{liveBoundary:'forced_flush'}:{})});
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(posts.some(p=>p.action==='present'&&p.presentation===readback),outcome==='played',outcome);
  }finally{memory.stop();}
 }
});

test('concurrent replies cannot overwrite a guard; loaded source count is bounded',async()=>{
 const pending=deferred(),id=randomUUID();let changes=0;
 const context=reviewResponseContextGuard({verify:values=>values[0].revision==='a'.repeat(64)?pending.promise:Promise.resolve({status:'current'}),onInvalidate:()=>{changes++;},onUnavailable:()=>assert.fail('unexpected failure')});
 const older=context.accept(guard(id,1));assert.equal(await context.accept(guard(id,2,'b'.repeat(64))),true);pending.resolve({status:'current'});assert.equal(await older,false);assert.equal(changes,1);context.stop();
 const bounded=reviewResponseContextGuard({maxSources:2,verify:async()=>({status:'current'}),onInvalidate:()=>{changes++;},onUnavailable:()=>assert.fail('unexpected failure')});
 assert.equal(await bounded.accept(guard()),true);assert.equal(await bounded.accept(guard()),true);assert.equal(await bounded.accept(guard()),false);assert.equal(changes,2);bounded.stop();
});

test('the shared Live/Realtime recall controller strips guard metadata and blocks cached advice or writes after invalidation',async()=>{
 let current=true,valid=true,readCount=0,writes=0,stops=0;const value=guard();
 const context=reviewResponseContextGuard({verify:async()=>({status:valid?'current':'changed'}),onInvalidate:()=>{stops++;current=false;},onUnavailable:()=>{current=false;}});
 const controller=voiceMemoryTools({isCurrent:()=>current,beforeInvoke:()=>context.verifyAll(),onResponseContext:g=>context.accept(g),post:async body=>{
  if(body.action==='read'){readCount++;return {status:'retrieved',reviewResponse:{status:'retrieved',response:{guidance:'PRIVATE_COORDINATOR_ADVICE'}},reviewResponseGuard:value};}
  if(body.action==='write')writes++;
  return {status:'registered'};
 }});
 try{
  controller.configure({id:randomUUID(),revision:1});controller.transcript('turn-1','What about my insurance waiver?');
  const tool={name:'recall_student_context',call_id:'read-1',arguments:JSON.stringify({query:'insurance'})};
  const result=await controller.invoke(tool);assert.equal(result.reviewResponse.response.guidance,'PRIVATE_COORDINATOR_ADVICE');assert.ok(!Object.hasOwn(result,'reviewResponseGuard'));assert.equal(readCount,1);
  valid=false;assert.equal((await controller.invoke(tool)).status,'cancelled');assert.equal(stops,1);assert.equal(readCount,1);
  assert.equal((await controller.invoke({name:'save_next_step',call_id:'write-1',arguments:'{}'})).status,'cancelled');assert.equal(writes,0);
 }finally{context.stop();controller.stop();}
});

test('a response changed while its final check is pending is never sent as a model tool result',async()=>{
 const pending=deferred();let current=true;const context=reviewResponseContextGuard({verify:()=>pending.promise,onInvalidate:()=>{current=false;},onUnavailable:()=>{current=false;}});
 const controller=voiceMemoryTools({isCurrent:()=>current,beforeInvoke:()=>context.verifyAll(),onResponseContext:g=>context.accept(g),post:async body=>body.action==='read'?{status:'retrieved',reviewResponse:{response:{guidance:'STALE_ADVICE'}},reviewResponseGuard:guard()}:{status:'registered'}});
 try{controller.configure({id:randomUUID(),revision:1});controller.transcript('t','What about insurance?');const task=controller.invoke({name:'recall_student_context',call_id:'r',arguments:'{"query":"insurance"}'});await new Promise(resolve=>setImmediate(resolve));pending.resolve({status:'changed'});const result=await task;assert.equal(result.status,'cancelled');assert.ok(!JSON.stringify(result).includes('STALE_ADVICE'));}
 finally{controller.stop();context.stop();}
});

test('interruptions, corrections and deferrals supersede a pending response before either voice path can use it',async()=>{
 for(const [language,next] of [
  ['en','Not now. Let’s talk about my classes.'],['es','Ahora no. Quiero hablar de mis clases.'],
  ['en','No, I meant the scholarship question.'],['es','No, me refería a la pregunta sobre becas.'],
 ]){
  const waiting=deferred(),started=deferred();let checks=0,reads=0,writes=0;
  const controller=voiceMemoryTools({onResponseContext:async()=>{checks++;return true;},post:async body=>{
   if(body.action==='read'){reads++;if(reads===1){started.resolve();return waiting.promise;}return {status:'retrieved',items:[],reviewResponse:{status:'none'}};}
   if(body.action==='write')writes++;
   return {status:'registered'};
  }});
  try{
   controller.configure({id:randomUUID(),revision:1});controller.transcript('old','Explain the insurance response.',language);
   const tool={name:'recall_student_context',call_id:'old-read',arguments:'{"query":"insurance"}'};
   const older=controller.invoke(tool,controller.sequence());await started.promise;
   controller.begin('new',language);controller.transcript('new',next,language);
   // A late server response must remain cancelled even if its transport ignored abort.
   waiting.resolve({status:'retrieved',reviewResponse:{status:'retrieved',response:{guidance:'SUPERSEDED_RESPONSE'}},reviewResponseGuard:guard()});
   const result=await older;assert.equal(result.status,'cancelled');assert.ok(!JSON.stringify(result).includes('SUPERSEDED_RESPONSE'));assert.equal(checks,0);
   const current=await controller.invoke({...tool,call_id:'new-read',arguments:'{"query":"classes scholarships"}'});
   assert.equal(current.reviewResponse.status,'none');assert.equal(writes,0);
  }finally{controller.stop();}
 }
});
