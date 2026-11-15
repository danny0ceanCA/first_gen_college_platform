import test from 'node:test';
import assert from 'node:assert/strict';
import {costCampusName,csuCampuses} from '../../src/campusIdentity.mjs';
import {researchSubjectIdentity,findingSubjectMentioned} from '../../src/researchFindings.mjs';
import {researchFindingMatchesTaskEntity,createResearchTask} from '../../src/researchTask.mjs';
import {csuPublicationSnapshot} from './csu-publication.mjs';
import {readStaging} from './postgres.mjs';
import {projectRecord} from './catalog.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchVisualReducer,emptyResearchVisual,visibleResearchReport} from '../../src/researchVisualState.ts';
import {researchCostRows} from '../../src/researchCostRows.ts';

test('all CSU campuses have bounded English/Spanish aliases without UC collisions',()=>{
 for(const [name,city,other] of csuCampuses)for(const alias of [name,...other,'California State University, '+city,'Cal State '+city,'Universidad Estatal de California en '+city]){
  assert.equal(costCampusName(alias),name,alias);
  assert.equal(researchSubjectIdentity(alias),researchSubjectIdentity(name),alias);
  assert.equal(findingSubjectMentioned(name,'What about '+alias+'?'),true,alias);
 }
 for(const name of ['Cal Poly','State University','Sacramento City College','UC Sacramento','Sacramento State College of Something'])assert.equal(costCampusName(name),null,name);
 assert.equal(costCampusName('UC Cal State Sacramento'),'CSU Sacramento');
 assert.equal(costCampusName('UC San Francisco'),'UC San Francisco');
 assert.equal(costCampusName('San Francisco State'),'San Francisco State University');
 assert.notEqual(researchSubjectIdentity('CSUS'),researchSubjectIdentity('CSUSB'));
 assert.notEqual(researchSubjectIdentity('SDSU'),researchSubjectIdentity('UCSD'));
 assert.equal(findingSubjectMentioned('UC San Francisco','What about San Francisco State?'),false);
 assert.equal(findingSubjectMentioned('UCLA','¿Y Cal State Los Angeles?'),false);
 assert.equal(findingSubjectMentioned('CSU Sacramento','What about Sac State?'),true);
 const task=createResearchTask({institution:'California State University, Sacramento'});
 assert.equal(researchFindingMatchesTaskEntity(task,task.entities[0],{subject:'CSU Sacramento — Renting off campus'}),true);
});

test('CSU publication holds unresolved amounts and preserves imported flags/dates',()=>{
 const batch={id:'a'.repeat(64),hash:'b'.repeat(64),version:'csu-coa-workbook-staging-v1.0',report:{},budgets:[]};
 const raw={'Budget period':'Academic year','Source checked':'2026-11-12','Academic year':'2026-27',Currency:'USD','Student level':'Undergraduate',
  'Program / degree':'General','Residency':'California resident','Official source URL':'https://www.csus.edu/financial-aid'};
 const items=[['Tuition',965600],['Housing',2350400],['Books and supplies',774400]].map(([category,amount],index)=>({key:'i'+index,amount,role:'Included component',raw:{Category:category,'Original source label':category}}));
 const b={key:'CSU-1',campus:'CSU Sacramento',year:'2026-27',bucket:'reconciled',flagged:true,total:4090400,sum:4090400,difference:0,
  payload:{raw,normalized:{housing:'renting'},issues:{invalid:[],review:['workbook_source_review_required','housing_scope_requires_review']},items}};
 batch.budgets=[b,{...b,key:'CSU-2',bucket:'discrepancy'},{...b,key:'CSU-3',payload:{...b.payload,issues:{invalid:[],review:['explicit_source_override_requires_review']}}}];
 const snapshot=csuPublicationSnapshot(batch,{reviewedAt:'2026-11-15T00:00:00Z',validUntil:'2026-12-12T00:00:00Z'});
 assert.equal(snapshot.budgets.length,1);assert.equal(snapshot.reviewEvidence.held.length,2);
 assert.equal(snapshot.budgets[0].flagged,true);assert.equal(snapshot.budgets[0].eligible_for_review,false);
 assert.equal(snapshot.budgets[0].payload.raw['Source checked'],'2026-11-12');
});

test('real CSU workbook lookup and mixed white table in English and Spanish',{skip:process.env.COA_CSU_LOCAL_TEST!=='true'},async()=>{
 const batch=readStaging('cf0fe03601395617ac6a73981dd338058ba9244b51a2825ce7b14fa508d3d84a','csu-coa-staging.sqlite');
 const snapshot=csuPublicationSnapshot(batch,{reviewedAt:new Date().toISOString(),validUntil:'2026-12-12T00:00:00Z'});
 const rows=snapshot.budgets.map(b=>({...b,caveated_publication:true,source_reviewed_at:snapshot.sourceReviewedAt,valid_until:snapshot.validUntil}));
 for(const row of rows)assert.ok(projectRecord(row,'en',{allowTesting:true}),row.budget_key);
 for(const language of ['en','es']){
  const observed=[];
  const lookup=createLocalCostLookup({publication:'production',query:async(sql,params)=>{
   assert.match(sql,/coa_catalog.production_published/);observed.push(params[0]);
   return {rows:rows.filter(r=>params[0].includes(r.campus)&&params[1].includes(r.payload.raw.Residency)&&params[2].includes(r.payload.raw['Program / degree']))};
  }});
  const question=language==='en'?'2026-27 California resident undergraduate cost of attendance renting off campus.':'Costo de asistencia 2026-27 de pregrado residente de California alquilando fuera del campus.';
  const result=await lookup({mode:'finance',language,institution:'California State University, Sacramento',question});
  assert.ok(result);assert.equal(result.catalogPublication,'production');
  const budget=result.voiceBrief.findings[0].budget;
  assert.equal(budget.total,40904);assert.equal(budget.components.find(i=>i.key==='tuition_fees').amount,9656);
  assert.equal(budget.components.find(i=>i.key==='housing_and_food').amount,23504);
  assert.equal(budget.components.reduce((sum,i)=>sum+i.amount,0),40904);
  assert.match(result.voiceBrief.qualification,/More than 6 units per semester/);
  let state=emptyResearchVisual;
  const receive=(id,res,institution,reference)=>{
   const visual=voiceVisualCards({emit:e=>{state=researchVisualReducer(state,{type:'receive',report:e.report,present:e.present});}});
   visual.trackResearch(id,question);visual.receiveResearch({id,status:'completed',result:res,question,query:{mode:'finance',language,institution,question,requestKey:id,visualComparisonBaseId:reference,visualComparisonCampus:institution,confirmedHousingChoice:'renting'}});
  };
  const uc=structuredClone(result);
  uc.voiceBrief.findings[0].subject='UC Berkeley — Renting off campus';
  uc.voiceBrief.findings[0].budget={...budget,total:49692,housing:'renting',expectedCategories:['tuition_fees','housing','food','books','transportation','personal','health_insurance'],components:[
   {key:'tuition_fees',amount:18214,role:'component',sourceLabel:'Tuition and fees',qualification:''},
   {key:'housing',amount:14386,role:'component',sourceLabel:'Housing',qualification:''},
   {key:'food',amount:6144,role:'component',sourceLabel:'Food',qualification:''},
   {key:'books',amount:1342,role:'component',sourceLabel:'Books',qualification:''},
   {key:'transportation',amount:1238,role:'component',sourceLabel:'Transportation',qualification:''},
   {key:'personal',amount:3302,role:'component',sourceLabel:'Personal',qualification:''},
   {key:'health_insurance',amount:5066,role:'component',sourceLabel:'Insurance',qualification:''}]};
  // UI fixture only: actual UC PostgreSQL records are exercised in the release rehearsal.
  uc.voiceBrief.findings[0].answer='Published total cost: USD $49,692. [1]';
  receive('berkeley',uc,'UC Berkeley');
  const davis=structuredClone(uc);davis.voiceBrief.findings[0].subject='UC Davis — Renting off campus';
  receive('davis',davis,'UC Davis',state.view);
  receive('sacramento',result,'Sacramento State',state.view);
  const report=state.reports.find(r=>r.id===state.view);
  assert.equal(report.table.columns.length,3,JSON.stringify(report.table.columns));
  const display=researchCostRows(report.table.rows,3,report.housingScenario);
  assert.equal(display.find(r=>r.id==='total_budget').cells[2].value,'$40,904');
  assert.equal(display.find(r=>r.id==='tuition_fees').cells[0].value,'$18,214');
  assert.ok(display.find(r=>r.id==='housing_and_food').cells.every(Boolean));
  assert.equal(display.find(r=>r.id==='housing_and_food').cells[0].value,'$20,530');
  assert.equal(display.find(r=>r.id==='housing_and_food').cells[2].value,'$23,504');
  state=researchVisualReducer(state,{type:'hideColumn',column:report.table.columns[1]});
  assert.equal(visibleResearchReport(report,state.hiddenColumns).table.columns.length,2);
  assert.deepEqual(observed,[['CSU Sacramento']],'no UC lookup required to add Sacramento');
 }
});
