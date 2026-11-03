import test from 'node:test';
import assert from 'node:assert/strict';
import {decideRecommendation,recommendationTextKey,recommendationExplanation,validateRecommendationSelectionRequest,recommendationDecisionInstructions} from './recommendation-policy.mjs';
import {selectBinderRecommendation,recommendationRequestAllowed,selectBinderOpening} from './binder-next-step.mjs';
import {policyNow as now,policyId,policyCandidate,policyContext,scopedPolicyContext,recommendationPolicyCases} from './fixtures/recommendation-policy-cases.mjs';
import {evaluateRecommendationPolicy} from './recommendation-policy-review.mjs';
const decide=c=>decideRecommendation(c,{now});
const request=()=>({studentId:'alex',language:'en',intent:'next_action',goal:'understand_requirement',process:'office_contact',focus:null,episodes:[],timeZone:'America/Chicago'});
const interaction=r=>({trigger:'student_request',role:'student',targetConfirmed:true,studentId:r.studentId,intent:r.intent,goal:r.goal,process:r.process,focus:r.focus});
for(const c of recommendationPolicyCases())test('policy: '+c.name,()=>{const before=structuredClone(c.context),result=decide(c.context);assert.equal(result.decision.status,c.expected.status);assert.equal(result.decision.reason,c.expected.reason);assert.deepEqual(c.context,before);assert.deepEqual(result,decide(c.context));});
test('closed intent and feature contracts reject sensitive features, invented authority and unsupported inputs',()=>{
 const r=request();assert.deepEqual(validateRecommendationSelectionRequest(r),r);
 for(const extra of [{healthDetails:'private'},{ethnicity:'private'},{coordinatorPopularity:90},{familyDisclosures:[]},{confirmedCampus:policyId(2)},{facts:{document_requested:'yes'}},{officialVerified:true},{candidates:[]},{successProbability:0.99}])assert.throws(()=>validateRecommendationSelectionRequest({...r,...extra}),{status:400});
 for(const patch of [{goal:'maximize_score'},{process:'general_chat'},{timeZone:'Not/AZone'},{focus:{kind:'reviewed-template',teachingId:policyId(4),revision:2}},{intent:'revisit_action'},{episodes:[{id:policyId(3),version:1}]}])assert.throws(()=>validateRecommendationSelectionRequest({...r,...patch}),{status:400});
 for(const extra of [{ethnicity:'any'},{language:'es'},{inferredVulnerability:4},{coordinatorPopularity:50}])assert.throws(()=>decide({...policyContext(),...extra}),{status:400});
 assert.throws(()=>decide({...policyContext(),facts:{...policyContext().facts,document_requested:true}}),{status:400});
 assert.match(recommendationDecisionInstructions,/untrusted reference data/);assert.match(recommendationDecisionInstructions,/Never rerank alternatives/);assert.match(recommendationDecisionInstructions,/grants no save/);
});
test('exact duplicates are language independent; conflict cannot be hidden by duplicate identity',()=>{
 const c=policyContext();for(const language of ['en','es']){const copy=structuredClone(c);copy.duplicates=[{keys:[recommendationTextKey('  '+copy.candidates[0].candidate.action[language].toUpperCase()+'  ')],state:'deferred'}];assert.equal(decide(copy).decision.status,'no_applicable_candidate');}
 c.candidates.push(structuredClone(c.candidates[0]));assert.equal(decide(c).trace.eligible,1);
 c.candidates[1].state='deferred';assert.equal(decide(c).decision.reason,'source_unavailable');
 const tied=policyContext([policyCandidate(0,3),policyCandidate(0,2),policyCandidate(0,1)]);const first=decide(tied).decision;tied.candidates.reverse();assert.deepEqual(decide(tied).decision,first);assert.equal(first.candidate.source.teachingId,policyId(1));
});
test('student priority and the existing opening allowance cannot be converted to a new recommendation',()=>{
 const c=policyContext(),i=interaction(request());assert.equal(selectBinderRecommendation(i,c,{now}).decision.status,'recommended');
 for(const patch of [{trigger:'opening'},{targetConfirmed:false},{role:'parent'},{studentId:'sam'},{goal:'check_decision'},{process:'insurance_waiver'},{intent:'revisit_action'},{focus:undefined},{onboarding:true},{scopeRestart:true},{workspaceRefreshOnly:true},{reconnecting:true},{declined:true},{deferred:true},{questionChanged:true},{selection:'note'},{selection:'point'}]){
  assert.equal(recommendationRequestAllowed({...i,...patch},request()),false);assert.equal(selectBinderRecommendation({...i,...patch},c,{now}).decision.reason,'student_priority');
 }
 // An explicitly requested answer may follow an earlier null opening, but no
 // selection or metadata grants a proactive opening by itself.
 const original={...i,openingDecision:{opening:null,reason:'already_offered'}};
 assert.equal(selectBinderOpening(original),null);assert.equal(selectBinderRecommendation({...original,trigger:'opening'},c,{now}).decision.reason,'student_priority');assert.equal(selectBinderOpening(original),null);
});
test('an applicable conflict cannot be offset by another eligible action',()=>{
 const c=policyContext([policyCandidate(0,1),policyCandidate(0,2)]);c.candidates[1].state='conflict';
 assert.equal(decide(c).decision.reason,'conflicting_evidence');c.candidates.reverse();assert.equal(decide(c).decision.reason,'conflicting_evidence');
 c.candidates[0].candidate.scope.campus={state:'confirmed',id:policyId(90)};c.scope.campus={state:'confirmed',id:policyId(91)};
 assert.equal(decide(c).decision.status,'recommended','a conflict about another campus is not imported');
});
test('personal target dates use local dates, preserve unknown dates and never imply failure',()=>{
 const row=policyCandidate();row.candidate.source={kind:'accepted-action',planId:policyId(2),stepId:'accepted',planVersion:1};row.deadline={kind:'personal',on:'2026-11-02',timeZone:'America/Los_Angeles',sourceId:null};
 const c=policyContext([row]);c.intent='revisit_action';c.focus=row.candidate.source;
 const midnight=Date.parse('2026-11-03T01:00:00.000Z');assert.ok(decideRecommendation(c,{now:midnight}).trace.reasons.includes('future_target_date'));
 row.deadline.timeZone='UTC';assert.deepEqual(decideRecommendation(c,{now:midnight}).trace.reasons,['accepted_work']);assert.equal(decideRecommendation(c,{now:midnight}).decision.status,'recommended');
 for(const on of ['2026-02-30','unknown','2020-01-01']){row.deadline.on=on;assert.deepEqual(decide(c).trace.reasons,['accepted_work']);}
 c.timeZone=null;row.deadline.on='2026-11-04';assert.deepEqual(decide(c).trace.reasons,['accepted_work']);
});
test('official deadline priority needs exact current policy support and never invents a deadline from prose',()=>{
 const c=scopedPolicyContext();c.candidates[0].deadline={kind:'official',on:'2026-11-03',timeZone:'America/Chicago',sourceId:policyId(90)};
 assert.ok(decide(c).trace.reasons.includes('future_target_date'));
 c.candidates[0].deadline.sourceId=policyId(91);assert.deepEqual(decide(c).trace.reasons,['relevant_prerequisite']);
 c.candidates[0].official.sourceRevision='c'.repeat(64);assert.equal(decide(c).decision.status,'unavailable');
});
test('equivalent English and Spanish explanations preserve source, uncertainty and authored wording',()=>{
 const result=decide(policyContext());assert.match(recommendationExplanation(result,'en'),/reviewed question/);assert.match(recommendationExplanation(result,'es'),/pregunta revisada/);
 const missing=decide(policyContext([policyCandidate(1)]));assert.equal(recommendationExplanation(missing,'es'),'¿La oficina responsable te ha pedido un documento específico?');
 assert.doesNotMatch(JSON.stringify(result),/successProbability|confidence|score/);
});
test('a verified passed submission deadline is an exclusion, not a lower ranking',()=>{
 const c=scopedPolicyContext();c.goal=c.candidates[0].candidate.goal='submit_document';
 c.candidates[0].deadline={kind:'official',on:'2026-11-01',timeZone:'America/Chicago',sourceId:policyId(90)};
 const result=decide(c);assert.equal(result.decision.status,'no_applicable_candidate');assert.equal(result.trace.excluded[0].reason,'expired_requirement');
 c.timeZone=null;assert.equal(decide(c).decision.status,'no_applicable_candidate','the verified deadline timezone is sufficient to exclude an expired requirement');
 c.candidates[0].deadline.on='2026-11-03';assert.equal(decide(c).decision.status,'recommended');
});
test('synthetic comparison documents behavior differences without inventing outcome evidence',()=>{
 const report=evaluateRecommendationPolicy();assert.equal(report.passed,true);assert.equal(report.cases.length,32);assert.equal(report.matched,32);assert.equal(report.comparisons.length,6);assert.equal(report.realStudentData,false);assert.equal(report.outcomeEvaluation,false);assert.equal(report.causalClaims,false);
});
