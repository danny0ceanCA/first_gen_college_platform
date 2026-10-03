import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceResearchCache} from '../src/voiceResearchCache.mjs';
test('live-call cache reuses exact verified questions, expires, and isolates context and sessions',()=>{
 let time=0;const cache=voiceResearchCache(()=>time);const query={mode:'admissions',language:'en',institution:'UC',question:'Fall 2027 transfer deadline'};const result={sources:[{url:'https://admission.universityofcalifornia.edu',checkedAt:'2026-10-03'}]};
 cache.put(query,result);assert.equal(cache.get(query),result);
 for(const change of [{language:'es'},{mode:'finance'},{institution:'CSU'},{question:'Fall 2027 first-year deadline'}])assert.equal(cache.get({...query,...change}),undefined);
 assert.equal(voiceResearchCache().get(query),undefined);
 time=300000;assert.equal(cache.get(query),undefined);
 cache.put(query,{error:'lookup_failed',sources:result.sources});assert.equal(cache.get(query),undefined);
 cache.put(query,{sources:[]});assert.equal(cache.get(query),undefined);
});
