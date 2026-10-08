import test from 'node:test';
import assert from 'node:assert/strict';
import {createSummaryReviewer,validateSummaryReview} from './summary-quality.mjs';
const turns=[{role:'user',text:'PRIVATE: I was considering a loan.'},{role:'user',text:'Correction: I have not applied. What are my options?'}];
test('review output strips prose and accepts only bounded categories and actual turn ordinals',()=>{
 const findings=validateSummaryReview({findings:[{category:'summary_commitment',confidence:'high',turns:[1,1],reason:'PRIVATE'}]},turns);
 assert.equal(findings[0].evidence.length,1);assert.ok(!JSON.stringify(findings).includes('PRIVATE'));
 for(const change of [{category:'invented'},{confidence:'certain'},{turns:[2]},{turns:[]}])assert.throws(()=>validateSummaryReview({findings:[{category:'summary_commitment',confidence:'high',turns:[1],...change}]},turns));
});
test('bilingual fidelity policy and corrections are included; valid empty review is checked',async()=>{
 let body;const review=createSummaryReviewer({OPENAI_API_KEY:'test'},async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"findings":[]}'}]}]})};});
 assert.equal((await review('No application yet.',turns)).status,'checked');
 assert.match(body.instructions,/English and Spanish semantically/);assert.match(body.instructions,/correction supersedes/);assert.match(body.instructions,/Silence, thanks/);assert.equal(body.store,false);assert.equal(body.max_output_tokens,700);
});
test('failure, incomplete output and missing or oversized evidence are not passes',async()=>{
 let calls=0;const review=createSummaryReviewer({OPENAI_API_KEY:'test'},async()=>{calls++;return {ok:true,json:async()=>({status:'incomplete',output:[]})};});
 assert.equal((await review('Summary',turns)).status,'failed');
 assert.equal((await review('Summary',[])).status,'unavailable');
 assert.equal((await review('Summary',[{role:'user',text:'x'.repeat(48000)}])).status,'too_large');assert.equal(calls,1);
 assert.equal((await createSummaryReviewer({})('Summary',turns)).status,'unavailable');
});
