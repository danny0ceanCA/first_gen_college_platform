// Synthetic engineering reference cases. This is NOT Phase 5's permissioned
// recommendation/outcome evaluation or a measured student-effectiveness study.
import {decideRecommendation} from './recommendation-policy.mjs';
import {rankBinderNextSteps,selectBinderOpening,NEXT_STEP_POLICY} from './binder-next-step.mjs';
import {policyCandidate,policyContext,policyId,policyNow,recommendationPolicyCases} from './fixtures/recommendation-policy-cases.mjs';
export function evaluateRecommendationPolicy(){
 const cases=recommendationPolicyCases().map(c=>{const result=decideRecommendation(c.context,{now:policyNow});return {name:c.name,expected:c.expected,observed:{status:result.decision.status,reason:result.decision.reason},passed:result.decision.status===c.expected.status&&result.decision.reason===c.expected.reason};});
 const baseline={role:'student',studentId:'alex',mode:'finance',experience:{usedApp:true},workspace:{available:true,scope:{kind:'student',studentId:'alex'},actions:[],notes:[]}};
 const comparisons=[];
 const cold=decideRecommendation(policyContext(),{now:policyNow});
 comparisons.push({name:'No saved history',baseline:selectBinderOpening(baseline,{now:policyNow})===null?'no_opening':'opening',newPolicy:cold.decision.status,expectedDifference:'The reviewed catalog adds a general office question for an explicit request; the legacy ranker only knows saved workspace items.',passed:selectBinderOpening(baseline,{now:policyNow})===null&&cold.decision.status==='recommended'});
 for(const status of ['complete','deferred']){
  const b=structuredClone(baseline);b.workspace.actions=[{action:'Ask the office.',title:'Ask the office',topic:'costs',status}];
  const c=policyContext();c.candidates[0].state=status;const d=decideRecommendation(c,{now:policyNow});
  comparisons.push({name:status+' action',baseline:rankBinderNextSteps(b,{now:policyNow}).length,newPolicy:d.decision.status,expectedDifference:'Both withhold a fresh action; neither changes stored status.',passed:rankBinderNextSteps(b,{now:policyNow}).length===0&&d.decision.status==='no_applicable_candidate'});
 }
 const dates=structuredClone(baseline);dates.workspace.actions=[{action:'Ask the office.',title:'Ask the office',topic:'costs',status:'not-started',personalTargetDate:'2026-11-01'}];
 const c=policyContext();c.candidates[0].candidate.source={kind:'accepted-action',planId:policyId(5),stepId:'accepted',planVersion:1};c.candidates[0].deadline={kind:'personal',on:'2026-11-01',timeZone:'America/Chicago',sourceId:null};c.intent='revisit_action';c.focus=c.candidates[0].candidate.source;
 const dateResult=decideRecommendation(c,{now:policyNow}),oldDate=rankBinderNextSteps(dates,{now:policyNow})[0];
 comparisons.push({name:'Passed personal target',baseline:oldDate.ranking.reasons,newPolicy:dateResult.trace.reasons,expectedDifference:'The new policy gives no urgency bonus to a passed personal target and makes no failure claim.',passed:oldDate.ranking.reasons.includes('personal-target-passed')&&!dateResult.trace.reasons.includes('future_target_date')&&dateResult.decision.status==='recommended'});
 const ambiguous=policyContext([policyCandidate(0,1),policyCandidate(0,2)]);ambiguous.candidates[1].candidate.action={en:'Ask about appointment availability.',es:'Pregunta por la disponibilidad de citas.'};
 const ambiguity=decideRecommendation(ambiguous,{now:policyNow});
 comparisons.push({name:'Equally suitable reviewed alternatives',baseline:'catalog_not_supported',newPolicy:ambiguity.decision.status,expectedDifference:'The new catalog requires clarification for materially different ties; the legacy ranker has no template catalog.',passed:ambiguity.decision.reason==='ambiguous_action'});
 const opening=selectBinderOpening({...baseline,openingDecision:{opening:null,reason:'student_priority'}},{now:policyNow});
 comparisons.push({name:'Existing null opening allowance',baseline:opening,newPolicy:'no_new_opening_in_step_3',expectedDifference:'The new internal selector cannot reserve or replace an opening. Voice/binder delivery remains step 4.',passed:opening===null});
 return {kind:'recommendation-policy-reference-review',version:1,policyVersion:'evidence-informed-v1',baselinePolicy:NEXT_STEP_POLICY,syntheticOnly:true,realStudentData:false,outcomeEvaluation:false,causalClaims:false,liveModelsTested:false,cases,comparisons,matched:cases.filter(c=>c.passed).length,passed:cases.every(c=>c.passed)&&comparisons.every(c=>c.passed)};
}
