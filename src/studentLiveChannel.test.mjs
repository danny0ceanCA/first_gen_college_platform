import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveChannel,liveBackendDeadlineMs} from './studentLiveChannel.mjs';
import {voiceProfileSaveConsent} from './voiceProfileSave.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}){
 const sent=[],events=[],consent=voiceProfileSaveConsent();
 const raw={readyState:'open',send:value=>sent.push(JSON.parse(value)),close(){this.readyState='closed';}};
 const channel=studentLiveChannel(raw,{getTurn:()=>consent.token(),isPlaybackIdle:()=>true,...options});
 channel.onmessage=({data})=>{const e=JSON.parse(data);events.push(e);if(e.type==='input_audio_buffer.speech_started')consent.begin(e.item_id);if(e.type==='conversation.item.input_audio_transcription.completed')consent.transcript(e.item_id,e.transcript);};
 channel.configure({voiceProvider:'live',voiceSession:{instructions:'Backend policy',tools:[]}});
 const receive=e=>raw.onmessage({data:JSON.stringify(e)});
 receive({type:'session.started'});
 const backend=(type,responseId,fields={})=>receive({type:'response.event',delegation_id:'d',event:{type,...(type==='response.created'?{response:{id:responseId}}:{response_id:responseId}),...fields}});
 return {sent,events,consent,channel,receive,backend,raw};
}
test('Realtime remains an unchanged pass-through',()=>{const sent=[];const raw={send:value=>sent.push(value)};const dc=studentLiveChannel(raw);dc.send('{"type":"response.create"}');assert.deepEqual(sent,['{"type":"response.create"}']);});
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
 const reply=f.sent.find(event=>event.type==='response.item.create');assert.equal(reply.item.call_id,'stale-call');assert.equal(JSON.parse(reply.item.output).status,'superseded_turn');assert.equal(f.sent.filter(event=>event.type==='response.create').length,1);f.channel.close();
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
