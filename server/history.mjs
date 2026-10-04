import {safeErrorCode} from './api-logging.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {allowedRequest} from './origin.mjs';

const fail=(status,error)=>Object.assign(new Error(error),{status});
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=128;
export function validateMemory(value){
 if(!value||!identifier(value.id)||(value.studentId!==null&&!identifier(value.studentId))||!['profile','finance','admissions','planning','loans'].includes(value.mode)||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>12000||typeof value.date!=='string'||!Number.isFinite(Date.parse(value.date))||!Array.isArray(value.sources)||value.sources.length>30)throw fail(400,'invalid_request');
 const sources=value.sources.map(s=>{if(!s||typeof s.title!=='string'||s.title.length>300||typeof s.url!=='string'||s.url.length>2000||typeof s.checkedAt!=='string'||!Number.isFinite(Date.parse(s.checkedAt)))throw fail(400,'invalid_request');let url;try{url=new URL(s.url);}catch{throw fail(400,'invalid_request');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw fail(400,'invalid_request');return {title:s.title,url:url.href,checkedAt:new Date(s.checkedAt).toISOString()};});
 return {id:value.id,studentId:value.studentId,mode:value.mode,summary:value.summary.trim(),date:new Date(value.date).toISOString(),sources};
}
const memory=row=>({id:row.id,studentId:row.student_id,mode:row.mode,summary:row.summary,date:new Date(row.conversation_at).toISOString(),sources:row.sources});
export function createHistoryRepository(database){
 return async(subject,input)=>{
  if(!database)throw fail(503,'database_unavailable');
  const client=await database.connect();
  try{
   await client.query('BEGIN');
   await guardAccountTransaction(client,subject);
   const account=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
   if(!account){if(input.action==='load'&&!input.studentId){await client.query('COMMIT');return {items:[]};}throw fail(404,'student_not_found');}
   const owner=account.id;
   const requireStudent=async id=>{if(!(await client.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,id])).rows.length)throw fail(404,'student_not_found');};
   if(input.studentId)await requireStudent(input.studentId);
   if(input.action==='save'||input.action==='import'){
    let values=input.action==='save'?[validateMemory(input.item)]:input.items.map(validateMemory);
    if(input.action==='import'){
     const receipt=await client.query('SELECT account_id FROM origen_history_imports WHERE account_id=$1',[owner]);
     if(receipt.rows.length)values=[];
     else await client.query('INSERT INTO origen_history_imports(account_id) VALUES($1)',[owner]);
    }
    for(const item of values){
     // Imports skip summaries for students that were deleted or never belonged to this account.
     const student=item.studentId===null?{id:null}:(await client.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,item.studentId])).rows[0];
     if(!student){if(input.action==='import')continue;throw fail(404,'student_not_found');}
     const existing=(await client.query('SELECT student_id FROM origen_conversation_summaries WHERE account_id=$1 AND id=$2',[owner,item.id])).rows[0];
     if(existing&&existing.student_id!==item.studentId)throw fail(409,'summary_conflict');
     await client.query('INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,sources,conversation_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,id) DO NOTHING',[owner,item.id,item.studentId,item.mode,item.summary,JSON.stringify(item.sources),item.date]);
    }
   }
   if(input.action==='delete'){
    if(!(await client.query('DELETE FROM origen_conversation_summaries WHERE account_id=$1 AND id=$2 RETURNING id',[owner,input.id])).rows.length)throw fail(404,'summary_not_found');
   }
   const rows=(await client.query(`SELECT id,student_id,mode,summary,sources,conversation_at FROM origen_conversation_summaries WHERE account_id=$1${input.studentId===null?' AND student_id IS NULL':input.studentId?' AND student_id=$2':''} ORDER BY conversation_at DESC,id DESC LIMIT ${input.action==='context'?6:100}`,input.studentId?[owner,input.studentId]:[owner])).rows;
   await client.query('COMMIT');return {items:rows.map(memory).reverse()};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}
export function createHistoryHandler(database){
 const run=createHistoryRepository(database);
 return async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/conversation-history')return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
  try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2000000)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{throw fail(400,'invalid_request');}
   if(!['load','delete','import','save'].includes(input?.action)||input.studentId!==undefined&&input.studentId!==null&&!identifier(input.studentId)||input.action==='delete'&&!identifier(input.id)||input.action==='import'&&(!Array.isArray(input.items)||input.items.length>100))throw fail(400,'invalid_request');
   if(input.action==='save')input.item=validateMemory(input.item);
   return send(200,await run(req.origenIdentity.sub,input));
  }catch(error){if(![400,403,404,409].includes(error.status))req.log?.({event:'database_error',level:'error',code:safeErrorCode(error)});const status=[400,403,404,409].includes(error.status)?error.status:503;return send(status,{error:status===503?'history_unavailable':error.message});}
 };
}
