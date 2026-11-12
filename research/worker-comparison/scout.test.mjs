import test from 'node:test';import assert from 'node:assert/strict';
import {createScout,selectedDecision,ruleSelection} from './scout.mjs';import {fixtures} from './fixtures.mjs';
for(const language of ['en','es']){
 test(language+': baseline starts no added work',async()=>{let n=0;const s=createScout({mode:'current',research:()=>n++,accept:()=>n++});await s.observe(fixtures.find(f=>f.id==='direct_fee-'+language));assert.equal(n,0);});
 test(language+': duplicate and known work are coalesced',async()=>{let finish,n=0;const snap=fixtures.find(f=>f.id==='direct_fee-'+language);const s=createScout({mode:'rules',research:()=>{n++;return new Promise(r=>finish=r);},accept:()=>true});const first=s.observe(snap);assert.equal((await s.observe(snap)).reason,'none_or_duplicate');finish({});await first;await s.observe(snap);assert.equal(n,1);});
 test(language+': topic changes discard results before acceptance',async()=>{let finish,n=0;const s=createScout({mode:'rules',research:()=>new Promise(r=>finish=r),accept:()=>n++});const p=s.observe(fixtures.find(f=>f.id==='direct_fee-'+language));s.invalidate();finish({});assert.equal((await p).reason,'stale_result');assert.equal(n,0);});
}
test('malformed, refused and low-confidence decisions do not start research',()=>{for(const answer of [{type:'refusal'},{type:'choice',choice:'unknown',confidence:1},{type:'choice',choice:'transit',confidence:.5}])assert.equal(selectedDecision({answers:[{name:'research_task',...answer}]}),'none');});
test('rules are deliberately frozen as a simple comparator, not disguised semantic model',()=>{assert.equal(ruleSelection(fixtures.find(f=>f.id==='context_invitation-en')),'none');});
test('a classification that completes after a topic change cannot dispatch work',async()=>{
 let finish,calls=0;const scout=createScout({mode:'decisions',client:{evaluate:()=>new Promise(r=>finish=r)},research:()=>calls++,accept:()=>true});
 const p=scout.observe(fixtures[0]);scout.invalidate();finish({response:{answers:[{type:'choice',name:'research_task',choice:'fee_waiver',confidence:1}]}});
 assert.equal((await p).reason,'stale_selection');assert.equal(calls,0);
});
test('declined lookups are blocked equally before rules or model dispatch',async()=>{
 for(const mode of ['rules','decisions']){let calls=0;const scout=createScout({mode,client:{evaluate:()=>calls++},research:()=>calls++,accept:()=>true});
  assert.equal((await scout.observe(fixtures.find(f=>f.id==='declined-es'))).reason,'declined_or_hypothetical');assert.equal(calls,0);}
});
test('unverified research is not published and model failures do not escape into the caller',async()=>{
 const scout=createScout({mode:'rules',research:async()=>({}),accept:()=>false});assert.equal((await scout.observe(fixtures[0])).reason,'unverified');
 const failed=createScout({mode:'decisions',client:{evaluate:async()=>{throw Error('timeout');}},research:()=>assert.fail(),accept:()=>assert.fail()});assert.equal((await failed.observe(fixtures[0])).reason,'classification_failed');
});
test('research admission uses independent support, winning probability and separation rather than confidence alone',()=>{
 const response=(p=.75,confidence=.67,support=.95)=>({answers:[{type:'choice',name:'research_task',choice:'parent_invitation',confidence,probabilities:[{value:'none',probability:1-p},{value:'fee_waiver',probability:0},{value:'parent_invitation',probability:p},{value:'transit',probability:0}]},{type:'predicate',name:'task_supported',probability:support}]});
 assert.equal(selectedDecision(response()),'parent_invitation');
 assert.equal(selectedDecision(response(),.8),'none');
 assert.equal(selectedDecision(response(.51,.9)),'none','nearly tied choices remain withheld');
 assert.equal(selectedDecision(response(.99,.99,.4)),'none','high confidence does not authorize an unsupported task');
 assert.equal(selectedDecision(response(.75,.1)),'none');
 const bad=response();bad.answers[0].probabilities[0].probability=.9;assert.equal(selectedDecision(bad),'none');
});
