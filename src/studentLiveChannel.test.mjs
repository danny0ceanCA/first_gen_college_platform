import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveChannel} from './studentLiveChannel.mjs';
import {voiceProfileSaveConsent} from './voiceProfileSave.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(){
 const sent=[],events=[],consent=voiceProfileSaveConsent();
 const raw={readyState:'open',send:value=>sent.push(JSON.parse(value)),close(){this.readyState='closed';}};
 const channel=studentLiveChannel(raw,{getTurn:()=>consent.token(),isPlaybackIdle:()=>true});
 channel.onmessage=({data})=>{const e=JSON.parse(data);events.push(e);if(e.type==='input_audio_buffer.speech_started')consent.begin(e.item_id);if(e.type==='conversation.item.input_audio_transcription.completed')consent.transcript(e.item_id,e.transcript);};
 channel.configure({voiceProvider:'live',voiceSession:{instructions:'Backend policy',tools:[]}});
 const receive=e=>raw.onmessage({data:JSON.stringify(e)});
 receive({type:'session.started'});
 const backend=(type,responseId,fields={})=>receive({type:'response.event',delegation_id:'d',event:{type,...(type==='response.created'?{response:{id:responseId}}:{response_id:responseId}),...fields}});
 return {sent,events,consent,channel,receive,backend};
}
test('Realtime remains an unchanged pass-through',()=>{const sent=[];const raw={send:value=>sent.push(value)};const dc=studentLiveChannel(raw);dc.send('{"type":"response.create"}');assert.deepEqual(sent,['{"type":"response.create"}']);});
test('Live opening waits for session startup; regular response requests do not duplicate speech',()=>{const f=fixture();f.channel.send(JSON.stringify({type:'response.create',response:{instructions:'Introduce yourself as Origen'}}));f.channel.send(JSON.stringify({type:'response.create'}));assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);f.channel.close();});
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
for(const name of ['remember_student_detail','prepare_coordinator_connection','set_conversation_language'])test(`Stale ${name} never reaches a current-turn handler`,async()=>{
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
