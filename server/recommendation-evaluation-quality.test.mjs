import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendationQualityReport,recommendationEvaluationRows} from './recommendation-evaluation-quality.mjs';
import {compareRecommendationPolicies,assertSeparatedEvaluationCases} from './recommendation-evaluation-reference.mjs';
import {decideRecommendation} from './recommendation-policy.mjs';
import {policyContext,policyNow} from './fixtures/recommendation-policy-cases.mjs';
const key=n=>n.toString(16).padStart(64,'0');
const rows=(n=20)=>Array.from({length:n},(_,i)=>({key:key(i+1),participant:key(i+1),sourceKey:key(100),status:i<n/2?'recommended':'clarification_required',considered:1,eligible:i<n/2?1:0,channel:'binder',language:i%2?'es':'en',latencyMs:200,displayed:i<n/2,played:false,accepted:i<n/2,outcome:'not_recorded',episodeKey:null,reportedAttempt:false,pending:false,adverse:false,unknown:false,declinedOutcome:false,supportedOutcome:false}));
test('fixed groups protect ten-account cells and complements, not merely ten receipts',()=>{
 const report=recommendationQualityReport(rows(),{period:'2026-10',synthetic:true});assert.equal(report.status,'available');assert.equal(report.metrics.accepted.count,10);assert.equal(report.metrics.accepted.rate,.5);assert.equal(report.metrics.complete_playback_observed.count,null);assert.equal(report.participants,20);
 const repeated=rows().map(r=>({...r,participant:key(1)}));assert.equal(recommendationQualityReport(repeated,{period:'2026-10'}).status,'suppressed');
 assert.equal(recommendationQualityReport(rows(19),{period:'2026-10'}).metrics.accepted.count,null);
 assert.equal(recommendationQualityReport(rows(),{period:'2026-10',limited:true}).selections,null);
 assert.throws(()=>recommendationQualityReport([...rows(),rows()[0]],{period:'2026-10'}));assert.doesNotMatch(JSON.stringify(report),/sourceKey|participantKey|episodeKey|"key"/);
});
test('multiple outcomes and missing returns never become supported success or failure',()=>{
 const input=rows(1)[0];const r=recommendationEvaluationRows({cutoff:'2026-11-02T12:00:00Z',definitions:[],items:[{...input,outcomes:[{},{}]}]})[0];assert.equal(r.outcome,'ambiguous');assert.equal(r.episodeKey,null);assert.equal(r.supportedOutcome,false);assert.equal(r.reportedAttempt,false);
 const report=recommendationQualityReport(rows(),{period:'2026-10'});assert.match(report.missingness,/never a failure/);assert.ok(report.unmeasured.includes('causal_effect'));
});
test('frozen reference comparison separates students and time and cannot promote',()=>{
 const report=compareRecommendationPolicies();assert.equal(report.passed,true);assert.equal(report.partition.heldout,16);assert.equal(report.promoted,false);assert.equal(report.baseline.heldout.metrics.inappropriateActions,0);
 assert.throws(()=>assertSeparatedEvaluationCases([{id:'a',participant:'same',at:'2026-10-01'}],[{id:'b',participant:'same',at:'2026-11-01'}]),/leakage/);
 assert.throws(()=>assertSeparatedEvaluationCases([{id:'a',participant:'a',at:'2026-12-01'}],[{id:'b',participant:'b',at:'2026-11-01'}]),/leakage/);
});
test('comparison rejects always-recommend and always-abstain policies without relaxing budgets',()=>{
 const unsafe=compareRecommendationPolicies({candidate:()=>decideRecommendation(policyContext(),{now:policyNow}),candidateVersion:'unsafe-synthetic-v1'});assert.equal(unsafe.passed,false);assert.ok(unsafe.candidate.heldout.metrics.inappropriateActions>0);
 const empty=compareRecommendationPolicies({candidate:()=>({decision:{status:'no_applicable_candidate',reason:'no_eligible_source'}}),candidateVersion:'empty-synthetic-v1'});assert.equal(empty.passed,false);assert.equal(empty.promoted,false);
});
