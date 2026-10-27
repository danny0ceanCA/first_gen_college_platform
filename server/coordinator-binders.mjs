import {binderSharingEnabled,derivedSharingEnabled} from './binder-sharing.mjs';
import {invitationIdentity} from './institution-access.mjs';
import {requireStaffAccess} from './staff-access.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export const coordinatorViewingEnabled=env=>binderSharingEnabled(env)&&env.ORIGEN_COORDINATOR_BINDER_VIEWING==='true';
export function validateCoordinatorBinderInput(v){
 if(!v||!['list','read','review','resolve-help'].includes(v.action)||!uuid(v.organizationId))throw fail(400,'invalid_binder_request');
 const out={action:v.action,organizationId:v.organizationId};
 if(v.action==='list'){
  if(v.view!==undefined&&!['all','new','help'].includes(v.view)||v.search!==undefined&&(typeof v.search!=='string'||v.search.length>80||/[\x00-\x1f]/.test(v.search))||v.cursor!=null&&!uuid(v.cursor))throw fail(400,'invalid_binder_request');
  out.view=v.view||'all';out.search=v.search?.trim()||'';if(v.cursor)out.cursor=v.cursor;
 }else{if(!uuid(v.grantId))throw fail(400,'invalid_binder_request');out.grantId=v.grantId;}
 if(['review','resolve-help'].includes(v.action)){if(!uuid(v.publicationId))throw fail(400,'invalid_binder_request');out.publicationId=v.publicationId;}
 if(v.action==='resolve-help'){if(!uuid(v.helpRequestId))throw fail(400,'invalid_binder_request');out.helpRequestId=v.helpRequestId;}
 return out;
}
export async function runCoordinatorBinderCommand(database,input){
 const result=(await database.query('SELECT origen_coordinator_binder_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error==='binder_unavailable'?404:result.error==='binder_changed'?409:403,result.error);
 return result;
}
export function createCoordinatorBindersHandler(database,env={},fetcher=fetch){return async(req,res,next)=>{
 if(req.url!=='/api/coordinator-binders')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!coordinatorViewingEnabled(env))return send(503,{error:'coordinator_sharing_unavailable'});
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}
  let input;try{input=validateCoordinatorBinderInput(JSON.parse(raw));}catch{return send(400,{error:'invalid_binder_request'});}
  await requireStaffAccess(database,req.origenIdentity,{scope:'institution',action:`binder-${input.action}`,target:input.grantId||input.organizationId,env});
  const trusted=await invitationIdentity(req,env,fetcher);
  if(trusted.email_verified!==true||typeof trusted.email!=='string'||!trusted.email.trim())return send(403,{error:'verified_email_required'});
  return send(200,await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat},()=>runCoordinatorBinderCommand(database,{...input,derivedEnabled:derivedSharingEnabled(env)})));
 }catch(error){
  const known=[400,401,403,404,409,503].includes(error.status);
  return send(known?error.status:503,{error:known?error.message:'binder_read_unavailable'});
 }
};}
export async function assertCoordinatorViewingReady(database,env){
 if(!coordinatorViewingEnabled(env))return;
 for(const fn of ['origen_coordinator_binder_command(jsonb)','origen_binder_help_command(jsonb)']){
  const row=(await database.query('SELECT to_regprocedure($1) AS fn',[fn])).rows[0];
  if(!row?.fn||!(await database.query('SELECT has_function_privilege(current_user,$1,\'EXECUTE\') AS allowed',[fn])).rows[0]?.allowed)throw new Error('coordinator_viewing_migration_or_grant_required');
 }
}
