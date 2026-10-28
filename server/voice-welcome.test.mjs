import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';
test('onboarding collects profile before introducing features in either language',()=>{
 for(const language of ['en','es']){
  const opening=onboardingWelcome(language,{canSaveProfile:true});
  assert.match(opening,/focus on profile setup/);
  assert.match(opening,/before the profile is saved/);
  assert.match(opening,/Start with Hola/);
  assert.match(opening,language==='en'?/Hola, I'm Origen, your AI guide\./:/Hola, soy Origen, tu guía de inteligencia artificial\./);
  assert.doesNotMatch(opening,/Family home|Mi familia|Paying for college|Planificación/);
  const home=homeVoiceIntroduction(language);
  assert.match(home,/home page is now open/);
  assert.match(home,/SAME conversation without Hola/);
  assert.match(home,language==='en'?/Origen circle button on the bar at the bottom/:/botón con el círculo de Origen en la barra de abajo/);
  assert.match(home,language==='en'?/short summary/:/resumen breve/);
 }
});
test('home introduction distinguishes preview summary storage',()=>{
 assert.match(homeVoiceIntroduction('en',{preview:true}),/summaries stay in this browser/);
 assert.match(homeVoiceIntroduction('es',{preview:true}),/resúmenes se quedan en este navegador/);
 assert.doesNotMatch(homeVoiceIntroduction('en'),/This is a preview/);
});

test('another student starts with that student name even when the account holder is a student',()=>{
 for(const language of ['en','es'])for(const role of ['parent','student']){
  const opening=onboardingWelcome(language,{newStudent:true,role});
  assert.match(opening,language==='es'?/Cómo se llama el nuevo estudiante/:/What is the new student's name/);
  assert.doesNotMatch(opening,/What should I call you|Cómo te llamas/);
 }
});

test('welcome overrides preserve the same natural beginner-friendly voice style',()=>{
 for(const language of ['en','es'])for(const preview of [false,true]){
  const opening=onboardingWelcome(language,{preview});
  assert.match(opening,/# Personality & Tone/);
  assert.match(opening,/everyday idea before naming a needed official term or acronym/);
  assert.match(opening,/Avoid .*patronizing speech/);
  assert.match(opening,/never read headings or stage directions aloud/);
  assert.match(opening,/Silent guidance; never explain, compare or spell the name aloud/);
 }
});
