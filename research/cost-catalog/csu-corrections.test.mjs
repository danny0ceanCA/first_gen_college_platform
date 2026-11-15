import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readStaging,digest} from './postgres.mjs';
import {applyCsuCorrections} from './csu-corrections.mjs';
import {csuPublicationSnapshot} from './csu-publication.mjs';
import {projectRecord,scopeMatch} from './catalog.mjs';
import {budgetAudit} from '../../src/publishedBudget.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchCostRows} from '../../src/researchCostRows.ts';

const review=JSON.parse(await readFile(new URL('./reviews/csu-20261115.json',import.meta.url),'utf8'));
const haveLocal=process.env.COA_CSU_LOCAL_TEST==='true';
const snapshot=batch=>csuPublicationSnapshot(batch,{reviewedAt:review.reviewedAt,validUntil:'2026-12-12T00:00:00Z'});

test('review manifest binds exact input and every correction has dated official evidence',()=>{
 assert.equal(review.records.length,24);assert.equal(new Set(review.records.map(r=>r.budgetId)).size,24);
 for(const r of review.records){assert.match(r.expectedDigest,/^[a-f0-9]{64}$/);assert.ok(r.sourceIds.length);assert.ok(r.note.en&&r.note.es);}
 assert.equal(review.verifiedOverridesStillHeld.length,12);
 assert.ok(review.sources.every(s=>s.verified&&s.url.startsWith('https://')&&Date.parse(s.checkedAt)<=Date.parse(review.reviewedAt)));
});

test('isolated real CSU amendment: original data, holds, canonical scopes and all bilingual totals',{skip:!haveLocal},async t=>{
 const original=readStaging(review.baseBatchId,'csu-coa-staging.sqlite'),originalDigest=digest(original),revised=applyCsuCorrections(original,review);
 assert.equal(digest(original),originalDigest,'original SQLite import never changed');assert.notEqual(revised.id,original.id);
 assert.equal(applyCsuCorrections(original,review).id,revised.id,'same review has stable revision identity');
 const selected=snapshot(revised),prior=snapshot(original),amended=new Set(review.records.map(r=>r.budgetId));
 assert.equal(prior.budgets.length,583);assert.equal(selected.budgets.length,607);assert.equal(selected.reviewEvidence.held.length,212);
 for(const old of original.budgets){const now=revised.budgets.find(b=>b.key===old.key);
  if(!amended.has(old.key))assert.deepEqual(now,old,'unreviewed record unchanged: '+old.key);
  else {assert.deepEqual(now.payload.issues,old.payload.issues);assert.equal(now.flagged,old.flagged);assert.equal(now.total,old.total);
   assert.equal(now.payload.raw['Source checked'],old.payload.raw['Source checked']);}
 }
 const held=new Set(selected.reviewEvidence.held.map(h=>h.budgetId));
 for(const key of ['CSU-0461','CSU-0466','CSU-0592','CSU-0609','CSU-0612','CSU-0772','CSU-0327','CSU-0382','CSU-0541'])assert.ok(held.has(key),key+' must remain held');
 for(const language of ['en','es'])await t.test(language+': 24 corrected records reconcile through research and table',()=>{
  for(const key of amended){
   const b=selected.budgets.find(b=>b.budget_key===key),old=original.budgets.find(b=>b.key===key);
   const row={...b,caveated_publication:true,source_reviewed_at:review.reviewedAt,valid_until:selected.validUntil};
   const result=projectRecord(row,language,{allowTesting:true,now:Date.parse(review.reviewedAt)});assert.ok(result,key);
   const finding=result.voiceBrief.findings[0],budget=finding.budget;assert.equal(budget.total,old.total/100,key);
   assert.ok(budgetAudit(budget).complete,key);assert.ok(budget.population.length<=160);
   assert.equal(budget.components.reduce((sum,c)=>sum+Math.round(c.amount*100),0),old.total,key);
   const events=[],visual=voiceVisualCards({emit:e=>events.push(e)}),question=language==='en'?'What is the total cost of attendance?':'¿Cuál es el costo total de asistencia?';
   visual.trackResearch(key,question);visual.receiveResearch({id:key,status:'completed',result,query:{requestKey:key,mode:'finance',language,institution:b.campus,question}});
   const report=events.find(e=>e.type==='origen.visual.research')?.report;assert.ok(report,key);
   const total=researchCostRows(report.table.rows,1,report.housingScenario).find(r=>r.id==='total_budget');assert.ok(total?.cells[0],key);
   assert.equal(Number(total.cells[0].value.replace(/[^0-9.]/g,'')),old.total/100,key);
   if(key.startsWith('CSU-000')){
    assert.equal(budget.components.find(c=>c.key==='tuition_fees').amount,10390);
    assert.match(budget.population,/Teaching credential/);assert.match(finding.qualification,/10,390/);
    assert.equal(b.payload.items[0].raw.Amount,10930,'original source figure remains inspectable');
   }
   if(key==='CSU-0022'||key==='CSU-0023')assert.ok(budget.components.some(c=>c.key==='food'));
   for(const source of result.sources.filter(s=>review.sources.some(r=>r.url===s.url))){
    assert.equal(source.catalogValidity.reviewBasis,'independent_review');
    assert.equal(source.checkedAt,new Date(review.sources.find(r=>r.url===source.url).checkedAt).toISOString());
   }
  }
 });
 await t.test('short display labels do not change program/cohort matching identity',()=>{
  const b=selected.budgets.find(b=>b.budget_key==='CSU-0069'),old=original.budgets.find(source=>source.key===b.budget_key);
  assert.equal(b.payload.raw['Program / degree'],old.payload.raw['Program / degree']);
  assert.equal(b.scenario_key,old.scenario,'display label never replaces the canonical scenario key');
  assert.equal(scopeMatch(b,{program:'College of Liberal Arts'}),false);
  assert.equal(scopeMatch(b,{program:old.payload.raw['Program / degree'],cohort:old.payload.raw['Normalized cohort key']}),true);
 });
 await t.test('fail closed on stale amounts, foreign workbook, invented operation and positive hidden charge',()=>{
  for(const change of [r=>r.sourceSha256='0'.repeat(64),r=>r.records[0].expectedDigest='0'.repeat(64),
   r=>r.sources[0].verified=false,r=>r.records[0].operations.push({type:'invent_total',value:1}),
   r=>r.records.find(x=>x.budgetId==='CSU-0021').operations=[{type:'omit_zero_placeholder',itemKey:'CSU-0021-001'}]]){
   const bad=structuredClone(review);change(bad);assert.throws(()=>applyCsuCorrections(original,bad));
  }
 });
});
