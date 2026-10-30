import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWelcome,homeVoiceIntroduction,onboardingSavedConfirmation} from '../src/voiceWelcome.mjs';
test('onboarding collects profile before introducing features in either language',()=>{
 for(const language of ['en','es']){
  const opening=onboardingWelcome(language,{canSaveProfile:true});
  assert.match(opening,/focus on profile setup/);
  assert.match(opening,/before the profile is saved/);
  assert.match(opening,/Start with Hola/);
  assert.match(opening,/introduce yourself as Origen, the AI guide/);
  assert.match(opening,language==='en'?/We’ll fill out this profile together/:/Vamos a completar este perfil juntos/);
  assert.doesNotMatch(opening,/Family home|Mi familia|Paying for college|Planificación/);
  const home=homeVoiceIntroduction(language);
  assert.match(home,/binder is now open/);
  assert.match(home,/SAME conversation without Hola/);
  assert.match(home,language==='en'?/Origen circle button on the bar at the bottom/:/botón con el círculo de Origen en la barra de abajo/);
  assert.match(home,language==='en'?/Notes and next steps/:/notas y los próximos pasos/);
 }
});

test('saved-profile acknowledgment leaves the tour and goodbye for the open binder',()=>{
 const saved=onboardingSavedConfirmation();
 assert.match(saved,/profile was saved successfully/);
 assert.match(saved,/binder is opening next/);
 assert.match(saved,/Do not ask another question, give the orientation yet, or say goodbye/);
 assert.match(saved,/confirmation finishes playing/);
});

test('final binder orientation addresses students and parents without claiming notes already saved',()=>{
 for(const language of ['en','es'])for(const role of ['student','parent']){
  const intro=homeVoiceIntroduction(language,{role});
  assert.match(intro,/Never claim a conversation summary or binder notes have already saved/);
  assert.match(intro,/disconnect after this final audio finishes/);
  assert.match(intro,/do not wait for another reply/);
  assert.match(intro,language==='es'?(role==='parent'?/Esta es la carpeta de tu estudiante/:/Esta es tu carpeta/):(role==='parent'?/This is your student's binder/:/This is your binder/));
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
