import test from 'node:test';
import assert from 'node:assert/strict';
import {captureTemplate,reviewStudentFirst,evaluationFlags} from '../scripts/evaluate-student-first.mjs';
import {studentFirstCatalog as catalog,studentFirstRubric as rubric} from '../evals/student-first.cases.v1.mjs';
import {hash} from './model-evaluation.mjs';
const candidate={sourceFingerprint:'a'.repeat(64),flags:evaluationFlags,catalogHash:hash(catalog),rubricHash:hash(rubric)};
// Fabricated records exercise the evidence validator only. They are not captured
// responses or an actual human review and must never be saved as release evidence.
function fixture(){
 const capture=captureTemplate(candidate);Object.assign(capture,{capturedAt:new Date().toISOString(),environmentRef:'synthetic-validator-fixture',budgetApprovedBy:'test-fixture-only',costBudgetUSD:1});
 for(const r of capture.responses)Object.assign(r,{text:'Synthetic validator fixture.',configurationHash:'b'.repeat(64),providerModel:'fixture',providerReceiptRef:'fixture',audioEvidenceRef:'fixture',timingMethod:'fixture',firstAudioMs:100,costUSD:0.01,usage:{inputTokens:10,outputTokens:10},pricingAsOf:'2026-10-21',researchCalls:0,reviews:[{type:'human',evaluatorId:'fabricated-validator-fixture',scores:Object.fromEntries(rubric.dimensions.map(d=>[d,2]))}]});
 return capture;
}
test('student-first capture keeps bilingual coverage and never makes a template or a completed technical review release approval',()=>{
 assert.equal(catalog.cases.length,16);assert.equal(catalog.cases.filter(c=>c.language==='es').length,8);
 assert.throws(()=>reviewStudentFirst(captureTemplate(candidate),candidate),/Capture time/);
 const report=reviewStudentFirst(fixture(),candidate);assert.equal(report.technicalGatePassed,true);assert.equal(report.releaseReady,false);
});
test('stale source, different rollout, missing recording and provider identity cannot pass the same-candidate check',()=>{
 for(const change of [c=>c.sourceFingerprint='c'.repeat(64),c=>c.flags={...c.flags,ORIGEN_DERIVED_BINDER_SHARING:'false'},c=>c.responses[0].audioEvidenceRef=null,c=>c.responses[0].providerReceiptRef=null,c=>c.responses[0].configurationHash='unmeasured']){const capture=fixture();change(capture);assert.throws(()=>reviewStudentFirst(capture,candidate));}
 const capture=fixture();capture.flags=Object.fromEntries(Object.entries(capture.flags).reverse());assert.equal(reviewStudentFirst(capture,candidate).technicalGatePassed,true);
});
test('missing cases, human review, usage, critical ownership failures and exceeded time/cost budgets fail closed',()=>{
 for(const change of [c=>c.responses.pop(),c=>c.responses[0].reviews=[],c=>c.responses[0].usage={},c=>c.responses[0].reviews[0].scores.actionOwnership=1,c=>c.responses[0].reviews[0].scores.privacy=1,c=>c.responses[0].firstAudioMs=9000,c=>c.costBudgetUSD=0.01]){const capture=fixture();change(capture);assert.equal(reviewStudentFirst(capture,candidate).technicalGatePassed,false);}
});
