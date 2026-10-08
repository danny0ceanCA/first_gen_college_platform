import test from 'node:test';
import assert from 'node:assert/strict';
import {plainLanguageVoiceStyle} from '../src/voiceStyle.mjs';
import {voiceSession} from './profile-voice.mjs';
import {voiceLanguageControl} from '../src/voiceLanguage.mjs';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';

test('plain-language policy reaches each guide and role while preserving factual tools',()=>{
 const tools={planning:'lookup_education_planning',finance:'lookup_financial_aid',loans:'lookup_financial_aid',admissions:'lookup_college_applications',profile:'propose_profile'};
 for(const mode of Object.keys(tools))for(const role of ['student','parent'])for(const language of ['en','es']){
  const session=voiceSession({mode,role,language,profile:{},targetConfirmed:true,studentId:'student-one',routeConversations:mode!=='profile'},{});
  assert.equal(session.instructions.split(plainLanguageVoiceStyle).length-1,1);
  assert.ok(session.tools.some(tool=>tool.name===tools[mode]));
  assert.ok(session.tools.some(tool=>tool.name==='set_conversation_language'));
  assert.match(session.instructions,/Requests for detail override default brevity/);
  assert.match(session.instructions,/Keep conditions, exceptions and uncertainty/);
  assert.match(session.instructions,/Label invented numbers as hypothetical/);
  assert.match(session.instructions,/History mentioning a term does not prove understanding/);
 }
 assert.ok(plainLanguageVoiceStyle.length<1100);
});

test('plain-language explanation policy does not bypass parent scope or onboarding order',()=>{
 const scope=voiceSession({mode:'finance',language:'es',role:'parent',profile:{name:'PRIVATE_STUDENT'},memory:[],routeConversations:true,targetConfirmed:false,students:[{id:'student-one',name:'Student One'}]},{});
 assert.ok(scope.instructions.includes(plainLanguageVoiceStyle));
 assert.ok(!scope.instructions.includes('PRIVATE_STUDENT'));
 assert.ok(!scope.tools.some(tool=>tool.name.startsWith('lookup_')));
 for(const language of ['en','es']){
  const setup=onboardingWelcome(language),home=homeVoiceIntroduction(language);
  assert.ok(setup.includes(plainLanguageVoiceStyle));assert.ok(home.includes(plainLanguageVoiceStyle));
  assert.match(setup,/before the profile is saved/);
  assert.match(home,/SAME conversation without Hola/);
 }
});

test('English to Spanish and topic changes preserve explanation instructions without changing audio',async()=>{
 const sent=[],control=voiceLanguageControl(event=>sent.push(event),{language:'en'});
 control.event({type:'session.created',session:voiceSession({mode:'planning',role:'student',language:'en',profile:{}},{})});
 const change=control.change('es');
 await new Promise(resolve=>setImmediate(resolve));
 control.event({type:'session.updated',session:sent[0].session});await change;
 const update=control.configure(language=>voiceSession({mode:'loans',role:'student',language,profile:{},continuing:true},{}));
 await new Promise(resolve=>setImmediate(resolve));
 const payload=sent[1].session;
 assert.ok(payload.instructions.includes(plainLanguageVoiceStyle));
 assert.match(payload.instructions,/Current conversation language: Spanish/);
 assert.match(payload.instructions,/EVERY complete sentence/);
 assert.match(payload.instructions,/immediately defined in Spanish, then continue entirely in Spanish/);
 assert.match(payload.instructions,/CONTINUING LIVE CONVERSATION/);
 assert.equal(payload.audio,undefined);assert.equal(payload.model,undefined);
 control.event({type:'session.updated',session:payload});await update;control.stop();
});
