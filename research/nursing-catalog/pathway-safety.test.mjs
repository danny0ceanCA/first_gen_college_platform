import test from 'node:test';
import assert from 'node:assert/strict';
import {createNursingLookup} from './lookup.mjs';
import {readExport} from './postgres.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';
function row(id,site,program='BSN',amount=16792800){
 const values={College:'Example College','Program / degree':program,'Institution / location note':site,'Academic year':'2026-27','Budget period':'Entire program','Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'};
 return {budget_id:id,batch_id:'fixture',campus:values.College,program,academic_year_raw:'2026-27',academic_year_key:'2026-27',budget_period:'Entire program',source_url:values['Official source URL'],payload:{id,values,normalized:{source_verified:false,automatic_production_permission:false,published_cents:amount,caveated_decisions:[]}}};
}
const rows=[row('NUR-0001','Los Angeles'),row('NUR-0002','Orange County'),row('NUR-0003','Sacramento','BSN online completer',1584000),row('NUR-0004','Sacramento','Pre-licensure BSN',6000000),row('NUR-0005','Irvine; Los Angeles','Traditional BSN',6000000)];
const query=async(sql,p)=>({rows:sql.includes('production_items')?[]:typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
const lookup=createNursingLookup({query,campuses:['Example College']});
async function noPrice(question,language){
 const result=await lookup({mode:'finance',institution:'Example College',question,language});
 assert.equal(result?.nursingCatalog?.clarification,true,question);assert.ok(!researchBriefSelection(result).text.includes('$'));
}
for(const language of ['en','es']){
 for(const question of ['Nursing NUR-0001, not at Los Angeles','Nursing NUR-0001 in Orange County, not Los Angeles','Nursing NUR-0001 at Orange County and Los Angeles','Enfermeria NUR-0001, no en Los Angeles'])test(`${language}: excluded or competing sites cannot select one site's price: ${question}`,()=>noPrice(question,language));
 test(`${language}: a positive site correction selects the applicable row`,async()=>{
  const result=await lookup({mode:'finance',institution:'Example College',question:'Nursing NUR-0002 at Orange County, not Los Angeles',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0002');
 });
 test(`${language}: a shared-site reference can still cover the requested positive site`,async()=>{
  const result=await lookup({mode:'finance',institution:'Example College',question:'Nursing NUR-0005 at Irvine, not Los Angeles',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0005');
 });
 for(const question of ['Prelicensure BSN nursing cost NUR-0003','First nursing degree BSN cost NUR-0003','RN-to-BSN cost NUR-0004','Post-licensure BSN nursing cost NUR-0004'])test(`${language}: entry and completion routes cannot substitute: ${question}`,()=>noPrice(question,language));
 for(const [question,id] of [['RN-to-BSN nursing cost NUR-0003','NUR-0003'],['Prelicensure BSN nursing cost NUR-0004','NUR-0004'],['Traditional BSN cost NUR-0005','NUR-0005']])test(`${language}: the recorded route remains available: ${question}`,async()=>{
  const result=await lookup({mode:'finance',institution:'Example College',question,language});
  assert.equal(result?.nursingCatalog?.recordId,id);assert.match(result.voiceBrief.qualification,/pending|pendiente/i);
 });
 for(const question of ['How long is the nursing program NUR-0001?','How much longer is the nursing program NUR-0001?','Is the nursing program NUR-0001 online?','What is the nursing graduation rate for NUR-0001?','What does nursing NUR-0001 cost and how long is the program?','What does nursing NUR-0001 cost and how many clinical hours are required?','What does nursing NUR-0001 cost and is the program online?','Cuantas horas tiene el programa de enfermeria NUR-0001?','Cuanto dura el programa de enfermeria NUR-0001?','El programa de enfermeria NUR-0001 es en linea?'])test(`${language}: program facts continue to research: ${question}`,async()=>{
  assert.equal(await lookup({mode:'finance',institution:'Example College',question,language}),null);
 });
 test(`${language}: price-only online-program requests stay in the catalog`,async()=>{
  const result=await lookup({mode:'finance',institution:'Example College',question:'What does the online BSN completer NUR-0003 cost?',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0003');
 });
 test(`${language}: reference inspection and price questions remain available`,async()=>{
  for(const question of ['Nursing reference NUR-0001','Show the caveats for nursing NUR-0001','What does nursing NUR-0001 cost?','How long does this nursing budget cover? NUR-0001']){
   const result=await lookup({mode:'finance',institution:'Example College',question,language});assert.equal(result?.nursingCatalog?.recordId,'NUR-0001');
  }
 });
}
test('published records enforce site exclusions, entry route and question intent',{skip:!process.env.ORIGEN_NURSING_BATCH},async()=>{
 const batch=await readExport(process.env.ORIGEN_NURSING_BATCH),groups=new Map();
 for(const i of batch.items){const list=groups.get(i.budget_id)||[];list.push({payload:i});groups.set(i.budget_id,list);}
 const records=batch.budgets.map(r=>({batch_id:batch.id,budget_id:r.id,campus:r.values.College,program:r.values['Program / degree'],academic_year_raw:r.values['Academic year'],academic_year_key:r.normalized.academic_year,budget_period:r.values['Budget period'],residency:r.values.Residency,housing:r.values.Housing,enrollment:r.values.Enrollment,source_url:r.values['Official source URL'],payload:r}));
 const query=async(sql,p)=>({rows:sql.includes('production_items')?groups.get(p[1])||[]:typeof p[0]==='string'?records.filter(r=>r.budget_id===p[0]):records.filter(r=>p[0].includes(r.campus))});
 const lookup=createNursingLookup({query,campuses:[...new Set(records.map(r=>r.campus))]});
 for(const language of ['en','es']){
  for(const [institution,question] of [['West Coast University','Nursing NUR-0069, not at Los Angeles'],['Carrington College','Prelicensure BSN nursing cost NUR-0075']]){
   const result=await lookup({mode:'finance',institution,question,language});assert.equal(result?.nursingCatalog?.clarification,true);assert.ok(!researchBriefSelection(result).text.includes('$'));
  }
  assert.equal(await lookup({mode:'finance',institution:'UC Davis',question:'How long is the DNP nursing program NUR-0001?',language}),null);
  const completion=await lookup({mode:'finance',institution:'Carrington College',question:'RN-to-BSN nursing cost NUR-0075',language});
  assert.equal(completion?.nursingCatalog?.recordId,'NUR-0075');assert.match(completion.voiceBrief.answer,/15,840/);
 }
});
