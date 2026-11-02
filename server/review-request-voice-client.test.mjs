import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRequestVoiceTools} from '../src/reviewRequestVoiceTools.mjs';
import {studentLiveChannel} from '../src/studentLiveChannel.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const prepare={name:'prepare_coordinator_review_request',call_id:'prepare',arguments:JSON.stringify({connectionId:'selected',question:'Could I qualify?',kind:'question',entries:[]})};
const confirm={name:'confirm_coordinator_review_request',call_id:'confirm',arguments:'{}'};
function fixture(extra={}){
 const calls=[];let changed=0,uncertain=0;
 const tools=reviewRequestVoiceTools({post:async(body,signal)=>{calls.push(body);assert.ok(signal);return {status:body.action==='prepare'?'readback_required':body.action==='confirm'?'queued':'registered',readback:'Exact full readback.'};},onChanged:()=>changed++,onUncertain:()=>uncertain++,...extra});
 tools.configure({id:'session'});tools.begin('request');tools.transcript('request','Ask my coordinator about aid.');
 return {tools,calls,changed:()=>changed,uncertain:()=>uncertain};
}
function playback(tools,{mode='complete',text='Exact full readback.'}={}){
 tools.event({type:'response.created',response:{id:'readback'}});
 if(mode!=='no-audio')tools.event({type:'output_audio_buffer.started',response_id:'readback'});
 tools.event({type:'response.output_audio_transcript.done',response_id:'readback',item_id:'audio',transcript:text});
 if(mode==='interrupt')tools.event({type:'input_audio_buffer.speech_started',item_id:'interrupt'});
 if(mode==='clear')tools.event({type:'output_audio_buffer.cleared'});
 tools.event({type:'response.done',response:{id:'readback',status:mode==='cancelled'?'cancelled':'completed'}});
 if(mode!=='no-drain')tools.event({type:'output_audio_buffer.stopped',response_id:'readback',...(mode==='forced'?{liveBoundary:'forced_flush'}:{})});
}
test('review bridge binds independent transcription and deduplicates one tool call',async()=>{
 const f=fixture();assert.equal((await f.tools.invoke(prepare)).status,'readback_required');await f.tools.invoke(prepare);
 const writes=f.calls.filter(x=>x.action==='prepare');assert.equal(writes.length,1);assert.equal(writes[0].transcript,'Ask my coordinator about aid.');assert.equal(writes[0].turnId,'request');assert.ok(writes[0].requestKey);
 assert.equal(f.changed(),1);
 for(const args of [{confirmed:true},{accepted:true},{sessionId:'another'},{transcript:'yes'}])assert.equal((await f.tools.invoke({...confirm,call_id:JSON.stringify(args),arguments:JSON.stringify(args)})).status,'invalid_request');
 assert.equal(f.calls.some(x=>x.action==='confirm'),false);f.tools.stop();await tick();
});
test('a connected request forwards only the selected reference and keeps playback/approval evidence independent',async()=>{
 const relatedResponse={kind:'review-response',requestId:'a4fb1a5c-59ae-4f35-8130-07343895a557',responseVersion:3},f=fixture();
 const linked={...prepare,arguments:JSON.stringify({...JSON.parse(prepare.arguments),relatedResponse})};
 assert.equal((await f.tools.invoke(linked)).status,'readback_required');assert.deepEqual(f.calls.find(x=>x.action==='prepare').relatedResponse,relatedResponse);
 assert.equal(f.calls.find(x=>x.action==='prepare').transcript,'Ask my coordinator about aid.');
 playback(f.tools,{mode:'forced'});await tick();assert.equal(f.calls.some(x=>x.action==='present'&&x.presentation),false);
 assert.equal((await f.tools.invoke({...confirm,arguments:JSON.stringify({relatedResponse,confirmed:true})})).status,'invalid_request');
 assert.equal(f.calls.some(x=>x.action==='confirm'),false);f.tools.stop();await tick();
});
test('only completed audible playback produces a nonempty presentation',async()=>{
 for(const mode of ['complete','interrupt','clear','cancelled','forced','no-audio','no-drain','muted']){
  const f=fixture({canHear:()=>mode!=='muted'});await f.tools.invoke(prepare);playback(f.tools,{mode});await tick();
  assert.equal(f.calls.filter(x=>x.action==='present'&&x.presentation).length,mode==='complete'?1:0,mode);f.tools.stop();await tick();
 }
});
test('presentation registers before the immediately following turn, despite asynchronous transport',async()=>{
 const f=fixture();await f.tools.invoke(prepare);playback(f.tools);f.tools.begin('approval');f.tools.transcript('approval','Yes, please.');await f.tools.invoke(confirm);
 const presentation=f.calls.findIndex(x=>x.action==='present'&&x.presentation),next=f.calls.findIndex(x=>x.action==='turn'&&x.turnId==='approval'),write=f.calls.find(x=>x.action==='confirm');
 assert.ok(presentation>=0&&next>presentation);assert.equal(write.transcript,'Yes, please.');assert.equal(write.sequence,f.tools.sequence());f.tools.stop();await tick();
});
test('new speech fences stale tools and late transcripts; changing session clears approval evidence',async()=>{
 const f=fixture(),old=f.tools.sequence();await f.tools.invoke(prepare);f.tools.begin('new');f.tools.transcript('request','Yes');
 assert.equal((await f.tools.invoke(confirm,old)).status,'cancelled');assert.equal((await f.tools.invoke(confirm)).status,'unavailable');
 f.tools.configure({id:'new-session'});playback(f.tools);await tick();assert.equal(f.calls.some(x=>x.action==='present'&&x.presentation),false);
 assert.ok(f.calls.some(x=>x.action==='close'&&x.sessionId==='session'));f.tools.stop();await tick();
});
test('an ambiguous write result is never retried automatically or reported as saved',async()=>{
 let attempts=0;const f=fixture({post:async body=>{if(body.action==='prepare'){attempts++;throw new Error('connection lost');}return {status:'registered'};}});
 assert.equal((await f.tools.invoke(prepare)).status,'outcome_unknown');assert.equal((await f.tools.invoke(prepare)).status,'outcome_unknown');assert.equal(attempts,1);assert.equal(f.uncertain(),1);assert.equal(f.changed(),0);f.tools.stop();await tick();
});
test('stopping cancels an in-flight write and reports no success even if transport ignores abort',async()=>{
 let resolve;const f=fixture({post:async body=>body.action==='prepare'?new Promise(r=>resolve=r):{status:'registered'}});
 const result=f.tools.invoke(prepare);await tick();assert.ok(resolve);f.tools.stop();resolve({status:'readback_required'});assert.equal((await result).status,'cancelled');assert.equal(f.changed(),0);
});
test('Live adapter requires observed audio; silence and forced end flush cannot supply consent',async()=>{
 for(const mode of ['audible','forced','silent']){
  const force=mode==='forced';
  const f=fixture();await f.tools.invoke(prepare);const scheduled=new Map();let next=0;
  const raw={send(){},close(){},readyState:'open'};
  const channel=studentLiveChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>mode==='silent'?0:1,schedule:(fn,ms)=>{const id=++next;scheduled.set(id,{fn,ms});return id;},cancel:id=>scheduled.delete(id)});
  channel.configure({voiceProvider:'live',voiceSession:{tools:[]}});channel.onmessage=({data})=>f.tools.event(JSON.parse(data));
  raw.onmessage({data:JSON.stringify({type:'session.output_transcript.delta',delta:'Exact full readback.'})});await tick();
  if(force)await channel.flush();else{const idle=[...scheduled.values()].find(x=>x.ms===1800);assert.ok(idle);idle.fn();}
  await tick();await tick();assert.equal(f.calls.filter(x=>x.action==='present'&&x.presentation).length,mode==='audible'?1:0);channel.close();f.tools.stop();await tick();
 }
});
