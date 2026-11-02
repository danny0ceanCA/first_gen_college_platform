import {assessCoordinatorObservation} from './outcome-assessment.mjs';
import {allowedRequest} from './origin.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
import {requireStaffAccess} from './staff-access.mjs';
import {invitationIdentity} from './institution-access.mjs';
import {reviewDeliveryEnabled} from './review-request-delivery.mjs';
import {validateOutcomeObservation,validateOutcomeDispute} from '../src/outcomeObservation.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<2147483647;
export const outcomeObservationsEnabled=env=>env.ORIGEN_OUTCOME_EVIDENCE==='true'&&env.ORIGEN_STUDENT_FOLLOW_UP==='true'&&reviewDeliveryEnabled(env);
export function validateOutcomeObservationCommand(raw,staff=false){
 const fields=staff?{load:[],prepare:['publicationId','operationId','observationId','version','payload'],confirm:['publicationId','previewId','digest','confirmed'],withdraw:['publicationId','observationId','version','confirmed']}:{load:[],'prepare-dispute':['observationId','observationVersion','version','operationId','payload'],'confirm-dispute':['previewId','digest','confirmed'],'delete-dispute':['observationId','version','confirmed']};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.hasOwn(fields,raw.action))throw fail(400,'invalid_outcome_observation');
 const keys=['action','id',staff?'organizationId':'studentId',...fields[raw.action]];
 if(Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k))||!uuid(raw.id)||staff&&!uuid(raw.organizationId)||!staff&&(typeof raw.studentId!=='string'||!raw.studentId.trim()||raw.studentId.length>128))throw fail(400,'invalid_outcome_observation');
 for(const key of ['publicationId','operationId','previewId','observationId'])if(key in raw&&!(key==='observationId'&&raw.action==='prepare'&&raw[key]===null)&&!uuid(raw[key]))throw fail(400,'invalid_outcome_observation');
 if('version'in raw&&!integer(raw.version)||'observationVersion'in raw&&(!integer(raw.observationVersion)||raw.observationVersion<1)||'confirmed'in raw&&raw.confirmed!==true||'digest'in raw&&(typeof raw.digest!=='string'||!/^[a-f\d]{64}$/.test(raw.digest)))throw fail(400,'invalid_outcome_observation');
 if(raw.action==='prepare'&&(raw.observationId===null)!==(raw.version===0))throw fail(400,'invalid_outcome_observation');
 return {...raw,...('payload'in raw?{payload:staff?validateOutcomeObservation(raw.payload):validateOutcomeDispute(raw.payload)}:{})};
}
export function createOutcomeObservationRepository(database,env={}){return async(subject,raw,staff=false)=>{
 const input=validateOutcomeObservationCommand(raw,staff);if(!database)throw fail(503,'outcome_observation_unavailable');
 const c=await database.connect(),enabled=outcomeObservationsEnabled(env),delivery=reviewDeliveryEnabled(env);
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");
  if(!staff)await guardAccountTransaction(c,subject);
  const body={...input,enabled,...(staff?{deliveryEnabled:delivery}:{})};
  const fn=staff?'origen_coordinator_outcome_command':'origen_student_outcome_observation_command';
  const result=(await c.query(`SELECT ${fn}($1::jsonb) AS result`,[JSON.stringify(body)])).rows[0].result;
  if(result.error)throw fail(result.error.endsWith('_changed')?409:result.error.endsWith('_paused')?503:result.error.endsWith('_unavailable')?404:result.error.startsWith('invalid_')?400:403,result.error);
  if(!staff)await guardAccountTransaction(c,subject);
  if(enabled&&!outcomeObservationsEnabled(env)&&['prepare','confirm','prepare-dispute','confirm-dispute'].includes(input.action))throw fail(503,'outcome_observation_paused');
  await c.query('COMMIT');return input.action==='load'&&enabled?{...result,observations:result.observations.map(record=>({...record,assessment:assessCoordinatorObservation(record)}))}:result;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
};}
export function createOutcomeObservationHandler(database,env={},fetcher=fetch){const run=createOutcomeObservationRepository(database,env);return async(req,res,next)=>{
 const path=req.url?.split('?')[0],staff=path==='/api/coordinator-outcome-observations';if(!staff&&path!=='/api/student-outcome-observations')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>16000)return send(413,{error:'too_large'});}let input;try{input=validateOutcomeObservationCommand(JSON.parse(raw),staff);}catch{return send(400,{error:'invalid_outcome_observation'});}
  if(staff){
   if(!database||env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')return send(503,{error:'outcome_observation_paused'});
   await requireStaffAccess(database,req.origenIdentity,{scope:'institution',action:'outcome-observation-'+input.action,target:input.id,env,fresh:input.action!=='load'});
   const trusted=await invitationIdentity(req,env,fetcher);if(trusted.email_verified!==true||!trusted.email?.trim())return send(403,{error:'verified_email_required'});
   return send(200,await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat},()=>run(req.origenIdentity.sub,input,true)));
  }
  return send(200,await run(req.origenIdentity.sub,input));
 }catch(e){return send([400,401,403,404,409,503].includes(e.status)?e.status:503,{error:e.status?e.message:'outcome_observation_unavailable'});}
};}
