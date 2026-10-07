import test from 'node:test';
import assert from 'node:assert/strict';
import {welcomeStageLabel} from '../src/welcomeLanguage.mjs';

test('animated onboarding translates every supported education stage without changing stored values',()=>{
 const stages=['9th grade','10th grade','11th grade','12th grade','Community college','College'];
 const translated=['9.º grado','10.º grado','11.º grado','12.º grado','Colegio comunitario','Universidad'];
 stages.forEach((stage,i)=>{
  assert.equal(welcomeStageLabel(stage,'es'),translated[i]);
  assert.equal(welcomeStageLabel(stage,'en'),stage);
 });
 assert.equal(welcomeStageLabel('','es'),'');
 assert.equal(welcomeStageLabel('Unknown','es'),'Unknown');
});
