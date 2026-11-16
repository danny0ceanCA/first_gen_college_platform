import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ucEstimateSnapshot} from './uc-estimates.mjs';
import {publicationDigest as digest} from './publication.mjs';
import {projectRecord,combineCatalogResults} from './catalog.mjs';
import {ucsfProgram} from './ucsf-program-lookup.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchCostRows} from '../../src/researchCostRows.ts';
import {validatedResearchFindings} from '../../src/researchFindings.mjs';
import {researchVisualReducer,emptyResearchVisual,visibleResearchReport} from '../../src/researchVisualState.ts';

const review=JSON.parse(await readFile(new URL('./reviews/uc-estimates-20261115.json',import.meta.url),'utf8'));
test('UC review selects exactly the 45 calculated and 14 partial records, with seven explicit UCI discrepancies',()=>{
 assert.equal(review.records.length,59);assert.equal(review.records.filter(r=>r.basis==='calculated').length,45);assert.equal(review.records.filter(r=>r.basis==='partial').length,14);
 assert.equal(new Set(review.records.map(r=>r.budgetId)).size,59);assert.equal(review.uciDiscrepancyBudgetIds.length,7);
});

for(const [en,es,program] of [
 ["Global Health Sciences master's cost",'Costo de maestría en salud global',"Global Health Sciences (Master's)"],
 ["Global Health Sciences master's summer cost",'Costo de maestría en salud global en verano',"Global Health Sciences - Master's (Summer)"],
 ['Global Health Sciences part-time 1 cost','Costo de salud global tiempo parcial primer año','Global Health Sciences Part-Time 1'],
 ['Global Health Sciences part-time 2 cost','Costo de salud global tiempo parcial segundo año','Global Health Sciences Part-Time 2'],
 ['Global Health Sciences part-time summer cost','Costo de salud global tiempo parcial verano','Global Health Sciences - Part-Time (Summer)'],
 ['Global Health Sciences PhD cost','Costo de doctorado en salud global','Global Health Sciences (PhD)'],
 ['Advanced Training Clinical Research certificate cost','Costo del certificado de investigación clínica','Advanced Training Clinical Research - Certificate'],
 ["Clinical Research master's first year cost",'Costo de maestría en investigación clínica primer año',"Advanced Training Clinical Research - Master's 1"],
 ["Clinical Research master's second year cost",'Costo de maestría en investigación clínica segundo año',"Advanced Training Clinical Research - Master's 2"],
 ['Biomedical Imaging cost','Costo de imágenes biomédicas','Biomedical Imaging'],
 ['Dental PostBac cost','Costo de posbachillerato en odontología','Dental PostBac'],
 ['Medicine PostBac cost','Costo de posbachillerato en medicina','Medicine PostBac'],
 ['Pharmacy PostBac cost','Costo de posbachillerato en farmacia','Pharmacy PostBac'],
])test('named UCSF program: '+program,()=>{assert.equal(ucsfProgram(en),program);assert.equal(ucsfProgram(es),program);});
test('unclear program, track and year do not silently select a UCSF scenario',()=>{
 for(const question of ['UCSF costs','Global Health Sciences costs','Global Health Sciences part-time cost','Global Health Sciences part-time for 2 months',"Clinical Research master's cost",'Dental and medicine postbac costs',"Global Health Sciences PhD master's cost",'Biomedical Imaging summer costs','Dental PostBac summer costs'])
  assert.equal(ucsfProgram(question),null,question);
});

test('actual reviewed UC records preserve source data and produce bilingual qualified tables',{skip:process.env.COA_UC_ESTIMATE_TEST!=='true'},async t=>{
 const base=JSON.parse(await readFile(new URL('./.local/csu-estimates-20261115/uc-base-snapshot.json',import.meta.url),'utf8')),before=digest(base);
 const snapshot=ucEstimateSnapshot(base,review);assert.equal(digest(base),before);assert.equal(snapshot.budgets.length,491);
 assert.equal(snapshot.sourceReviewedAt,base.sourceReviewedAt);assert.equal(snapshot.validUntil,base.validUntil);
 assert.equal(snapshot.batch.id,ucEstimateSnapshot(base,review).batch.id);
 const selected=new Set(review.records.map(r=>r.budgetId));
 for(const original of base.budgets){const b=snapshot.budgets.find(b=>b.budget_key===original.budget_key);
  assert.equal(b.published_cents,original.published_cents);assert.deepEqual(b.payload.raw,original.payload.raw);assert.deepEqual(b.payload.items,original.payload.items);assert.deepEqual(b.payload.issues,original.payload.issues);
  if(!selected.has(b.budget_key))assert.equal(b.record_digest,original.record_digest);
 }
 for(const language of ['en','es'])await t.test(language+': all 59 amounts, exclusions, source notes and comparison controls',()=>{
  const results=[];
  for(const entry of review.records){const b=snapshot.budgets.find(b=>b.budget_key===entry.budgetId),row={...b,caveated_publication:true,source_reviewed_at:snapshot.sourceReviewedAt,valid_until:snapshot.validUntil};
   const result=projectRecord(row,language,{allowTesting:true});assert.ok(result,entry.budgetId);const budget=result.voiceBrief.findings[0].budget;
   assert.equal(budget.total,null);assert.equal(Math.round(budget.catalogEstimate.amount*100),entry.expectedKnownCents);
   if(entry.basis==='partial'){assert.ok(budget.catalogEstimate.unresolved.length);assert.match(budget.catalogEstimate.note,language==='es'?/Cubre \d+ meses/:/Covers \d+ months/);
    assert.ok(budget.catalogEstimate.unresolved.every(u=>u.rate===null));assert.match(budget.catalogEstimate.unresolved[0].label,language==='es'?/Cuotas|Matrícula/:/fees/);
   }
   if(review.uciDiscrepancyBudgetIds.includes(entry.budgetId)){assert.match(result.voiceBrief.qualification,/1,550/);assert.match(budget.catalogEstimate.note,/1,550/);}
   assert.equal(projectRecord(row,language,{allowTesting:true,now:Date.parse(snapshot.validUntil)+1}),null);
   const events=[],visual=voiceVisualCards({emit:e=>events.push(e)}),question=language==='es'?'Costo de asistencia y componentes':'Cost of attendance and components';
   visual.trackResearch(entry.budgetId,question);visual.receiveResearch({id:entry.budgetId,status:'completed',result:{...result,catalogPublication:'production'},query:{requestKey:entry.budgetId,question,language}});
   const report=events.find(e=>e.type==='origen.visual.research').report,rows=researchCostRows(report.table.rows,1,report.housingScenario);
   assert.equal(rows.at(-1).id,'total_budget');const cell=rows.at(-1).cells[0];assert.equal(cell.estimateBasis,entry.basis);assert.equal(Math.round(Number(cell.value.replace(/[^\d.]/gu,''))*100),entry.expectedKnownCents);
   for(const component of budget.components.filter(c=>c.role==='component'&&c.amount!==null))assert.equal(Math.round(Number(rows.find(r=>r.id===component.key).cells[0].value.replace(/[^\d.]/gu,''))*100),Math.round(component.amount*100));
   results.push(result);
  }
  const mixed=combineCatalogResults([results.find(r=>r.voiceBrief.findings[0].budget.catalogEstimate.note?.includes('1,550')),results.at(-1)],language);
  assert.equal(validatedResearchFindings(mixed).length,2);
  const events=[],visual=voiceVisualCards({emit:e=>events.push(e)});visual.trackResearch('mixed','Compare cost estimates');visual.receiveResearch({id:'mixed',status:'completed',result:mixed,query:{requestKey:'mixed',question:'Compare cost estimates',language}});
  const report=events[0].report;let state=researchVisualReducer(emptyResearchVisual,{type:'receive',report,present:true});
  state=researchVisualReducer(state,{type:'hideColumn',column:report.table.columns[0]});assert.equal(visibleResearchReport(report,state.hiddenColumns).table.columns.length,1);
  state=researchVisualReducer(state,{type:'restoreColumns'});assert.equal(visibleResearchReport(report,state.hiddenColumns).table.columns.length,2);
 });
 await t.test('unreviewed source changes, wrong sums, incomplete selections and lost discrepancy notes are rejected',()=>{
  for(const mutate of [r=>r.records[0].expectedPayloadDigest='0'.repeat(64),r=>r.records[0].expectedKnownCents++,r=>r.records.pop(),r=>r.uciDiscrepancyBudgetIds=[],r=>r.records[0].basis='partial']){
   const bad=structuredClone(review);mutate(bad);assert.throws(()=>ucEstimateSnapshot(base,bad));
  }
 });
});
