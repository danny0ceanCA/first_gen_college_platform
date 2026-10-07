import {safeErrorCode} from './api-logging.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function progressEnabled(env=process.env){return env.PROGRESS_HISTORY_ENABLED==='true';}
export function assertProgressConfiguration(env){
 if(progressEnabled(env)&&env.NODE_ENV==='production'&&(!env.PROGRESS_DATA_OWNER?.trim()||!(env.RENDER_GIT_COMMIT||env.APPLICATION_REVISION)))throw new Error('Progress history requires a data owner and application revision.');
}
// Use the caller's transaction: failed profile/plan writes cannot leave history behind.
export async function observeProfile(c,owner,studentId,values,origin){
 const before=(await c.query('SELECT * FROM origen_students WHERE account_id=$1 AND id=$2 FOR UPDATE',[owner,studentId])).rows[0];
 return async()=>{
  for(const [field,value] of Object.entries(values)){
   if(before&&before[field]===value)continue;
   await c.query('INSERT INTO origen_profile_observations(account_id,student_id,field,previous_value,reported_value,origin) VALUES($1,$2,$3,$4,$5,$6)',[owner,studentId,field,before?.[field]??null,value,origin]);
  }
 };
}
export async function recordPlanRevision(c,owner,planId,version,plan,previous){
 // Summary references remain in the current relational table; never duplicate their contents.
 const {summaryIds,...snapshot}=plan;
 await c.query('INSERT INTO origen_plan_revisions(account_id,plan_id,version,snapshot) VALUES($1,$2,$3,$4)',[owner,planId,version,JSON.stringify(snapshot)]);
 const old=new Map(previous.map(s=>[s.id,s.status])),next=new Map(plan.steps.map(s=>[s.id,s.status]));
 for(const stepId of new Set([...old.keys(),...next.keys()])){
  const a=old.get(stepId),b=next.get(stepId);if(a===b)continue;
  const kind=a===undefined?'added':b===undefined?'removed':'status-changed';
  await c.query('INSERT INTO origen_step_transitions(account_id,plan_id,version,step_id,kind,previous_status,reported_status) VALUES($1,$2,$3,$4,$5,$6,$7)',[owner,planId,version,stepId,kind,a??null,b??null]);
 }
}
export function validateProgress(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'invalid_progress');
 if(input.action==='load'&&Object.keys(input).length===1)return {action:'load'};
 const keys=['action','id','studentId','kind','responseStatus','value','language','occurredDate'];
 if(Object.keys(input).some(k=>!keys.includes(k))||input.action!=='record'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)||!['en','es'].includes(input.language)||!(input.studentId===null||(typeof input.studentId==='string'&&input.studentId.length>0&&input.studentId.length<=128)))throw fail(400,'invalid_progress');
 if(input.kind==='feedback'){
  if(!['answered','declined','unknown'].includes(input.responseStatus)||input.occurredDate!=null||(input.responseStatus==='answered'?!['helpful','partly','not-yet'].includes(input.value):input.value!==null))throw fail(400,'invalid_progress');
 }else if(input.kind==='milestone'){
  if(input.responseStatus!=='answered'||!['counselor-contacted','application-started','application-submitted','aid-offer-reviewed'].includes(input.value))throw fail(400,'invalid_progress');
  if(input.occurredDate!=null&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredDate)||!Number.isFinite(Date.parse(input.occurredDate))||new Date(input.occurredDate).toISOString().slice(0,10)!==input.occurredDate||input.occurredDate>new Date().toISOString().slice(0,10)))throw fail(400,'invalid_progress');
 }else throw fail(400,'invalid_progress');
 return {...input,occurredDate:input.occurredDate??null};
}
export function createProgressRepository(database){return async(subject,input)=>{
 const c=await database.connect();try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const owner=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0]?.id;
  if(!owner)throw fail(404,'account_not_found');
  if(input.action==='record'){
   if(input.studentId!==null&&!(await c.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,input.studentId])).rows.length)throw fail(404,'student_not_found');
   const values=[owner,input.id,input.studentId,input.kind,input.kind==='feedback'?'guidance-helpfulness':null,input.kind==='feedback'?1:null,input.responseStatus,input.value,input.language,input.occurredDate];
   const prior=(await c.query('SELECT * FROM origen_progress_reports WHERE account_id=$1 AND id=$2',[owner,input.id])).rows[0];
   if(prior){
    const priorDate=prior.occurred_date?new Date(prior.occurred_date).toISOString().slice(0,10):null;
    if(prior.student_id!==input.studentId||prior.kind!==input.kind||prior.response_status!==input.responseStatus||prior.value!==input.value||prior.language!==input.language||priorDate!==input.occurredDate)throw fail(409,'report_id_conflict');
   }else {
    if(Number((await c.query('SELECT count(*) AS count FROM origen_progress_reports WHERE account_id=$1',[owner])).rows[0].count)>=1000)throw fail(409,'report_limit_reached');
    await c.query('INSERT INTO origen_progress_reports(account_id,id,student_id,kind,definition_id,definition_version,response_status,value,language,occurred_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',values);
   }
  }
  if(input.action==='record'){await c.query('COMMIT');return {saved:true,id:input.id,milestonesAreSelfReported:true};}
  const result={};
  for(const [key,table] of Object.entries({observations:'origen_profile_observations',revisions:'origen_plan_revisions',transitions:'origen_step_transitions',reports:'origen_progress_reports'}))result[key]=(await c.query(`SELECT * FROM ${table} WHERE account_id=$1 ORDER BY ${key==='transitions'?'version DESC,step_id':'recorded_at DESC'} LIMIT ${key==='revisions'?10:100}`, [owner])).rows;
  result.historyLimits={observations:100,revisions:10,transitions:100,reports:100}; // Bounded view; the account export includes all retained rows.
  result.definitions=(await c.query('SELECT * FROM origen_measurement_definitions')).rows;
  result.milestonesAreSelfReported=true;
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
};}
export function createProgressHandler(database,env=process.env){const run=database?createProgressRepository(database):null;return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/progress')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!run||!progressEnabled(env))return send(503,{error:'progress_unavailable'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8000)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_progress'});}return send(200,await run(req.origenIdentity.sub,validateProgress(input)));}
 catch(error){const known=[400,403,404,409].includes(error.status);if(!known)req.log?.({event:'database_error',level:'error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'progress_unavailable'});}
};}
export async function purgeProgressHistory(database){
 if(!database)return;
 for(const table of ['origen_profile_observations','origen_plan_revisions','origen_progress_reports'])await database.query(`DELETE FROM ${table} WHERE recorded_at < now() - interval '90 days'`);
}
