import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceStartingPoints} from '../src/voiceStartingPoints.mjs';
import {voiceSession} from './profile-voice.mjs';
import {homeVoiceIntroduction,onboardingWelcome} from '../src/voiceWelcome.mjs';

test('every specialty receives optional, language-matched starting points on initial and continuing calls',()=>{
 const labels={en:{planning:'exploring what to study',finance:'understanding college costs',loans:'understanding borrowed money and repayment',admissions:'figuring out where to apply'},es:{planning:'explorar qué estudiar',finance:'entender los costos de la universidad',loans:'entender el dinero prestado y cómo devolverlo',admissions:'pensar dónde solicitar ingreso'}};
 for(const language of ['en','es'])for(const mode of Object.keys(labels.en))for(const continuing of [false,true]){
  const session=voiceSession({mode,language,role:'student',targetConfirmed:true,profile:{stage:'Community college'},continuing},{});
  assert.equal(session.instructions.split('OPTIONAL STARTING POINTS v1').length-1,1);
  assert.ok(session.instructions.includes(labels[language][mode]));
  assert.ok(voiceStartingPoints({mode,language}).length<1600);
  assert.match(session.instructions,/Answer a specific question directly/);
  assert.match(session.instructions,/at most two short everyday options and one easy question/);
  assert.match(session.instructions,/Silence, noise, a short answer/);
  assert.match(session.instructions,/Generating starting ideas requires no research lookup/);
  assert.match(session.instructions,/supplied scoped summaries as context data/);
  assert.match(session.instructions,/do not ask them to choose again/);
  assert.match(session.instructions,/transfer only if relevant/);
  assert.match(session.instructions,new RegExp(`Current conversation language: ${language==='es'?'Spanish':'English'}`));
  if(continuing)assert.match(session.instructions,/CONTINUING LIVE CONVERSATION/);
 }
});

test('unconfirmed parent scope cannot receive personalized starting options or hidden history',()=>{
 for(const language of ['en','es']){
  const session=voiceSession({mode:'planning',language,role:'parent',routeConversations:true,targetConfirmed:false,students:[{id:'one',name:'Student One'}],profile:{goals:'PRIVATE_GOAL'},memory:[{date:'2026-10-01',mode:'planning',summary:'PRIVATE_MEMORY'}]},{});
  assert.match(session.instructions,/CONFIRM SCOPE FIRST/);
  assert.ok(!session.instructions.includes('Illustrative options'));
  assert.ok(!session.instructions.includes('PRIVATE_GOAL'));
  assert.ok(!session.instructions.includes('PRIVATE_MEMORY'));
  assert.ok(!session.tools.some(tool=>tool.name.startsWith('lookup_')));
 }
});

test('onboarding uncertainty helps with setup; only the post-save introduction supports exploration',()=>{
 for(const language of ['en','es']){
  const session=voiceSession({mode:'profile',language,role:'student',collectAccount:true,saveOnboarding:true,profile:{}},{});
  assert.match(session.instructions,/PROFILE SETUP TAKES PRIORITY/);
  assert.match(session.instructions,/If an optional detail is unknown, accept that/);
  assert.ok(!session.instructions.includes('Illustrative options'));
  assert.ok(session.tools.some(tool=>tool.name==='save_onboarding_profile'));
  assert.ok(!onboardingWelcome(language).includes('Illustrative options'));
  const home=homeVoiceIntroduction(language);
  assert.ok(home.includes(voiceStartingPoints({language})));
  assert.match(home,/SAME conversation without Hola/);
  assert.match(home,/Talk button on the bar at the bottom/);
 }
});
