import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceIsCurrent,sameResearchSource} from './researchSourceValidity.mjs';
const day=86400000,clock=Date.parse('2026-11-12T16:00:00Z');
const iso=n=>new Date(n).toISOString();
export function catalogSource(){
 const checkedAt=iso(clock-day),url='https://financialaid.berkeley.edu/how-aid-works/student-budgets-cost-of-attendance/';
 return {url,checkedAt,catalogValidity:{version:1,kind:'local_testing_catalog',batchId:'a'.repeat(64),recordId:'UC-0005',recordDigest:'b'.repeat(64),sourceUrl:url,sourceCheckedAt:checkedAt,reviewedAt:iso(clock-12*3600000),retrievedAt:iso(clock),validUntil:iso(clock+30*day),reviewBasis:'workbook_reported'}};
}
test('catalog validity is independent of five-minute source age, including expiry boundary',()=>{
 const source=catalogSource(),original=structuredClone(source);
 for(const delta of [0,8*3600000,day,29*day])assert.equal(sourceIsCurrent(source,clock+delta),true);
 assert.equal(sourceIsCurrent(source,clock+30*day-1),true);
 assert.equal(sourceIsCurrent(source,clock+30*day),false);
 assert.deepEqual(source,original,'checking freshness never rewrites source review dates');
});
test('ordinary web results keep the five-minute policy',()=>{
 const source={url:catalogSource().url,checkedAt:iso(clock)};
 assert.equal(sourceIsCurrent(source,clock+299999),true);assert.equal(sourceIsCurrent(source,clock+300000),false);
 assert.equal(sourceIsCurrent(source,clock-1),false);
});
test('missing, mismatched or expired catalog contracts do not become fresh by changing a timestamp',()=>{
 for(const change of [s=>s.catalogValidity={},s=>s.catalogValidity=null,s=>s.catalogValidity.recordDigest='bad',s=>s.url+='other',s=>s.checkedAt=iso(clock),s=>s.catalogValidity.retrievedAt=iso(clock+1),s=>s.catalogValidity.validUntil=iso(clock),s=>s.catalogValidity.kind='reviewed_catalog']){
  const source=catalogSource();change(source);assert.equal(sourceIsCurrent(source,clock),false);
 }
});
test('deduplication retains record-specific approval and expiry',()=>{
 const a=catalogSource(),b=structuredClone(a);assert.equal(sameResearchSource(a,b),true);
 b.catalogValidity.validUntil=iso(clock+day);assert.equal(sameResearchSource(a,b),false);
 assert.equal(sameResearchSource({url:a.url,checkedAt:a.checkedAt},a),false);
});
