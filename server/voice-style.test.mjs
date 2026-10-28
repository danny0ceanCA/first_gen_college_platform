import test from 'node:test';
import assert from 'node:assert/strict';
import {collegeVoiceStyle,brandVoicePronunciation} from '../src/voiceStyle.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';
import {voiceSession} from './profile-voice.mjs';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';
import {voiceLanguageControl} from '../src/voiceLanguage.mjs';

test('all guides and parent scope gates receive exactly one shared style without losing tools or language',()=>{
 for(const mode of ['profile','planning','finance','loans','admissions'])for(const language of ['en','es'])for(const confirmed of [false,true]){
  const session=voiceSession({mode,language,role:'parent',profile:{name:'Synthetic Student'},students:[{id:'synthetic',name:'Synthetic Student'}],routeConversations:mode!=='profile',targetConfirmed:confirmed,studentId:confirmed?'synthetic':undefined},{});
  assert.equal(session.instructions.split(collegeVoiceStyle).length-1,1);
  assert.ok(session.instructions.includes(brandVoicePronunciation));
  assert.match(session.instructions,new RegExp(`Current conversation language: ${language==='es'?'Spanish':'English'}`));
  assert.ok(session.tools.some(tool=>tool.name==='set_conversation_language'));
  if(mode!=='profile'&&!confirmed){assert.match(session.instructions,/Before answering a substantive question, ask who this is about/);assert.ok(!session.tools.some(tool=>tool.name.startsWith('lookup_')));}
 }
});

test('standalone research audio retains pronunciation without adding a greeting or changing the status text',()=>{
 const sent=[],turns=voiceTurns(event=>{sent.push(event);return `event-${sent.length}`;});
 turns.request();turns.beginDone('research',true);
 const sentence='Origen is checking the University of Oregon requirements.';
 assert.equal(turns.progress(sentence),true);
 const reply=sent.at(-1).response;
 assert.equal(reply.conversation,'none');
 assert.ok(reply.instructions.startsWith(brandVoicePronunciation));
 assert.ok(reply.instructions.endsWith(`Say only this brief status update: ${sentence}`));
 assert.match(reply.instructions,/No greeting/);
 assert.match(reply.instructions,/not actual place names/);
 turns.stop();
});

test('onboarding and post-save response overrides preserve style and the required setup order',()=>{
 for(const language of ['en','es']){
  const setup=onboardingWelcome(language,{canSaveProfile:true}),home=homeVoiceIntroduction(language);
  assert.ok(setup.includes(collegeVoiceStyle));assert.ok(home.includes(collegeVoiceStyle));
  assert.ok(setup.startsWith(brandVoicePronunciation));assert.ok(home.startsWith(brandVoicePronunciation));
  assert.match(setup,/focus on profile setup/);assert.match(setup,/before the profile is saved/);
  assert.match(home,/SAME conversation without Hola/);assert.match(home,/Origen circle button|botón con el círculo de Origen/);
 }
});

test('an in-place language and specialty update carries the shared style without replacing audio',async()=>{
 const sent=[],control=voiceLanguageControl(event=>sent.push(event),{language:'en'});
 const config=voiceSession({mode:'loans',language:'es',role:'student',profile:{},continuing:true},{});
 const update=control.configure(()=>config);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(sent[0].session.instructions.includes(collegeVoiceStyle));
 assert.match(sent[0].session.instructions,/CONTINUING LIVE CONVERSATION/);
 assert.equal(sent[0].session.audio,undefined);assert.equal(sent[0].session.model,undefined);
 control.event({type:'session.updated',session:sent[0].session});await update;
 const change=control.change('es');await new Promise(resolve=>setImmediate(resolve));
 assert.ok(sent[1].session.instructions.includes(brandVoicePronunciation));
 assert.match(sent[1].session.instructions,/Current conversation language: Spanish/);
 assert.equal(sent[1].session.instructions.split(brandVoicePronunciation).length-1,1);
 control.event({type:'session.updated',session:sent[1].session});await change;control.stop();
});
