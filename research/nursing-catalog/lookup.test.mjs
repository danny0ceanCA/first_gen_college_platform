import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readExport} from './postgres.mjs';
import {projectNursingRecord,itemValue} from './projection.mjs';
import {createNursingLookup} from './lookup.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';
import {localClient} from '../cost-catalog/postgres.mjs';
const id=process.env.ORIGEN_NURSING_BATCH;

test('bounds, unknowns and explicit zero retain their meanings',()=>{
 const item={normalized:{value_representation:'Published upper bound',published_upper_bound_cents:35000}};
 assert.match(itemValue(item),/^Up to \$350/);
 item.normalized={value_representation:'Published lower bound',published_lower_bound_cents:15000};assert.match(itemValue(item),/^At least \$150/);
 item.normalized={value_representation:'Published range',published_lower_bound_cents:4000,published_upper_bound_cents:6000};assert.equal(itemValue(item),'$40–$60 USD');
 item.normalized={value_representation:'Unpriced or variable'};assert.equal(itemValue(item),'Unpriced or variable');
 item.normalized={value_representation:'Recorded scalar amount',source_scalar_cents:0};assert.equal(itemValue(item),'$0 USD');
});

test('every supplied nursing record is retrievable with retained caveats in English and Spanish',{skip:!id},async()=>{
 const b=await readExport(id),groups=new Map();
 for(const i of b.items){const list=groups.get(i.budget_id)||[];list.push(i);groups.set(i.budget_id,list);}
 const rows=b.budgets.map(r=>({batch_id:b.id,budget_id:r.id,campus:r.values.College,program:r.values['Program / degree'],academic_year_raw:r.values['Academic year'],academic_year_key:r.normalized.academic_year,budget_period:r.values['Budget period'],residency:r.values.Residency,housing:r.values.Housing,source_url:r.values['Official source URL'],payload:r}));
 const map=new Map(rows.map(r=>[r.budget_id,r]));
 const query=async(sql,p)=>({rows:sql.includes('production_items')?(groups.get(p[1])||[]).map(payload=>({payload})):typeof p[0]==='string'?[map.get(p[0])].filter(Boolean):rows.filter(r=>p[0].includes(r.campus))});
 const lookup=createNursingLookup({query,campuses:[...new Set(rows.map(r=>r.campus))]});
 for(const r of rows)for(const language of ['en','es']){
  const result=await lookup({mode:'finance',institution:r.campus,question:`Nursing reference ${r.budget_id}`,language});
  assert.ok(result,r.budget_id+' '+language);assert.equal(result.nursingCatalog.recordId,r.budget_id);
  assert.equal(result.nursingCatalog.pending,true);assert.equal(result.nursingCatalog.sourceVerified,false);
  const brief=researchBriefSelection(result);assert.equal(brief.evidenceFormat,'brief-v1');assert.equal(brief.verification,'partial');
  assert.equal(brief.findings.length,1);assert.ok(brief.sources.length);
  assert.match(brief.findings[0].qualification,/pending|pendiente/i);
  for(const key of ['Program / degree','Institution / location note','Academic year','Entering cohort / applies to','Budget period','Residency','Housing','Enrollment','Cost coverage']){
   const value=r.payload.values[key];if(value)assert.ok(brief.text.includes(value),`${r.budget_id}: live scope ${key}`);
  }
  for(const item of groups.get(r.budget_id)||[])assert.ok(result.text.includes(item.id),item.id);
  for(const decision of r.payload.normalized.caveated_decisions)assert.ok(result.text.includes(decision.required_caveat));
 }
 const lmc=await lookup({mode:'finance',institution:'Los Medanos College',question:'Los Medanos vocational nursing costs',language:'en'});
 assert.ok(lmc);assert.ok(lmc.text.includes('5,369'));assert.ok(lmc.text.includes('5,321'));
 const conflictBrief=researchBriefSelection(lmc).text;
 for(const phrase of ['5,369','5,619','5,321','5,821','Spring 2026','remains unconfirmed'])assert.ok(conflictBrief.includes(phrase),phrase);
 const bls=await lookup({mode:'finance',institution:'Cal State Los Angeles',question:'BLS certification cost for nursing reference NUR-0042',language:'en'});
 assert.match(bls.voiceBrief.answer,/\$40–\$60/);assert.equal(bls.voiceBrief.status,'partial');
 const site=await lookup({mode:'finance',institution:'Carrington College',question:'Vocational nursing at Carrington College in Bakersfield',language:'en'});
 assert.equal(site.nursingCatalog.recordId,'NUR-0924');assert.ok(site.text.includes('Bakersfield'));
 const ordinary=await lookup({mode:'finance',institution:'UC Davis',question:'General undergraduate tuition',language:'en'});assert.equal(ordinary,null);
 const refresh=await lookup({mode:'finance',institution:'Los Medanos College',question:'Nursing NUR-0547',language:'en',forceRefresh:true});assert.equal(refresh,null);
});

test('actual PostgreSQL publication exposes all records through restricted views only',{skip:!id||process.env.ORIGEN_NURSING_LOCAL_TEST!=='true'},async()=>{
 const c=await localClient();try{
  await c.query('BEGIN');try{
   await c.query(await readFile(new URL('./publication.sql',import.meta.url),'utf8'));
   await c.query("INSERT INTO nursing_catalog.production_releases(id,batch_id,valid_until,released_by,note) VALUES('fixture-publication',$1,now()+interval '1 day','local test','Rollback-only rehearsal')",[id]);
   await c.query('SET LOCAL ROLE origen_research_worker');
   const n=(await c.query("SELECT count(*) n,bool_and(review_state='pending' AND NOT source_verified AND NOT live_eligible) pending FROM nursing_catalog.production_budgets")).rows[0];
   assert.equal(Number(n.n),1016);assert.equal(n.pending,true);
   const forbidden=(await c.query("SELECT has_table_privilege(current_user,'nursing_catalog.budgets','SELECT') raw")).rows[0];assert.equal(forbidden.raw,false);
   const campuses=(await c.query('SELECT DISTINCT campus FROM nursing_catalog.production_budgets')).rows.map(r=>r.campus);
   const lookup=createNursingLookup({query:c.query.bind(c),campuses});
   const result=await lookup({mode:'finance',institution:'Los Medanos College',question:'What is the vocational nursing cost? NUR-0547',language:'en'});
   assert.ok(result.text.includes('5,369'));assert.equal(result.voiceBrief.status,'partial');
  }finally{await c.query('ROLLBACK');}
 }finally{await c.end();}
});
