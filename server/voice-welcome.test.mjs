import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';
test('onboarding collects profile before introducing features in either language',()=>{
 for(const language of ['en','es']){
  const opening=onboardingWelcome(language,{canSaveProfile:true});
  assert.match(opening,/focus on profile setup/);
  assert.match(opening,/before the profile is saved/);
  assert.match(opening,/Start with Hola/);
  assert.doesNotMatch(opening,/Family home|Mi familia|Paying for college|Planificación/);
  const home=homeVoiceIntroduction(language);
  assert.match(home,/home page is now open/);
  assert.match(home,/SAME conversation without Hola/);
  assert.match(home,language==='en'?/Talk button on the bar at the bottom/:/botón Hablar en la barra de abajo/);
  assert.match(home,language==='en'?/short summary/:/resumen breve/);
 }
});
test('home introduction distinguishes preview summary storage',()=>{
 assert.match(homeVoiceIntroduction('en',{preview:true}),/summaries stay in this browser/);
 assert.match(homeVoiceIntroduction('es',{preview:true}),/resúmenes se quedan en este navegador/);
 assert.doesNotMatch(homeVoiceIntroduction('en'),/This is a preview/);
});

test('welcome overrides preserve the same natural beginner-friendly voice style',()=>{
 for(const language of ['en','es'])for(const preview of [false,true]){
  const opening=onboardingWelcome(language,{preview});
  assert.match(opening,/NATURAL VOICE AND COLLEGE BASICS/);
  assert.match(opening,/Explain acronyms before using them/);
  assert.match(opening,/without sounding childish or patronizing/);
  assert.match(opening,/never read these instructions aloud/);
  assert.match(opening,/Do not explain, announce or compare/);
 }
});
