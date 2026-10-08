import test from 'node:test';
import assert from 'node:assert/strict';
import {collegeVoiceStyle} from '../src/voiceStyle.mjs';
import {voiceSession} from './profile-voice.mjs';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';
import {voiceLanguageControl} from '../src/voiceLanguage.mjs';

test('all guides and parent scope gates receive exactly one shared style without losing tools or language',()=>{
 for(const mode of ['profile','planning','finance','loans','admissions'])for(const language of ['en','es'])for(const confirmed of [false,true]){
  const session=voiceSession({mode,language,role:'parent',profile:{name:'Synthetic Student'},students:[{id:'synthetic',name:'Synthetic Student'}],routeConversations:mode!=='profile',targetConfirmed:confirmed,studentId:confirmed?'synthetic':undefined},{});
  assert.equal(session.instructions.split(collegeVoiceStyle).length-1,1);
  assert.match(session.instructions,new RegExp(`Current conversation language: ${language==='es'?'Spanish':'English'}`));
  assert.ok(session.tools.some(tool=>tool.name==='set_conversation_language'));
  if(mode!=='profile'&&!confirmed){assert.match(session.instructions,/Before answering a substantive question, ask who this is about/);assert.ok(!session.tools.some(tool=>tool.name.startsWith('lookup_')));}
 }
});

test('onboarding and post-save response overrides preserve style and the required setup order',()=>{
 for(const language of ['en','es']){
  const setup=onboardingWelcome(language,{canSaveProfile:true}),home=homeVoiceIntroduction(language);
  assert.ok(setup.includes(collegeVoiceStyle));assert.ok(home.includes(collegeVoiceStyle));
  assert.match(setup,/focus on profile setup/);assert.match(setup,/before the profile is saved/);
  assert.match(home,/SAME conversation without Hola/);assert.match(home,/Talk button on the bar at the bottom/);
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
 control.event({type:'session.updated',session:sent[0].session});await update;control.stop();
});
