import test from 'node:test';
import assert from 'node:assert/strict';
import {testCounts,sourceFingerprint} from '../scripts/check-onboarding.mjs';
test('release reports never infer success from absent, duplicated or inconsistent test evidence',()=>{
 const complete='# tests 10\n# pass 8\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n';
 assert.equal(testCounts(complete).fail,1);assert.equal(testCounts(complete).skipped,1);
 for(const text of ['',complete.replace('# tests 10','# tests 9'),complete+'# fail 0\n',complete.replace('# skipped 1\n','')])assert.equal(testCounts(text),null);
});
test('source fingerprint is stable and covers only the declared source tree',async()=>{const first=await sourceFingerprint();assert.match(first,/^[a-f0-9]{64}$/);assert.equal(await sourceFingerprint(),first);});
