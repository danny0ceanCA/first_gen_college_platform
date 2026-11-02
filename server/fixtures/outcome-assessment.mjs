import {randomUUID} from 'node:crypto';
import {outcomeObservationFixture} from './outcome-observations.mjs';
import {loadReviewResponseContext,verifyReviewResponseContext} from '../review-response-context.mjs';
export async function outcomeAssessmentFixture(t){
 const f=await outcomeObservationFixture(t);
 const outcomes=input=>f.httpCall('other','/api/outcome-evidence',{studentId:'alex',...input});
 async function record({definitionId='document_submitted',status='occurred',decision=null,eventOn=null,statement='I submitted the employer letter.',cycle='Insurance documents',reportId}={}){
  let report=reportId;
  if(!report){
   const preview=(await f.httpCall('other','/api/student-follow-up-report',{action:'prepare',studentId:'alex',target:f.target,operationId:randomUUID(),planVersion:(await f.plans()).plans[0].version,language:'en',payload:{report:{responseState:'answered',reportedAction:'completed',reportedOutcome:'pending',detail:statement,helpfulness:null,occurredOn:eventOn,timeZone:'America/Chicago'},planStatus:null}})).preview;
   report=(await f.httpCall('other','/api/student-follow-up-report',{action:'confirm',studentId:'alex',previewId:preview.id,digest:preview.digest,confirmed:true})).reportId;
  }
  const version=(await f.owner.query('SELECT version FROM origen_student_follow_up_reports WHERE id=$1',[report])).rows[0].version;
  const preview=(await outcomes({action:'prepare',target:f.target,planVersion:(await f.plans()).plans[0].version,operationId:randomUUID(),language:'en',payload:{link:{episode:{definitionId,definitionVersion:1,scope:{institution:'Example University',term:'2026–2027',cycle},window:{start:'2026-01-01',end:'2026-12-31',timeZone:'America/Chicago'}},report:{id:report,version},responseState:'answered',claimStatus:status,decision},correction:null,replaces:null}})).preview;
  return outcomes({action:'confirm',previewId:preview.id,digest:preview.digest,confirmed:true});
 }
 const context=(options={})=>f.as('other',()=>loadReviewResponseContext(f.db,'other',{studentId:'alex',focus:f.source},f.env,options));
 const verify=guard=>f.as('other',()=>verifyReviewResponseContext(f.db,'other','alex',guard,f.env));
 return {...f,outcomes,record,context,verify};
}
