import {coordinatorViewingEnabled} from './coordinator-binders.mjs';
import {derivedSharingEnabled} from './binder-sharing.mjs';
import {invitationIdentity} from './institution-access.mjs';
import {requireStaffAccess} from './staff-access.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
export const coordinatorFeedbackEnabled=env=>coordinatorViewingEnabled(env)&&env.ORIGEN_COORDINATOR_FEEDBACK==='true';
export function validateFeedbackInput(v){
 const actions=['staff-list','staff-thread','staff-create','staff-edit','staff-withdraw','student-list','student-thread','student-review','student-reply','student-hide','student-unhide','student-remove','student-report'];
 if(!v||!actions.includes(v.action))throw fail(400,'invalid_feedback_request');
 const out={action:v.action},staff=v.action.startsWith('staff-');
 if(staff){if(!uuid(v.organizationId)||!uuid(v.grantId))throw fail(400,'invalid_feedback_request');out.organizationId=v.organizationId;out.grantId=v.grantId;}
 else{if(!text(v.studentId,128))throw fail(400,'invalid_feedback_request');out.studentId=v.studentId;}
 if(!v.action.endsWith('-list')&&v.action!=='staff-create'){if(!uuid(v.feedbackId))throw fail(400,'invalid_feedback_request');out.feedbackId=v.feedbackId;}
 if(!v.action.endsWith('-list')&&!v.action.endsWith('-thread')){
  if(!uuid(v.requestId))throw fail(400,'invalid_feedback_request');out.requestId=v.requestId;
  if(v.action!=='staff-create'){if(!Number.isSafeInteger(v.version)||v.version<1)throw fail(400,'invalid_feedback_request');out.version=v.version;}
 }
 if(['staff-create','staff-edit','student-reply'].includes(v.action)){if(!text(v.body,2000))throw fail(400,'invalid_feedback_request');out.body=v.body.trim();}
 if(['staff-create','staff-edit'].includes(v.action)){
  if(!['guidance','resource','suggested-step'].includes(v.kind))throw fail(400,'invalid_feedback_request');out.kind=v.kind;out.resourceUrl='';
  if(v.resourceUrl){let url;try{url=new URL(v.resourceUrl);}catch{throw fail(400,'invalid_feedback_link');}if(typeof v.resourceUrl!=='string'||v.resourceUrl.length>2000||url.href.length>2000||url.protocol!=='https:'||url.username||url.password)throw fail(400,'invalid_feedback_link');out.resourceUrl=url.href;}
 }
 if(v.action==='staff-create'){if(!['options','transfer','costs','applications'].includes(v.topic)||!uuid(v.publicationId)||v.publicationItemId!=null&&!uuid(v.publicationItemId))throw fail(400,'invalid_feedback_request');out.topic=v.topic;out.publicationId=v.publicationId;if(v.publicationItemId)out.publicationItemId=v.publicationItemId;}
 if(v.action==='student-report'){if(!['abuse','spam','inaccurate','privacy','other'].includes(v.reason))throw fail(400,'invalid_feedback_request');out.reason=v.reason;}
 return out;
}
export async function runFeedbackCommand(database,input){
 const result=(await database.query('SELECT origen_coordinator_feedback_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(/unavailable$/.test(result.error)?404:/changed$|limit$/.test(result.error)?409:result.error==='feedback_paused'?503:403,result.error);
 return result;
}
export function createCoordinatorFeedbackHandler(database,env={},fetcher=fetch){return async(req,res,next)=>{
 if(req.url!=='/api/coordinator-feedback')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(413,{error:'too_large'});}
  let input;try{input=validateFeedbackInput(JSON.parse(raw));}catch(error){return send(400,{error:error.message==='invalid_feedback_link'?error.message:'invalid_feedback_request'});}
  input.enabled=coordinatorFeedbackEnabled(env);
  input.derivedEnabled=derivedSharingEnabled(env);
  if(!input.enabled&&['staff-create','staff-edit','student-reply'].includes(input.action))return send(503,{error:'feedback_paused'});
  const execute=async()=>({...await runFeedbackCommand(database,input),writesEnabled:input.enabled});
  if(input.action.startsWith('staff-')){
   if(!coordinatorViewingEnabled(env))return send(503,{error:'coordinator_sharing_unavailable'});
   await requireStaffAccess(database,req.origenIdentity,{scope:'institution',action:input.action,target:input.grantId,env,fresh:!['staff-list','staff-thread'].includes(input.action)});
   const trusted=await invitationIdentity(req,env,fetcher);if(trusted.email_verified!==true||!trusted.email?.trim())return send(403,{error:'verified_email_required'});
   return send(200,await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat},execute));
  }
  return send(200,await execute());
 }catch(error){const known=[400,401,403,404,409,503].includes(error.status);return send(known?error.status:503,{error:known?error.message:'feedback_unavailable'});}
};}
export async function assertCoordinatorFeedbackReady(database,env){
 if(!coordinatorFeedbackEnabled(env))return;
 if(!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='071_preserve_coordinator_lock_order.sql'")).rows.length)throw new Error('coordinator_lock_order_migration_required');
 if((derivedSharingEnabled(env)||env.ORIGEN_COORDINATOR_FOLLOW_THROUGH==='true')&&!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='068_coordinator_follow_through.sql'")).rows.length)throw new Error('coordinator_follow_through_migration_required');
 const fn='origen_coordinator_feedback_command(jsonb)';
 if(!(await database.query('SELECT to_regprocedure($1) AS fn',[fn])).rows[0]?.fn||!(await database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed",[fn])).rows[0]?.allowed)throw new Error('coordinator_feedback_migration_or_grant_required');
}
