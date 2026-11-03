import {runAsCoordinatorActor} from './account-isolation.mjs';
import {requireStaffAccess,staffPermissions} from './staff-access.mjs';
import {invitationIdentity} from './institution-access.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function validateNotificationInput(v){
 if(!v||!['list','read','open','operations','resolve-report','retry-deliveries'].includes(v.action))throw fail(400,'invalid_notification_request');
 const out={action:v.action};
 if(['operations','resolve-report','retry-deliveries'].includes(v.action)){
  if(v.action==='resolve-report'){if(!uuid(v.id)||!['reviewed','coordinator-disabled'].includes(v.resolution))throw fail(400,'invalid_notification_request');Object.assign(out,{id:v.id,resolution:v.resolution});}
  return out;
 }
 if(!['student','staff'].includes(v.audience))throw fail(400,'invalid_notification_request');out.audience=v.audience;
 if(v.audience==='staff'){if(!uuid(v.organizationId))throw fail(400,'invalid_notification_request');out.organizationId=v.organizationId;}
 else{if(typeof v.studentId!=='string'||!v.studentId||v.studentId.length>128||/[\x00-\x1f]/.test(v.studentId))throw fail(400,'invalid_notification_request');out.studentId=v.studentId;}
 if(v.action!=='list'){if(!uuid(v.id))throw fail(400,'invalid_notification_request');out.id=v.id;}
 return out;
}
export async function runNotificationCommand(db,input){
 const operator=['operations','resolve-report','retry-deliveries'].includes(input.action);
 const fn=operator?'origen_coordinator_operations_command':'origen_coordinator_notification_command';
 const result=(await db.query(`SELECT ${fn}($1::jsonb) AS result`,[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error==='notification_unavailable'?404:result.error==='report_conflict'?409:403,result.error);
 return result;
}
export function createCoordinatorNotificationsHandler(db,env={},fetcher=fetch){return async(req,res,next)=>{
 if(req.url!=='/api/coordinator-notifications')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}
  let input;try{input=validateNotificationInput(JSON.parse(raw));}catch{return send(400,{error:'invalid_notification_request'});}
  const operator=['operations','resolve-report','retry-deliveries'].includes(input.action);
  if(input.audience==='staff'&&env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')return send(503,{error:'coordinator_sharing_unavailable'});
  if(operator||input.audience==='staff'){
   await requireStaffAccess(db,req.origenIdentity,{scope:'institution',action:`notification-${input.action}`,target:input.id||input.organizationId,permission:operator?'manage:institutions':undefined,env,fresh:['resolve-report','retry-deliveries'].includes(input.action)});
   const trusted=await invitationIdentity(req,env,fetcher);
   if(trusted.email_verified!==true||!trusted.email)return send(403,{error:'verified_email_required'});
   return send(200,await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat,administrator:operator&&staffPermissions(req.origenIdentity,env).includes('manage:institutions')},()=>runNotificationCommand(db,input)));
  }
  return send(200,await runNotificationCommand(db,input));
 }catch(error){const known=[400,401,403,404,409,503].includes(error.status);return send(known?error.status:503,{error:known?error.message:'notifications_unavailable'});}
};}
export async function maintainCoordinators(db){return (await db.query('SELECT origen_coordinator_maintain() AS result')).rows[0].result;}
export async function assertCoordinatorLifecycleReady(db,env,maintenance){
 if(env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')return;
 for(const fn of ['origen_coordinator_notification_command(jsonb)','origen_coordinator_export()','origen_coordinator_operations_command(jsonb)']){
  const row=(await db.query('SELECT to_regprocedure($1) AS fn',[fn])).rows[0];
  if(!row?.fn||!(await db.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed",[fn])).rows[0]?.allowed)throw new Error('coordinator_lifecycle_migration_required');
 }
 if(!maintenance||!(await maintenance.query("SELECT has_function_privilege(current_user,'origen_coordinator_maintain()','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('coordinator_lifecycle_maintenance_required');
}
