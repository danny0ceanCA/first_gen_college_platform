import {randomUUID} from 'node:crypto';
import {studentFollowUpFixture} from './student-follow-up.mjs';
export const observationPayload=()=>({claim:{definitionId:'document_submitted',definitionVersion:1,scope:{institution:'Example University',term:'2026–2027',cycle:'Insurance documents'},claimStatus:'occurred',decision:null},selection:{kind:'question',entryId:null,quote:'I submitted my employer letter'},position:'supports',basis:'declared_record_review',observation:'I checked the dated submission receipt; it records delivery, not acceptance or approval.',observedOn:'2026-11-01',eventOn:'2026-10-01',timeZone:'America/Chicago',sourceReference:{kind:'submission_receipt',on:'2026-10-01'},dependsOnStudentStatement:'unknown'});
export async function outcomeObservationFixture(t){
 const f=await studentFollowUpFixture(t);Object.assign(f.env,{ORIGEN_STUDENT_FOLLOW_UP:'true',ORIGEN_OUTCOME_EVIDENCE:'true'});
 const question='I submitted my employer letter. Institution: Example University. Term: 2026–2027. Process: Insurance documents. Please review the evidence for document submission.';
 const draft=(await f.student({action:'create',requestKey:randomUUID(),connectionId:f.connection,origin:'notebook',language:'en',kind:'student-update',originalQuestion:question,entries:[],relatedResponse:f.source})).request;
 const preview=(await f.student({action:'preview',id:draft.id,version:1,wording:'original'})).preview;
 const shared=(await f.student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true})).request;await f.sweep();
 const coordinator=(await f.owner.query("SELECT id FROM origen_coordinator_profiles WHERE institution_id=$1 AND auth0_subject='staff'",[f.org])).rows[0].id;
 const grant=(definition='document_submitted',bases=['student_account','direct_observation','declared_record_review'],valid=true)=>f.owner.query("SELECT origen_outcome_review_grant($1,$2,$3,$4,CASE WHEN $5 THEN clock_timestamp()+interval '30 days' ELSE NULL END)",[f.org,coordinator,definition,bases,valid]);
 const staff=(input,actor='staff')=>f.httpCall(actor,'/api/coordinator-outcome-observations',{id:shared.id,organizationId:f.org,...input});
 const student=(input,actor='other')=>f.httpCall(actor,'/api/student-outcome-observations',{id:shared.id,studentId:'alex',...input});
 const prepare=async(extra={})=>(await staff({action:'prepare',publicationId:shared.publication.id,operationId:randomUUID(),observationId:null,version:0,payload:observationPayload(),...extra})).preview;
 const confirm=p=>staff({action:'confirm',publicationId:shared.publication.id,previewId:p.id,digest:p.digest,confirmed:true});
 return {...f,shared,coordinator,grant,observe:staff,studentObservations:student,observationPrepare:prepare,observationConfirm:confirm};
}
