import test from 'node:test';
import assert from 'node:assert/strict';
import {createNursingLookup} from './lookup.mjs';
import {projectNursingRecord} from './projection.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';

function row(id,campus,site,program,year,residency,housing){
 const values={College:campus,'Institution / location note':site,'Program / degree':program,'Academic year':year,
  'Budget period':'Academic year',Residency:residency,Housing:housing,Enrollment:'Full time',
  'Cost coverage':'Partial direct costs','Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'};
 return {budget_id:id,campus,program,academic_year_key:year,academic_year_raw:year,residency,housing,enrollment:values.Enrollment,
  budget_period:values['Budget period'],source_url:values['Official source URL'],batch_id:'fixture',
  payload:{id,values,normalized:{source_verified:false,automatic_production_permission:false,published_cents:4651500,caveated_decisions:[]}}};
}
const rows=[row('NUR-0001','Example College','North Campus','ADN','2026-27','California resident','On campus'),
 row('NUR-0002','Example College','South Campus','BSN','2027-28','Nonresident','Off campus'),
 row('NUR-0003','Other College','Main Campus','ABSN','2026-27','California resident','On campus')];
const query=async(sql,p)=>({rows:sql.includes('production_items')?[]:sql.includes('budget_id=ANY')?rows.filter(r=>p[0].includes(r.budget_id)):typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
const lookup=createNursingLookup({query,campuses:[...new Set(rows.map(r=>r.campus))]});
const conflicts=[
 ['institution','Other College','Nursing reference NUR-0001'],
 ['year','Example College','Nursing reference NUR-0001 for 2027-28'],
 ['single year','Example College','Nursing reference NUR-0001 for 2030'],
 ['residency','Example College','Nursing reference NUR-0001 for a nonresident'],
 ['housing','Example College','Nursing reference NUR-0001 off campus'],
 ['program','Example College','BSN nursing reference NUR-0001'],
 ['site','Example College','Nursing reference NUR-0001 at South Campus'],
 ['enrollment','Example College','Part time nursing reference NUR-0001'],
 ['multiple references','Example College','Compare nursing NUR-0001 and NUR-0002'],
];
for(const language of ['en','es'])for(const [name,institution,question] of conflicts)test(`${language}: a reference cannot bypass conflicting ${name}`,async()=>{
 const result=await lookup({mode:'finance',institution,question,language});
 assert.ok(result?.nursingCatalog?.clarification,'the conflict needs clarification');
 const brief=researchBriefSelection(result);
 assert.ok(!brief.text.includes('$'),'no conflicting price is supplied');
 assert.equal(brief.findings[0].status,'partial');assert.match(brief.findings[0].qualification,/pending|pendiente/i);
});
test('a matching explicit reference still supplies the requested record',async()=>{
 const result=await lookup({mode:'finance',institution:'Example College',question:'ADN nursing NUR-0001 for a California resident on campus in 2026-27',language:'en'});
 assert.equal(result?.nursingCatalog?.recordId,'NUR-0001');
});

function item(id,label,amount){return {id,values:{'Original source label':label,Category:label,'Amount period':'Program','Relationship to total':'Included component'},
 normalized:{value_representation:'Recorded scalar amount',source_scalar_cents:amount,caveated_decisions:[],source_url:'https://example.edu/nursing'}};}
const components=[item('NUR-0001-001','Tuition',4000000),item('NUR-0001-002','Textbooks',120000),item('NUR-0001-003','Equipment',50000),item('NUR-0001-004','Application fee',5000)];
for(const language of ['en','es']){
 test(`${language}: total including textbooks cannot select the textbook price as the total`,()=>{
  const result=projectNursingRecord(rows[0],components,language,'What is the total nursing program cost including textbooks?');
  const brief=researchBriefSelection(result);
  assert.equal(brief.findings[0].aspect,'total_budget');assert.match(brief.text,/46,515/);assert.ok(!result.voiceBrief.answer.includes('Textbooks: $1,200'));
 });
 test(`${language}: tuition plus equipment cannot silently answer tuition alone`,()=>{
  const result=projectNursingRecord(rows[0],components,language,'Nursing tuition and equipment costs');
  assert.match(result.voiceBrief.answer,/combined subtotal|subtotal combinado/i);assert.ok(!result.voiceBrief.answer.includes('$40,000'));
 });
 test(`${language}: a focused textbook answer is not labeled as a full program budget`,()=>{
  const result=projectNursingRecord(rows[0],components,language,'Textbooks cost for nursing');
  assert.match(result.voiceBrief.answer,/1,200/);assert.equal(researchBriefSelection(result).findings[0].aspect,'other');
 });
 test(`${language}: total tuition remains a tuition request`,()=>{
  const result=projectNursingRecord(rows[0],components,language,'What is total tuition for nursing?');
  assert.match(result.voiceBrief.answer,/40,000/);assert.ok(!result.voiceBrief.answer.includes('46,515'));
  assert.equal(researchBriefSelection(result).findings[0].aspect,'tuition_fees');
 });
 test(`${language}: a named application fee cannot select tuition`,()=>{
  const result=projectNursingRecord(rows[0],components,language,'Application fee for nursing');
  assert.match(result.voiceBrief.answer,/Application fee: \$50/);assert.ok(!result.voiceBrief.answer.includes('40,000'));
 });
 test(`${language}: an explicit cost-item reference resolves the item rather than the whole budget`,()=>{
  const result=projectNursingRecord(rows[0],components,language,'Nursing cost item NUR-0001-002');
  assert.match(result.voiceBrief.answer,/1,200/);assert.ok(!result.voiceBrief.answer.includes('46,515'));
 });
 test(`${language}: an unknown cost-item reference cannot substitute the whole budget`,()=>{
  const result=projectNursingRecord(rows[0],components,language,'Nursing cost item NUR-0001-999');
  assert.match(result.voiceBrief.answer,/not found|no se encontr/i);assert.ok(!result.voiceBrief.answer.includes('$'));
 });
}
