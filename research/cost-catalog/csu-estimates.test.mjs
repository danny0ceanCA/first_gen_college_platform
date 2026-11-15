import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readStaging,digest} from './postgres.mjs';
import {applyCsuCorrections} from './csu-corrections.mjs';
import {applyCsuEstimates} from './csu-estimates.mjs';
import {csuPublicationSnapshot} from './csu-publication.mjs';
import {projectRecord,combineCatalogResults} from './catalog.mjs';
import {budgetAudit} from '../../src/publishedBudget.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchCostRows} from '../../src/researchCostRows.ts';
import {validatedResearchFindings} from '../../src/researchFindings.mjs';
import {researchSpokenFinding} from '../../src/researchAnswerDelivery.mjs';
import {researchVisualReducer,emptyResearchVisual,visibleResearchReport} from '../../src/researchVisualState.ts';
const correction=JSON.parse(await readFile(new URL('./reviews/csu-20261115.json',import.meta.url),'utf8'));
const review=JSON.parse(await readFile(new URL('./reviews/csu-estimates-20261115.json',import.meta.url),'utf8'));
const settings={reviewedAt:review.reviewedAt,validUntil:'2026-12-12T00:00:00Z'};
test('estimate selection explicitly separates 44 calculated, 125 partial and 43 disputed scenarios',()=>{
 assert.equal(review.records.filter(r=>r.basis==='calculated').length,44);assert.equal(review.records.filter(r=>r.basis==='partial').length,125);
 assert.equal(review.disputedBudgetIds.length,43);assert.equal(new Set(review.records.map(r=>r.budgetId)).size,169);
 assert.ok(!review.records.some(r=>review.disputedBudgetIds.includes(r.budgetId)));assert.equal(review.independentlyVerified,false);
});
test('actual workbook estimate representation, bilingual speech/table, reuse and holds',{skip:process.env.COA_CSU_LOCAL_TEST!=='true'},async t=>{
 const original=readStaging(review.baseBatchId,'csu-coa-staging.sqlite'),beforeDigest=digest(original),corrected=applyCsuCorrections(original,correction),batch=applyCsuEstimates(corrected,review);
 assert.equal(digest(original),beforeDigest);assert.equal(batch.id,applyCsuEstimates(corrected,review).id);
 assert.equal(csuPublicationSnapshot(batch,settings).budgets.length,607,'estimates stay off unless explicitly selected');
 const snapshot=csuPublicationSnapshot(batch,{...settings,allowEstimates:true});assert.equal(snapshot.budgets.length,776);assert.equal(snapshot.reviewEvidence.held.length,43);
 const selected=new Set(snapshot.budgets.map(b=>b.budget_key));for(const id of review.disputedBudgetIds)assert.ok(!selected.has(id),id);
 const rowFor=key=>({...snapshot.budgets.find(b=>b.budget_key===key),test_publication:true,source_reviewed_at:settings.reviewedAt,valid_until:settings.validUntil});
 for(const language of ['en','es'])await t.test(language+': 169 exact source records produce accurate labeled figures and retain missing charges',()=>{
  for(const entry of review.records){
   const row=rowFor(entry.budgetId),source=original.budgets.find(b=>b.key===entry.budgetId),result=projectRecord(row,language,{allowTesting:true,now:Date.parse(review.reviewedAt)});assert.ok(result,entry.budgetId);
   assert.equal(row.published_cents,null);assert.equal(source.total,null);assert.equal(row.payload.raw['Source checked'],source.payload.raw['Source checked']);
   const finding=validatedResearchFindings(result)[0];assert.ok(finding,entry.budgetId+' validated finding');const budget=finding.budget;
   assert.equal(budget.total,null);assert.equal(budget.catalogEstimate.basis,entry.basis);assert.equal(Math.round(budget.catalogEstimate.amount*100),source.sum);
   assert.equal(budgetAudit(budget).complete,false);assert.equal(budgetAudit(budget).calculatedComplete,entry.basis==='calculated');
   if(entry.basis==='partial'){
    assert.ok(budget.catalogEstimate.unresolved.length);assert.equal(budget.complete,false);
    assert.match(finding.qualification,language==='es'?/Sin incluir/:/Not included/);
    assert.ok(budget.components.filter(c=>c.role==='component').every(c=>c.amount!==null));
    const expectedMissing=source.payload.items.filter(i=>i.role==='Included component'&&i.amount===null).length;
    assert.equal(budget.catalogEstimate.unresolved.length,expectedMissing);
   }
   const question=language==='en'?'What is the cost of attendance?':'¿Cuál es el costo de asistencia?',spoken=researchSpokenFinding(finding,{question,language});
   assert.match(spoken.answer,entry.basis==='calculated'?(language==='es'?/Estimación calculada/:/Calculated estimate/):(language==='es'?/Costos conocidos/:/Known costs so far/));
   const events=[],visual=voiceVisualCards({emit:e=>events.push(e)});visual.trackResearch(entry.budgetId,question);
   visual.receiveResearch({id:entry.budgetId,status:'completed',result,query:{requestKey:entry.budgetId,mode:'finance',language,institution:row.campus,question}});
   const report=events.find(e=>e.type==='origen.visual.research')?.report;assert.ok(report,entry.budgetId+' white table');
   const display=researchCostRows(report.table.rows,1,report.housingScenario).find(r=>r.id==='total_budget')?.cells[0];assert.ok(display,entry.budgetId+' summary');
   assert.equal(Number(display.value.replace(/[^0-9.]/gu,'')),source.sum/100);assert.equal(display.estimateBasis,entry.basis);
  }
 });
 await t.test('known base tuition remains numeric when a supplementary charge is unknown',()=>{
  const result=projectRecord(rowFor('CSU-0382'),'en',{allowTesting:true,now:Date.parse(review.reviewedAt)}),b=validatedResearchFindings(result)[0].budget;
  const source=original.budgets.find(b=>b.key==='CSU-0382');
  const knownFees=source.payload.items.filter(i=>['Tuition','Tuition and mandatory fees','Mandatory fees'].includes(i.raw.Category)&&i.amount!==null).reduce((n,i)=>n+i.amount,0)/100;
  assert.equal(b.components.find(c=>c.key==='tuition_fees').amount,knownFees);
  assert.equal(b.catalogEstimate.unresolved[0].rate,471);assert.match(result.voiceBrief.qualification,/semester unit/);
 });
 for(const language of ['en','es'])await t.test(language+': published, calculated and partial columns retain independent labels through reuse and controls',()=>{
  let state=emptyResearchVisual;
  const result=combineCatalogResults(['CSU-0544','CSU-0816','CSU-0382'].map(key=>projectRecord(rowFor(key),language,{allowTesting:true,now:Date.parse(review.reviewedAt)})),language);
  assert.equal(validatedResearchFindings(result).length,3);
  const events=[],visual=voiceVisualCards({emit:e=>{events.push(e);state=researchVisualReducer(state,{type:'receive',report:e.report,present:e.present});}});
  const question=language==='en'?'Compare these cost estimates.':'Compara estas estimaciones de costos.';
  visual.trackResearch('mixed',question);visual.receiveResearch({id:'mixed',status:'completed',result,query:{requestKey:'mixed',language,question}});
  const report=state.reports.find(r=>r.id===state.view);assert.equal(report.table.columns.length,3);
  const rows=researchCostRows(report.table.rows,3,report.housingScenario),summary=rows.find(r=>r.id==='total_budget');assert.ok(summary.cells.every(Boolean));
  assert.deepEqual(summary.cells.map(c=>c.estimateBasis),[undefined,'calculated','partial']);
  state=researchVisualReducer(state,{type:'hideColumn',column:report.table.columns[1]});assert.equal(visibleResearchReport(report,state.hiddenColumns).table.columns.length,2);
  state=researchVisualReducer(state,{type:'restoreColumns'});assert.equal(visibleResearchReport(report,state.hiddenColumns).table.columns.length,3);
 });
 await t.test('disputed totals and mismatched arithmetic fail closed',()=>{
  const bad=structuredClone(review),disputed=corrected.budgets.find(b=>b.key==='CSU-0461');
  bad.records.push({budgetId:disputed.key,expectedDigest:digest(disputed.payload),expectedKnownCents:disputed.sum,basis:'calculated'});
  assert.throws(()=>applyCsuEstimates(corrected,bad),/disputed/);
  const wrong=structuredClone(review);wrong.records[0].expectedKnownCents++;assert.throws(()=>applyCsuEstimates(corrected,wrong),/arithmetic/);
 });
});
