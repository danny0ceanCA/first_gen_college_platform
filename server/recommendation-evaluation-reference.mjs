import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {decideRecommendation} from './recommendation-policy.mjs';
import {policyContext,policyCandidate,policyId,scopedPolicyContext,recommendationPolicyCases} from './fixtures/recommendation-policy-cases.mjs';
// Freeze expected behavior and budgets before considering any candidate. These
// engineering cases make no claim of measured effectiveness with students.
export const recommendationComparisonBudgets=Object.freeze({inappropriateActions:0,sourceErrors:0,decisionErrors:0,repetitionErrors:0,missingBilingualContent:0,p95PolicyMs:100});
const digest=value=>createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
export function assertSeparatedEvaluationCases(development,heldout){
 const people=new Set(development.map(c=>c.participant)),ids=new Set(development.map(c=>c.id));
 if(!development.length||!heldout.length||heldout.some(c=>people.has(c.participant)||ids.has(c.id))||new Set(heldout.map(c=>c.id)).size!==heldout.length||Math.max(...development.map(c=>Date.parse(c.at)))>=Math.min(...heldout.map(c=>Date.parse(c.at)))||[...development,...heldout].some(c=>!Number.isFinite(Date.parse(c.at))))throw Error('evaluation_partition_leakage');
}
export function recommendationHeldoutCases(){
 const rows=[],add=(name,context,status,reason,repetition=false)=>rows.push({id:'heldout-'+rows.length,participant:'heldout-student-'+rows.length,at:'2026-11-03T12:00:00.000Z',name,context,expected:{status,reason,source:status==='recommended'?context.candidates[0].candidate.source:null},repetition});
 for(const index of [0,1,2,3]){
  const c=policyContext([policyCandidate(index)]);Object.assign(c.facts,{document_requested:'yes',document_prepared:'yes',submission_reported:index===3?'yes':'no',decision_pending:'yes',decision_received:'no'});
  add('supported general question '+index,c,'recommended',index===0?'current_goal':'relevant_prerequisite');
 }
 for(const state of ['complete','deferred','declined']){const c=policyContext();c.candidates[0].state=state;c.candidates[0].candidate.expiresAt='2026-12-30T00:00:00.000Z';add('prior action state '+state,c,'no_applicable_candidate','no_eligible_source',true);}
 const conflict=policyContext([policyCandidate(1)]);conflict.facts.document_requested='conflict';add('contradictory requested document',conflict,'clarification_required','conflicting_evidence');
 const noDate=policyContext([policyCandidate(2)]);noDate.facts.document_requested='yes';add('unconfirmed preparation is not submission permission',noDate,'clarification_required','missing_prerequisite');
 const other=policyContext();other.candidates[0].studentId='another-student';add('private source cannot cross accounts',other,'no_applicable_candidate','no_eligible_source');
 const expiry=policyContext();expiry.candidates[0].candidate.expiresAt='2026-11-03T11:59:59.000Z';add('just-expired general source',expiry,'no_applicable_candidate','no_eligible_source');
 const campus=scopedPolicyContext();campus.scope.campus.id=policyId(444);add('verified policy for a different campus',campus,'no_applicable_candidate','no_eligible_source');
 const official=scopedPolicyContext();official.candidates[0].official.sourceRevision='c'.repeat(64);add('official receipt for a different revision',official,'unavailable','lookup_failed');
 const scope=scopedPolicyContext();scope.scope.term={state:'unknown',value:null};add('unknown term despite a known campus',scope,'clarification_required','missing_scope');
 const unavailable=policyContext();unavailable.candidates[0].availability='unavailable';add('lookup outage is not no applicable help',unavailable,'unavailable','source_unavailable');
 const goal=policyContext();goal.goal=null;add('missing goal without inferred identity',goal,'clarification_required','missing_goal');
 return rows;
}
function score(cases,policy){
 let inappropriateActions=0,sourceErrors=0,decisionErrors=0,repetitionErrors=0,missingBilingualContent=0,eligible=0,recommended=0,abstentions=0;const timings=[],results=[];
 for(const c of cases){const start=performance.now();const result=policy(structuredClone(c.context),{now:Date.parse(c.at)});timings.push(performance.now()-start);const d=result.decision,selected=d?.status==='recommended';
  if(c.expected.status==='recommended')eligible++;if(selected)recommended++;else abstentions++;
  const wrong=d?.status!==c.expected.status||d?.reason!==c.expected.reason;decisionErrors+=Number(wrong);inappropriateActions+=Number(selected&&c.expected.status!=='recommended');
  const sourceWrong=selected&&digest(d.candidate?.source)!==digest(c.expected.source||c.context.candidates[0]?.candidate.source);sourceErrors+=Number(sourceWrong);repetitionErrors+=Number(selected&&c.repetition===true);
  if(selected&&['en','es'].some(lang=>!d.candidate?.action?.[lang]?.trim()||!d.candidate?.explanation?.[lang]?.trim()))missingBilingualContent++;
  results.push({id:c.id,expected:c.expected.status,observed:d?.status||'invalid',reason:d?.reason||'invalid',passed:!wrong&&!sourceWrong});
 }
 timings.sort((a,b)=>a-b);const metrics={inappropriateActions,sourceErrors,decisionErrors,repetitionErrors,missingBilingualContent,p95PolicyMs:timings[Math.max(0,Math.ceil(timings.length*.95)-1)],applicableCases:eligible,recommended,abstentions,cases:cases.length};
 return {metrics,results,passed:Object.entries(recommendationComparisonBudgets).every(([key,max])=>metrics[key]<=max)};
}
export function compareRecommendationPolicies({candidate=decideRecommendation,candidateVersion='evidence-informed-v1-baseline-replay'}={}){
 if(typeof candidate!=='function'||!/^[-a-z0-9.]{1,100}$/.test(candidateVersion))throw Error('invalid_candidate_policy');
 const development=recommendationPolicyCases().map((c,i)=>({...c,id:'development-'+i,participant:'development-student-'+i,at:'2026-11-02T12:00:00.000Z'})),heldout=recommendationHeldoutCases();assertSeparatedEvaluationCases(development,heldout);
 const referenceDigest=digest({development,heldout,budgets:recommendationComparisonBudgets}),baseline={development:score(development,decideRecommendation),heldout:score(heldout,decideRecommendation)},proposal={development:score(development,candidate),heldout:score(heldout,candidate)};
 return {kind:'recommendation-evaluation-reference-comparison',version:1,syntheticOnly:true,realStudentData:false,referenceDigest,baselinePolicy:'evidence-informed-v1',candidateVersion,budgets:recommendationComparisonBudgets,partition:{unit:'synthetic_student',timeBoundary:'2026-11-03T00:00:00Z',development:development.length,heldout:heldout.length},baseline,candidate:proposal,
  passed:baseline.development.passed&&baseline.heldout.passed&&proposal.development.passed&&proposal.heldout.passed,promoted:false,
  limitations:['Default candidate replays the baseline; equivalence is not an improvement claim.','Reference cases check rules and source attribution, not live model explanations or student outcomes.','Bilingual presence is checked here; meaning and responsive layout require content/browser review.','Policy latency excludes database/provider/network latency; live selection latency is reported separately.','Any future permitted case evaluation must keep students disjoint and development timestamps before held-out timestamps. Private traces are not exported by this workflow.']};
}
