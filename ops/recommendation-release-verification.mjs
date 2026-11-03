import {outcomeReleaseComplete,outcomeExternalChecks} from './outcome-release-verification.mjs';
export const recommendationReleaseStages=Object.freeze(['reviewed-library','permitted-context','prospective-evaluation-choice','guarded-recommendation','exact-binder-acceptance','approved-check-in','heard-private-readback','private-report','heard-outcome-readback','typed-outcome-provenance','approved-disclosure','audience-assessment','private-correction','suppressed-evaluation','paused-evaluation-withdrawal','source-invalidation']);
export const recommendationBrowserCounts=Object.freeze({library:3,acceptance:18,evaluation:6,connected:12});
export const recommendationReleaseVersions=Object.freeze({policy:'evidence-informed-v1',libraryContract:1,recommendationContract:1,outcomeProvenance:'recommendation-provenance-v1',evaluationContract:1,migrationsThrough:120});
export const recommendationExternalChecks=Object.freeze([...outcomeExternalChecks,'physical-device-accessibility-and-bilingual-meaning-review','reviewed-library-publication-and-institutional-applicability']);
export const recommendationReferenceDigest='bcedc20720df937043bddb1900ba23dc083ad7855b3e2566be6faed0be283bd2';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const everyTrue=(r,keys)=>keys.every(k=>r[k]===true);
const matrix=(rows,keys,key)=>Array.isArray(rows)&&rows.length===keys.length&&keys.every(k=>rows.filter(r=>r.passed===true&&key(r)===k).length===1);
export function recommendationBrowserComplete(record,kind){
 if(!record||record.passed!==true||!Array.isArray(record.journeys))return false;
 const rows=record.journeys,wl=[1280,390,320].flatMap(w=>['en','es'].map(l=>`${w}:${l}`));
 if(kind==='connected')return record.kind==='recommendation-connected-browser-verification'&&record.schemaVersion===1&&everyTrue(record,['syntheticIdentity','syntheticSpeech','disposablePostgres'])&&matrix(rows,wl.flatMap(k=>['live','realtime'].map(e=>`${k}:${e}`)),r=>`${r.width}:${r.language}:${r.entry}`)&&rows.every(r=>same(r.stages,recommendationReleaseStages));
 if(record.realDatabase!==true||record.kind!==`recommendation-${kind}-browser-verification`)return false;
 if(kind==='library')return matrix(rows,[1280,390,320],r=>r.width)&&rows.every(r=>everyTrue(r,['bilingualPreview','realDatabase','lostSave','lostPublish','conflictingRevision','scopedPolicy','revocation','navigationGuard']));
 if(kind==='acceptance')return record.liveProviders===false&&matrix(rows,wl.flatMap(k=>['binder','live','realtime'].map(e=>`${k}:${e}`)),r=>`${r.width}:${r.language}:${r.surface==='binder'?'binder':r.surface==='voice'?r.provider:'invalid'}`)&&rows.every(r=>everyTrue(r,['realDatabase','explicitApproval',...(r.surface==='binder'?['lostSave','duplicatePrevention','revocation','noOverflow']:['syntheticAudio','canonicalSave','noNewOpening'])]));
 if(kind==='evaluation')return matrix(rows,wl,r=>`${r.width}:${r.language}`)&&rows.every(r=>everyTrue(r,['realDatabase','explicitOptIn','lostResponse','prospectiveDisplay','malformedCapabilityRecovery','pausedWithdrawal','noGuidanceChanges','noOverflow']));
 return false;
}
const budgets=Object.freeze({inappropriateActions:0,sourceErrors:0,decisionErrors:0,repetitionErrors:0,missingBilingualContent:0,p95PolicyMs:100});
export function summarizeRecommendationReferences(policy,comparison,fingerprint){
 const p=policy,c=comparison;
 if(p?.kind!=='recommendation-policy-reference-review'||p.version!==1||p.policyVersion!==recommendationReleaseVersions.policy||p.passed!==true||p.syntheticOnly!==true||p.realStudentData!==false||p.causalClaims!==false||p.liveModelsTested!==false||p.matched!==32||!Array.isArray(p.cases)||p.cases.length!==32||!p.cases.every(r=>r.passed===true)||new Set(p.cases.map(r=>r.name)).size!==32||!Array.isArray(p.comparisons)||p.comparisons.length!==6||!p.comparisons.every(r=>r.passed===true)||new Set(p.comparisons.map(r=>r.name)).size!==6)throw Error('recommendation_policy_reference_incomplete');
 if(c?.kind!=='recommendation-evaluation-reference-comparison'||c.version!==1||c.passed!==true||c.syntheticOnly!==true||c.realStudentData!==false||c.promoted!==false||c.candidateDigest!==null||c.sourceFingerprint!==fingerprint||c.referenceDigest!==recommendationReferenceDigest||c.baselinePolicy!==recommendationReleaseVersions.policy||c.candidateVersion!=='evidence-informed-v1-baseline-replay'||!same(c.budgets,budgets)||!same(c.partition,{unit:'synthetic_student',timeBoundary:'2026-11-03T00:00:00Z',development:32,heldout:16}))throw Error('recommendation_comparison_incomplete');
 const metrics={};for(const mode of ['baseline','candidate'])for(const [partition,count] of [['development',32],['heldout',16]]){
  const r=c[mode]?.[partition],m=r?.metrics;
  if(r?.passed!==true||!m||m.cases!==count||!Number.isFinite(m.p95PolicyMs)||m.p95PolicyMs<0||Object.entries(budgets).some(([k,max])=>!Number.isFinite(m[k])||m[k]<0||m[k]>max)||!Array.isArray(r.results)||r.results.length!==count||!Array.from({length:count},(_,i)=>`${partition}-${i}`).every(id=>r.results.filter(row=>row.id===id&&row.passed===true&&row.observed===row.expected).length===1))throw Error('recommendation_comparison_cases_failed');
  metrics[`${mode}-${partition}`]={cases:count,...Object.fromEntries(Object.keys(budgets).map(k=>[k,m[k]]))};
 }
 return {passed:true,referenceDigest:c.referenceDigest,policyCases:32,legacyComparisons:6,development:32,heldout:16,baselineReplay:true,promoted:false,budgets:{...budgets},metrics};
}
export function recommendationReleaseComplete(r){
 const fields=['kind','schemaVersion','localOnly','sourceFingerprint','sourceUnchanged','startedAt','checkedAt','versions','priorPhases','browsers','references','externalChecksNotPerformed','productionEnabled','passed'];
 if(!only(r,fields)||r.kind!=='recommendation-local-verification'||r.schemaVersion!==1||r.localOnly!==true||r.productionEnabled!==false||r.sourceUnchanged!==true||!same(r.versions,recommendationReleaseVersions)||!same(r.externalChecksNotPerformed,recommendationExternalChecks))return false;
 const prior=r.priorPhases;if(!outcomeReleaseComplete(prior)||prior.passed!==true||prior.sourceFingerprint!==r.sourceFingerprint||prior.startedAt!==r.startedAt||prior.checkedAt!==r.checkedAt||!['node','postgres','playwright','chromium'].every(k=>typeof prior.runtime?.[k]==='string'&&prior.runtime[k].length>0))return false;
 if(!only(r.browsers,Object.keys(recommendationBrowserCounts))||!Object.entries(recommendationBrowserCounts).every(([id,count])=>only(r.browsers[id],['passed','journeys'])&&r.browsers[id].passed===true&&r.browsers[id].journeys===count))return false;
 const c=r.references;if(!only(c,['passed','referenceDigest','policyCases','legacyComparisons','development','heldout','baselineReplay','promoted','budgets','metrics'])||c.passed!==true||c.referenceDigest!==recommendationReferenceDigest||c.policyCases!==32||c.legacyComparisons!==6||c.development!==32||c.heldout!==16||c.baselineReplay!==true||c.promoted!==false||!same(c.budgets,budgets))return false;
 const ids=['baseline-development','baseline-heldout','candidate-development','candidate-heldout'];
 return only(c.metrics,ids)&&ids.every(id=>{const m=c.metrics[id];return only(m,['cases',...Object.keys(budgets)])&&m.cases===(id.endsWith('heldout')?16:32)&&Object.entries(budgets).every(([k,max])=>Number.isFinite(m[k])&&m[k]>=0&&m[k]<=max);});
}
