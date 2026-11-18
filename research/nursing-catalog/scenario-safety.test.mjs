import test from 'node:test';
import assert from 'node:assert/strict';
import {createNursingLookup} from './lookup.mjs';
import {readExport} from './postgres.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';

function row(id,{housing='With parents',cohort='6 units only',period='Academic year',amount=3773800}={}){
 const values={College:'Example College','Program / degree':'Nursing','Academic year':'2026-27',
  'Entering cohort / applies to':cohort,'Budget period':period,Residency:'California resident',Housing:housing,
  Enrollment:'See source and scope','Cost coverage':'Partial direct costs','Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'};
 return {budget_id:id,batch_id:'fixture',campus:values.College,program:values['Program / degree'],academic_year_raw:'2026-27',academic_year_key:'2026-27',
  housing,residency:values.Residency,budget_period:period,enrollment:values.Enrollment,source_url:values['Official source URL'],
  payload:{id,values,normalized:{source_verified:false,automatic_production_permission:false,published_cents:amount,caveated_decisions:[]}}};
}
function lookupFor(rows){
 const query=async(sql,p)=>({rows:sql.includes('production_items')?[]:typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
 return createNursingLookup({query,campuses:[...new Set(rows.map(r=>r.campus))]});
}
async function mustClarify(lookup,question,language){
 const result=await lookup({mode:'finance',institution:'Example College',question,language});
 assert.equal(result?.nursingCatalog?.clarification,true,question);
 assert.ok(!researchBriefSelection(result).text.includes('$'),question);
 assert.match(result.voiceBrief.qualification,/pending|pendiente/i);
}

for(const language of ['en','es']){
 const housing=lookupFor([row('NUR-0001',{housing:'With parents'}),row('NUR-0002',{housing:'away from parents'}),row('NUR-0003',{housing:'Not living with parents'}),row('NUR-0004',{housing:'On campus'}),row('NUR-0005',{housing:'Off campus'})]);
 for(const [id,scope] of [['NUR-0002','I live with parents'],['NUR-0003','Vivo con mis padres'],['NUR-0001','I do not live with parents'],['NUR-0001',"I don't live with parents"],['NUR-0004','I am not living on campus'],['NUR-0005','No vivo fuera del campus']]){
  test(`${language}: housing conflict ${id}: ${scope}`,()=>mustClarify(housing,`Nursing reference ${id}. ${scope}`,language));
 }
 test(`${language}: a negated housing category does not assume an unsupported alternative`,()=>mustClarify(housing,'Nursing NUR-0002. I am not living on campus',language));
 test(`${language}: contradictory housing needs clarification`,()=>mustClarify(housing,'Nursing NUR-0001. I live with parents and rent off campus',language));
 test(`${language}: matching housing still resolves`,async()=>{
  for(const [id,scope] of [['NUR-0001','I live with parents'],['NUR-0002','I do not live with parents'],['NUR-0003','No vivo con mis padres'],['NUR-0004','I live on campus'],['NUR-0005','I am not living on campus; I rent off campus']]){
   const result=await housing({mode:'finance',institution:'Example College',question:`Nursing ${id}. ${scope}`,language});
   assert.equal(result?.nursingCatalog?.recordId,id,scope);
  }
 });
 const units=lookupFor([row('NUR-0011',{cohort:'6 units only'}),row('NUR-0012',{cohort:'Less than 6 units',amount:2165600}),row('NUR-0013',{cohort:'7 units or more'})]);
 for(const scope of ['3 units per semester','3 unidades por semestre','7 units per semester'])test(`${language}: six-unit price cannot satisfy ${scope}`,()=>mustClarify(units,`Nursing NUR-0011 for ${scope}`,language));
 test(`${language}: exact credit load selects the applicable source band`,async()=>{
  const result=await units({mode:'finance',institution:'Example College',question:'Nursing budget for 3 units per semester',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0012');assert.match(result.voiceBrief.answer,/21,656/);
 });
 test(`${language}: a matching exact six-unit load still resolves`,async()=>{
  const result=await units({mode:'finance',institution:'Example College',question:'Nursing NUR-0011 for 6 units per semester',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0011');
 });
 for(const scope of ['not 6 units','not 6.1 units','3 or 6 units'])test(`${language}: an ambiguous credit load does not choose a price: ${scope}`,()=>mustClarify(units,`Nursing NUR-0011, ${scope}`,language));
 const bands=lookupFor([row('NUR-0014',{cohort:'0–6units'}),row('NUR-0015',{cohort:'6.1+units'}),row('NUR-0016',{cohort:'21units',period:'Entire program'})]);
 test(`${language}: credit-band boundaries preserve exact and decimal loads`,async()=>{
  for(const [id,load] of [['NUR-0014',6],['NUR-0015',6.1]]){
   const result=await bands({mode:'finance',institution:'Example College',question:`Nursing ${id} for ${load} units per semester`,language});
   assert.equal(result?.nursingCatalog?.recordId,id);
  }
  await mustClarify(bands,'Nursing NUR-0014 for 6.1 units per semester',language);
  await mustClarify(bands,'Nursing NUR-0015 for 6 units per semester',language);
 });
 test(`${language}: a curriculum unit total is not a per-semester enrollment band`,()=>mustClarify(bands,'Nursing NUR-0016 for 21 units per semester',language));
 const periods=lookupFor([row('NUR-0021',{cohort:'Not specified',period:'Program year1',amount:500000}),row('NUR-0022',{cohort:'Not specified',period:'Program phase',amount:594000}),row('NUR-0023',{cohort:'Not specified',period:'Entire program',amount:750000})]);
 for(const [id,scope] of [['NUR-0021','entire program'],['NUR-0022','whole program'],['NUR-0021','programa completo']])test(`${language}: ${scope} cannot use ${id}`,()=>mustClarify(periods,`Nursing ${id}: ${scope} cost`,language));
 test(`${language}: an entire-program request selects a whole-program reference`,async()=>{
  const result=await periods({mode:'finance',institution:'Example College',question:'Entire nursing program cost',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0023');assert.match(result.voiceBrief.answer,/7,500/);
 });
 test(`${language}: excluding a whole-program quote still allows a matching first-year reference`,async()=>{
  const result=await periods({mode:'finance',institution:'Example College',question:'Nursing NUR-0021 for year 1, not the entire program',language});
  assert.equal(result?.nursingCatalog?.recordId,'NUR-0021');
 });
}

test('published nursing records enforce housing, load and whole-program scope',{skip:!process.env.ORIGEN_NURSING_BATCH},async()=>{
 const batch=await readExport(process.env.ORIGEN_NURSING_BATCH);
 const rows=batch.budgets.map(r=>({batch_id:batch.id,budget_id:r.id,campus:r.values.College,program:r.values['Program / degree'],academic_year_raw:r.values['Academic year'],academic_year_key:r.normalized.academic_year,
  budget_period:r.values['Budget period'],housing:r.values.Housing,residency:r.values.Residency,enrollment:r.values.Enrollment,source_url:r.values['Official source URL'],payload:r}));
 const groups=new Map();for(const i of batch.items){const group=groups.get(i.budget_id)||[];group.push({payload:i});groups.set(i.budget_id,group);}
 const query=async(sql,p)=>({rows:sql.includes('production_items')?groups.get(p[1])||[]:typeof p[0]==='string'?rows.filter(r=>r.budget_id===p[0]):rows.filter(r=>p[0].includes(r.campus))});
 const lookup=createNursingLookup({query,campuses:[...new Set(rows.map(r=>r.campus))]});
 const cases=[
  ['Saddleback College','Nursing reference NUR-0144. I live with parents.'],
  ['California State University, Fresno','Nursing reference NUR-0318 for 3 units per semester.'],
  ['College of San Mateo','Entire nursing program cost NUR-0540'],
 ];
 for(const language of ['en','es'])for(const [institution,question] of cases){
  const result=await lookup({mode:'finance',institution,question,language});
  assert.equal(result?.nursingCatalog?.clarification,true,question);assert.ok(!researchBriefSelection(result).text.includes('$'));
 }
 const household=await lookup({mode:'finance',institution:'Saddleback College',question:'Nursing reference NUR-0142. I live with parents.',language:'en'});
 assert.equal(household?.nursingCatalog?.recordId,'NUR-0142');assert.match(household.voiceBrief.answer,/26,939/);
 const load=await lookup({mode:'finance',institution:'California State University, Fresno',question:'Nursing cost for 3 units per semester with parents',language:'en'});
 assert.equal(load?.nursingCatalog?.recordId,'NUR-0321');assert.match(load.voiceBrief.answer,/21,656/);
});
