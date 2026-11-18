import test from 'node:test';
import assert from 'node:assert/strict';
import {createNursingLookup} from './lookup.mjs';
import {projectNursingRecord} from './projection.mjs';
import {sourceIsCurrent} from '../../src/researchSourceValidity.mjs';
import {selectResearchReuse} from '../../server/research-reuse.mjs';
const now=Date.parse('2026-11-17T12:00:00Z'),expiry='2026-12-17T00:00:00Z';
function row(id,cohort,period='Academic year'){
 const values={College:'UCLA','Program / degree':'MSN','Academic year':'2026-27','Entering cohort / applies to':cohort,
  'Budget period':period,Residency:'California resident',Housing:'Off campus',Enrollment:'Full time','Cost coverage':'Full COA',
  'Official source URL':'https://www.ucla.edu/nursing','Source checked':'2026-11-15T00:00:00'};
 return {budget_id:id,campus:'UCLA',program:'MSN',academic_year_key:'2026-27',academic_year_raw:'2026-27',
  budget_period:period,residency:values.Residency,housing:values.Housing,enrollment:values.Enrollment,
  source_url:values['Official source URL'],batch_id:'a'.repeat(64),record_digest:'b'.repeat(64),valid_until:expiry,
  publication_id:'published-fixture',caveated_publication:true,payload:{id,values,normalized:{source_verified:false,
   automatic_production_permission:false,published_cents:6000000,caveated_decisions:[]}}};
}
const rows=[row('NUR-0001','Entering'),row('NUR-0002','Continuing'),row('NUR-0003','Year 1 Summer Start','12 months'),row('NUR-0004','Year 1 Fall Start','9 months')];
const query=async(sql,p)=>({rows:sql.includes('production_items')?[]:typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
const lookup=createNursingLookup({query,campuses:['UCLA'],now:()=>now});
for(const language of ['en','es']){
 for(const question of [
  'Am I eligible for nursing scholarships? NUR-0001',
  'How much student loan can I qualify for in nursing? NUR-0001',
  'What is my nursing cost after financial aid? NUR-0001',
  'How much aid can I get for nursing? NUR-0001',
  'What is the nursing scholarship deadline? NUR-0001',
  'Soy elegible para becas de enfermeria? NUR-0001',
  'Cuanto prestamo estudiantil puedo obtener para enfermeria? NUR-0001',
 ])test(`${language}: cost-only records cannot answer ${question}`,async()=>{
  const result=await lookup({mode:'finance',institution:'UCLA',question,language});
  assert.equal(result,null,'funding and eligibility need ordinary research');
 });
 for(const question of ['Nursing tuition before financial aid NUR-0001','Costo de asistencia de enfermeria antes de ayuda financiera NUR-0001'])test(`${language}: a before-aid cost boundary remains a catalog request`,async()=>{
  assert.equal((await lookup({mode:'finance',institution:'UCLA',question,language}))?.nursingCatalog?.recordId,'NUR-0001');
 });
 test(`${language}: catalog price qualifications are distinct from student eligibility`,async()=>{
  const result=await lookup({mode:'finance',institution:'UCLA',question:'Nursing cost qualifications NUR-0001',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0001');
 });
 for(const [id,scope] of [['NUR-0001','continuing student'],['NUR-0002','entering student'],['NUR-0003','fall start'],['NUR-0004','summer start'],['NUR-0001','second year'],['NUR-0001','estudiante que continua'],['NUR-0003','inicio en otono']])test(`${language}: cohort mismatch ${scope} cannot quote ${id}`,async()=>{
  const result=await lookup({mode:'finance',institution:'UCLA',question:`MSN nursing cost ${scope} ${id}`,language});
  assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!result.voiceBrief.answer.includes('$'));
 });
 test(`${language}: matching year and start term use the recorded cohort, not the budget duration`,async()=>{
  const result=await lookup({mode:'finance',institution:'UCLA',question:'MSN nursing cost first year summer start NUR-0003',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0003');
 });
 test(`${language}: a natural continuing-student request selects the continuing cohort`,async()=>{
  const result=await lookup({mode:'finance',institution:'UCLA',question:'MSN nursing costs for a continuing student',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0002');
 });
 test(`${language}: negating a new-student cohort cannot select its entering budget`,async()=>{
  const conflict=await lookup({mode:'finance',institution:'UCLA',question:'Nursing cost I am not a new student NUR-0001',language});
  assert.equal(conflict?.nursingCatalog?.clarification,true);
  const matching=await lookup({mode:'finance',institution:'UCLA',question:'Nursing cost I am not a new student NUR-0002',language});
  assert.equal(matching?.nursingCatalog?.recordId,'NUR-0002');
 });
 test(`${language}: negating a start term cannot select that term`,async()=>{
  const result=await lookup({mode:'finance',institution:'UCLA',question:'Nursing cost not a summer start NUR-0003',language});
  assert.equal(result?.nursingCatalog?.clarification,true);
 });
 test(`${language}: negating a program year cannot select that year`,async()=>{
  const result=await lookup({mode:'finance',institution:'UCLA',question:'Nursing cost not in my first year NUR-0003',language});
  assert.equal(result?.nursingCatalog?.clarification,true);
 });
 test(`${language}: current publication sources remain reusable as partial reference without refreshing their source date`,()=>{
  const record=rows[0],question='UCLA nursing cost of attendance 2026-27 NUR-0001';
  const result=projectNursingRecord(record,[],language,question,{now});
  const source=result.sources[0];
  assert.ok(sourceIsCurrent(source,now));assert.equal(source.checkedAt,'2026-11-15T00:00:00.000Z');
  assert.equal(source.catalogValidity.reviewBasis,'workbook_reported');assert.equal(Date.parse(source.catalogValidity.validUntil),Date.parse(expiry));
  assert.equal(result.nursingCatalog.sourceVerified,false);assert.equal(result.voiceBrief.status,'partial');
  const input={mode:'finance',institution:'UCLA',question,language};
  const reuse=selectResearchReuse(input,[{input,status:'completed',finished_at:new Date(now).toISOString(),result}],{now});
  assert.equal(reuse.reusedEvidence?.length,1);assert.equal(reuse.reusedEvidence[0].coverage,'reference');
  assert.equal(reuse.reusedEvidence[0].findings[0].status,'partial');
  assert.equal(sourceIsCurrent(source,Date.parse(expiry)),false);
  assert.equal(sourceIsCurrent({...source,url:'https://other.edu'},now),false);
 });
 test(`${language}: expired publications cannot produce a nursing price`,()=>{
  assert.equal(projectNursingRecord(rows[0],[],language,'Nursing cost',{now:Date.parse(expiry)}),null);
 });
 test(`${language}: generic student wording cannot select a new-student fee`,()=>{
  const document={id:'NUR-0001-001',values:{'Original source label':'New-student document charge',Category:'Document fee','Amount period':'Academic year','Relationship to total':'Included component'},
   normalized:{source_scalar_cents:8000,value_representation:'Recorded scalar amount',caveated_decisions:[],source_url:rows[0].source_url}};
  const result=projectNursingRecord(rows[0],[document],language,'Nursing costs for an entering student',{now});
  assert.ok(!result.voiceBrief.answer.includes('$80'));assert.match(result.voiceBrief.answer,/60,000/);
 });
 test(`${language}: an explicit student ID fee still resolves despite generic-word filtering`,()=>{
  const item={id:'NUR-0001-002',values:{'Original source label':'Student ID',Category:'Document fee','Amount period':'Program','Relationship to total':'Included component'},
   normalized:{source_scalar_cents:2500,value_representation:'Recorded scalar amount',caveated_decisions:[],source_url:rows[0].source_url}};
  const result=projectNursingRecord(rows[0],[item],language,'Student ID cost for nursing',{now});
  assert.match(result.voiceBrief.answer,/Student ID: \$25/);
 });
 test(`${language}: a bare pending record cannot mint reusable publication evidence`,()=>{
  const record={...rows[0],caveated_publication:false,payload:{...rows[0].payload,values:{...rows[0].payload.values,'Source checked':new Date(now).toISOString()}}};
  const result=projectNursingRecord(record,[],language,'Nursing cost',{now});
  assert.equal(sourceIsCurrent(result.sources[0],now),false);
 });
}
