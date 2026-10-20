import {createHash} from 'node:crypto';
import {normalizeCoordinatorCode} from '../src/coordinatorCodes.mjs';
import {requireStaffAccess} from './staff-access.mjs';
import {invitationIdentity} from './institution-access.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=v=>createHash('sha256').update(v).digest('hex');
export const linkingEnabled=env=>env.ORIGEN_COORDINATOR_ACCOUNTS==='true'&&env.ORIGEN_COORDINATOR_LINKING==='true';
export function validateConnectionInput(v){
 const actions=['available','open','close','turn','lookup','prepare','confirm','cancel','list','withdraw','inbox','accept','decline'];
 if(!v||!actions.includes(v.action))throw fail(400,'invalid_connection_request');
 const out={action:v.action};
 const id=key=>{if(!uuid(v[key]))throw fail(400,'invalid_connection_request');out[key]=v[key];};
 if(['available','open','list','withdraw'].includes(v.action)){
  if(typeof v.studentId!=='string'||!v.studentId.trim()||v.studentId.length>128)throw fail(400,'invalid_connection_request');out.studentId=v.studentId;
 }else if(['inbox','accept','decline'].includes(v.action))id('organizationId');else id('contextId');
 if(v.action==='open'){if(!['screen','voice'].includes(v.channel))throw fail(400,'invalid_connection_request');out.channel=v.channel;}
 if(['turn','lookup','prepare','confirm','cancel'].includes(v.action)){if(!Number.isSafeInteger(v.sequence)||v.sequence<0)throw fail(400,'invalid_connection_request');out.sequence=v.sequence;}
 if(v.action==='turn'){if(typeof v.turnId!=='string'||!v.turnId||v.turnId.length>128)throw fail(400,'invalid_connection_request');out.turnId=v.turnId;}
 if(v.action==='lookup'){if(typeof v.code!=='string'||v.code.length>100)throw fail(400,'invalid_connection_request');out.codeHash=hash(normalizeCoordinatorCode(v.code)||'invalid');}
 if(['prepare','confirm','cancel'].includes(v.action))id('challengeId');
 if(['withdraw','accept','decline'].includes(v.action))id('connectionId');
 if(v.action==='confirm'){
  if(v.confirmed!==true||!Array.isArray(v.topics)||v.topics.length>4||new Set(v.topics).size!==v.topics.length||v.topics.some(t=>!['options','transfer','costs','applications'].includes(t)))throw fail(400,'invalid_connection_request');
  out.confirmed=true;out.topics=v.topics;
 }
 return out;
}
export async function runConnectionCommand(database,input){
 const result=(await database.query('SELECT origen_coordinator_connection_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error==='connection_rate_limited'?429:result.error==='connection_changed'?409:result.error==='coordinator_unavailable'?404:403,result.error);
 return result;
}
export async function coordinatorVoiceAvailable(database,env,studentId){
 if(!linkingEnabled(env)||env.ORIGEN_COORDINATOR_VOICE_LINKING!=='true'||typeof studentId!=='string')return false;
 try{return (await runConnectionCommand(database,{action:'available',studentId})).available===true;}catch{return false;}
}
export function createCoordinatorConnectionsHandler(database,env={},fetcher=fetch){return async(req,res,next)=>{
 if(req.url!=='/api/coordinator-connections')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!linkingEnabled(env))return send(503,{error:'coordinator_sharing_unavailable'});
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}
  let input;try{input=validateConnectionInput(JSON.parse(raw));}catch{return send(400,{error:'invalid_connection_request'});}
  input.voiceEnabled=env.ORIGEN_COORDINATOR_VOICE_LINKING==='true';
  if(input.channel==='voice'&&env.ORIGEN_COORDINATOR_VOICE_LINKING!=='true')return send(403,{error:'connection_denied'});
  if(input.action==='lookup')input.networkHash=hash(req.socket?.remoteAddress||'unknown'); // never trust browser forwarding headers
  if(['inbox','accept','decline'].includes(input.action)){
   await requireStaffAccess(database,req.origenIdentity,{scope:'institution',action:'coordinator-'+input.action,target:input.organizationId,env,fresh:input.action!=='inbox'});
   const identity=await invitationIdentity(req,env,fetcher);
   if(identity.email_verified!==true)return send(403,{error:'verified_email_required'});
   return send(200,await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat},()=>runConnectionCommand(database,input)));
  }
  const result=await runConnectionCommand(database,input);
  return send(200,input.action==='available'?{...result,voiceEnabled:input.voiceEnabled}:result);
 }catch(error){const known=[400,401,403,404,409,429].includes(error.status);return send(known?error.status:error.code==='42501'?403:503,{error:known?error.message:error.code==='42501'?'connection_denied':'connection_unavailable'});}
};}
export async function assertCoordinatorLinkingReady(database,env){
 if(!linkingEnabled(env))return;
 const row=(await database.query("SELECT to_regprocedure('origen_coordinator_connection_command(jsonb)') AS fn")).rows[0];
 if(!row?.fn||!(await database.query("SELECT has_function_privilege(current_user,'origen_coordinator_connection_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('coordinator_linking_migration_or_grant_required');
 if(!(await database.query("SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='058_student_controlled_coordinator_sharing.sql') AS ready")).rows[0]?.ready)throw new Error('coordinator_student_permission_migration_required');
}
