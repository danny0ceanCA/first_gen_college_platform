import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceResearchRequest} from '../src/voiceResearchRequest.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

for(const stage of ['authentication','fetch','response body'])test(`research deadline releases a stalled ${stage} even when it ignores abort`,async()=>{
 const request=voiceResearchRequest({timeoutMs:15}),gate=deferred();let signal;
 const stages=[];
 const pending=request.run(async s=>{
  signal=s;
  for(const name of ['authentication','fetch','response body']){
   stages.push(name);
   if(name===stage)await gate.promise;
   s.throwIfAborted();
  }
  return 'late evidence';
 });
 await assert.rejects(pending,{name:'TimeoutError'});
 assert.equal(signal.aborted,true);
 gate.resolve();await Promise.resolve();
 assert.equal(stages.at(-1),stage,'no later operation after timeout');
 assert.equal(await request.run(async()=> 'next request'),'next request');
});

test('cancel releases the pending lookup, invalidates queued old tools, and ignores late results',async()=>{
 const request=voiceResearchRequest(),gate=deferred(),started=deferred();const version=request.revision();
 const pending=request.run(async()=>{started.resolve();return gate.promise;},version);
 await started.promise;request.cancel();
 await assert.rejects(pending,{name:'AbortError'});
 let invoked=false;
 await assert.rejects(request.run(async()=>{invoked=true;},version),{name:'AbortError'});
 assert.equal(invoked,false);
 const next=request.run(async()=> 'current evidence');
 gate.resolve('obsolete evidence');assert.equal(await next,'current evidence');
});

test('a timed out batch cannot start its remaining queued searches',async()=>{
 const request=voiceResearchRequest({timeoutMs:10}),version=request.revision();
 await assert.rejects(request.run(()=>new Promise(()=>{}),version),{name:'TimeoutError'});
 await assert.rejects(request.run(async()=>assert.fail('expired batch invoked'),version),{name:'TimeoutError'});
});

test('ending the call aborts current and future work',async()=>{
 const call=new AbortController(),request=voiceResearchRequest({signal:call.signal}),started=deferred();
 const pending=request.run(async()=>{started.resolve();return new Promise(()=>{});});
 await started.promise;call.abort();await assert.rejects(pending,{name:'AbortError'});
 await assert.rejects(request.run(async()=>assert.fail('closed call invoked')),{name:'AbortError'});
});

test('cancellation releases a new question once, and a late result cannot request another answer',async()=>{
 const events=[],turns=voiceTurns(e=>{events.push(e);return 'event-'+events.length;});
 const research=voiceResearchRequest(),gate=deferred(),started=deferred();
 turns.request();turns.beginDone('tool',true);
 const pending=research.run(async()=>{started.resolve();return gate.promise;}).catch(error=>{
  assert.equal(error.name,'AbortError');events.push({type:'tool_output',error:'lookup_cancelled'});
 }).finally(()=>{turns.endProgress();turns.toolsCompleted();});
 await started.promise;
 turns.speechStarted('new');const release=turns.holdReply();research.cancel();
 turns.transcript('new','What is a college major?');release();await pending;
 assert.equal(events.filter(e=>e.type==='response.create').length,2);
 gate.resolve('late');await Promise.resolve();
 assert.equal(events.filter(e=>e.type==='tool_output').length,1);
 assert.equal(events.filter(e=>e.type==='response.create').length,2);turns.stop();
});

for(const created of [false,true])test(`ending research releases unfinished progress audio (created=${created})`,()=>{
 const events=[],turns=voiceTurns(e=>{events.push(e);return 'event-'+events.length;});
 turns.request();turns.beginDone('tool',true);turns.progress('Checking.');
 const metadata=events[1].response.metadata;
 if(created){turns.progressEvent({type:'response.created',response:{id:'progress',metadata}});turns.playback({type:'output_audio_buffer.started',response_id:'progress'});}
 turns.endProgress();turns.toolsCompleted();
 assert.equal(events.filter(e=>e.type==='response.create'&&!e.response).length,2);
 if(!created)turns.progressEvent({type:'response.created',response:{id:'progress',metadata}});
 assert.ok(events.some(e=>e.type==='response.cancel'&&e.response_id==='progress'));
 turns.playback({type:'output_audio_buffer.started',response_id:'progress'});
 turns.progressEvent({type:'response.done',response:{id:'progress',metadata}});
 turns.beginDone('answer');turns.completed();
 assert.equal(turns.busy(),false);turns.stop();
});

test('late progress from an old lookup cannot finish the new lookup progress',()=>{
 const events=[],turns=voiceTurns(e=>{events.push(e);return 'event-'+events.length;});
 turns.request();turns.beginDone('tool-a',true);turns.progress('First.');const old=events.at(-1).response.metadata;
 turns.endProgress();turns.toolsCompleted();turns.beginDone('tool-b',true);turns.progress('Second.');
 turns.progressEvent({type:'response.created',response:{id:'old',metadata:old}});
 turns.progressEvent({type:'response.done',response:{id:'old',metadata:old}});
 turns.toolsCompleted();assert.equal(events.filter(e=>e.type==='response.create'&&!e.response).length,2);
 turns.endProgress();assert.equal(events.filter(e=>e.type==='response.create'&&!e.response).length,3);turns.stop();
});

test('completed generation with undrained progress playback cannot hold a cancelled lookup',()=>{
 const events=[],turns=voiceTurns(e=>{events.push(e);return 'event-'+events.length;});
 turns.request();turns.beginDone('tool',true);turns.progress('Checking.');const metadata=events.at(-1).response.metadata;
 turns.progressEvent({type:'response.created',response:{id:'progress',metadata}});
 turns.playback({type:'output_audio_buffer.started',response_id:'progress'});
 turns.progressEvent({type:'response.done',response:{id:'progress',metadata}});
 turns.endProgress();turns.toolsCompleted();
 assert.ok(events.some(e=>e.type==='output_audio_buffer.clear'));
 assert.equal(events.filter(e=>e.type==='response.create'&&!e.response).length,2);turns.stop();
});
