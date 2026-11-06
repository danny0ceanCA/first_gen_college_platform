import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verificationCases } from './verification-fixtures.mjs';
import { runVerificationCalibration } from './verification-calibration.mjs';
const wire=value=>({...value,items:value.items.map(({kind,status,...item})=>({...item,classification:`${kind}:${status}`}))});

test('verifier calibration keeps gold out of requests and retains immutable staged candidates and saved results',async()=>{
  const examples=verificationCases().filter(item=>item.split==='development'),seen=[];
  const fetcher=async(_url,options)=>{
    const request=JSON.parse(options.body),input=JSON.parse(request.input),item=examples.find(row=>row.source.text===input.source.text);
    assert.ok(item);seen.push(item.id);
    assert.deepEqual(Object.keys(input).sort(),['candidate','episodes','existingItems','reviewTriggers','source']);
    assert.deepEqual(input.candidate,wire(item.initialCandidate));
    assert.ok(!request.input.includes('humanReview'));
    // Exercise keep and a minimal repair without pretending these transport
    // mocks establish the semantic quality of the challenge cases.
    const result={obstacles:[],decision:'keep',issues:[],edits:[],additions:[]};
    if(item.id==='verify-dev-en-02'){
      result.decision='revise';
      result.issues=[{type:'classification',quote:item.initialCandidate.items[0].quote,
        detail:'The source explicitly says the email was sent.',itemKey:item.initialCandidate.items[0].key}];
      result.edits=[{itemKey:item.initialCandidate.items[0].key,field:'classification',value:'action:completed',issueIndex:0}];
    }
    return{ok:true,json:async()=>({status:'completed',usage:{input_tokens:100,output_tokens:100},
      output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})};
  };
  const runId=`verify-mock-${randomUUID()}`,budgetId=`verify-budget-${randomUUID()}`;
  const {report}=await runVerificationCalibration({apiKey:'mock-secret',runId,budgetId,capUsd:1,split:'development',fetcher});
  assert.equal(seen.length,9);assert.equal(report.summary.overall.completed,9);
  assert.equal(report.summary.overall.cleanControlsUnchanged,3);
  assert.equal(report.summary.overall.revised,1);
  const repaired=report.records.find(item=>item.id==='verify-dev-en-02');
  assert.equal(repaired.actual.items[0].status,'completed');
  assert.deepEqual(repaired.initial.items[1],repaired.actual.items[1]);
  assert.ok(report.records.every(row=>row.history.attempts.length===1&&row.history.attempts[0].audit.decision!=='pending'));
  assert.ok(!JSON.stringify(report).includes('mock-secret'));
  await assert.rejects(runVerificationCalibration({apiKey:'mock-secret',runId,budgetId,capUsd:1,split:'development',fetcher}),{code:'verification_run_exists'});
  assert.equal(seen.length,9);
});

test('a host pause retains the paid attempt and stops calibration without extending an expired lease',async()=>{
  const realNow=Date.now;let calls=0;
  try{
    const {report}=await runVerificationCalibration({apiKey:'mock',runId:`verify-pause-${randomUUID()}`,
      budgetId:`pause-budget-${randomUUID()}`,capUsd:1,split:'development',fetcher:async()=>{
        calls++;Date.now=()=>realNow()+121000;
        return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:100,output_tokens:100},
          output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
            decision:'keep',issues:[],edits:[],additions:[],obstacles:[],
          })}]}]})};
      }});
    assert.equal(calls,1);assert.equal(report.status,'interrupted');assert.equal(report.records.length,1);
    assert.equal(report.records[0].errorCode,'stale_job_lease');assert.equal(report.records[0].actual,null);
    assert.equal(report.records[0].history.attempts[0].audit.decision,'pending');
    assert.equal(report.budget.calls,1);assert.ok(report.budget.accountedUsd>0);
  }finally{Date.now=realNow;}
});
