import {actionTemplateDrafts} from '../../src/recommendationLibrary.mjs';
import {unknownRecommendationFacts} from '../recommendation-policy.mjs';
export const policyNow=Date.parse('2026-11-02T12:00:00.000Z');
export const policyId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function policyCandidate(index=0,id=1){
 const t=actionTemplateDrafts('2026-11-01')[index].content;
 return {candidate:{contractVersion:1,source:{kind:'reviewed-template',teachingId:policyId(id),revision:2},action:t.action,explanation:t.explanation,goal:t.goal,process:t.process,prerequisites:t.prerequisites,exclusions:t.exclusions,scope:{campus:{state:'unknown',id:null},term:{state:'unknown',value:null},organizationId:null},support:[],reviewedAt:'2026-11-01T00:00:00.000Z',expiresAt:'2027-01-30T23:59:59.999Z'},sourceRevision:'a'.repeat(64),studentId:'alex',availability:'current',state:'available',deadline:null,official:null};
}
export function policyContext(candidates=[policyCandidate()]){return {studentId:'alex',goal:candidates[0]?.candidate.goal||'understand_requirement',process:candidates[0]?.candidate.process||'office_contact',scope:{campus:{state:'unknown',id:null},term:{state:'unknown',value:null},organizationId:null},facts:unknownRecommendationFacts(),timeZone:'America/Chicago',intent:'next_action',focus:null,limited:false,requiresScope:false,evidenceRevision:'b'.repeat(64),candidates,duplicates:[]};}
export function scopedPolicyContext(){
 const row=policyCandidate(),c=policyContext([row]);
 c.scope={campus:{state:'confirmed',id:policyId(80)},term:{state:'confirmed',value:'Fall 2026'},organizationId:null};
 row.candidate.scope=structuredClone(c.scope);row.candidate.prerequisites=['campus_confirmed','term_confirmed','current_official_requirement'];row.candidate.support=[{kind:'official-policy',id:policyId(90),version:2}];
 row.official={state:'verified',checkedAt:'2026-11-02T11:59:00.000Z',expiresAt:'2026-11-02T12:10:00.000Z',campusId:policyId(80),term:'Fall 2026',sourceRevision:row.sourceRevision,support:[{id:policyId(90),version:2}]};return c;
}
export function recommendationPolicyCases(){
 const cases=[],add=(name,mutate,status,reason)=>{const c=policyContext();mutate(c);cases.push({name,context:c,expected:{status,reason}});};
 add('cold start receives a reviewed office question',()=>{},'recommended','current_goal');
 add('unknown goal asks one question',c=>c.goal=null,'clarification_required','missing_goal');
 add('unknown process asks one question',c=>c.process=null,'clarification_required','missing_process');
 add('changed goal does not reuse an unrelated action',c=>c.goal='check_decision','no_applicable_candidate','no_eligible_source');
 add('a different process is not a match',c=>c.process='insurance_waiver','no_applicable_candidate','no_eligible_source');
 add('unknown requested document requires clarification',c=>Object.assign(c,policyContext([policyCandidate(1)])),'clarification_required','missing_prerequisite');
 add('a reported request supports a narrow preparation question',c=>{Object.assign(c,policyContext([policyCandidate(1)]));c.facts.document_requested='yes';},'recommended','relevant_prerequisite');
 add('a missing requested document cannot be offset by priority',c=>{Object.assign(c,policyContext([policyCandidate(1)]));c.facts.document_requested='no';},'no_applicable_candidate','no_eligible_source');
 add('reported submission does not become another submission instruction',c=>{Object.assign(c,policyContext([policyCandidate(2)]));c.facts.submission_reported='yes';},'no_applicable_candidate','no_eligible_source');
 add('reported submission and pending decision support a status question',c=>{Object.assign(c,policyContext([policyCandidate(3)]));c.facts.submission_reported='yes';c.facts.decision_pending='yes';c.facts.decision_received='no';},'recommended','relevant_prerequisite');
 add('received decision excludes a pending-decision action',c=>{Object.assign(c,policyContext([policyCandidate(3)]));c.facts.decision_received='yes';},'no_applicable_candidate','no_eligible_source');
 add('unresolved contradictory reports require clarification',c=>c.facts.submission_reported='conflict','clarification_required','conflicting_evidence');
 add('expired publication cannot be recommended',c=>c.candidates[0].candidate.expiresAt='2026-11-02T11:00:00.000Z','no_applicable_candidate','no_eligible_source');
 add('future review date cannot count as reviewed',c=>c.candidates[0].candidate.reviewedAt='2026-11-03T00:00:00.000Z','no_applicable_candidate','no_eligible_source');
 for(const state of ['complete','archived','deferred','declined','accepted_elsewhere','goal_changed'])add(state+' is excluded',c=>c.candidates[0].state=state,'no_applicable_candidate','no_eligible_source');
 add('source failure differs from no eligible help',c=>c.candidates[0].availability='unavailable','unavailable','source_unavailable');
 add('another student source is excluded',c=>c.candidates[0].studentId='sam','no_applicable_candidate','no_eligible_source');
 add('candidate overflow is unavailable',c=>c.candidates=Array.from({length:51},(_,i)=>policyCandidate(0,i+1)),'unavailable','limit_exceeded');
 add('two materially different equal options need one clarification',c=>{const other=policyCandidate(0,2);other.candidate.action={en:'Ask how to arrange an office appointment.',es:'Pregunta cómo hacer una cita con la oficina.'};c.candidates.push(other);},'clarification_required','ambiguous_action');
 add('unknown institutional scope is not inferred',c=>{Object.assign(c,scopedPolicyContext());c.scope.campus={state:'unknown',id:null};},'clarification_required','missing_scope');
 add('another campus policy is excluded',c=>{Object.assign(c,scopedPolicyContext());c.scope.campus.id=policyId(81);},'no_applicable_candidate','no_eligible_source');
 add('another term policy is excluded',c=>{Object.assign(c,scopedPolicyContext());c.scope.term.value='Spring 2027';},'no_applicable_candidate','no_eligible_source');
 add('fresh exact official applicability supports the policy',c=>Object.assign(c,scopedPolicyContext()),'recommended','relevant_prerequisite');
 add('official lookup failure is not eligibility',c=>{Object.assign(c,scopedPolicyContext());c.candidates[0].official.state='unavailable';},'unavailable','lookup_failed');
 add('stale official lookup cannot support use',c=>{Object.assign(c,scopedPolicyContext());c.candidates[0].official.checkedAt='2026-11-01T12:00:00.000Z';},'unavailable','lookup_failed');
 add('another claim version cannot support use',c=>{Object.assign(c,scopedPolicyContext());c.candidates[0].official.support[0].version=1;},'unavailable','lookup_failed');
 add('published scoped guidance without student scope asks which campus',c=>{c.candidates=[];c.requiresScope=true;},'clarification_required','missing_scope');
 return cases;
}
