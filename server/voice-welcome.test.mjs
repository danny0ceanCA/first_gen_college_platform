import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWelcome} from '../src/voiceWelcome.mjs';
test('onboarding opening explicitly explains Origen before requesting student details in either language',()=>{
 const en=onboardingWelcome('en'),es=onboardingWelcome('es');
 for(const text of [en,es]){assert.match(text,/first response only/);assert.match(text,/Start with Hola/);assert.match(text,/BEFORE asking for student details/);assert.match(text,/Do not use profile tools/);}
 for(const section of ['Family home','Paying for college','Ready to apply for college','Planning'])assert.ok(en.includes(section));
 for(const section of ['Mi familia','Pagar la universidad','Listos para solicitar ingreso','Planificación'])assert.ok(es.includes(section));
 assert.ok(en.indexOf('Planning')<en.indexOf('What should I call'));
 assert.ok(es.indexOf('Planificación')<es.indexOf('Cómo se llama'));
});

test('welcome explains summaries and accurately distinguishes browser previews',()=>{
 for(const lang of ['en','es']){const preview=onboardingWelcome(lang,{preview:true});assert.match(preview,lang==='en'?/summaries stay in this browser/:/resúmenes se quedan en este navegador/);}
 const live=onboardingWelcome('en');assert.match(live,/read summaries in Family home/);assert.match(live,/save it to keep its summary/);assert.doesNotMatch(live,/This is a preview/);assert.match(onboardingWelcome('en',{role:'student'}),/What should I call you/);
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
