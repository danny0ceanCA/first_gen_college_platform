import {createHash} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {safeErrorCode} from './api-logging.mjs';
import {validateSheet,safeSheetURL} from '../src/workspaceSheets.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function validateSheetRequest(value){
 if(!value||!['load','create','update','delete','prepare'].includes(value.action)||value.studentId!==null&&(typeof value.studentId!=='string'||!value.studentId||value.studentId.length>128))throw fail(400,'invalid_sheet');
 const input={action:value.action,studentId:value.studentId};
 if(['create','update','delete'].includes(input.action)){if(!uuid(value.id))throw fail(400,'invalid_sheet');input.id=value.id;}
 if(['update','delete'].includes(input.action)){if(!Number.isSafeInteger(value.version)||value.version<1)throw fail(400,'invalid_sheet');input.version=value.version;}
 if(['create','update'].includes(input.action)){if(value.reviewed!==true)throw fail(400,'review_required');input.sheet=validateSheet(value.sheet);}
 if(input.action==='prepare'){
  if(!Array.isArray(value.notes)||value.notes.length>30||!Array.isArray(value.actions)||value.actions.length>30||typeof value.includeGoal!=='boolean'||typeof value.includeSources!=='boolean')throw fail(400,'invalid_selection');
  input.notes=value.notes.map(n=>{if(!n||!uuid(n.id)||!Number.isSafeInteger(n.version)||n.version<1)throw fail(400,'invalid_selection');return {id:n.id,version:n.version};});
  input.actions=value.actions.map(a=>{if(!a||!uuid(a.planId)||typeof a.stepId!=='string'||!a.stepId||a.stepId.length>128||!Number.isSafeInteger(a.version)||a.version<1)throw fail(400,'invalid_selection');return {planId:a.planId,stepId:a.stepId,version:a.version};});
  if(new Set(input.notes.map(n=>n.id)).size!==input.notes.length||new Set(input.actions.map(a=>JSON.stringify([a.planId,a.stepId]))).size!==input.actions.length||input.notes.length+input.actions.length>40)throw fail(400,'invalid_selection');
  input.includeGoal=value.includeGoal;input.includeSources=value.includeSources;
 }
 return input;
}
export function createSheetRepository(database){return async(subject,raw)=>{
 const input=validateSheetRequest(raw);if(!database)throw fail(503,'sheets_unavailable');const c=await database.connect();
 try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const account=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];if(!account)throw fail(404,'account_not_found');const owner=account.id;
  const student=input.studentId===null?null:(await c.query('SELECT id,goals FROM origen_students WHERE account_id=$1 AND id=$2',[owner,input.studentId])).rows[0];if(input.studentId!==null&&!student)throw fail(404,'student_not_found');
  if(input.action==='prepare'){
   const entries=[],sources=[];
   const addSources=rows=>{if(!input.includeSources)return;for(const s of rows||[]){const url=safeSheetURL(s.url);if(url&&!sources.some(x=>x.url===url)&&sources.length<20)sources.push({title:String(s.title||url).slice(0,200),url,checkedAt:s.checkedAt&&Number.isFinite(Date.parse(s.checkedAt))?new Date(s.checkedAt).toISOString():null});}};
   for(const pick of input.notes){
    const note=(await c.query('SELECT * FROM origen_topic_notes WHERE account_id=$1 AND id=$2',[owner,pick.id])).rows[0];if(!note||note.student_id!==input.studentId||note.status!=='saved')throw fail(404,'selection_unavailable');if(note.version!==pick.version)throw fail(409,'selection_changed');
    entries.push({kind:note.kind==='question'?'question':'note',text:note.content,done:false});
    if(note.source_summary_id&&input.includeSources){const summary=(await c.query('SELECT student_id,sources FROM origen_conversation_summaries WHERE account_id=$1 AND id=$2',[owner,note.source_summary_id])).rows[0];if(summary?.student_id===input.studentId)addSources(summary.sources);}
   }
   for(const pick of input.actions){
    const row=(await c.query("SELECT p.student_id,p.status AS plan_status,p.version,s.title,s.action,s.notes,s.status,to_char(s.due_date,'YYYY-MM-DD') AS due_date FROM origen_plans p JOIN origen_plan_steps s ON s.account_id=p.account_id AND s.plan_id=p.id WHERE p.account_id=$1 AND p.id=$2 AND s.id=$3",[owner,pick.planId,pick.stepId])).rows[0];if(!row||row.student_id!==input.studentId||row.plan_status!=='active')throw fail(404,'selection_unavailable');if(row.version!==pick.version)throw fail(409,'selection_changed');
    const text=[row.title,row.action,row.notes,row.due_date?'Personal target date / Fecha personal: '+row.due_date:''].filter(Boolean).join('\n');if(text.length>2000)throw fail(409,'selection_too_long');entries.push({kind:'action',text,done:row.status==='complete'});
    if(input.includeSources)addSources((await c.query('SELECT title,url FROM origen_plan_sources WHERE account_id=$1 AND plan_id=$2 AND step_id=$3 ORDER BY position',[owner,pick.planId,pick.stepId])).rows);
   }
   await c.query('COMMIT');return {entries,sources,goal:input.includeGoal?student?.goals||'':''};
  }
  if(input.action==='create'){
   const fingerprint=createHash('sha256').update(JSON.stringify([input.studentId,input.sheet])).digest('hex');
   const receipt=(await c.query('SELECT fingerprint FROM origen_workspace_sheet_receipts WHERE account_id=$1 AND id=$2',[owner,input.id])).rows[0];
   if(receipt){if(receipt.fingerprint!==fingerprint)throw fail(409,'create_changed');if(!(await c.query('SELECT id FROM origen_workspace_sheets WHERE account_id=$1 AND id=$2',[owner,input.id])).rows.length)throw fail(409,'sheet_deleted');}
   else{
    if(Number((await c.query('SELECT count(*) AS count FROM origen_workspace_sheets WHERE account_id=$1',[owner])).rows[0].count)>=100)throw fail(409,'sheet_limit');
    await c.query('INSERT INTO origen_workspace_sheets(account_id,id,student_id,content) VALUES($1,$2,$3,$4)',[owner,input.id,input.studentId,JSON.stringify(input.sheet)]);
    await c.query('INSERT INTO origen_workspace_sheet_receipts(account_id,id,fingerprint) VALUES($1,$2,$3)',[owner,input.id,fingerprint]);
   }
  }
  if(input.action==='update'||input.action==='delete'){
   const row=(await c.query('SELECT student_id,version FROM origen_workspace_sheets WHERE account_id=$1 AND id=$2 FOR UPDATE',[owner,input.id])).rows[0];if(!row||row.student_id!==input.studentId)throw fail(404,'sheet_not_found');if(row.version!==input.version)throw fail(409,'sheet_changed');
   if(input.action==='delete')await c.query('DELETE FROM origen_workspace_sheets WHERE account_id=$1 AND id=$2',[owner,input.id]);
   else await c.query('UPDATE origen_workspace_sheets SET content=$3,version=version+1,updated_at=now() WHERE account_id=$1 AND id=$2',[owner,input.id,JSON.stringify(input.sheet)]);
  }
  const rows=(await c.query(`SELECT id,student_id,content,version,updated_at FROM origen_workspace_sheets WHERE account_id=$1 AND ${input.studentId===null?'student_id IS NULL':'student_id=$2'} ORDER BY updated_at DESC,id`,input.studentId===null?[owner]:[owner,input.studentId])).rows;
  await c.query('COMMIT');return {sheets:rows.map(r=>({id:r.id,studentId:r.student_id,sheet:r.content,version:r.version,updatedAt:new Date(r.updated_at).toISOString()}))};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
};}
export function createSheetHandler(database){const run=createSheetRepository(database);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/workspace-sheets')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});if(req.method!=='POST')return send(405,{error:'method_not_allowed'});if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>120000)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_sheet'});}return send(200,await run(req.origenIdentity.sub,input));}
 catch(error){const known=[400,403,404,409].includes(error.status);if(!known)req.log?.({event:'api_error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'sheets_unavailable'});}
};}
