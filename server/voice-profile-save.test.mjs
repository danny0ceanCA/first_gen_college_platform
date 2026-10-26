import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceProfileSaveTools,explicitProfileSaveRequest,voiceProfileSaveConsent} from '../src/voiceProfileSave.mjs';
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
 const pending=voiceProfileSaveTools([call('one'),call('two')],()=>{writes++;return new Promise(r=>{resolve=r;});},e=>events.push(e),()=>true,()=>true);
 await Promise.resolve();assert.equal(writes,1);assert.equal(events.length,0);
 resolve({status:'saved',instruction:'Continue talking.'});await pending;
 assert.equal(writes,1);assert.equal(events.length,2);
 assert.ok(events.every(e=>JSON.parse(e.item.output).status==='saved'));
});
test('failed storage, missing details, and absent authorization cannot report a saved profile',async()=>{
 for(const [save,requested,status] of [[()=>{throw new Error('private database error');},true,'save_failed'],[()=>({status:'missing_details',instruction:'Ask for the missing name.'}),true,'missing_details'],[()=>{throw new Error('Must not write');},false,'save_not_requested'],[undefined,true,'save_unavailable']]){
  const events=[];await voiceProfileSaveTools([call('save',requested)],save,e=>events.push(e),()=>true,()=>true);
  assert.equal(JSON.parse(events[0].item.output).status,status);assert.ok(!events[0].item.output.includes('private database'));
 }
});
test('ending the call during a save cannot send a tool result to a closed session',async()=>{
 const events=[];let current=true,finish;
 const pending=voiceProfileSaveTools([call()],()=>new Promise(resolve=>finish=resolve),e=>events.push(e),()=>current,()=>true);
 await Promise.resolve();current=false;finish({status:'saved',instruction:'Saved.'});await pending;
 assert.equal(events.length,0);
});

test('spoken profile saving requires a direct current request in EN/ES, never implied completion',()=>{
 for(const text of ['Save my profile','Please save it','No other questions, go ahead and save my profile',"That's everything, you can save his profile",'Save her profile','Save their profile','No, guarda mi perfil','Sí, puedes guardarlo','Guárdalo','Guardar el perfil'])assert.equal(explicitProfileSaveRequest(text),true,text);
 for(const text of ['Thanks','That is all','Gracias, adiós','Yes','Her name is Elena',"Don't save my profile",'Do not save it','No guardes mi perfil','No quiero guardar mi perfil','Save it? Not yet.','How do I save my profile?','What happens if I save my profile?','¿Cómo puedo guardar el perfil?','She said "save my profile"'])assert.equal(explicitProfileSaveRequest(text),false,text);
});

test('a model save claim without current transcript consent never writes',async()=>{
 const events=[];await voiceProfileSaveTools([call()],()=>assert.fail('unrequested save'),e=>events.push(e));
 assert.equal(JSON.parse(events[0].item.output).status,'save_not_requested');
 await voiceProfileSaveTools([call()],()=>assert.fail('ended call wrote'),()=>{},()=>false,()=>true);
});

test('save consent belongs to its requested response, is consumed once, and is revoked by interruptions',()=>{
 const consent=voiceProfileSaveConsent();consent.begin('first');consent.transcript('first','Her name is Ana');const old=consent.token();
 consent.begin('second');consent.transcript('second','Actually Elena, save her profile');const latest=consent.token();
 assert.equal(consent.consume(old),false,'old draft response must not consume newer consent');assert.equal(consent.consume(latest),true);assert.equal(consent.consume(latest),false);
 consent.begin('third');consent.transcript('third','Save my profile');const saving=consent.token();consent.begin('fourth');
 assert.equal(consent.consume(saving),false,'new speech revokes consent even before transcription');
 assert.equal(consent.transcript('third','Save it'),false,'late transcript cannot restore old consent');
 consent.transcript('fourth',"Don't save it");assert.equal(consent.consume(consent.token()),false);
 consent.begin('fifth');consent.transcript('fifth','Guarda mi perfil');const last=consent.token();consent.clear();assert.equal(consent.consume(last),false);
});

test('adding another student keeps setup tools, PIQ focus and explicit save without recollecting account identity',()=>{
 for(const language of ['en','es']){
  const session=voiceSession({mode:'profile',onboarding:true,collectAccount:false,saveOnboarding:true,experience:{usedApp:true,usedVoice:true},allowGuideHandoff:true,language,profile:{name:'Elena',stage:'11th grade'}},{});
  assert.deepEqual(session.tools.map(t=>t.name).sort(),['end_conversation','propose_profile','save_onboarding_profile','set_conversation_language'].sort());
  assert.match(session.instructions,/do not ask for the account-holder name or role/);
  assert.match(session.instructions,/Mentioning PIQs, essays, admissions, aid or colleges is profile context/);
  assert.match(session.instructions,/any other onboarding details or questions, or would like to save/);
  assert.match(session.instructions,/First propose all latest details/);
  assert.doesNotMatch(session.instructions,/RETURNING USER:/);
 }
});
test('live save is available only in onboarding and is explained in both languages',()=>{
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
