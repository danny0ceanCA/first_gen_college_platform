import test from 'node:test';
import assert from 'node:assert/strict';
import {createNursingLookup} from './lookup.mjs';
import {projectNursingRecord} from './projection.mjs';
import {readExport} from './postgres.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';

function row(id,program='DNP Nurse Anesthesia',campus='Example College'){
 const values={College:campus,'Program / degree':program,'Academic year':'2026-27','Entering cohort / applies to':'Year 1','Budget period':'12 months',Residency:'Not differentiated',Housing:'Not differentiated',Enrollment:'See source and scope','Cost coverage':'Full COA','Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'};
 return {budget_id:id,batch_id:'fixture',campus,program,academic_year_raw:'2026-27',academic_year_key:'2026-27',budget_period:'12 months',residency:values.Residency,housing:values.Housing,enrollment:values.Enrollment,source_url:values['Official source URL'],payload:{id,values,normalized:{source_verified:false,automatic_production_permission:false,published_cents:10080800,caveated_decisions:[]}}};
}
const rows=[row('NUR-0001'),row('NUR-0002','DNP Family Nurse Practitioner'),row('NUR-0003','MSN Psychiatric Mental Health Nurse Practitioner')];
const query=async(sql,p)=>({rows:sql.includes('production_items')?[]:typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
const lookup=createNursingLookup({query,campuses:['Example College']});
for(const language of ['en','es']){
 for(const question of ['DNP Family Nurse Practitioner cost NUR-0001','FNP nursing cost NUR-0001','PMHNP nursing cost NUR-0002','Nurse Practitioner nursing cost NUR-0001','CRNA nursing cost NUR-0002'])test(`${language}: a conflicting specialty cannot quote ${question}`,async()=>{
  const result=await lookup({mode:'finance',institution:'Example College',question,language});
  assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!researchBriefSelection(result).text.includes('$'));
 });
 for(const [question,id] of [['FNP cost','NUR-0002'],['Doctor of Nursing Practice Family Nurse Practitioner cost','NUR-0002'],['CRNA cost','NUR-0001'],['PMHNP cost','NUR-0003'],['DNP nursing cost, not Nurse Anesthesia','NUR-0002']])test(`${language}: a matching specialty resolves ${question}`,async()=>{
  const result=await lookup({mode:'finance',institution:'Example College',question,language});
  assert.equal(result?.nursingCatalog?.recordId,id);assert.match(result.voiceBrief.qualification,/pending|pendiente/i);
 });
 for(const question of ['What nursing prerequisites and entrance exams do I need? NUR-0001','Is the nursing program accredited and state approved? NUR-0001','Is nursing NUR-0001 approved?','Esta aprobado el programa de enfermeria NUR-0001?','How much is nursing tuition and what are the admission requirements? NUR-0001','Cuales son los prerrequisitos de admision para enfermeria NUR-0001?','El programa de enfermeria NUR-0001 esta acreditado y aprobado por el estado?'])test(`${language}: non-price research is not replaced by a cost reference: ${question}`,async()=>{
  assert.equal(await lookup({mode:'finance',institution:'Example College',question,language}),null);
 });
 const college=row('NUR-0011','MSN Entry California','Western University of Health Sciences');
 const insurance={id:'NUR-0011-001',values:{'Original source label':'Health insurance',Category:'Health insurance','Amount period':'12 months','Relationship to total':'Included component'},normalized:{value_representation:'Recorded scalar amount',source_scalar_cents:537400,caveated_decisions:[],source_url:college.source_url}};
 test(`${language}: the college name cannot turn a general price question into insurance`,()=>{
  for(const question of ['What does nursing cost at Western University of Health Sciences?','Cuanto cuesta enfermeria en Western University of Health Sciences?']){
   const result=projectNursingRecord(college,[insurance],language,question);
   assert.match(result.voiceBrief.answer,/100,808/);assert.ok(!result.voiceBrief.answer.includes('5,374'));
   assert.equal(researchBriefSelection(result).findings[0].aspect,'total_budget');
  }
 });
 test(`${language}: an explicit insurance request still selects insurance at the same college`,()=>{
  const result=projectNursingRecord(college,[insurance],language,'Health insurance cost at Western University of Health Sciences');
  assert.match(result.voiceBrief.answer,/5,374/);assert.equal(researchBriefSelection(result).findings[0].aspect,'other');
 });
}

test('published records retain specialty, price intent and research routing',{skip:!process.env.ORIGEN_NURSING_BATCH},async()=>{
 const batch=await readExport(process.env.ORIGEN_NURSING_BATCH),groups=new Map();
 for(const i of batch.items){const list=groups.get(i.budget_id)||[];list.push({payload:i});groups.set(i.budget_id,list);}
 const records=batch.budgets.map(r=>({batch_id:batch.id,budget_id:r.id,campus:r.values.College,program:r.values['Program / degree'],academic_year_raw:r.values['Academic year'],academic_year_key:r.normalized.academic_year,budget_period:r.values['Budget period'],residency:r.values.Residency,housing:r.values.Housing,enrollment:r.values.Enrollment,source_url:r.values['Official source URL'],payload:r}));
 const query=async(sql,p)=>({rows:sql.includes('production_items')?groups.get(p[1])||[]:typeof p[0]==='string'?records.filter(r=>r.budget_id===p[0]):records.filter(r=>p[0].includes(r.campus))});
 const lookup=createNursingLookup({query,campuses:[...new Set(records.map(r=>r.campus))]});
 for(const language of ['en','es']){
  const general=await lookup({mode:'finance',institution:'Western University of Health Sciences',question:'What does nursing cost at Western University of Health Sciences? Reference NUR-0122',language});
  assert.equal(general?.nursingCatalog?.recordId,'NUR-0122');assert.ok(!general.voiceBrief.answer.includes('5,374'));assert.equal(researchBriefSelection(general).findings[0].aspect,'total_budget');
  const conflict=await lookup({mode:'finance',institution:'UC Davis',question:'DNP Family Nurse Practitioner nursing cost NUR-0001',language});
  assert.equal(conflict?.nursingCatalog?.clarification,true);assert.ok(!conflict.voiceBrief.answer.includes('$'));
  const fnp=await lookup({mode:'finance',institution:'UC Davis',question:'FNP nursing budget for year 1 summer start',language});
  assert.equal(fnp?.nursingCatalog?.recordId,'NUR-0003');
  assert.equal(await lookup({mode:'finance',institution:'Cal State Los Angeles',question:'Is the nursing program NUR-0042 accredited and state approved?',language}),null);
  assert.equal(await lookup({mode:'finance',institution:'Cal State Los Angeles',question:'What are the nursing admission prerequisites and entrance exams for NUR-0042?',language}),null);
  const bls=await lookup({mode:'finance',institution:'Cal State Los Angeles',question:'BLS certification cost for nursing reference NUR-0042',language});
  assert.match(bls.voiceBrief.answer,/\$40–\$60/);
  const insurance=await lookup({mode:'finance',institution:'Western University of Health Sciences',question:'Health insurance cost at Western University of Health Sciences NUR-0122',language});
  assert.match(insurance.voiceBrief.answer,/5,374/);
 }
});
