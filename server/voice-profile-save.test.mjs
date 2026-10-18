import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceProfileSaveTools} from '../src/voiceProfileSave.mjs';
import {voiceSession} from './profile-voice.mjs';
import {onboardingWelcome} from '../src/voiceWelcome.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';
const call=(id='save',requested=true)=>({type:'function_call',name:'save_onboarding_profile',call_id:id,arguments:JSON.stringify({requested_by_user:requested})});
test('Save stays blocked across transcription, draft tools, follow-up replies and audio playback',()=>{
 const states=[],turns=voiceTurns(()=>{},()=>{},{onBusy:value=>states.push(value)});
 turns.speechStarted('correction');assert.equal(states.at(-1),true);
 turns.speechStopped('correction');turns.transcript('correction','Actually, nursing.');
 turns.created();turns.beginDone('draft-update',true);assert.equal(states.at(-1),true);
 turns.toolsCompleted();assert.equal(states.at(-1),true,'the follow-up response request is still pending');
 turns.created();turns.playback({type:'output_audio_buffer.started',response_id:'ack'});
 turns.beginDone('ack');turns.completed();assert.equal(states.at(-1),true,'generation completing must not unlock Save before playback finishes');
 turns.playback({type:'output_audio_buffer.stopped',response_id:'ack'});assert.equal(states.at(-1),false);
 assert.deepEqual(states,[true,false]);
 turns.speechStarted('next');turns.stop();assert.deepEqual(states,[true,false,true,false]);
});
test('save acknowledges storage completion and deduplicates writes within a response',async()=>{
 let writes=0,resolve;const events=[];
 const pending=voiceProfileSaveTools([call('one'),call('two')],()=>{writes++;return new Promise(r=>{resolve=r;});},e=>events.push(e));
 await Promise.resolve();assert.equal(writes,1);assert.equal(events.length,0);
 resolve({status:'saved',instruction:'Continue talking.'});await pending;
 assert.equal(writes,1);assert.equal(events.length,2);
 assert.ok(events.every(e=>JSON.parse(e.item.output).status==='saved'));
});
test('failed storage, missing details, and absent authorization cannot report a saved profile',async()=>{
 for(const [save,requested,status] of [[()=>{throw new Error('private database error');},true,'save_failed'],[()=>({status:'missing_details',instruction:'Ask for the missing name.'}),true,'missing_details'],[()=>{throw new Error('Must not write');},false,'save_not_requested'],[undefined,true,'save_unavailable']]){
  const events=[];await voiceProfileSaveTools([call('save',requested)],save,e=>events.push(e));
  assert.equal(JSON.parse(events[0].item.output).status,status);assert.ok(!events[0].item.output.includes('private database'));
 }
});
test('ending the call during a save cannot send a tool result to a closed session',async()=>{
 const events=[];await voiceProfileSaveTools([call()],async()=>({status:'saved',instruction:'Saved.'}),e=>events.push(e),()=>false);
 assert.equal(events.length,0);
});
test('live save is available only in account onboarding and is explained in both languages',()=>{
 for(const language of ['en','es']){
  const session=voiceSession({mode:'profile',collectAccount:true,onboarding:true,saveOnboarding:true,language,profile:{}},{});
  assert.ok(session.tools.some(tool=>tool.name==='save_onboarding_profile'));
  assert.ok(!session.instructions.includes('only the Save profile button persists registration'));
  assert.match(session.instructions,/Only say the profile is saved when the tool returns saved/);
  const welcome=onboardingWelcome(language,{canSaveProfile:true});
  assert.match(welcome,language==='es'?/mientras hablamos/:/while we talk/);
 }
 for(const options of [{mode:'planning',collectAccount:true,saveOnboarding:true},{mode:'profile',saveOnboarding:true},{mode:'profile',collectAccount:true}])assert.ok(!voiceSession({...options,language:'en',profile:{}},{}).tools.some(tool=>tool.name==='save_onboarding_profile'));
});
