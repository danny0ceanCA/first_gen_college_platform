import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedBudget,budgetAudit,budgetHeadline,publishedBudgetSchema,remapBudget} from '../src/publishedBudget.mjs';
import {parseResearchBrief} from './research-brief.mjs';
import {researchSpokenFinding} from '../src/researchAnswerDelivery.mjs';
import {validatedResearchFindings} from '../src/researchFindings.mjs';
import {researchCostRows} from '../src/researchCostRows.ts';
import {hasCoaBreakdown} from './coa-evidence.mjs';
import {voiceVisualCards} from './voice-visual-cards.mjs';

function fixture(basis='calculated'){
 const checkedAt=new Date().toISOString();
 const catalogValidity={version:1,kind:'local_testing_catalog',batchId:'a'.repeat(64),recordId:'fixture',recordDigest:'b'.repeat(64),sourceUrl:'https://example.edu/cost',sourceCheckedAt:checkedAt,reviewedAt:checkedAt,retrievedAt:checkedAt,validUntil:new Date(Date.now()+86400000).toISOString(),reviewBasis:'workbook_reported'};
 const sources=[{url:'https://example.edu/cost',title:'Official cost source',checkedAt,catalogValidity}];
 const components=[['tuition_fees',100],['housing',200],['food',100]].map(([key,amount])=>({key,amount,role:'component',sourceLabel:key,qualification:''}));
 const budget={year:'2026-27',population:'Undergraduate; Nonresident',currency:'USD',period:'academic_year',housing:'renting',assumed:false,total:null,sourceCitation:'[1]',complete:basis==='calculated',
  expectedCategories:components.map(c=>c.key),components,catalogEstimate:{version:1,basis,amount:400,unresolved:basis==='calculated'?[]:[{key:'tuition_fees',label:'Nonresident tuition',rate:471,unit:'Semester credit unit',qualification:'Annual quantity unknown.'}]}};
 return {sources,budget};
}
for(const language of ['en','es'])for(const basis of ['calculated','partial'])test(`${language}: ${basis} basis survives parser, spoken headline, citations and numeric table`,()=>{
 const {sources,budget}=fixture(basis),qualification=(language==='es'?'Estimación para planificar; no es una factura.':'Planning estimate; not a bill.')+' [1]';
 const finding={subject:'Example University',aspect:'total_budget',status:'partial',answer:budgetHeadline(budget,language),qualification,budget};
 const result=parseResearchBrief({sources,text:JSON.stringify({brief:{status:'partial',answer:finding.answer,qualification,nextStep:'',findings:[finding]},report:'Source facts.'})},language);
 assert.ok(result.voiceBrief);const f=validatedResearchFindings(result)[0];assert.ok(f);assert.equal(f.budget.total,null);
 assert.equal(f.budget.catalogEstimate.amount,400);assert.equal(f.budget.catalogEstimate.basis,basis);assert.equal(budgetAudit(f.budget).complete,false,'never claim a university-published total');
 assert.equal(budgetAudit(f.budget).calculatedComplete,basis==='calculated');assert.equal(hasCoaBreakdown({...f,sourceIds:[1]}),false,'published-COA completeness semantics stay unchanged');
 const spoken=researchSpokenFinding(f,{question:language==='es'?'¿Cuál es el costo de asistencia?':'What is the cost of attendance?',language});
 assert.match(spoken.answer,basis==='calculated'?(language==='es'?/Estimación calculada/:/Calculated estimate/):(language==='es'?/Costos conocidos/:/Known costs so far/));
 assert.doesNotMatch(spoken.answer,/Total unverified|Total sin verificar/);
 const rows=researchCostRows([{aspect:'total_budget',cells:[{scope:f.subject,answer:f.answer,qualification:f.qualification,status:f.status,budget:f.budget,sources}]}],1);
 const summary=rows.find(r=>r.id==='total_budget').cells[0];assert.equal(summary.value,'$400');assert.equal(summary.estimateBasis,basis);
 assert.equal(rows.find(r=>r.id==='tuition_fees').cells[0].knownPortion,basis==='partial'?true:undefined);
 assert.equal(remapBudget(f.budget,v=>v.replace('[1]','[2]')).catalogEstimate.basis,basis);
});

test('catalog estimates cannot replace source totals or hide missing charges',()=>{
 const {budget}=fixture();
 for(const mutate of [b=>b.total=400,b=>b.catalogEstimate.amount=399,b=>b.catalogEstimate.basis='published',b=>b.catalogEstimate.unresolved=[{key:'tuition_fees'}],b=>b.complete=false]){
  const b=structuredClone(budget);mutate(b);assert.equal(validatedBudget(b,new Set([1])),null);
 }
 const partial=fixture('partial').budget;partial.catalogEstimate.unresolved=[];assert.equal(validatedBudget(partial,new Set([1])),null);
});

test('catalog estimate source notes are bounded plain strings and survive validation',()=>{
 const {budget}=fixture();budget.catalogEstimate.note='Source subtotal differs by $1,550.';
 assert.equal(validatedBudget(budget,new Set([1])).catalogEstimate.note,budget.catalogEstimate.note);
 for(const note of [{en:'not a runtime label'},'', 'x'.repeat(241)]){budget.catalogEstimate.note=note;assert.equal(validatedBudget(budget,new Set([1])),null);}
});

test('provider schema remains unchanged and an external response cannot invent catalog estimate provenance',()=>{
 assert.ok(!Object.hasOwn(publishedBudgetSchema.properties,'catalogEstimate'));
 const {budget}=fixture(),finding={subject:'Example University',aspect:'total_budget',status:'partial',answer:'Calculated estimate USD $400. [1]',qualification:'Estimate. [1]',budget};
 const result=parseResearchBrief({sources:[{url:'https://example.edu/cost'}],text:JSON.stringify({brief:{status:'partial',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]},report:'Facts.'})});
 assert.equal(result.voiceBrief.findings[0].status,'unverified');assert.ok(!result.voiceBrief.findings[0].budget);
});

test('unrelated web findings do not erase an estimate backed by its own catalog citations',()=>{
 const {sources,budget}=fixture();sources.push({url:'https://other.edu/cost'});
 const f={subject:'Example University',aspect:'total_budget',status:'partial',answer:'Calculated estimate USD $400. [1]',qualification:'Estimate. [1]',budget};
 assert.equal(validatedResearchFindings({sources,findings:[f]}).length,1);
 f.budget.sourceCitation='[2]';assert.equal(validatedResearchFindings({sources,findings:[f]}).length,0);
});

for(const language of ['en','es'])test(`${language}: a published catalog off-campus benchmark remains visible for a qualified rental request`,()=>{
 const {sources,budget}=fixture();budget.housing='off_campus';
 const f={subject:'Example University — Published off-campus benchmark',aspect:'total_budget',status:'partial',answer:budgetHeadline(budget,language),qualification:'Source benchmark; personal rental applicability unconfirmed. [1]',budget};
 const result=parseResearchBrief({sources,text:JSON.stringify({brief:{status:'partial',answer:f.answer,qualification:f.qualification,nextStep:'',findings:[f]},report:'Source facts.'})},language);
 result.catalogPublication='production';const events=[],visual=voiceVisualCards({emit:e=>events.push(e)}),question=language==='es'?'Costo de asistencia alquilando fuera del campus.':'Cost of attendance renting off campus.';
 visual.trackResearch('estimate',question);visual.receiveResearch({id:'estimate',status:'completed',result,query:{requestKey:'estimate',question,language,confirmedHousingChoice:'renting'}});
 const report=events.find(e=>e.type==='origen.visual.research').report;
 assert.equal(report.housingScenario,undefined);assert.match(report.scopeNote,language==='es'?/Referencia/:/benchmark/);
 assert.equal(researchCostRows(report.table.rows,1,report.housingScenario).find(r=>r.id==='total_budget').cells[0].value,'$400');
});
