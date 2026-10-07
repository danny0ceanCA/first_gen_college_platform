import {progressEnabled,recordPlanRevision} from './progress-history.mjs';
import {safeErrorCode} from './api-logging.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail(400,'invalid_plan');return value.trim();};
const id=value=>text(value,128,true);
const uuid=value=>{const out=id(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out))throw fail(400,'invalid_plan');return out;};
export function validatePlan(input){
 if(!input||!['load','create','update','delete'].includes(input.action))throw fail(400,'invalid_plan');
 if(input.action==='load'){if(input.studentId!==undefined&&input.studentId!==null)id(input.studentId);return {action:'load',studentId:input.studentId};}
 const out={action:input.action};
 if(input.action!=='create'){out.id=uuid(input.id);if(!Number.isSafeInteger(input.version)||input.version<1)throw fail(400,'invalid_plan');out.version=input.version;}
 if(input.action==='delete')return out;
 const p=input.plan;
 if(!p||!['education','courses','transfer','degree','career','financial','other'].includes(p.category)||!['active','archived'].includes(p.status)||!Array.isArray(p.steps)||p.steps.length>30||!Array.isArray(p.summaryIds)||p.summaryIds.length>30)throw fail(400,'invalid_plan');
 out.plan={studentId:p.studentId===null?null:id(p.studentId),title:text(p.title,200,true),goal:text(p.goal,4000),category:p.category,status:p.status,summaryIds:[...new Set(p.summaryIds.map(id))],steps:p.steps.map(s=>{
  if(!s||!['not-started','in-progress','complete'].includes(s.status)||!Array.isArray(s.sources)||s.sources.length>10)throw fail(400,'invalid_plan');
  if(s.dueDate!==null&&(typeof s.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.dueDate)||!Number.isFinite(Date.parse(s.dueDate))||new Date(s.dueDate).toISOString().slice(0,10)!==s.dueDate))throw fail(400,'invalid_plan');
  return {id:id(s.id),title:text(s.title,200,true),action:text(s.action,4000),notes:text(s.notes,4000),status:s.status,dueDate:s.dueDate,sources:s.sources.map(source=>{const title=text(source.title,300,true),url=text(source.url,2000,true);let parsed;try{parsed=new URL(url);}catch{throw fail(400,'invalid_plan');}if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw fail(400,'invalid_plan');return {title,url:parsed.href};})};
 })};
 if(new Set(out.plan.steps.map(s=>s.id)).size!==out.plan.steps.length)throw fail(400,'invalid_plan');
 return out;
}
export function createPlanRepository(database,env=process.env){return async(subject,input)=>{
 if(!database)throw fail(503,'plans_unavailable');
 const c=await database.connect();
 try{
  await c.query('BEGIN');
  await guardAccountTransaction(c,subject);
  const account=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
  if(!account)throw fail(404,'account_not_found');const owner=account.id;
  const requireStudent=async target=>{if(target!==null&&!(await c.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,target])).rows.length)throw fail(404,'student_not_found');};
  if(input.studentId!==undefined)await requireStudent(input.studentId);
  let planId=input.id;
  if(input.action!=='load'){
   let current;
   if(input.action!=='create'){
    current=(await c.query('SELECT student_id,version FROM origen_plans WHERE account_id=$1 AND id=$2 FOR UPDATE',[owner,planId])).rows[0];
    if(!current)throw fail(404,'plan_not_found');if(current.version!==input.version)throw fail(409,'plan_changed');
   }
   if(input.action==='delete')await c.query('DELETE FROM origen_plans WHERE account_id=$1 AND id=$2',[owner,planId]);
   else {
    const p=input.plan;await requireStudent(p.studentId);
    const previous=progressEnabled(env)&&current?(await c.query('SELECT id,status FROM origen_plan_steps WHERE account_id=$1 AND plan_id=$2',[owner,planId])).rows:[];
    // A plan's target is immutable: moving it could mix two students' actions/history.
    if(current&&current.student_id!==p.studentId)throw fail(409,'plan_target_mismatch');
    for(const summaryId of p.summaryIds){const summary=(await c.query('SELECT student_id FROM origen_conversation_summaries WHERE account_id=$1 AND id=$2',[owner,summaryId])).rows[0];if(!summary||summary.student_id!==p.studentId)throw fail(400,'summary_target_mismatch');}
    if(input.action==='create')planId=(await c.query('INSERT INTO origen_plans(account_id,student_id,title,goal,category,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[owner,p.studentId,p.title,p.goal,p.category,p.status])).rows[0].id;
    else await c.query('UPDATE origen_plans SET title=$3,goal=$4,category=$5,status=$6,version=version+1,updated_at=now() WHERE account_id=$1 AND id=$2',[owner,planId,p.title,p.goal,p.category,p.status]);
    await c.query('DELETE FROM origen_plan_steps WHERE account_id=$1 AND plan_id=$2',[owner,planId]);
    await c.query('DELETE FROM origen_plan_conversations WHERE account_id=$1 AND plan_id=$2',[owner,planId]);
    for(const [position,s] of p.steps.entries()){
     await c.query('INSERT INTO origen_plan_steps(account_id,plan_id,id,position,title,action,notes,status,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,planId,s.id,position,s.title,s.action,s.notes,s.status,s.dueDate]);
     for(const [n,source] of s.sources.entries())await c.query('INSERT INTO origen_plan_sources(account_id,plan_id,step_id,position,title,url) VALUES($1,$2,$3,$4,$5,$6)',[owner,planId,s.id,n,source.title,source.url]);
    }
    for(const summaryId of p.summaryIds)await c.query('INSERT INTO origen_plan_conversations(account_id,plan_id,summary_id) VALUES($1,$2,$3)',[owner,planId,summaryId]);
    if(progressEnabled(env))await recordPlanRevision(c,owner,planId,current?current.version+1:1,p,previous);
   }
  }
  const rows=(await c.query(`SELECT * FROM origen_plans WHERE account_id=$1${input.studentId===null?' AND student_id IS NULL':input.studentId!==undefined?' AND student_id=$2':''} ORDER BY updated_at DESC,id LIMIT 100`,input.studentId!==undefined&&input.studentId!==null?[owner,input.studentId]:[owner])).rows;
  // Four reads regardless of plan count, rather than three extra queries per plan.
  const ids=rows.map(row=>row.id),params=[owner,...ids],slots=ids.map((_,i)=>`$${i+2}`).join(',');
  const steps=ids.length?(await c.query(`SELECT account_id,plan_id,id,position,title,action,notes,status,to_char(due_date,'YYYY-MM-DD') AS due_date FROM origen_plan_steps WHERE account_id=$1 AND plan_id IN (${slots}) ORDER BY position`,params)).rows:[];
  const sources=ids.length?(await c.query(`SELECT * FROM origen_plan_sources WHERE account_id=$1 AND plan_id IN (${slots}) ORDER BY position`,params)).rows:[];
  const summaries=ids.length?(await c.query(`SELECT plan_id,summary_id FROM origen_plan_conversations WHERE account_id=$1 AND plan_id IN (${slots})`,params)).rows:[];
  const plans=[];
  for(const row of rows){
   plans.push({id:row.id,studentId:row.student_id,title:row.title,goal:row.goal,category:row.category,status:row.status,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,summaryIds:summaries.filter(s=>s.plan_id===row.id).map(s=>s.summary_id),steps:steps.filter(s=>s.plan_id===row.id).map(s=>({id:s.id,title:s.title,action:s.action,notes:s.notes,status:s.status,dueDate:s.due_date?s.due_date.slice(0,10):null,sources:sources.filter(x=>x.plan_id===row.id&&x.step_id===s.id).map(x=>({title:x.title,url:x.url}))}))});
  }
  await c.query('COMMIT');return {plans};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
};}
export function createPlanHandler(database,env=process.env){const run=createPlanRepository(database,env);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/plans')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512000)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_plan'});}return send(200,await run(req.origenIdentity.sub,validatePlan(input)));}
 catch(error){const known=[400,403,404,409].includes(error.status);if(!known)req.log?.({event:'database_error',level:'error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'plans_unavailable'});}
};}
