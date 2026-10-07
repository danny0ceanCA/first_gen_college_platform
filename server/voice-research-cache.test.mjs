import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceResearchCache,voiceResearchBudget,wantsFreshLookup} from '../src/voiceResearchCache.mjs';
test('live-call cache reuses exact verified questions, expires, and isolates context and sessions',()=>{
 let time=0;const cache=voiceResearchCache(()=>time);const query={mode:'admissions',language:'en',institution:'UC',question:'Fall 2027 transfer deadline'};const result={sources:[{url:'https://admission.universityofcalifornia.edu',checkedAt:'2026-10-03'}]};
 cache.put(query,result);assert.equal(cache.get(query),result);
 for(const change of [{language:'es'},{mode:'finance'},{institution:'CSU'},{question:'Fall 2027 first-year deadline'}])assert.equal(cache.get({...query,...change}),undefined);
 assert.equal(voiceResearchCache().get(query),undefined);
 time=300000;assert.equal(cache.get(query),undefined);
 cache.put(query,{error:'lookup_failed',sources:result.sources});assert.equal(cache.get(query),undefined);
 cache.put(query,{sources:[]});assert.equal(cache.get(query),undefined);
});

test('a requested fresh check invalidates cached evidence, including when the fresh lookup fails',()=>{
 const cache=voiceResearchCache(()=>0),q={mode:'planning',language:'es',institution:'UC',question:'A-G course approval'};
 cache.put(q,{sources:[{url:'https://ucop.edu/'}]});assert.ok(cache.get(q));
 assert.equal(cache.get({...q,forceRefresh:true}),undefined);assert.equal(cache.get(q),undefined);
 assert.equal(wantsFreshLookup('Revisa de nuevo para este año'),true);assert.equal(wantsFreshLookup('Please check again'),true);assert.equal(wantsFreshLookup('Explain that more simply'),false);
});
test('paid attempts are bounded without charging cache hits or retrying the same failing question forever',()=>{
 const budget=voiceResearchBudget({maxCalls:3,maxAttemptsPerQuestion:2}),q={mode:'finance',language:'en',institution:'',question:'Loan types'};
 assert.equal(budget.take(q),true);assert.equal(budget.take(q),true);assert.equal(budget.take(q),false);assert.equal(budget.used(),2);
 assert.equal(budget.take({...q,question:'Different question'}),true);assert.equal(budget.take({...q,question:'Fourth attempt'}),false);assert.equal(budget.used(),3);
});

test('formatting variations reuse results without merging different years',()=>{
 const cache=voiceResearchCache();const q={mode:'loans',language:'en',institution:'',question:'Loan limits 2026'};const r={sources:[{url:'https://studentaid.gov/'}]};cache.put(q,r);
 assert.equal(cache.get({...q,question:'  Loan   limits 2026  '}),r);
 assert.equal(cache.get({...q,question:'Loan limits 2027'}),undefined);
});
