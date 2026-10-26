import {randomBytes,createHash} from 'node:crypto';
import {invitationIdentity} from './institution-access.mjs';
import {requireStaffAccess,staffPermissions} from './staff-access.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
import {applicationActions,applicantActions,validateApplication,runApplicationCommand} from './coordinator-applications.mjs';
import {reviewAdmissionFor,isReviewWork} from './coordinator-review-admission.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export const coordinatorCodeAlphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function createCoordinatorCode(){
 const raw=Array.from(randomBytes(10),n=>coordinatorCodeAlphabet[n&31]).join('');
 return {code:`${raw.slice(0,5)}-${raw.slice(5)}`,hash:createHash('sha256').update(raw).digest('hex')};
}
export function validateCoordinatorInput(value){
 if(value&&applicationActions.includes(value.action))return validateApplication(value);
 const actions=['overview','organization-queue','team','approve-organization','suspend-organization','enable-member','disable-member','profile','save-profile','rotate-code','revoke-code'];
 if(!value||!actions.includes(value.action))throw fail(400,'invalid_coordinator_request');
 const out={action:value.action};
 if(out.action==='approve-organization'){
  if(value.revision!==undefined&&(!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>2147483647))throw fail(400,'invalid_coordinator_request');
  out.revision=value.revision??0;
 }
 if(out.action==='organization-queue'){
  if(value.after){if(typeof value.after!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.after))throw fail(400,'invalid_coordinator_request');out.after=value.after;}
  if(value.search!==undefined){if(typeof value.search!=='string'||value.search.length>200||/[\x00-\x1f\x7f]/.test(value.search))throw fail(400,'invalid_coordinator_request');out.search=value.search.trim();}
 }
 if(!['overview','organization-queue'].includes(out.action)){
  if(typeof value.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.id))throw fail(400,'invalid_coordinator_request');out.id=value.id;
 }
 if(['enable-member','disable-member'].includes(out.action)){
  if(typeof value.subject!=='string'||!value.subject.trim()||value.subject.length>255||value.subject.includes('\0'))throw fail(400,'invalid_coordinator_request');out.subject=value.subject;
 }
 if(out.action==='save-profile'){
  if(typeof value.displayName!=='string'||!value.displayName.trim()||value.displayName.trim().length>100||/[\x00-\x1f]/.test(value.displayName))throw fail(400,'invalid_coordinator_request');out.displayName=value.displayName.trim();
 }
 return out;
}
export async function runCoordinatorCommand(database,input){
 // Hash is generated here, never trusted from JSON or model arguments.
 const generated=input.action==='rotate-code'?createCoordinatorCode():null;
 const args=generated?{...input,codeHash:generated.hash}:input;
 const removal=['suspend-organization','disable-member','revoke-code'].includes(input.action);
 const query=removal&&database.queryRetryable?database.queryRetryable.bind(database):database.query.bind(database);
 const result=(await query('SELECT origen_coordinator_command($1::jsonb) AS result',[JSON.stringify(args)])).rows[0].result;
 return generated?{...result,code:generated.code}:result;
}
export function createCoordinatorHandler(database,env={},fetcher=fetch){
 const reviews=reviewAdmissionFor(database);
 return async(req,res,next)=>{
  if(req.url!=='/api/coordinator-access')return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')return send(503,{error:'coordinator_sharing_unavailable'});
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
  let releaseReview;
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32768)return send(413,{error:'too_large'});}
   let input;try{input=validateCoordinatorInput(JSON.parse(raw));}catch{return send(400,{error:'invalid_coordinator_request'});}
   if(isReviewWork(input.action)){
    releaseReview=reviews.acquire();
    if(!releaseReview){res.setHeader('Retry-After','2');return send(429,{error:'coordinator_review_busy'});}
   }
   if(applicantActions.includes(input.action)){
    const trusted=await invitationIdentity(req,env,fetcher);
    if(trusted.email_verified!==true||typeof trusted.email!=='string'||!trusted.email.trim()||trusted.email.length>320)return send(403,{error:'verified_email_required'});
    return send(200,await runApplicationCommand(database,{...input,verifiedEmail:trusted.email.trim().toLowerCase()}));
   }
   const review=['organization-queue','approve-organization','suspend-organization','applications','application-organizations','approve-application','decline-application'].includes(input.action);
   await requireStaffAccess(database,req.origenIdentity,{scope:'institution',action:input.action,target:input.id,env,permission:review?'manage:institutions':undefined,fresh:!['overview','organization-queue','team','profile','applications','application-organizations'].includes(input.action)});
   const trusted=await invitationIdentity(req,env,fetcher);
   if(trusted.email_verified!==true||typeof trusted.email!=='string'||!trusted.email.trim())return send(403,{error:'verified_email_required'});
   const result=await runAsCoordinatorActor(req.origenIdentity.sub,{administrator:staffPermissions(req.origenIdentity,env).includes('manage:institutions'),issuedAt:req.origenIdentity.iat},()=>applicationActions.includes(input.action)?runApplicationCommand(database,input):runCoordinatorCommand(database,input));
   return send(200,result);
  }catch(error){
   if(error.code==='40001')return send(409,{error:error.message==='organization_changed'?'organization_changed':'application_changed'});
   if(error.code==='42501')return send(403,{error:['application_review_required','independent_review_required','organization_verification_required','application_membership_required'].includes(error.message)?error.message:'coordinator_access_denied'});
   const known=[400,401,403].includes(error.status)||(error.status===503&&error.message==='identity_verification_unavailable');
   // Never log request bodies, connection codes, emails or DB error details.
   return send(known?error.status:503,{error:known?error.message:'coordinator_access_unavailable'});
  }finally{releaseReview?.();}
 };
}

export async function assertCoordinatorProvisioningReady(database,env={}){
 if(env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')return;
 const application=(await database.query("SELECT to_regprocedure('origen_coordinator_application_command(jsonb)') AS fn")).rows[0];
 if(!application?.fn)throw new Error('coordinator_application_migration_required');
 if(!(await database.query("SELECT has_function_privilege(current_user,'origen_coordinator_application_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('coordinator_application_grant_required');
 const row=(await database.query("SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='059_coordinator_registration_safety.sql') AND EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='073_durable_coordinator_signup.sql') AS migrated, to_regprocedure('origen_coordinator_command(jsonb)') AS fn")).rows[0];
 if(!row?.migrated||!row.fn)throw new Error('coordinator_migration_required');
 if(!(await database.query("SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='075_approval_review_recovery.sql') AS migrated")).rows[0]?.migrated)throw new Error('approval_review_migration_required');
 if(!(await database.query("SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='076_organization_approval_version.sql') AS migrated")).rows[0]?.migrated)throw new Error('organization_approval_version_migration_required');
 if(!(await database.query("SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='077_organization_approval_retry.sql') AS migrated")).rows[0]?.migrated)throw new Error('organization_approval_retry_migration_required');
 if(!(await database.query("SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='078_approval_consistency.sql') AS migrated")).rows[0]?.migrated)throw new Error('approval_consistency_migration_required');
 if(!(await database.query("SELECT has_function_privilege(current_user,'origen_coordinator_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('coordinator_runtime_grant_required');
 const overview=(await database.query("SELECT to_regprocedure('origen_admin_organization_overview(uuid,integer)') AS fn")).rows[0];
 if(!overview?.fn)throw new Error('organization_overview_migration_required');
 if(!(await database.query("SELECT has_function_privilege(current_user,'origen_admin_organization_overview(uuid,integer)','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('organization_overview_grant_required');
}
