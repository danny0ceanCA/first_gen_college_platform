import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { calibrationCases } from './calibration-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';
import { openCalibrationBudget, reserveEstimate, calibrationDirectory, pricing } from './calibration-budget.mjs';
import { scoreCalibrationCase, calibrationSummary } from './calibration-scoring.mjs';
import { runCalibration } from './calibration-runner.mjs';

const toWire = value => ({...value,items:value.items.map(({kind,status,...item})=>({...item,classification:`${kind}:${status}`}))});
const request={model:pricing.model,service_tier:'default',max_output_tokens:3000,input:'fictional text'};
const code=expected=>error=>error.code===expected;
const identity=prefix=>`${prefix}-${randomUUID()}`;
const response=candidate=>({ok:true,json:async()=>({id:'resp_mock',model:pricing.model,status:'completed',usage:{input_tokens:100,output_tokens:100},
  output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(toWire(candidate))}]}]})});

test('calibration — 60 annotated fictional cases span languages, topics, reporters and intact split scenarios',()=>{
  const cases=calibrationCases(),existingItems=[];
  assert.equal(cases.length,60);
  assert.deepEqual(Object.fromEntries(['en','es','mixed'].map(lang=>[lang,cases.filter(item=>item.source.language===lang).length])),{en:25,es:25,mixed:10});
  assert.equal(new Set(cases.map(item=>item.source.text)).size,60);
  assert.equal(new Set(cases.flatMap(item=>item.expected.items.map(obs=>obs.topic))).size,9);
  assert.ok(cases.filter(item=>!item.expected.items.length).length>=4);
  assert.ok(cases.filter(item=>item.rubric.expectedBarrier).length>=15);
  for(const example of cases){
    assert.equal(example.source.synthetic,true);validateSource(example.source);
    assert.equal(example.rubric.humanReview,'pending');
    validateExtraction(example.expected,example.source,{existingItems});
    for(const item of example.expected.items)existingItems.push({...item,id:`${example.source.id}@1#${item.key}`,
      accountId:example.source.accountId,studentId:example.source.studentId,state:'current'});
  }
  for(const scenario of new Set(cases.map(item=>item.scenario)))assert.equal(new Set(cases.filter(item=>item.scenario===scenario).map(item=>item.split)).size,1);
  for(let number=1;number<=20;number++)assert.equal(cases.find(item=>item.id===`en-${String(number).padStart(2,'0')}`).split,cases.find(item=>item.id===`es-${String(number).padStart(2,'0')}`).split);
});

test('calibration — conservative reservation requires known model and explicit standard tier',()=>{
  const estimate=reserveEstimate(request);
  assert.ok(estimate.inputBound>=Buffer.byteLength(JSON.stringify(request))+4096);
  assert.equal(estimate.outputBound,3000);assert.ok(estimate.reservedMicros>=1500);
  for(const invalid of [{...request,model:'unknown'},{...request,service_tier:undefined},{...request,service_tier:'priority'},
    {...request,tools:[{type:'web_search'}]},{...request,max_output_tokens:8000}])assert.throws(()=>reserveEstimate(invalid),code('unsupported_budget_request'));
  assert.throws(()=>reserveEstimate({...request,input:'a'.repeat(100001)}),code('calibration_input_too_large'));
});

test('calibration — durable reservations survive restart and unknown usage cannot free the cap',()=>{
  const path=resolve(calibrationDirectory,`${identity('budget')}.sqlite`),budgetId='same-approved-cap';
  const estimate=reserveEstimate(request),capUsd=estimate.reservedMicros/1e6;
  let budget=openCalibrationBudget({path,budgetId,capUsd});budget.reserve('call-1',request);
  const uncertain=budget.settle('call-1',{sent:true,outcome:'failed',usage:null,secret:'not saved'});
  assert.equal(uncertain.usageConfirmed,false);assert.equal(uncertain.chargedUsd,capUsd);budget.close();
  budget=openCalibrationBudget({path,budgetId,capUsd});
  try{
    assert.equal(budget.summary().remainingUsd,0);assert.equal(budget.summary().unresolvedCalls,1);
    assert.throws(()=>budget.reserve('call-2',request),code('calibration_budget_exhausted'));
    assert.throws(()=>budget.reserve('call-1',request),code('calibration_call_already_reserved'));
    assert.throws(()=>openCalibrationBudget({path,budgetId,capUsd:capUsd+1}),code('budget_configuration_changed'));
  }finally{budget.close();}
});

test('calibration — unsent cancellation releases only that reservation; usage settles paid failures',()=>{
  const budget=openCalibrationBudget({path:':memory:',budgetId:'cancel',capUsd:1});
  try{
    budget.reserve('unsent',request);const stopped=budget.settle('unsent',{sent:false,outcome:'failed',usage:null});
    assert.equal(stopped.chargedUsd,0);assert.equal(stopped.usageConfirmed,true);
    budget.reserve('paid-failure',request);const failed=budget.settle('paid-failure',{sent:true,outcome:'failed',usage:{inputTokens:1000,outputTokens:1000}});
    assert.equal(failed.chargedUsd,.0006);assert.equal(budget.summary().accountedUsd,.0006);
    assert.throws(()=>budget.settle('paid-failure',{sent:false}),code('calibration_call_already_settled'));
  }finally{budget.close();}
});

test('calibration — status and reporter errors are flagged even when quotation is exact',()=>{
  const example=calibrationCases().find(item=>item.id==='en-03'),bad=structuredClone(example.expected);
  bad.items[0].status='completed';bad.items[0].reportedBy='parent';
  const score=scoreCalibrationCase(example,bad,{valid:true});
  assert.equal(score.supportedAnnotations,0);
  assert.ok(score.flags.some(flag=>flag.type==='unsupported_completion_or_positive_result'));
  assert.ok(score.flags.some(flag=>flag.type==='reporter_mismatch'));
  assert.equal(score.humanReview.status,'pending');
  const summary=calibrationSummary([{source:example.source,split:example.split,score,diagnostic:{sent:true,durationMs:500},accounting:{chargedUsd:.001}}]);
  assert.equal(summary.releaseGate,'human_review_required');assert.equal(summary.byLanguage.en.cases,1);
  assert.equal(summary.overall.annotationPrecision.value,0);assert.equal(summary.byLanguage.es.annotationPrecision.value,null);
});

test('calibration — mock run uses actual prior outputs, never oracle keys, and resumes without replaying paid calls',async()=>{
  const examples=calibrationCases(),byText=new Map(examples.map(example=>[example.source.text,example]));
  let calls=0,sawPrior=false;
  const fetcher=async(_url,options)=>{
    calls++;const body=JSON.parse(options.body),input=JSON.parse(body.input),example=byText.get(input.source.text);
    assert.equal(body.service_tier,'default');assert.equal(body.reasoning.effort,'low');
    assert.ok(!body.input.includes('expected-'));assert.ok(!body.input.includes('humanReview'));
    if(input.existingItems.length){sawPrior=true;assert.ok(input.existingItems.every(item=>item.id.includes('#actual-')));}
    const candidate=structuredClone(example.expected);
    for(const item of candidate.items){item.key=item.key.replace('expected-','actual-');if(item.linksTo)item.linksTo=item.linksTo.replace('#expected-','#actual-');if(item.corrects)item.corrects=item.corrects.replace('#expected-','#actual-');}
    return response(candidate);
  };
  const options={apiKey:'sk-never-in-report',runId:identity('mock-run'),budgetId:identity('mock-budget'),capUsd:1,fetcher};
  const {report,reportPath}=await runCalibration(options);
  assert.equal(calls,60);assert.equal(report.status,'completed');assert.equal(sawPrior,true);
  assert.equal(report.summary.overall.validOutputs.value,1);assert.equal(report.summary.overall.annotationRecall.value,1);
  assert.equal(report.summary.overall.pendingHumanReview,60);
  assert.equal(report.records.find(row=>row.id==='en-25').score.flags.length,0);
  assert.equal(report.configuration.datasetRole,'previously-inspected-regression');
  assert.equal(report.records.find(row=>row.id==='en-25').pipeline.passed,true);
  assert.ok(report.records.find(row=>row.id==='en-25').pipeline.checks.some(check=>check.type==='correction_replaces_prior_result'));
  assert.ok(!(await readFile(reportPath,'utf8')).includes('sk-never-in-report'));
  await runCalibration(options);assert.equal(calls,60);
  assert.equal(report.configuration.reasoningEffort,'low');
  await assert.rejects(runCalibration({...options,reasoningEffort:'none'}),code('calibration_run_configuration_changed'));
  assert.equal(calls,60);
});

test('calibration — no API key, exhausted budget, and cancellation make no hidden requests',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return response({schemaVersion:1,items:[]});};
  const base={runId:identity('no-call'),budgetId:identity('no-call-budget'),capUsd:.000001,fetcher,maxCases:1};
  await assert.rejects(runCalibration(base),code('calibration_api_key_required'));
  const limited=await runCalibration({...base,apiKey:'mock'});
  assert.equal(limited.report.status,'stopped');assert.equal(limited.report.records.length,0);assert.equal(calls,0);
  const abort=new AbortController();abort.abort();
  const stopped=await runCalibration({...base,apiKey:'mock',runId:identity('cancel'),signal:abort.signal});
  assert.equal(stopped.report.status,'cancelled');assert.equal(calls,0);
});

test('calibration — rejected candidates are reviewable but never feed later sequential model context',async()=>{
  const examples=calibrationCases(),byText=new Map(examples.map(example=>[example.source.text,example]));
  let inspected=false;
  const fetcher=async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).input),example=byText.get(input.source.text);
    if(example.id==='en-24'){
      inspected=true;assert.ok(!input.existingItems.some(item=>item.id.startsWith('cal-en-23@')));
      assert.ok(input.existingItems.some(item=>item.id.startsWith('cal-en-22@')));
    }
    const candidate=structuredClone(example.expected);
    for(const item of candidate.items){
      item.key=item.key.replace('expected-','actual-');
      if(item.linksTo)item.linksTo=item.linksTo.replace('#expected-','#actual-');
      if(item.corrects)item.corrects=item.corrects.replace('#expected-','#actual-');
      if(item.linksTo?.startsWith('cal-en-23@'))item.linksTo=null;
    }
    if(example.id==='en-23')candidate.items[0].quote='Invented success that was never said.';
    return response(candidate);
  };
  const {report}=await runCalibration({apiKey:'mock',runId:identity('invalid-context'),budgetId:identity('invalid-budget'),capUsd:1,maxCases:25,fetcher});
  const invalid=report.records.find(item=>item.id==='en-23');
  assert.equal(inspected,true);assert.equal(invalid.valid,false);
  assert.equal(invalid.actual.items[0].quote,'Invented success that was never said.');
  assert.equal(invalid.diagnostic.sent,true);assert.ok(invalid.accounting.chargedUsd>0);
  assert.equal(report.records.find(item=>item.id==='en-24').valid,true);
});

test('calibration — rejected correction reports actual saved uncertainty rather than stale success',async()=>{
  const byText=new Map(calibrationCases().map(example=>[example.source.text,example]));
  const fetcher=async(_url,options)=>{
    const example=byText.get(JSON.parse(JSON.parse(options.body).input).source.text);
    const candidate=structuredClone(example.expected);
    if(example.id==='en-25') {candidate.items[0].kind='understanding';candidate.items[0].status='reported';}
    return response(candidate);
  };
  const {report}=await runCalibration({apiKey:'mock',runId:identity('failed-correction'),budgetId:identity('failed-correction-budget'),capUsd:1,maxCases:25,fetcher});
  const correction=report.records.find(row=>row.id==='en-25');
  assert.equal(correction.valid,false);
  assert.equal(correction.pipeline.passed,true);
  assert.ok(correction.pipeline.checks.some(check=>check.type==='failed_correction_blocks_prior_result'&&check.pass));
  const episode=correction.pipeline.episodes.find(episode=>episode.observations.some(item=>item.id==='cal-en-24@1#expected-1'));
  assert.equal(episode.outcomeState,'unknown');assert.equal(episode.analysisEligible,false);
});
