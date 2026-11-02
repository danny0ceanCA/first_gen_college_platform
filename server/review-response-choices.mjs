import {validateReviewResponseReference} from '../src/reviewResponseConnection.mjs';
import {reviewResponseContextEnabled} from './review-response-context.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {allowedRequest} from './origin.mjs';
import {reviewFollowupsEnabled} from './review-requests.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function validateReviewResponseChoice(input){
 if(!input||Object.keys(input).some(k=>!['action','studentId','source','revision','operationId','reviewOn'].includes(k))||!['load','defer','revisit'].includes(input.action)
  ||typeof input.studentId!=='string'||!input.studentId.trim()||input.studentId.length>128||/[\x00-\x1f\x7f]/.test(input.studentId))throw fail(400,'invalid_review_response_choice');
 const out={action:input.action,studentId:input.studentId,source:validateReviewResponseReference(input.source)};
 if(input.action!=='load'){
  if(!uuid(input.operationId)||!Number.isSafeInteger(input.revision)||input.revision<0)throw fail(400,'invalid_review_response_choice');
  Object.assign(out,{operationId:input.operationId,revision:input.revision});
 }
 if(input.action==='defer'){
  const date=input.reviewOn;
  if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<new Date().toISOString().slice(0,10)))throw fail(400,'invalid_review_response_choice');
  out.reviewOn=date;
 }else if(input.reviewOn!==undefined)throw fail(400,'invalid_review_response_choice');
 return out;
}
export async function runReviewResponseChoice(c,input){
 const result=(await c.query('SELECT origen_review_response_choice_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error==='invalid_review_response_choice'?400:result.error==='review_response_unavailable'?404:result.error.endsWith('changed')?409:result.error.endsWith('paused')?503:403,result.error);
 return result;
}
export async function enableReviewResponseChoice(c,env,subject){
 if(!reviewResponseContextEnabled(env,subject))throw fail(503,'review_response_context_paused');
 await c.query("SELECT set_config('origen.review_response_context','true',true)");
}
export function createReviewResponseChoiceRepository(database,env={}){return async(subject,input)=>{
 if(!database)throw fail(503,'review_response_choices_unavailable');
 const c=await database.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='3000ms'");await guardAccountTransaction(c,subject);
  if(input.action!=='load')await enableReviewResponseChoice(c,env,subject);
  const result=await runReviewResponseChoice(c,input);await guardAccountTransaction(c,subject);
  if(input.action!=='load'&&!reviewResponseContextEnabled(env,subject))throw fail(503,'review_response_context_paused');
  await c.query('COMMIT');return {...result,enabled:reviewResponseContextEnabled(env,subject)&&result.available,canFollowUp:reviewFollowupsEnabled(env)&&result.available&&result.availability==='current'};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
};}
export function createReviewResponseChoicesHandler(database,env={}){const run=createReviewResponseChoiceRepository(database,env);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/review-response-choices')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}let input;try{input=validateReviewResponseChoice(JSON.parse(raw));}catch{return send(400,{error:'invalid_review_response_choice'});}return send(200,await run(req.origenIdentity.sub,input));}
 catch(error){return send(error.status||503,{error:error.status?error.message:'review_response_choices_unavailable'});}
};}
