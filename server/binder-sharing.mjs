import {linkingEnabled} from './coordinator-connections.mjs';
import {sharingTopics} from './binder-sharing-policy.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export const binderSharingEnabled=env=>linkingEnabled(env)&&env.ORIGEN_BINDER_SHARING==='true';
export function validateSharingInput(v){
 if(!v||!['status','entries','preview','publish','cancel','withdraw','remove-topic','revoke','revoke-all','help'].includes(v.action)||typeof v.studentId!=='string'||!v.studentId.trim()||v.studentId.length>128)throw fail(400,'invalid_sharing_request');
 const out={action:v.action,studentId:v.studentId};
 const id=key=>{if(!uuid(v[key]))throw fail(400,'invalid_sharing_request');out[key]=v[key];};
 if(v.action==='preview'){
  id('connectionId');
  for(const [key,max,valid] of [['topics',4,x=>sharingTopics.includes(x)],['entryIds',50,uuid]]){
   if(!Array.isArray(v[key])||!v[key].length||v[key].length>max||new Set(v[key]).size!==v[key].length||v[key].some(x=>!valid(x)))throw fail(400,'invalid_sharing_request');out[key]=v[key];
  }
 }
 if(['publish','cancel'].includes(v.action))id('previewId');
 if(v.action==='publish'){if(v.confirmed!==true)throw fail(400,'invalid_sharing_request');out.confirmed=true;}
 if(['withdraw','remove-topic','revoke','help'].includes(v.action))id('grantId');
 if(v.action==='withdraw')id('itemId');
 if(v.action==='remove-topic'){if(!sharingTopics.includes(v.topic))throw fail(400,'invalid_sharing_request');out.topic=v.topic;}
 if(v.action==='help'){if(typeof v.requested!=='boolean')throw fail(400,'invalid_sharing_request');out.requested=v.requested;}
 return out;
}
export async function runSharingCommand(database,input){
 const fn=input.action==='help'?'origen_binder_help_command':'origen_binder_sharing_command';
 const removal=['revoke','revoke-all','withdraw','remove-topic'].includes(input.action);
 const query=removal&&database.queryRetryable?database.queryRetryable.bind(database):database.query.bind(database);
 const result=(await query(`SELECT ${fn}($1::jsonb) AS result`,[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error==='sharing_changed'?409:result.error==='sharing_paused'?503:403,result.error);
 if(input.action==='status'&&result.grants?.length){const help=(await database.query('SELECT origen_binder_help_command($1::jsonb) AS result',[JSON.stringify({action:'status',studentId:input.studentId})])).rows[0].result;result.grants=result.grants.map(g=>({...g,helpRequested:help[g.id]===true}));}
 return result;
}
export function createBinderSharingHandler(database,env={}){return async(req,res,next)=>{
 if(req.url!=='/api/binder-sharing')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)return send(413,{error:'too_large'});}
  let input;try{input=validateSharingInput(JSON.parse(raw));}catch{return send(400,{error:'invalid_sharing_request'});}
  // Stop-sharing actions remain available even when every rollout flag is off.
  input.enabled=binderSharingEnabled(env);
  if(!input.enabled&&['entries','preview','publish'].includes(input.action))return send(503,{error:'sharing_paused'});
  return send(200,await runSharingCommand(database,input));
 }catch(error){
  const known=[400,403,409,503].includes(error.status);
  const conflict=['40001','40P01','23514'].includes(error.code);
  return send(known?error.status:conflict?409:503,{error:known?error.message:conflict?'sharing_changed':'sharing_unavailable'});
 }
};}
export async function assertBinderSharingReady(database,env){
 if(!binderSharingEnabled(env))return;
 for(const fn of ['origen_binder_sharing_command(jsonb)','origen_binder_help_command(jsonb)']){
  const row=(await database.query('SELECT to_regprocedure($1) AS fn',[fn])).rows[0];
  if(!row?.fn||!(await database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed",[fn])).rows[0]?.allowed)throw new Error('binder_sharing_migration_or_grant_required');
 }
}
