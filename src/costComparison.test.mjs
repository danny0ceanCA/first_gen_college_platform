import test from 'node:test';
import assert from 'node:assert/strict';
import {costComparisonFacts} from './costComparison.mjs';

function report(subject,total,fees,overrides={}){
 const budget={year:'2026-27',population:'Undergraduate; California resident; 2026-27',currency:'USD',period:'academic_year',housing:'renting',assumed:false,total,sourceCitation:'[1]',complete:true,
  expectedCategories:['tuition_fees','housing','food'],components:[['tuition_fees',fees],['housing',10000],['food',5000]].map(([key,amount])=>({key,sourceLabel:key,amount,role:'component',qualification:''})),...overrides};
 return {sources:[{url:'https://example.edu/cost',checkedAt:new Date().toISOString()}],voiceBrief:{status:'partial',answer:'Published estimate. [1]',qualification:'Published benchmark, not a bill. [1]',nextStep:'',findings:[{subject,aspect:'total_budget',status:'partial',answer:`Published total $${total} [1].`,qualification:'Published benchmark, not a bill; components may differ. [1]',budget}]}};
}

for(const language of ['en','es'])test(`${language}: signed differences distinguish tuition from totals and retain source uncertainty`,()=>{
 const davis=report('UC Davis — Renting off campus',44760,18263);
 const berkeley=report('UC Berkeley — Renting off campus',49692,18214);
 const riverside=report('UC Riverside — Published off-campus benchmark',44329,16790,{housing:'off_campus',population:'Undergraduate; California resident / AB540 eligible; 2026-2027'});
 const before=JSON.stringify([riverside,davis,berkeley]);
 let facts=costComparisonFacts(riverside,[davis,berkeley]);
 assert.equal(facts.peers[0].totalDifference,-431);assert.equal(facts.peers[0].tuitionFeesDifference,-1473);
 assert.equal(facts.peers[0].totalRelation,'lower');
 facts=costComparisonFacts(davis,[berkeley]);
 assert.equal(facts.peers[0].totalDifference,-4932);assert.equal(facts.peers[0].tuitionFeesDifference,49);
 assert.equal(facts.peers[0].totalRelation,'lower');assert.equal(facts.peers[0].tuitionFeesRelation,'higher');
 assert.match(facts.basis,/Negative.*lower/);assert.match(facts.basis,/caveats/);
 assert.equal(JSON.stringify([riverside,davis,berkeley]),before);
});

test('incompatible years, populations, periods and housing do not produce misleading differences',()=>{
 const left=report('Left',40000,15000);
 for(const scope of [{year:'2025-26'},{currency:'EUR'},{period:'semester'},{housing:'with_family'},{housing:'on_campus'},{population:'Graduate; California resident'},{population:'Undergraduate; California resident; 2025-26'}])
  assert.equal(costComparisonFacts(left,[report('Other',30000,12000,scope)]),null);
 const same=costComparisonFacts(left,[report('Other',40000,15000)]);
 assert.equal(same.peers[0].totalDifference,0);
 const decimals=costComparisonFacts(report('Left',40000.1,15000.1),[report('Right',40000.09,15000.09)]);
 assert.equal(decimals.peers[0].totalDifference,.01);
 const unknown=report('Other',30000,12000);unknown.voiceBrief.findings[0].status='unverified';
 assert.equal(costComparisonFacts(left,[unknown]),null);
 const stale=report('Stale',30000,12000);stale.sources[0].checkedAt=new Date(Date.now()-301000).toISOString();
 assert.equal(costComparisonFacts(left,[stale]),null,'expired sources cannot supply a new comparison');
});
