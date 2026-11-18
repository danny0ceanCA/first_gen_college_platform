import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNursingRecord} from './projection.mjs';
import {createNursingLookup} from './lookup.mjs';
import {createProductionCatalogProvider} from './production-provider.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';
const now=Date.parse('2026-11-17T12:00:00Z');
function row(id,campus='Example College',residency='California resident'){
 const values={College:campus,'Program / degree':'MSN','Academic year':'2026-27','Entering cohort / applies to':'Entering','Budget period':'Academic year',
  Residency:residency,Housing:'Off campus',Enrollment:'Full time','Cost coverage':'Full COA','Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'};
 return {budget_id:id,campus,program:'MSN',academic_year_key:'2026-27',academic_year_raw:'2026-27',budget_period:'Academic year',residency,housing:'Off campus',enrollment:'Full time',source_url:values['Official source URL'],batch_id:'a'.repeat(64),
  payload:{id,values,normalized:{source_verified:false,automatic_production_permission:false,published_cents:10080800,caveated_decisions:[]}}};
}
const resident=row('NUR-0001'),nonresident=row('NUR-0002','Example College','Nonresident');
const books={id:'NUR-0001-001',values:{'Original source label':'Books and Supplies',Category:'Books','Amount period':'Academic year','Relationship to total':'Included component'},
 normalized:{value_representation:'Recorded scalar amount',source_scalar_cents:215000,caveated_decisions:[],source_url:resident.source_url}};
const tuition={...books,id:'NUR-0001-002',values:{...books.values,'Original source label':'Tuition',Category:'Tuition'},normalized:{...books.normalized,source_scalar_cents:4000000}};
for(const language of ['en','es']){
 for(const question of ['Cuanto cuestan los libros de enfermeria?','What do nursing books cost?','What is the total cost of textbooks?'])test(`${language}: ${question} returns the source book amount`,()=>{
  const result=projectNursingRecord(resident,[books,tuition],language,question,{now});
  assert.match(result.voiceBrief.answer,/2,150/);assert.ok(!result.voiceBrief.answer.includes('100,808'));
  assert.equal(researchBriefSelection(result).findings[0].aspect,'other');
 });
 test(`${language}: a missing requested books component cannot quote the full budget`,()=>{
  const result=projectNursingRecord(resident,[tuition],language,'Cuanto cuestan los libros de enfermeria?',{now});
  assert.match(result.voiceBrief.answer,/not found|no se encontr/i);assert.ok(!result.voiceBrief.answer.includes('$'));
 });
 test(`${language}: excluding books preserves a tuition-only request`,()=>{
  const result=projectNursingRecord(resident,[books,tuition],language,'Matricula de enfermeria sin incluir los libros',{now});
  assert.match(result.voiceBrief.answer,/40,000/);assert.ok(!result.voiceBrief.answer.includes('2,150'));
 });
 test(`${language}: overall program cost including books remains a full-budget request`,()=>{
  const result=projectNursingRecord(resident,[books,tuition],language,'Total nursing program cost including books',{now});
  assert.match(result.voiceBrief.answer,/100,808/);assert.equal(researchBriefSelection(result).findings[0].aspect,'total_budget');
 });
 test(`${language}: an appended housing scenario does not invent a housing-only request`,()=>{
  const result=projectNursingRecord(resident,[books,tuition],language,'What does nursing cost? Housing scenario: renting off campus.',{now});
  assert.match(result.voiceBrief.answer,/100,808/);
 });
 test(`${language}: an overall total retains its scope when a component cost is mentioned`,()=>{
  const result=projectNursingRecord(resident,[books,tuition],language,'Total nursing program cost including the books cost',{now});
  assert.match(result.voiceBrief.answer,/100,808/);
 });
}
const rows=[resident,nonresident];
const supplement={...books,id:'NUR-0002-001',values:{...books.values,'Original source label':'Nonresident supplemental tuition',Category:'Nonresident supplemental tuition'},normalized:{...books.normalized,source_scalar_cents:1224500}};
const query=async(sql,p)=>({rows:sql.includes('production_items')?[{payload:supplement}]:typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
const lookup=createNursingLookup({query,campuses:['Example College'],now:()=>now});
for(const question of ['I am not a California resident','I am not a resident of California','No soy residente de California','I am a nonresident'])test(`${question} cannot select the resident budget or a scope-named fee`,async()=>{
 const result=await lookup({mode:'finance',institution:'Example College',question:'MSN nursing costs for an entering student off campus. '+question,language:'en'});
 assert.equal(result?.nursingCatalog?.recordId,'NUR-0002');assert.ok(!result.voiceBrief.answer.includes('Nonresident supplemental tuition'));
});
test('a conflicting reference and negated residency requires clarification',async()=>{
 const result=await lookup({mode:'finance',institution:'Example College',question:'Nursing NUR-0001; I am not a California resident',language:'en'});
 assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!result.voiceBrief.answer.includes('$'));
});
for(const question of ['I am a California resident and a nonresident','I am not a nonresident'])test(`ambiguous residency requires clarification: ${question}`,async()=>{
 const result=await lookup({mode:'finance',institution:'Example College',question:'Nursing costs. '+question,language:'en'});
 assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!result.voiceBrief.answer.includes('$'));
});

test('a running provider discovers campuses published after startup and coalesces concurrent reads',async()=>{
 let published=false,discovery=0,ended=0;
 const incoming=row('NUR-9999','New Nursing College');
 class Pool{
  async query(sql,p){
   if(sql.includes('current_user'))return {rows:[{role:'origen_research_worker',readonly:'on'}]};
   if(sql.includes('coa_catalog.production_published LIMIT'))return {rows:[{available:1}]};
   if(sql.includes('DISTINCT campus')){discovery++;return {rows:(published?['Example College',incoming.campus]:['Example College']).map(campus=>({campus}))};}
   if(sql.includes('production_items'))return {rows:[]};
   if(sql.includes('production_budgets WHERE'))return {rows:published&&(typeof p[0]==='string'?p[0]===incoming.budget_id:p[0].includes(incoming.campus))?[incoming]:[]};
   throw Error('unexpected_query');
  }
  async end(){ended++;}
 }
 const provider=await createProductionCatalogProvider({ORIGEN_COST_CATALOG:'true',RESEARCH_WORKER_DATABASE_URL:'postgresql://fixture.invalid/catalog'},{Pool,now:()=>now});
 try{
  assert.equal(discovery,1);published=true;
  const input={mode:'finance',institution:incoming.campus,question:'What does nursing cost?',language:'en'};
  const results=await Promise.all([provider.lookup(input),provider.lookup(input)]);
  assert.ok(results.every(r=>r?.nursingCatalog?.recordId==='NUR-9999'));
  assert.equal(discovery,2,'concurrent lookups share one fresh discovery');
 }finally{await provider.close();}
 assert.equal(ended,1);
});
