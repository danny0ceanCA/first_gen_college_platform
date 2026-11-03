// Shape validation never establishes source authority, student consent or eligibility.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const RECOMMENDATION_CONTRACT_VERSION=1;
export const RECOMMENDATION_POLICY_VERSION='evidence-informed-v1';
export const RECOMMENDATION_EVALUATION_PURPOSE='recommendation_evaluation';
export const recommendationContract=freeze({
 version:1,policyVersion:RECOMMENDATION_POLICY_VERSION,
 sourceKinds:['accepted-action','review-response','reviewed-template'],
 decisionStates:['recommended','clarification_required','no_applicable_candidate','unavailable'],
 purposes:{guidance:'personal_guidance',evaluation:RECOMMENDATION_EVALUATION_PURPOSE},
 limits:{candidates:50,supportingSources:8,conditions:12,statementTimeoutMs:3000,retainedUnacceptedDecisions:0,temporaryApprovalMinutes:5},
 authority:{canRecommend:false,canAccept:false,canPublish:false,canEvaluate:false},
 excludedFeatures:['ethnicity','immigration_status','health_details','family_disclosures','inferred_vulnerability','coordinator_popularity'],
 permissions:{resolve:'current-own-student-scope-and-exact-source',publish:'separate-reviewed-library-authority',accept:'exact-binder-or-audible-preview-and-subsequent-approval',evaluate:'separate-purpose-and-exact-source-opt-in'},
 lifecycle:{unaccepted:'temporary-approval-references-and-hashes-no-decision-history',accepted:'canonical-action-reference-no-duplicate-prose',sourceChanged:'invalidate-recommendation-preserve-independent-action',privateCorrection:'invalidate-private-derivatives-preserve-approved-shared-snapshot',evaluation:'separate-prospective-90-day-organization-permission',deletion:'cascade-with-student-plan-and-approved-episode',restore:'clear-temporary-approvals-and-outcome-links-preserve-independent-actions'},
 evidenceMeaning:{displayed:'not-acceptance',played:'not-comprehension',accepted:'not-follow-up-or-sharing-consent',outcome:'not-causal-success',service_quality:'not-recommendation-evaluation-permission'}
});
const fail=()=>{throw Object.assign(Error('invalid_recommendation_contract'),{status:400});};
const object=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();};
const text=(v,max=128)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const version=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;
const digest=v=>typeof v==='string'&&/^[a-f\d]{64}$/.test(v);
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const bilingual=v=>{object(v,['en','es']);if(!text(v.en,1000)||!text(v.es,1000))fail();return {...v};};
const list=(v,allowed,max)=>{if(!Array.isArray(v)||v.length>max||new Set(v).size!==v.length||v.some(x=>!allowed.includes(x)))fail();return [...v];};
export function validateRecommendationSource(v){
 const fields={'accepted-action':['kind','planId','stepId','planVersion'],'review-response':['kind','requestId','responseVersion','organizationId'],'reviewed-template':['kind','teachingId','revision']};
 if(!v||!Object.hasOwn(fields,v.kind))fail();object(v,fields[v.kind]);
 for(const k of ['planId','requestId','organizationId','teachingId'])if(k in v&&!uuid(v[k]))fail();
 for(const k of ['planVersion','responseVersion','revision'])if(k in v&&!version(v[k]))fail();
 if('stepId'in v&&!text(v.stepId))fail();
 return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,['planId','requestId','organizationId','teachingId'].includes(k)?x.toLowerCase():x]));
}
export function validateRecommendationScope(v){
 object(v,['campus','term','organizationId']);object(v.campus,['state','id']);object(v.term,['state','value']);
 if(!['unknown','confirmed'].includes(v.campus.state)||!['unknown','confirmed'].includes(v.term.state))fail();
 if(v.campus.state==='unknown'?v.campus.id!==null:!uuid(v.campus.id))fail();
 if(v.term.state==='unknown'?v.term.value!==null:!text(v.term.value,100))fail();
 if(v.organizationId!==null&&!uuid(v.organizationId))fail();
 return {campus:{...v.campus,id:v.campus.id?.toLowerCase()??null},term:{...v.term},organizationId:v.organizationId?.toLowerCase()??null};
}
export function validateRecommendationCandidate(v){
 object(v,['contractVersion','source','action','goal','process','prerequisites','exclusions','scope','support','reviewedAt','expiresAt','explanation']);
 if(v.contractVersion!==1||!['understand_requirement','prepare_document','submit_document','check_decision'].includes(v.goal)||!['office_contact','aid_documents','insurance_waiver'].includes(v.process))fail();
 const source=validateRecommendationSource(v.source),scope=validateRecommendationScope(v.scope);
 const conditions=['campus_confirmed','term_confirmed','current_official_requirement','document_requested','document_prepared','submission_reported','decision_pending'];
 const prerequisites=list(v.prerequisites,conditions,12),exclusions=list(v.exclusions,['already_completed','declined','deferred','conflicting_evidence','expired_requirement','decision_received'],12);
 if(!instant(v.reviewedAt)||!instant(v.expiresAt)||v.expiresAt<=v.reviewedAt||!Array.isArray(v.support)||v.support.length>8)fail();
 const seen=new Set(),support=v.support.map(s=>{object(s,['kind','id','version']);if(s.kind!=='official-policy'||!uuid(s.id)||!version(s.version))fail();const id=s.id.toLowerCase();if(seen.has(id))fail();seen.add(id);return {...s,id};});
 if(prerequisites.includes('current_official_requirement')&&!support.length)fail();
 return {...v,source,scope,action:bilingual(v.action),explanation:bilingual(v.explanation),prerequisites,exclusions,support};
}
export function validateRecommendationDecision(v){
 object(v,['contractVersion','policyVersion','status','candidate','reason','sourceRevision']);
 if(v.contractVersion!==1||v.policyVersion!==RECOMMENDATION_POLICY_VERSION||!recommendationContract.decisionStates.includes(v.status))fail();
 const reasons={recommended:['current_goal','accepted_work','relevant_prerequisite'],clarification_required:['missing_scope','missing_goal','missing_process','missing_prerequisite','ambiguous_action','conflicting_evidence'],no_applicable_candidate:['no_eligible_source','student_priority'],unavailable:['paused','source_unavailable','lookup_failed','limit_exceeded']};
 if(!reasons[v.status].includes(v.reason))fail();
 if(v.status==='recommended'){if(!digest(v.sourceRevision))fail();return {...v,candidate:validateRecommendationCandidate(v.candidate)};}
 if(v.candidate!==null||v.sourceRevision!==null)fail();return {...v};
}
// Proposal only. The future acceptance workflow must independently verify an
// exact preview and approval before attaching this reference to a canonical action.
export function validateRecommendationActionLink(v){
 object(v,['contractVersion','policyVersion','source','sourceRevision','target']);object(v.target,['planId','stepId','planVersion']);
 if(v.contractVersion!==1||v.policyVersion!==RECOMMENDATION_POLICY_VERSION||!digest(v.sourceRevision)||!uuid(v.target.planId)||!text(v.target.stepId)||!version(v.target.planVersion))fail();
 return {...v,source:validateRecommendationSource(v.source),target:{...v.target,planId:v.target.planId.toLowerCase()}};
}
export function validateRecommendationCommand(v){
 object(v,['action','contractVersion','purpose','studentId','source']);
 if(v.action!=='resolve-source'||v.contractVersion!==1||v.purpose!=='personal_guidance'||!text(v.studentId))fail();
 return {...v,source:validateRecommendationSource(v.source)};
}
