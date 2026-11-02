import {personalizationControls} from './personalization-controls.mjs';
import {reviewDeliveryEnabled} from './review-request-delivery.mjs';
import {binderSharingEnabled} from './binder-sharing.mjs';
import {validateReviewResponseReference} from '../src/reviewResponseConnection.mjs';
// Shared notebook/voice request contract. Every disclosure requires its own
// exact preview or readback; private follow-up consent never authorizes sharing.
export const reviewRequestsEnabled=env=>env.ORIGEN_REVIEW_REQUESTS==='true'&&binderSharingEnabled(env);
export const reviewFollowupsEnabled=env=>env.ORIGEN_REVIEW_RESPONSE_CONTEXT==='true'&&reviewRequestsEnabled(env)&&reviewDeliveryEnabled(env);
export const studentUpdatesEnabled=(env={},subject)=>env.ORIGEN_STUDENT_FOLLOW_UP==='true'&&reviewFollowupsEnabled(env)&&personalizationControls(env,subject).retrieval;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const text=(value,max,required=true)=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0)&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const keys={
 list:['action','studentId','before'],options:['action','studentId'],
 create:['action','studentId','requestKey','connectionId','origin','language','kind','originalQuestion','proposedClarification','entries','relatedResponse'],
 get:['action','studentId','id'],cancel:['action','studentId','id','version'],remove:['action','studentId','id','version'],
 preview:['action','studentId','id','version','wording'],
 submit:['action','studentId','id','version','previewId','digest','confirmed'],
 withdraw:['action','studentId','id','version'],
};
export function validateReviewRequest(input){
 const invalid=()=>{throw fail(400,'invalid_review_request');};
 if(!input||Array.isArray(input)||!Object.hasOwn(keys,input.action)||Object.keys(input).some(k=>!keys[input.action].includes(k))||!text(input.studentId,128))invalid();
 if(['list','options'].includes(input.action)){
  if(input.before!==undefined&&!uuid(input.before))invalid();
  return {...input,...(input.before?{before:input.before.toLowerCase()}:{})};
 }
 if(input.action!=='create'){
  if(!uuid(input.id)||input.action!=='get'&&(!Number.isSafeInteger(input.version)||input.version<1))invalid();
  if(input.action==='preview'&&!['original','clarification'].includes(input.wording))invalid();
  if(input.action==='submit'&&(!uuid(input.previewId)||typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||input.confirmed!==true))invalid();
  return {...input,id:input.id.toLowerCase()};
 }
 if(!uuid(input.requestKey)||!uuid(input.connectionId)||!['notebook','voice'].includes(input.origin)||!['en','es'].includes(input.language)||!['question','concern','review','student-update'].includes(input.kind)||!text(input.originalQuestion,2000)||!text(input.proposedClarification??'',2000,false))invalid();
 if(input.kind==='student-update'&&input.relatedResponse===undefined)invalid();
 if(!Array.isArray(input.entries)||input.entries.length>20)invalid();
 const entries=input.entries.map(entry=>{
  if(!entry||Array.isArray(entry)||Object.keys(entry).some(k=>!['id','version'].includes(k))||!uuid(entry.id)||!Number.isSafeInteger(entry.version)||entry.version<1)invalid();
  return {id:entry.id.toLowerCase(),version:entry.version};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 if(new Set(entries.map(e=>e.id)).size!==entries.length)invalid();
 // Preserve the original wording, including uncertainty. This is a private
 // proposed request, not evidence that a transcript is exact or approved.
 return {...input,requestKey:input.requestKey.toLowerCase(),connectionId:input.connectionId.toLowerCase(),proposedClarification:input.proposedClarification??'',entries,...(input.relatedResponse!==undefined?{relatedResponse:validateReviewResponseReference(input.relatedResponse)}:{})};
}
export function createReviewRequestRepository(database,env={},subject){return async input=>{
 if(!database)throw fail(503,'review_requests_unavailable');
 const command=validateReviewRequest(input);
 const result=(await database.query("WITH policy AS MATERIALIZED (SELECT set_config('origen.review_delivery',$2,true),set_config('origen.review_followups',$3,true),set_config('origen.student_updates',$4,true)) SELECT origen_review_request_command($1::jsonb) AS result FROM policy",[JSON.stringify({...command,enabled:reviewRequestsEnabled(env)}),String(reviewDeliveryEnabled(env)),String(reviewFollowupsEnabled(env)),String(studentUpdatesEnabled(env,subject))])).rows[0].result;
 if(result.error)throw fail(result.error.endsWith('_paused')?503:result.error==='review_request_unavailable'?404:/changed$|limit$/.test(result.error)?409:result.error==='invalid_review_request'?400:403,result.error);
 return {...result,...(command.action==='list'?{studentUpdatesEnabled:result.enabled&&studentUpdatesEnabled(env,subject)}:{})};
};}

export function createReviewRequestsHandler(database,env={}){return async(req,res,next)=>{
 if(req.url!=='/api/review-requests')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return send(413,{error:'too_large'});}
  let input;try{input=validateReviewRequest(JSON.parse(body));}catch{return send(400,{error:'invalid_review_request'});}
  // Voice uses its separate current-turn/readback endpoint; this label cannot
  // forge that evidence on the notebook creation path.
  if(input.action==='create')input.origin='notebook';
  return send(200,await createReviewRequestRepository(database,env,req.origenIdentity.sub)(input));
 }catch(error){const known=[400,401,403,404,409,503].includes(error.status);return send(known?error.status:503,{error:known?error.message:'review_requests_unavailable'});}
};}

export async function assertReviewRequestsReady(database,env){
 if(!reviewRequestsEnabled(env))return;
 const migrated=(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='097_review_request_notebook.sql'")).rows.length;
 const allowed=migrated&&(await database.query("SELECT has_function_privilege(current_user,'origen_review_request_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed;
 if(!allowed)throw new Error('review_request_submission_migration_required');
}
