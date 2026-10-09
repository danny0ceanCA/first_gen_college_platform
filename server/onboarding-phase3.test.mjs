import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingVoiceDiagnostics} from '../src/onboardingVoiceDiagnostics.mjs';
import {voiceSaveCompletion} from '../src/voiceSaveCompletion.mjs';
import {onboardingTransition} from '../src/onboardingTransition.mjs';
import {onboardingEvents} from '../src/onboardingEvents.mjs';
import {onboardingBatch,sanitizeOnboardingMetadata,storeOnboardingBatch} from './onboarding-events.mjs';
import {adminOnboardingAttempt} from './admin-onboarding.mjs';
import {fixture} from './family-fixture.mjs';

test('first audio requires provider output and browser playback; blocked playback and silent elements do not qualify',()=>{
 let clock=100;const events=[];
 const d=onboardingVoiceDiagnostics((name,metadata)=>events.push({name,metadata}),{now:()=>clock});
 d.playback('blocked');clock=500;d.provider({type:'response.created',response:{id:'private-response',metadata:{secret:'secret'}}});
 d.provider({type:'output_audio_buffer.started',response_id:'private-response'});
 d.provider({type:'output_audio_buffer.started',response_id:'private-response'});
 d.playback('silent');assert.ok(!events.some(e=>e.name==='first_agent_audio'));
 clock=1500;d.playback('playing');d.playback('playing');
 assert.deepEqual(events.filter(e=>e.name==='first_agent_audio'),[{name:'first_agent_audio',metadata:{durationMs:1400}}]);
 assert.equal(events.filter(e=>e.name==='agent_audio_started').length,1);
 assert.equal(events.filter(e=>e.name==='audio_playback_resumed').length,1);
 d.playback('paused');assert.equal(d.ready(),false);d.playback('playing');assert.equal(d.ready(),true);
 d.provider({type:'output_audio_buffer.cleared',response_id:'private-response'});
 d.provider({type:'response.done',response:{id:'private-response',status:'cancelled',output:[{text:'private words'}]}});
 assert.equal(events.find(e=>e.name==='agent_response_finished').metadata.status,'cancelled');
 assert.doesNotMatch(JSON.stringify(events),/private|secret/);
 const count=events.length;d.stop();d.playback('playing');d.provider({type:'input_audio_buffer.speech_started',item_id:'new'});assert.equal(events.length,count);
});

test('speech segments deduplicate, measure one clock and report transcription outcomes without words',()=>{
 let clock=0;const events=[];const d=onboardingVoiceDiagnostics((name,metadata)=>events.push({name,metadata}),{now:()=>clock});
 d.playback('playing');d.provider({type:'output_audio_buffer.started',response_id:'response'});
 clock=200;const start={type:'input_audio_buffer.speech_started',item_id:'private-item'};
 d.provider(start);d.provider(start);clock=450;d.provider({type:'input_audio_buffer.speech_stopped',item_id:'private-item'});d.provider({type:'input_audio_buffer.speech_stopped',item_id:'private-item'});
 d.transcript('private-item','timeout');d.transcript('private-item','accepted');d.transcript('private-item','accepted');
 assert.equal(events.filter(e=>e.name==='first_user_speech').length,1);
 assert.deepEqual(events.find(e=>e.name==='first_user_speech').metadata,{durationMs:200});
 assert.deepEqual(events.find(e=>e.name==='user_speech_stopped').metadata,{speechIndex:1,durationMs:250});
 assert.equal(events.filter(e=>e.name==='speech_during_agent_audio').length,1);
 assert.deepEqual(events.filter(e=>e.name==='user_speech_transcription').map(e=>e.metadata.status),['timeout','accepted']);
 // A missing start is unknown; it cannot generate an invented duration.
 d.provider({type:'input_audio_buffer.speech_stopped',item_id:'another'});
 assert.equal(events.filter(e=>e.name==='user_speech_stopped').at(-1).metadata.durationMs,undefined);
 assert.doesNotMatch(JSON.stringify(events),/private-item/);
 assert.doesNotThrow(()=>onboardingVoiceDiagnostics(()=>{throw new Error('offline');}).playback('blocked'));
});

test('save confirmation diagnostics distinguish generated, drained, interrupted, progress and explicit call end',()=>{
 let clock=0,finished=[];const events=[];
 const flow=voiceSaveCompletion(reason=>finished.push(reason),{now:()=>clock,onEvent:(name,metadata)=>events.push({name,metadata})});
 flow.arm();flow.arm();flow.event({type:'response.created',response:{id:'progress',metadata:{topic:'origen_lookup_progress'}}});
 flow.event({type:'response.created',response:{id:'confirmation'}});flow.event({type:'output_audio_buffer.started',response_id:'confirmation'});flow.event({type:'output_audio_buffer.started',response_id:'confirmation'});
 flow.event({type:'response.done',response:{id:'confirmation',status:'completed',output:[]}});assert.deepEqual(finished,[]);
 flow.event({type:'output_audio_buffer.cleared',response_id:'confirmation'});assert.deepEqual(finished,[]);
 flow.event({type:'response.created',response:{id:'retry'}});clock=750;
 flow.event({type:'output_audio_buffer.stopped',response_id:'retry'});flow.event({type:'response.done',response:{id:'retry',status:'completed',output:[]}});flow.ended('user_end');
 assert.deepEqual(finished,['drained']);assert.equal(events.filter(e=>e.name==='save_confirmation_waiting').length,1);assert.equal(events.filter(e=>e.name==='save_confirmation_audio_started').length,1);
 assert.deepEqual(events.find(e=>e.name==='save_confirmation_finished').metadata,{durationMs:750,status:'drained'});
 const skipped=[];const end=voiceSaveCompletion(reason=>skipped.push(reason),{onEvent:(name)=>skipped.push(name)});end.arm();end.ended('user_end');
 assert.ok(skipped.includes('save_confirmation_skipped'));assert.ok(!skipped.includes('save_confirmation_finished'));assert.equal(skipped.at(-1),'user_end');
 // An interrupted introduction must not count an unrelated later answer as the introduction.
 const intro=[];const observed=voiceSaveCompletion(()=>intro.push('complete'),{retryAfterInterruption:false,onEvent:name=>intro.push(name)});observed.arm();observed.event({type:'response.created',response:{id:'intro'}});observed.event({type:'response.done',response:{id:'intro',status:'cancelled'}});observed.event({type:'response.created',response:{id:'different-question'}});observed.event({type:'response.done',response:{id:'different-question',status:'completed',output:[]}});observed.event({type:'output_audio_buffer.stopped',response_id:'different-question'});observed.ended();assert.ok(!intro.includes('complete'));assert.ok(!intro.includes('save_confirmation_finished'));assert.equal(intro.filter(name=>name==='save_confirmation_interrupted').length,1);
});

test('home diagnostics survive home render while later ordinary voice events stop',async()=>{
 const batches=[];const t=onboardingEvents(async body=>batches.push(body));t.open({captureVersion:3,surface:'web'});
 t.event('home_transition_started');t.homeReached();t.event('home_transition_finished',{durationMs:600});t.event('home_introduction_finished',{status:'drained'});t.event('user_speech_started');t.event('voice_ended');
 await t.flush();await t.flush();
 assert.deepEqual(batches.flatMap(b=>b.events).map(e=>e.name),['onboarding_opened','home_transition_started','home_reached','home_transition_finished','home_introduction_finished']);
 assert.equal(batches[0].attemptId,t.id);
});

test('transition reports actual completion and restores the UI on failure or cancellation',async()=>{
 let clock=0,restores=0;const events=[];
 const base={record:(name,metadata)=>events.push({name,metadata}),now:()=>clock,restore:()=>restores++};
 await onboardingTransition({...base,exit:async()=>{clock=240;},open:()=>{},home:()=>({}),enter:()=>{clock=660;}});
 assert.deepEqual(events.map(e=>e.name),['home_transition_started','home_transition_open_requested','home_transition_finished']);assert.equal(events.at(-1).metadata.durationMs,660);
 events.length=0;
 await assert.rejects(onboardingTransition({...base,exit:()=>{},open:()=>{},home:()=>null,enter:()=>assert.fail()}),/home_not_rendered/);
 assert.equal(events.at(-1).name,'home_transition_failed');assert.equal(events.at(-1).metadata.reason,'home_not_rendered');
 events.length=0;const controller=new AbortController();
 const pending=onboardingTransition({...base,signal:controller.signal,exit:()=>new Promise(()=>{}),open:()=>assert.fail('cancelled transition opened home'),home:()=>({}),enter:()=>{}});
 controller.abort();await pending;assert.equal(events.at(-1).name,'home_transition_cancelled');assert.equal(restores,3);
});

test('phase 3 metadata is strictly bounded and accepts no speech content or provider identifiers',()=>{
 const clean=sanitizeOnboardingMetadata({captureVersion:3,surface:'native',playbackReady:false,status:'accepted',durationMs:123,speechIndex:1,responseIndex:2,transcript:'secret',audio:'secret',responseId:'secret',itemId:'secret',code:'private error'});
 assert.deepEqual(clean,{playbackReady:false,surface:'native',captureVersion:3,status:'accepted',durationMs:123,speechIndex:1,responseIndex:2,code:'other'});
 for(const durationMs of [-1,600001,NaN,Infinity,1.2,'123'])assert.equal(sanitizeOnboardingMetadata({durationMs}).durationMs,undefined);
 assert.deepEqual(sanitizeOnboardingMetadata({captureVersion:100,speechIndex:2001,responseIndex:0,playbackReady:'yes',status:'private',surface:'private'}),{});
 const names=['first_agent_audio','user_speech_transcription','save_confirmation_skipped','home_transition_cancelled','home_introduction_finished','native_handoff_acknowledged'];
 const batch=onboardingBatch({attemptId:crypto.randomUUID(),events:names.map((name,i)=>({sequence:i+1,name,occurredAt:new Date().toISOString(),metadata:clean}))});
 assert.equal(batch.events.length,names.length);assert.doesNotMatch(JSON.stringify(batch),/secret|private/);
});

test('stored phase 3 signals return through the admin timeline without private metadata',async()=>{
 const {pool,run}=await fixture();try{
  await run('auth0|phase3',{action:'load'});const id=(await pool.query('SELECT id FROM origen_accounts')).rows[0].id;
  const input=onboardingBatch({attemptId:crypto.randomUUID(),events:[{sequence:1,name:'first_agent_audio',occurredAt:new Date().toISOString(),metadata:{durationMs:450,playbackReady:true,transcript:'private words',responseId:'private provider ID'}}]});
  await storeOnboardingBatch(pool,'auth0|phase3',input);
  const result=await adminOnboardingAttempt(pool,{id,attemptId:input.attemptId},new Date(Date.now()+60000));
  assert.deepEqual(result.events[0].metadata,{playbackReady:true,durationMs:450});assert.doesNotMatch(JSON.stringify(result),/private/);
 }finally{await pool.end();}
});
