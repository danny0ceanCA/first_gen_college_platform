import test from 'node:test';import assert from 'node:assert/strict';
import {publicRecord,publicFact,recordFixture} from './research-record.fixtures.mjs';
import {createResearchTask,auditResearchTask} from '../src/researchTask.mjs';
import {mergeRecoveryResearch} from './research-recovery.mjs';
for(const language of ['en','es']){
 const es=language==='es';
 test(language+': generic admissions and FAFSA labels are context, named programs remain restricted',()=>{
  const record=publicRecord('admissions',language);record.scope.program=es?'Admisión de pregrado':'Undergraduate admission';
  const task=createResearchTask({language,institution:'Eastview College',question:es?'Fecha límite de solicitud de primer año':'First-year application deadline'});
  assert.equal(auditResearchTask(task,recordFixture(language,'admissions','Eastview College',record).result).complete,true);
  assert.equal(auditResearchTask(createResearchTask({question:'First-year Nursing program deadline',institution:'Eastview College'}),recordFixture(language,'admissions','Eastview College',record).result).complete,false);
  record.scope.program='Nursing';assert.equal(auditResearchTask(task,recordFixture(language,'admissions','Eastview College',record).result).complete,false);
  const process=publicRecord('process',language);process.scope.program='FAFSA federal';
  const steps=createResearchTask({language,question:es?'Pasos para aceptar la invitación de FAFSA':'Steps to accept the FAFSA invitation'});
  assert.equal(auditResearchTask(steps,recordFixture(language,'process','Federal Student Aid',process).result).complete,true);
  assert.equal(auditResearchTask(createResearchTask({question:'Steps to apply for a housing permit'}),recordFixture(language,'process','Federal Student Aid',process).result).complete,false);
 });
 test(language+': applicant suffix is bounded and cannot absorb another campus',()=>{
  const record=publicRecord('admissions',language),question=es?'Fecha límite de primer año':'First-year deadline';
  const task=createResearchTask({language,institution:'Eastview College',question});
  for(const suffix of ['first-year applicants','solicitantes de primer año'])assert.equal(auditResearchTask(task,recordFixture(language,'admissions','Eastview College '+suffix,record).result).complete,true);
  for(const suffix of ['North Campus first-year applicants','School of Nursing','wood first-year applicants'])assert.equal(auditResearchTask(task,recordFixture(language,'admissions','Eastview College '+suffix,record).result).complete,false);
 });
 test(language+': step paraphrases and reordered sequences preserve first evidence without false conflict or completeness promotion',()=>{
  for(const complete of [true,false]){
   const a=publicRecord('process',language);a.complete=complete;const first=recordFixture(language,'process','Eastview College',a).result;
   const b=structuredClone(a);b.complete=true;b.facts.reverse();b.facts.forEach((f,i)=>{f.order=i+1;f.value+=' '+(es?'Sigue las instrucciones publicadas.':'Follow the published instructions.');});
   const recovered=recordFixture(language,'process','Eastview College',b).result;
   const plan={gaps:[{subject:'Eastview College',aspect:'other'}]};
   const merged=mergeRecoveryResearch(first,recovered,language,plan);
   assert.deepEqual(merged.voiceBrief.findings[0].evidence,a);assert.equal(merged.researchConflicts?.length||0,0);assert.ok(merged.researchAlternatives.length);
   assert.equal(merged.voiceBrief.answer,first.voiceBrief.findings[0].answer,'top-level summary also retains the accepted sequence');
  }
 });
 test(language+': a changed verified numeric value remains a conflict',()=>{
  const a=publicRecord('scholarships',language),b=structuredClone(a);b.facts[0].amount+=1000;
  const merged=mergeRecoveryResearch(recordFixture(language,'scholarships','Eastview College',a).result,recordFixture(language,'scholarships','Eastview College',b).result,language,{gaps:[{subject:'Eastview College',aspect:'other'}]});
  assert.equal(merged.researchConflicts.length,1);assert.equal(merged.voiceBrief.findings[0].evidence.facts[0].status,'partial');
 });
}
