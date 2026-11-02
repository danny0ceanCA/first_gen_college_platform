import test from 'node:test';
import assert from 'node:assert/strict';
import {followUpVoiceTools} from './followUpVoiceTools.mjs';
import {voiceMemoryTools} from './voiceMemoryTools.mjs';
import {studentLiveChannel} from './studentLiveChannel.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
const item=(name,args={},id='one')=>({name,arguments:JSON.stringify(args),call_id:id});
const audio=(text,id='reply')=>[{type:'response.created',response:{id}},{type:'output_audio_buffer.started',response_id:id},{type:'response.output_audio_transcript.done',response_id:id,transcript:text},{type:'response.done',response:{id,status:'completed'}},{type:'output_audio_buffer.stopped',response_id:id}];
function fixture(extra={}){
 const calls=[];let sequence=1,alive=true,hear=true,saved=0,changed=0,uncertain=0;
 let turn={sessionId:'session',sequence,turnId:'one',transcript:'Save an update about Ask the office: I called.'};
 const tools=followUpVoiceTools({post:async body=>{calls.push(body);return body.action==='prepare'?{status:'readback_required',readback:'Exact private readback.'}:body.action==='confirm'?{status:'saved',kind:'report'}:{status:body.action==='stop'?'stopped':'recorded'};},evidence:async()=>turn,sequence:()=>sequence,isCurrent:()=>alive,canHear:()=>hear,onSaved:()=>saved++,onChanged:()=>changed++,onUncertain:()=>uncertain++,...extra});tools.configure(true);
 return {tools,calls,setHear:v=>hear=v,setAlive:v=>alive=v,turn:text=>{tools.begin();sequence++;turn={sessionId:'session',sequence,turnId:String(sequence),transcript:text};},saved:()=>saved,changed:()=>changed,uncertain:()=>uncertain};
}
const prepare=f=>f.tools.invoke(item('prepare_student_check_in',{target:{planId:'plan',stepId:'step'}}));
test('both provider events use application-captured evidence, exact playback and a separate explicit-save request',async()=>{
 const f=fixture();await prepare(f);for(const e of audio('Exact private readback.'))f.tools.event(e);await f.tools.settled();
 assert.equal(f.calls.filter(c=>c.action==='present'&&c.presentation==='Exact private readback.').length,1);
 f.turn('Yes, save it.');await f.tools.invoke(item('confirm_student_follow_up'));assert.equal(f.saved(),1);const confirm=f.calls.find(c=>c.action==='confirm');assert.equal(confirm.transcript,'Yes, save it.');assert.equal(confirm.sequence,2);assert.ok(!('accepted'in confirm));
});
test('muted, interrupted, forced, failed or incomplete readbacks send no valid presentation',async t=>{
 for(const mode of ['muted','interrupted','forced','unverified','failed','partial','stale'])await t.test(mode,async()=>{
  const f=fixture();await prepare(f);const events=audio('Exact private readback.');
  if(mode==='muted')f.setHear(false);if(mode==='stale')f.setAlive(false);if(mode==='partial')events.splice(3);if(mode==='interrupted')events.splice(2,0,{type:'output_audio_buffer.cleared'});if(mode==='forced')events.at(-1).liveBoundary='forced_flush';if(mode==='unverified')events.at(-1).liveBoundary='unverified_audio';if(mode==='failed')events[3].response.status='failed';
  events.forEach(e=>f.tools.event(e));await f.tools.settled();assert.ok(!f.calls.some(c=>c.action==='present'&&c.presentation==='Exact private readback.'));f.tools.stop();
 });
});
test('unambiguous cancellation runs immediately once, without a model tool or approval turn',async()=>{
 const f=fixture();f.turn('Stop all my check-ins.');const first=await f.tools.spokenTurn(),second=await f.tools.spokenTurn();assert.equal(first.status,'stopped');assert.deepEqual(second,first);assert.equal(f.calls.filter(c=>c.action==='stop').length,1);assert.equal(f.changed(),1);
 f.turn('I called.');assert.equal(await f.tools.spokenTurn(),null);assert.equal(f.saved(),0);
});
test('stale calls, model-supplied consent and uncertain writes never claim a save',async()=>{
 const f=fixture();assert.equal((await f.tools.invoke(item('confirm_student_follow_up',{accepted:true}))).status,'invalid_request');f.turn('No, wait.');assert.equal((await f.tools.invoke(item('confirm_student_follow_up'),1)).status,'cancelled');assert.equal(f.calls.length,0);
 const unavailable=fixture({post:async()=>{throw Error('lost_response');}});assert.equal((await prepare(unavailable)).status,'outcome_unknown');assert.equal(unavailable.saved(),0);assert.equal(unavailable.uncertain(),1);
});
test('an independent turn cannot overtake an in-flight playback receipt; a newer transcript supersedes late registration',async()=>{
 const events=[];let unblock,follow;
 const memory=voiceMemoryTools({beforeRegister:()=>follow?.settled()||Promise.resolve(),post:async body=>{events.push(body.action+':'+body.sequence);return {status:'registered'};}});memory.configure({id:'session',revision:1});
 follow=followUpVoiceTools({evidence:()=>memory.evidence(),sequence:()=>memory.sequence(),canHear:()=>true,post:async body=>{if(body.action==='present'&&body.presentation){events.push('present:pending');await new Promise(r=>unblock=r);events.push('present:done');}return {status:body.action==='prepare'?'readback_required':'recorded'};}});follow.configure(true);
 memory.transcript('one','Remind me next time about Ask the office.');await memory.evidence();await follow.invoke(item('prepare_student_check_in',{target:{planId:'plan',stepId:'step'}}));audio('Exact private readback.').forEach(e=>follow.event(e));await flush();
 follow.begin();memory.begin('two');memory.transcript('two','Yes, save it.');await flush();assert.ok(!events.includes('turn:2'));unblock();await memory.evidence();assert.ok(events.indexOf('present:done')<events.indexOf('turn:2'));
 memory.stop();follow.stop();
});
test('Live selected opening sends the exact-question instruction without its generic greeting',()=>{
 const sent=[];const raw={readyState:'open',send:s=>sent.push(JSON.parse(s)),close(){}};const dc=studentLiveChannel(raw);dc.configure({voiceProvider:'live',voiceSession:{language:'en',tools:[]}});raw.onmessage({data:JSON.stringify({type:'session.started'})});dc.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_follow_up'},instructions:'Exact private check-in.'}}));
 const commentary=sent.find(e=>e.type==='session.commentary.append').content;assert.match(commentary,/exact application-provided/);assert.doesNotMatch(commentary,/greet with Hola/);dc.close();
});

test('outcome tools require negotiated capability and uncertain confirmation is never automatically repeated',async()=>{
 let confirmations=0;const f=fixture({post:async body=>{if(body.action==='confirm'){confirmations++;throw Error('lost_response');}return {status:'readback_required'};}});
 const request=item('prepare_student_outcome_evidence',{target:{planId:'plan',stepId:'step'},payload:{link:{}}});assert.equal((await f.tools.invoke(request)).status,'cancelled');
 f.tools.configure(true,true);assert.equal((await f.tools.invoke(request)).status,'readback_required');f.turn('Yes, save it.');
 const confirm=item('confirm_student_follow_up',{},'outcome-confirm');assert.equal((await f.tools.invoke(confirm)).status,'outcome_unknown');assert.equal((await f.tools.invoke(confirm)).status,'outcome_unknown');assert.equal(confirmations,1);assert.equal(f.saved(),0);assert.equal(f.uncertain(),1);f.tools.stop();
});
