import {validateFollowUpTarget,validateFollowUpSchedule} from '../src/studentFollowUp.mjs';
import {reviewResponseContextEnabled} from './review-response-context.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {allowedRequest} from './origin.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const studentFollowUpEnabled=(env={},subject)=>env.ORIGEN_STUDENT_FOLLOW_UP==='true'&&reviewResponseContextEnabled(env,subject);
export function validateStudentFollowUp(input){
 if(input?.action==='overview'||input?.action==='stop-all'){
  const keys=input.action==='overview'?['action','studentId']:['action','studentId','operationId'];
  if(Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||typeof input.studentId!=='string'||!input.studentId.trim()||input.studentId.length>128||/[\x00-\x1f\x7f]/.test(input.studentId)||input.action==='stop-all'&&!uuid(input.operationId))throw fail(400,'invalid_student_follow_up');
  return {...input};
 }
 const fields={load:[],prepare:['operationId','revision','planVersion','schedule','language'],confirm:['operationId','previewId','digest','confirmed'],pause:['operationId','revision'],stop:['operationId','revision'],'delete-report':['operationId','reportId','revision']};
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(fields,input.action))throw fail(400,'invalid_student_follow_up');
 const keys=['action','studentId','target',...fields[input.action]];
 if(Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||typeof input.studentId!=='string'||!input.studentId.trim()||input.studentId.length>128||/[\x00-\x1f\x7f]/.test(input.studentId))throw fail(400,'invalid_student_follow_up');
 const out={...input,target:validateFollowUpTarget(input.target)};
 if(input.action!=='load'&&!uuid(input.operationId))throw fail(400,'invalid_student_follow_up');
 if('revision' in input&&(!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>2147483647))throw fail(400,'invalid_student_follow_up');
 if(input.action==='prepare'){
  if(!Number.isSafeInteger(input.planVersion)||input.planVersion<1||input.planVersion>2147483647||!['en','es'].includes(input.language))throw fail(400,'invalid_student_follow_up');
  out.schedule=validateFollowUpSchedule(input.schedule);
 }
 if(input.action==='confirm'&&(!uuid(input.previewId)||typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||input.confirmed!==true))throw fail(400,'invalid_student_follow_up');
 if(input.action==='delete-report'&&!uuid(input.reportId))throw fail(400,'invalid_student_follow_up');
 return out;
}
export async function assertStudentFollowUpReady(database,env={}){
 if(env.ORIGEN_STUDENT_FOLLOW_UP!=='true')return;
 if(!database)throw Error('student_follow_up_migration_required');
 const migrated=(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name IN ('104_student_follow_up_foundation.sql','105_student_follow_up_controls.sql','106_student_follow_up_selection.sql','107_student_follow_up_conversations.sql','108_student_shared_updates.sql')")).rows.length===5;
 const allowed=migrated&&(await database.query("SELECT has_function_privilege(current_user,'origen_student_follow_up_command(jsonb)','EXECUTE') AND has_function_privilege(current_user,'origen_student_follow_up_controls(jsonb)','EXECUTE') AND has_function_privilege(current_user,'origen_conversation_opening_command(jsonb)','EXECUTE') AND has_function_privilege(current_user,'origen_follow_up_conversation_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed;
 if(!allowed)throw Error('student_follow_up_migration_required');
}
export function createStudentFollowUpRepository(database,env={}){return async(subject,raw)=>{
 const input=validateStudentFollowUp(raw),enrolling=['prepare','confirm'].includes(input.action);
 if(!database)throw fail(503,'student_follow_up_unavailable');
 if(enrolling&&!studentFollowUpEnabled(env,subject))throw fail(503,'student_follow_up_paused');
 const c=await database.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='3000ms'");await guardAccountTransaction(c,subject);
  if(studentFollowUpEnabled(env,subject))await c.query("SELECT set_config('origen.student_follow_up','true',true)");
  const command=['overview','stop-all'].includes(input.action)?'origen_student_follow_up_controls':'origen_student_follow_up_command';
  const result=(await c.query(`SELECT ${command}($1::jsonb) AS result`,[JSON.stringify(input)])).rows[0].result;
  if(result.error)throw fail(result.error==='invalid_student_follow_up'?400:result.error.endsWith('_changed')||result.error.endsWith('_expired')?409:result.error.endsWith('_unavailable')?404:result.error.endsWith('_paused')?503:403,result.error);
  await guardAccountTransaction(c,subject);
  if(enrolling&&!studentFollowUpEnabled(env,subject))throw fail(503,'student_follow_up_paused');
  await c.query('COMMIT');return {...result,...(result.items?{items:result.items.map(item=>({...item,canEnroll:studentFollowUpEnabled(env,subject)&&item.canEnroll}))}:{}),enabled:studentFollowUpEnabled(env,subject),...(Object.hasOwn(result,'canEnroll')?{canEnroll:studentFollowUpEnabled(env,subject)&&result.canEnroll}:{})};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
};}
export function createStudentFollowUpHandler(database,env={}){const run=createStudentFollowUpRepository(database,env);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/student-follow-up')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_student_follow_up'});}return send(200,await run(req.origenIdentity.sub,input));}
 catch(error){return send([400,403,404,409,503].includes(error.status)?error.status:503,{error:error.status?error.message:'student_follow_up_unavailable'});}
};}
