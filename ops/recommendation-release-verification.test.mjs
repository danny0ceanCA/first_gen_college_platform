import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendationBrowserComplete,recommendationReleaseComplete,recommendationReleaseStages,recommendationReleaseVersions,recommendationBrowserCounts,recommendationExternalChecks,summarizeRecommendationReferences} from './recommendation-release-verification.mjs';
import {outcomeBrowserCounts,outcomeExternalChecks} from './outcome-release-verification.mjs';
import {evaluateRecommendationPolicy} from '../server/recommendation-policy-review.mjs';
import {compareRecommendationPolicies} from '../server/recommendation-evaluation-reference.mjs';
const fingerprint='a'.repeat(64),policy=evaluateRecommendationPolicy(),comparison={...compareRecommendationPolicies(),candidateDigest:null,sourceFingerprint:fingerprint};
function browser(kind){
 const base={kind:`recommendation-${kind}-browser-verification`,passed:true,realDatabase:true};
 const wl=[1280,390,320].flatMap(width=>['en','es'].map(language=>({width,language,passed:true})));
 if(kind==='library')return {...base,journeys:[1280,390,320].map(width=>({width,passed:true,...Object.fromEntries(['bilingualPreview','realDatabase','lostSave','lostPublish','conflictingRevision','scopedPolicy','revocation','navigationGuard'].map(k=>[k,true]))}))};
 if(kind==='evaluation')return {...base,journeys:wl.map(r=>({...r,...Object.fromEntries(['realDatabase','explicitOptIn','lostResponse','prospectiveDisplay','malformedCapabilityRecovery','pausedWithdrawal','noGuidanceChanges','noOverflow'].map(k=>[k,true]))}))};
 if(kind==='acceptance')return {...base,liveProviders:false,journeys:wl.flatMap(r=>[{...r,surface:'binder',realDatabase:true,explicitApproval:true,lostSave:true,duplicatePrevention:true,revocation:true,noOverflow:true},...['live','realtime'].map(provider=>({...r,surface:'voice',provider,realDatabase:true,explicitApproval:true,syntheticAudio:true,canonicalSave:true,noNewOpening:true}))])};
 return {...base,schemaVersion:1,syntheticIdentity:true,syntheticSpeech:true,disposablePostgres:true,journeys:wl.flatMap(r=>['live','realtime'].map(entry=>({...r,entry,stages:[...recommendationReleaseStages]})))};
}
function record(){
 const prior={kind:'outcome-evidence-local-verification',schemaVersion:1,localOnly:true,startedAt:'2026-11-02T00:00:00Z',checkedAt:'2026-11-02T01:00:00Z',sourceFingerprint:fingerprint,disposablePostgres:true,syntheticIdentity:true,syntheticSpeech:true,browserConcurrency:2,productionEnabled:false,sourceUnchanged:true,typecheck:true,build:true,logging:true,passed:true,runtime:{node:'v24.19.0',postgres:'17',playwright:'1.57.0',chromium:'154'},suites:Object.fromEntries(['server','operations'].map(id=>[id,{tests:20,pass:20,fail:0,skipped:0,cancelled:0,todo:0,passed:true}])),browsers:Object.fromEntries(Object.entries(outcomeBrowserCounts).map(([id,journeys])=>[id,{journeys,passed:true}])),caseReview:{kind:'outcome-definition-case-review',version:1,ruleVersion:'outcome-assessment-v1',referenceReview:'engineering_contract_review',institutionalReview:'not_performed',passed:true,cases:26,matched:26,disagreements:[]},externalChecksNotPerformed:[...outcomeExternalChecks]};
 return {kind:'recommendation-local-verification',schemaVersion:1,localOnly:true,startedAt:prior.startedAt,checkedAt:prior.checkedAt,sourceFingerprint:fingerprint,sourceUnchanged:true,versions:{...recommendationReleaseVersions},priorPhases:prior,browsers:Object.fromEntries(Object.entries(recommendationBrowserCounts).map(([id,journeys])=>[id,{journeys,passed:true}])),references:summarizeRecommendationReferences(policy,comparison,fingerprint),productionEnabled:false,externalChecksNotPerformed:[...recommendationExternalChecks],passed:false};
}
test('all Phase 5 browser matrices reject missing, repeated or weakened journeys',()=>{
 for(const kind of Object.keys(recommendationBrowserCounts)){
  assert.equal(recommendationBrowserComplete(browser(kind),kind),true,kind);
  for(const mutate of [r=>r.journeys.pop(),r=>r.journeys[1]=r.journeys[0],r=>r.journeys[0].passed=false,r=>r.journeys[0].width=360,r=>r.passed=false,r=>r.kind='unrelated']){const r=browser(kind);mutate(r);assert.equal(recommendationBrowserComplete(r,kind),false,kind);}
 }
 for(const [kind,key] of [['library','revocation'],['acceptance','lostSave'],['evaluation','pausedWithdrawal'],['evaluation','malformedCapabilityRecovery']]){const r=browser(kind);r.journeys[0][key]=false;assert.equal(recommendationBrowserComplete(r,kind),false);}
 const connected=browser('connected');connected.journeys[0].stages.pop();assert.equal(recommendationBrowserComplete(connected,'connected'),false);
});
test('reference evidence freezes policy, partition, source, budgets and baseline-only comparison',()=>{
 assert.equal(summarizeRecommendationReferences(policy,comparison,fingerprint).passed,true);
 for(const mutate of [c=>c.sourceFingerprint='b'.repeat(64),c=>c.referenceDigest='b'.repeat(64),c=>c.promoted=true,c=>c.candidateDigest='b'.repeat(64),c=>c.partition.heldout=15,c=>c.budgets.sourceErrors=1,c=>c.candidate.heldout.metrics.sourceErrors=1,c=>c.baseline.development.metrics.p95PolicyMs=101,c=>c.candidate.heldout.results[1]=c.candidate.heldout.results[0],c=>c.candidate.heldout.results[0].passed=false]){const c=structuredClone(comparison);mutate(c);assert.throws(()=>summarizeRecommendationReferences(policy,c,fingerprint));}
 const p=structuredClone(policy);p.comparisons.pop();assert.throws(()=>summarizeRecommendationReferences(p,comparison,fingerprint));
});
test('Phase 5 release requires zero-skip prior phases, source consistency, exact counts and complete toolchain',()=>{
 assert.equal(recommendationReleaseComplete(record()),true);
 for(const mutate of [r=>r.priorPhases.suites.server.skipped=1,r=>r.priorPhases.suites.operations.todo=1,r=>r.priorPhases.passed=false,r=>r.priorPhases.sourceFingerprint='b'.repeat(64),r=>delete r.priorPhases.browsers.workflow,r=>delete r.priorPhases.runtime.chromium,r=>r.browsers.acceptance.journeys=17,r=>delete r.browsers.connected,r=>r.versions.policy='new-policy',r=>r.sourceUnchanged=false,r=>r.references.metrics['candidate-heldout'].inappropriateActions=1,r=>r.references.budgets.p95PolicyMs=200,r=>r.references.promoted=true,r=>r.productionEnabled=true,r=>r.externalChecksNotPerformed.pop(),r=>r.studentText='private',r=>r.references.studentText='private',r=>r.browsers.library.privateData='private',r=>r.references.metrics['baseline-heldout'].studentText='private']){const r=record();mutate(r);assert.equal(recommendationReleaseComplete(r),false);}
});
