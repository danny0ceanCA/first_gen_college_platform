import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWelcome} from '../src/voiceWelcome.mjs';
test('onboarding opening explicitly explains Origen before requesting student details in either language',()=>{
 const en=onboardingWelcome('en'),es=onboardingWelcome('es');
 for(const text of [en,es]){assert.match(text,/first response only/);assert.match(text,/Start with Hola/);assert.match(text,/BEFORE asking for student details/);assert.match(text,/Do not use profile tools/);}
 for(const section of ['Family home','Paying for college','Ready to apply for college','Planning'])assert.ok(en.includes(section));
 for(const section of ['Mi familia','Pagar la universidad','Listos para solicitar ingreso','Planificacion'])assert.ok(es.includes(section));
 assert.ok(en.indexOf('Planning')<en.indexOf('What should I call'));
 assert.ok(es.indexOf('Planificacion')<es.indexOf('Como se llama'));
});
