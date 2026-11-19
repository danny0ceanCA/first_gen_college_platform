import test from 'node:test';
import assert from 'node:assert/strict';
import {createNursingLookup} from './lookup.mjs';
import {projectNursingRecord} from './projection.mjs';
import {readExport} from './postgres.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';
function row(id,campus='UC Davis',year='2026-27'){
 const values={College:campus,'Program / degree':'Nursing','Academic year':year,'Budget period':'Program',Residency:'Not differentiated',Housing:'Not differentiated','Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'};
 return {budget_id:id,batch_id:'fixture',campus,program:'Nursing',academic_year_raw:year,academic_year_key:year,budget_period:'Program',source_url:values['Official source URL'],payload:{id,values,normalized:{source_verified:false,automatic_production_permission:false,published_cents:10080800,caveated_decisions:[]}}};
}
const rows=[row('NUR-0001'),row('NUR-0002','UCLA'),row('NUR-0003','Other College'),row('NUR-0004','UC Davis','2027-28')];
const books={id:'NUR-0001-002',values:{'Original source label':'Books and Supplies',Category:'Books','Amount period':'Program','Relationship to total':'Included component'},normalized:{value_representation:'Recorded scalar amount',source_scalar_cents:215000,source_url:rows[0].source_url,caveated_decisions:[]}};
const equipment={...books,id:'NUR-0001-003',values:{...books.values,'Original source label':'Equipment',Category:'Equipment'},normalized:{...books.normalized,source_scalar_cents:100000}};
const query=async(sql,p)=>({rows:sql.includes('production_items')?[{payload:books},{payload:equipment}]:typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
const lookup=createNursingLookup({query,campuses:[...new Set(rows.map(r=>r.campus))]});
for(const language of ['en','es']){
 for(const question of ['What is the total cost of nursing item NUR-0001-002?','Total de la partida de enfermeria NUR-0001-002'])test(`${language}: a total for an explicit item cannot become the whole budget`,async()=>{
  const result=await lookup({mode:'finance',institution:'UC Davis',question,language});
  assert.match(result.voiceBrief.answer,/2,150/);assert.ok(!result.voiceBrief.answer.includes('100,808'));
  assert.equal(researchBriefSelection(result).findings[0].aspect,'other');
 });
 test(`${language}: totals for several items do not substitute a budget or invented sum`,()=>{
  const result=projectNursingRecord(rows[0],[books,equipment],language,'Total cost of items NUR-0001-002 and NUR-0001-003');
  assert.match(result.voiceBrief.answer,/combined subtotal|subtotal combinado/i);assert.ok(!result.voiceBrief.answer.includes('$'));
 });
 test(`${language}: an unknown item total cannot substitute a budget`,()=>{
  const result=projectNursingRecord(rows[0],[books],language,'Total cost of item NUR-0001-999');
  assert.match(result.voiceBrief.answer,/not found|no se encontr/i);assert.ok(!result.voiceBrief.answer.includes('$'));
 });
 test(`${language}: an explicit overall total can include an item reference`,()=>{
  const result=projectNursingRecord(rows[0],[books],language,'Overall nursing program budget including item NUR-0001-002');
  assert.match(result.voiceBrief.answer,/100,808/);assert.equal(researchBriefSelection(result).findings[0].aspect,'total_budget');
 });
 for(const year of ['2027/28','2027 / 2028','2027—28','2027 - 28','2027 – 2028'])test(`${language}: conflicting academic year ${year} cannot bypass a reference`,async()=>{
  const result=await lookup({mode:'finance',institution:'UC Davis',question:`Nursing NUR-0001 for ${year}`,language});
  assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!result.voiceBrief.answer.includes('$'));
 });
 test(`${language}: a matching slash year selects the matching academic-year record`,async()=>{
  const result=await lookup({mode:'finance',institution:'UC Davis',question:'Nursing budget for 2027/28',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0004');
 });
 test(`${language}: a source-check calendar date is not an academic-year range`,async()=>{
  const result=await lookup({mode:'finance',institution:'UC Davis',question:'Nursing NUR-0001, source checked 2026-11-15',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0001');
 });
 for(const [institution,question] of [['UC Davis','What is the nursing cost at UCLA? NUR-0001'],[undefined,'Nursing at University of California Los Angeles NUR-0001'],['UC Davis','Nursing at Other College NUR-0001'],['UC Davis','Compare nursing at UC Davis and UCLA NUR-0001']])test(`${language}: an institution in the question cannot be ignored: ${question}`,async()=>{
  const result=await lookup({mode:'finance',institution,question,language});
  assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!researchBriefSelection(result).text.includes('$'));
 });
 test(`${language}: a stale selected institution without a reference continues to research`,async()=>{
  assert.equal(await lookup({mode:'finance',institution:'UC Davis',question:'Nursing cost at UCLA',language}),null);
 });
 test(`${language}: a matching institution alias in the question still resolves`,async()=>{
  const result=await lookup({mode:'finance',institution:'UC Davis',question:'Nursing at University of California at Davis NUR-0001',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0001');
 });
 test(`${language}: a negated other institution does not override a matching reference`,async()=>{
  const result=await lookup({mode:'finance',institution:'UC Davis',question:'Nursing at UC Davis, not UCLA, NUR-0001',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0001');
 });
 test(`${language}: negating the reference institution prevents its price`,async()=>{
  const result=await lookup({mode:'finance',question:'Nursing NUR-0001, not at UC Davis',language});
  assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!result.voiceBrief.answer.includes('$'));
 });
}
test('published references enforce item totals, academic-year syntax and question institutions',{skip:!process.env.ORIGEN_NURSING_BATCH},async()=>{
 const batch=await readExport(process.env.ORIGEN_NURSING_BATCH),groups=new Map();
 for(const i of batch.items){const list=groups.get(i.budget_id)||[];list.push({payload:i});groups.set(i.budget_id,list);}
 const records=batch.budgets.map(r=>({batch_id:batch.id,budget_id:r.id,campus:r.values.College,program:r.values['Program / degree'],academic_year_raw:r.values['Academic year'],academic_year_key:r.normalized.academic_year,budget_period:r.values['Budget period'],residency:r.values.Residency,housing:r.values.Housing,enrollment:r.values.Enrollment,source_url:r.values['Official source URL'],payload:r}));
 const query=async(sql,p)=>({rows:sql.includes('production_items')?groups.get(p[1])||[]:typeof p[0]==='string'?records.filter(r=>r.budget_id===p[0]):records.filter(r=>p[0].includes(r.campus))});
 const lookup=createNursingLookup({query,campuses:[...new Set(records.map(r=>r.campus))]});
 for(const language of ['en','es']){
  const item=await lookup({mode:'finance',institution:'UC Davis',question:'Total cost of nursing item NUR-0001-002',language});
  assert.match(item.voiceBrief.answer,/2,150/);assert.ok(!item.voiceBrief.answer.includes('100,808'));
  for(const question of ['Nursing NUR-0001 for 2027/28','Nursing at UCLA NUR-0001']){
   const result=await lookup({mode:'finance',institution:'UC Davis',question,language});
   assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!result.voiceBrief.answer.includes('$'));
  }
  const site=await lookup({mode:'finance',institution:'Concorde Career College',question:'Nursing at Concorde Career College in San Diego NUR-0781',language});
  assert.equal(site?.nursingCatalog?.recordId,'NUR-0781','a site city is not a different university');
  const twoYear=await lookup({mode:'finance',institution:'Tulare Adult School',question:'Nursing reference NUR-0892 for 2026/28',language});
  assert.equal(twoYear?.nursingCatalog?.recordId,'NUR-0892','a two-year source header is not collapsed to one academic year');
 }
});
