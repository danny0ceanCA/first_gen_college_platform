import {coordinatorViewingEnabled} from './coordinator-binders.mjs';
import {requireStaffAccess} from './staff-access.mjs';
import {invitationIdentity} from './institution-access.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
export const reviewDeliveryEnabled=env=>env.ORIGEN_REVIEW_REQUEST_DELIVERY==='true'&&env.ORIGEN_REVIEW_REQUESTS==='true'&&coordinatorViewingEnabled(env);
const fields={list:['before'],read:['id'],review:['id','publicationId'],respond:['id','publicationId','version','operationId','guidance','suggestedAction','resourceUrl','followUpOn'],'withdraw-response':['id','publicationId','version','operationId']};
export function validateCoordinatorReview(input){
 const invalid=()=>{throw fail(400,'invalid_coordinator_review');};
 if(!input||Array.isArray(input)||!Object.hasOwn(fields,input.action)||!uuid(input.organizationId)||Object.keys(input).some(k=>!['action','organizationId',...fields[input.action]].includes(k)))invalid();
 if(input.before!==undefined&&!uuid(input.before)||input.action!=='list'&&!uuid(input.id)||['review','respond','withdraw-response'].includes(input.action)&&!uuid(input.publicationId))invalid();
 if(['respond','withdraw-response'].includes(input.action)&&(!uuid(input.operationId)||!Number.isSafeInteger(input.version)||input.version<0||input.version>2147483646))invalid();
 if(input.action!=='respond')return input;
 if(!text(input.guidance,2000)||!input.guidance.trim()||!text(input.suggestedAction??'',1000)||!text(input.resourceUrl??'',2000))invalid();
 let resourceUrl=input.resourceUrl||'';
 if(resourceUrl){let url;try{url=new URL(resourceUrl);}catch{invalid();}if(url.protocol!=='https:'||url.username||url.password||url.href.length>2000)invalid();resourceUrl=url.href;}
 const followUpOn=input.followUpOn||'';
 if(followUpOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)||!Number.isFinite(Date.parse(followUpOn))||new Date(followUpOn).toISOString().slice(0,10)!==followUpOn))invalid();
 return {...input,guidance:input.guidance.trim(),suggestedAction:(input.suggestedAction||'').trim(),resourceUrl,followUpOn};
}
export function createCoordinatorReviewHandler(db,env={},fetcher=fetch){return async(req,res,next)=>{
 if(req.url!=='/api/coordinator-review-requests')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>24576)return send(413,{error:'too_large'});}
  let input;try{input=validateCoordinatorReview(JSON.parse(body));}catch{return send(400,{error:'invalid_coordinator_review'});}
  if(!db||env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')return send(503,{error:'review_delivery_paused'});
  await requireStaffAccess(db,req.origenIdentity,{scope:'institution',action:`review-request-${input.action}`,target:input.id||input.organizationId,env,fresh:['respond','withdraw-response'].includes(input.action)});
  const trusted=await invitationIdentity(req,env,fetcher);if(trusted.email_verified!==true||!trusted.email?.trim())return send(403,{error:'verified_email_required'});
  const result=await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat},async()=>{
   const r=(await db.query('SELECT origen_coordinator_review_command($1::jsonb) AS result',[JSON.stringify({...input,enabled:reviewDeliveryEnabled(env)})])).rows[0].result;
   if(r.error)throw fail(r.error.endsWith('paused')?503:r.error.endsWith('unavailable')?404:r.error.endsWith('changed')?409:r.error.startsWith('invalid_')?400:403,r.error);return r;
  });return send(200,{...result,outcomeReviewEnabled:env.ORIGEN_OUTCOME_EVIDENCE==='true'&&env.ORIGEN_STUDENT_FOLLOW_UP==='true'&&reviewDeliveryEnabled(env)});
 }catch(e){const known=[400,401,403,404,409,503].includes(e.status);return send(known?e.status:503,{error:known?e.message:'review_unavailable'});}
};}
export async function assertReviewDeliveryReady(db,env){
 if(!reviewDeliveryEnabled(env))return;
 if(!(await db.query("SELECT 1 FROM origen_schema_migrations WHERE name='099_review_request_delivery.sql'")).rows.length||!(await db.query("SELECT has_function_privilege(current_user,'origen_coordinator_review_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('review_delivery_migration_required');
}
