import test from 'node:test';
import assert from 'node:assert/strict';
import {providerVoiceObservation} from './providerVoice.mjs';
import {capturePayload,createVoiceCapture} from './voiceCapture.mjs';

const received=(voice='marin')=>({type:'session.updated',event_id:'event-provider',session:{id:'live-test',model:'gpt-live-1',audio:{output:{voice}}}});
test('requested voice and provider-confirmed voice are separate facts',()=>{
 const same=providerVoiceObservation(received(),{requestedVoice:'marin',expectedSessionId:'live-test'});
 assert.equal(same.status,'confirmed');assert.equal(same.requestedVoice,'marin');assert.equal(same.providerVoice,'marin');
 const different=providerVoiceObservation(received('cedar'),{requestedVoice:'marin',expectedSessionId:'live-test'});
 assert.equal(different.status,'mismatch');assert.equal(different.providerVoice,'cedar');
 for(const event of [{type:'session.started'},received(undefined),{...received(),session:{id:'live-test'}}]){
  if(event.session?.audio)delete event.session.audio;
  const missing=providerVoiceObservation(event,{requestedVoice:'marin'});
  assert.equal(missing.status,'unconfirmed');assert.equal(missing.providerVoice,null);
 }
 const wrongSession=providerVoiceObservation(received(),{requestedVoice:'marin',expectedSessionId:'live-other'});
 assert.equal(wrongSession.status,'unconfirmed');assert.equal(wrongSession.reason,'session_mismatch');assert.equal(wrongSession.providerVoice,null);
});
test('voice evidence respects the documented custom voice form and rejects malformed values',()=>{
 const custom=providerVoiceObservation(received({id:'voice-test',secret:'never'}),{requestedVoice:{id:'voice-test'}});
 assert.equal(custom.status,'confirmed');assert.equal(custom.providerVoice,'voice-test');assert.equal(custom.providerVoiceKind,'custom');
 for(const value of ['x'.repeat(129),'private sentence with spaces',{},['marin'],12])assert.equal(providerVoiceObservation(received(value)).providerVoice,null);
});
test('voice capture uses a bounded allowlist and keeps connection attempts distinct in the private archive',async()=>{
 const event=providerVoiceObservation(received(),{requestedVoice:'marin'});
 const captured=capturePayload({...event,session:received().session,instructions:'secret',audio:'raw audio',token:'Bearer secret',sdp:'v=0 secret'});
 for(const key of ['session','instructions','audio','token','sdp'])assert.equal(captured[key],undefined);
 const batches=[],archive=createVoiceCapture(async rows=>batches.push(rows));
 archive.event(event,{sessionId:'call',attemptId:'disabled'});await archive.flush();assert.equal(batches.length,0);
 archive.enable(true);
 archive.event(event,{sessionId:'call',attemptId:'first'});
 archive.event({...event,status:'pending',providerVoice:null},{sessionId:'call',attemptId:'reconnect'});
 await archive.flush();
 assert.deepEqual(batches.flat().map(row=>row.attemptId),['first','reconnect']);
 assert.equal(batches[0][1].data.providerVoice,null,'a new connection does not inherit the prior confirmed voice');
});
