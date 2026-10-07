import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationDefinitions,contractReport,hash,reviewResponses,compareReports} from './model-evaluation.mjs';
test('versioned bilingual synthetic contracts exercise all phase 4 categories without model calls',async()=>{
 const report=await contractReport();assert.equal(report.sampleSize,20);assert.equal(report.passed,20);assert.deepEqual(report.failed,[]);
 assert.equal(report.modelResponsesEvaluated,0);assert.equal(report.releaseReady,false);assert.equal(report.costUSD,null);
 for(const language of ['en','es'])assert.equal(report.cases.filter(c=>c.language===language).length,10);
});
test('human gate requires measured evidence and never treats missing examples or reviewers as passing',async()=>{
 const {catalog,rubric}=await evaluationDefinitions();
 const capture={synthetic:true,catalogHash:hash(catalog),rubricHash:hash(rubric),responses:[]};
 assert.equal(reviewResponses(catalog,rubric,capture).technicalGatePassed,false);
 assert.throws(()=>reviewResponses(catalog,rubric,{...capture,synthetic:false}));
 const response={id:catalog.cases[0].id,text:'Synthetic response',configurationHash:'synthetic-config',providerModel:'synthetic-model',reviews:[]};
 const report=reviewResponses(catalog,rubric,{...capture,responses:[response]});assert.ok(report.missingEvidence.includes(`${response.id}:human-review`));assert.equal(report.releaseReady,false);
 assert.throws(()=>reviewResponses(catalog,rubric,{...capture,responses:[response,response]}),/duplicate/);
});
test('critical failures, reviewer disagreements and latency/cost overruns block the technical gate',async()=>{
 const {catalog,rubric}=await evaluationDefinitions();
 const scores=Object.fromEntries(rubric.dimensions.map(d=>[d,2]));
 const responses=catalog.cases.map(c=>({id:c.id,text:'Synthetic test only',configurationHash:'test',providerModel:'test',firstAudioMs:1000,costUSD:.01,usage:{input_tokens:100,output_tokens:10},pricingAsOf:'2026-10-06',researchCalls:1,sources:[],toolTrace:[],reviews:[{type:'human',evaluatorId:'synthetic-reviewer',scores:{...scores}}]}));
 const capture={synthetic:true,catalogHash:hash(catalog),rubricHash:hash(rubric),responses,costBudgetUSD:1};
 assert.equal(reviewResponses(catalog,rubric,capture).technicalGatePassed,true);assert.equal(reviewResponses(catalog,rubric,capture).releaseReady,false);
 const critical=responses.find(r=>catalog.cases.find(c=>c.id===r.id).critical);critical.reviews.push({type:'human',evaluatorId:'second-synthetic-reviewer',scores:{...scores,correctness:0}});
 const report=reviewResponses(catalog,rubric,capture);assert.equal(report.technicalGatePassed,false);assert.ok(report.disagreements.length);assert.ok(report.failures.length);
 for(const r of responses)r.firstAudioMs=10000;
 capture.costBudgetUSD=.01;assert.ok(reviewResponses(catalog,rubric,capture).failures.includes('p95-first-audio'));assert.ok(reviewResponses(catalog,rubric,capture).failures.includes('cost-budget'));
});
test('baseline comparisons reject changes to the instrument or incomparable sample sizes',async()=>{
 const r=await contractReport();assert.equal(compareReports(r,r).configurationChanged,false);
 assert.throws(()=>compareReports(r,{...r,rubricHash:'other'}));assert.throws(()=>compareReports(r,{...r,sampleSize:1}));
});
