import test from 'node:test';
import assert from 'node:assert/strict';
import {feedbackCases} from '../evals/conversation-feedback.v1.mjs';
import {evaluateFeedback,scoreFeedbackCase} from './feedback-evaluation.mjs';
test('catalog has unique synthetic cases, bilingual defect/control pairs and all summary categories',()=>{
 assert.equal(new Set(feedbackCases.map(c=>c.id)).size,feedbackCases.length);
 assert.equal(feedbackCases.length,28);assert.ok(feedbackCases.every(c=>c.synthetic===true));
 for(const language of ['en','es'])for(const category of ['summary_correction','summary_omission','summary_unsupported_claim','summary_commitment','summary_uncertainty']){
  assert.ok(feedbackCases.some(c=>c.language===language&&c.expected.includes(category)));
  assert.ok(feedbackCases.some(c=>c.language===language&&c.kind==='summary'&&!c.expected.length));
 }
});
test('offline evaluates actual detector, never sends provider requests or claims summaries passed',async()=>{
 const report=await evaluateFeedback({request:()=>{throw Error('No network allowed');}});
 assert.equal(report.checked,8);assert.equal(report.notRun,20);assert.equal(report.failed,0);
 assert.ok(report.results.filter(r=>r.kind==='summary').every(r=>r.passed===null));
 assert.ok(!JSON.stringify(report).includes('engineering'));
});
test('scoring detects missed flags and false positives; provider failure is not a successful check',async()=>{
 assert.equal(scoreFeedbackCase([],['summary_commitment']).falsePositive,1);
 assert.equal(scoreFeedbackCase(['summary_omission'],[]).falseNegative,1);
 assert.equal(scoreFeedbackCase(['summary_omission'],['summary_omission','summary_omission']).truePositive,1);
 await assert.rejects(evaluateFeedback({live:true}),/OPENAI_API_KEY/);
 await assert.rejects(evaluateFeedback({cases:[{synthetic:false}]}),/synthetic/);
 const report=await evaluateFeedback({live:true,env:{OPENAI_API_KEY:'fake'},cases:feedbackCases.slice(0,1),request:async()=>({ok:false})});
 assert.equal(report.failed,1);assert.equal(report.checked,0);assert.equal(report.precision,null);
});
test('live adapter evaluates results without persisting source text and accepts clean controls',async()=>{
 const cases=feedbackCases.filter(c=>c.kind==='summary'&&!c.expected.length).slice(0,2);let calls=0;
 const report=await evaluateFeedback({live:true,env:{OPENAI_API_KEY:'fake'},cases,request:async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"findings":[]}'}]}]})};}});
 assert.equal(calls,2);assert.equal(report.checked,2);assert.equal(report.failed,0);
 assert.ok(!JSON.stringify(report).includes(cases[0].summary));
});
