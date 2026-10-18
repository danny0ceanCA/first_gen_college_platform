import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from './model-evaluation.mjs';
import {releaseDefinitions,captureTemplate,meteredCost,reviewPersonalization,comparePersonalization} from './personalization-release.mjs';

// These fabricate evaluation INPUTS to test the gate; never release evidence.
async function fixture(arm='candidate'){
 const {catalog,rubric}=await releaseDefinitions(),capture=captureTemplate(catalog,rubric,arm,{'synthetic-test-file':hash('test-only')});
 capture.budget={usd:10,authorizedBy:'synthetic-reviewer',authorizedAt:'2026-10-18T10:00:00Z'};capture.costBudgetUSD=10;
 for(const c of catalog.cases){
  const id=arm+'-'+c.id,meter={providerModel:'synthetic-model',providerRequestId:id,pricingURL:'https://example.test/pricing',pricingAsOf:'2026-10-18',usage:{input_audio_tokens:100},usdPerMillion:{input_audio_tokens:10}};
  capture.attempts.push({id,caseId:c.id,status:'completed',completedSessions:c.id.startsWith('durable-action-')?2:1,startedAt:'2026-10-18T10:01:00Z',transport:'webrtc-live',device:'synthetic-device',providerCallsComplete:true,meters:[meter]});
  capture.responses.push({id:c.id,attemptId:id,text:'Synthetic gate test fixture, not model output.',configurationHash:arm,providerModel:'synthetic-model',device:'synthetic-device',trialInputHash:hash(c),reviews:[{type:'human',evaluatorId:'synthetic-reviewer',scores:Object.fromEntries(rubric.dimensions.map(d=>[d,2]))}],researchCalls:0,sources:[],toolTrace:[],firstAudioMs:1500,costUSD:0.001,usage:meter.usage,pricingAsOf:meter.pricingAsOf,retrievalMs:40,unnecessaryRepeatedQuestions:0,listenedToAudio:true,persistenceEvidence:{saved:true,recordId:'test',version:1,duplicateCount:1,status:'not-started',secondSessionVerified:true}});
 }
 return {catalog,rubric,capture};
}
test('release templates cannot pass as real evaluations, and frozen matched coverage stays bilingual',async()=>{
 const {catalog,rubric}=await releaseDefinitions();assert.equal(catalog.cases.length,28);
 const result=reviewPersonalization(catalog,rubric,captureTemplate(catalog,rubric,'candidate',{}));
 assert.equal(result.technicalGatePassed,false);assert.equal(result.releaseReady,false);assert.equal(result.unrunCases.length,28);assert.equal(result.totalCostUSD,null);
 assert.equal(result.languages.es.expected,14);assert.equal(result.languages.en.expected,14);
});
test('gate accepts complete inputs but never declares production approved',async()=>{
 const {catalog,rubric,capture}=await fixture();const result=reviewPersonalization(catalog,rubric,capture);
 assert.equal(result.technicalGatePassed,true,JSON.stringify(result.missingEvidence));assert.equal(result.releaseReady,false);assert.equal(result.completedAttempts,28);assert.equal(result.completedSessions,30);assert.ok(Math.abs(result.meanSessionCostUSD-result.totalCostUSD/30)<1e-10);
});
test('critical failures, missing listening, stale budget, slow retrieval, repeated questions and false action persistence block the gate',async()=>{
 const changes=[
  c=>{c.responses.find(r=>r.id==='failed-save-en').reviews[0].scores.actionPersistence=1;},
  c=>{c.responses[0].listenedToAudio=false;},
  c=>{c.budget.authorizedAt='2026-10-18T11:00:00Z';},
  c=>{for(const r of c.responses)r.retrievalMs=1200;},
  c=>{c.responses[0].unnecessaryRepeatedQuestions=1;},
  c=>{c.responses.find(r=>r.id==='durable-action-es').persistenceEvidence.duplicateCount=2;},
  c=>{c.attempts[0].meters[0].usage=null;},
  c=>{c.attempts[0].providerCallsComplete=false;},
  c=>{delete c.attempts[0].completedSessions;},
 ];
 for(const change of changes){const {catalog,rubric,capture}=await fixture();change(capture);assert.equal(reviewPersonalization(catalog,rubric,capture).technicalGatePassed,false);}
});
test('every failed or retried attempt is costed, including attempts without a completed session',async()=>{
 const {catalog,rubric,capture}=await fixture();
 const failed=structuredClone(capture.attempts[0]);failed.id='retry';failed.status='failed';failed.completedSessions=0;failed.meters[0].providerRequestId='retry-provider';failed.meters[0].usage.input_audio_tokens=2000000;capture.attempts.push(failed);
 const r=reviewPersonalization(catalog,rubric,capture);assert.equal(r.technicalGatePassed,false);assert.equal(r.failedOrCancelledAttempts,1);assert.ok(r.totalCostUSD>20);assert.ok(r.missingEvidence.some(s=>s.endsWith('retry-cost-reconciliation')));assert.ok(r.failures.includes('all-attempts-cost-budget'));
 failed.meters=[];assert.equal(reviewPersonalization(catalog,rubric,capture).totalCostUSD,null);
 assert.equal(meteredCost([{usage:{input_audio_tokens:100}}]),null);
});
test('paired comparison requires matched inputs and shares one combined budget',async()=>{
 const {catalog,rubric,capture:a}=await fixture('baseline'),{capture:b}=await fixture();
 a.responses[0].reviews[0].scores.memoryRelevance=0;
 for(const r of a.responses.filter(r=>r.id.startsWith('durable-action-')))r.persistenceEvidence={saved:false,duplicateCount:0,secondSessionVerified:true};
 assert.equal(comparePersonalization(catalog,rubric,a,b).technicalGatePassed,true); // Known baseline quality miss, not missing evidence.
 b.sourceHashes['synthetic-test-file']=hash('different');assert.equal(comparePersonalization(catalog,rubric,a,b).technicalGatePassed,false);b.sourceHashes={...a.sourceHashes};
 b.responses[0].providerModel='different';assert.equal(comparePersonalization(catalog,rubric,a,b).technicalGatePassed,false);b.responses[0].providerModel='synthetic-model';
 a.budget.usd=b.budget.usd=a.costBudgetUSD=b.costBudgetUSD=0.04;
 const result=comparePersonalization(catalog,rubric,a,b);assert.ok(result.missingEvidence.includes('combined-budget-exceeded'));assert.equal(result.technicalGatePassed,false);
});
