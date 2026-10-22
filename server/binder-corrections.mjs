import {createHash,randomUUID} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {databaseOperation} from './observability/dependencies.mjs';
import {safeErrorCode} from './api-logging.mjs';
import {validateMemoryRequest} from './student-memory.mjs';
import {validateTopicRequest} from './topic-notes.mjs';
import {correctionsEnabled} from './binder-corrections-policy.mjs';
import {eligibilityAllowed} from './permission-context.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Both existing public item shapes and database rows map to this bounded shape.
export function correctionSnapshot(item,store){
 const result={content:item.content,language:item.language,status:item.status,summaryId:item.summaryId??item.source_summary_id??null,quote:item.quote??item.source_quote??'',organization:item.organization??null};
 if(store==='memory')Object.assign(result,{category:item.category,speaker:item.speaker,reportedBy:item.reportedBy??item.reported_by,sourceVersion:item.sourceVersion??item.source_version??null,conversationAt:item.conversationAt??item.source_at??null});
 else Object.assign(result,{topic:item.topic,kind:item.kind,origin:item.origin});
 return JSON.parse(JSON.stringify(result));
}
export function validateCorrection(input){
 if(!input||!['memory','note'].includes(input.store)||!['update','delete','confirm','undo'].includes(input.action)||!uuid(input.operationId)||!uuid(input.id)||!Number.isSafeInteger(input.version)||input.version<1||(input.studentId!==null&&(typeof input.studentId!=='string'||!input.studentId||input.studentId.length>128))||!input.before||typeof input.before!=='object')throw fail(400,'invalid_correction');
 if(input.action==='confirm'&&input.store!=='memory')throw fail(400,'invalid_correction');
 const out={operationId:input.operationId,store:input.store,action:input.action,studentId:input.studentId,id:input.id,version:input.version,before:correctionSnapshot(input.before,input.store)};
 if(JSON.stringify(out.before).length>18000)throw fail(400,'invalid_correction');
 if(input.action==='undo'){if(!uuid(input.undoOf))throw fail(400,'invalid_correction');out.undoOf=input.undoOf;}
 if(input.action==='update'){
  const field=input.store==='memory'?'memory':'note';
  out.value=(input.store==='memory'?validateMemoryRequest:validateTopicRequest)({action:'update',studentId:input.studentId,id:input.id,version:input.version,[field]:input.value})[field];
 }
 return out;
}

export function createCorrectionService(database,env={}){
 return async(subject,input,{beforeCommit,client:transactionClient,signal}={})=>{
  if(!correctionsEnabled(env))throw fail(503,'binder_corrections_disabled');
  input=validateCorrection(input);
  const c=transactionClient||await databaseOperation(database,input.store==='memory'?'memory.save':'notes.save');
  const commit=()=>transactionClient?Promise.resolve():c.query('COMMIT');
  try{
   signal?.throwIfAborted();if(!transactionClient)await c.query('BEGIN');await guardAccountTransaction(c,subject);
   const account=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
   if(!account)throw fail(404,'account_not_found');const owner=account.id;
   if(input.studentId!==null&&!(await c.query('SELECT 1 FROM origen_students WHERE account_id=$1 AND id=$2',[owner,input.studentId])).rows.length)throw fail(404,'student_not_found');
   const permissionRow=(await c.query("SELECT revision,status,permission_expires_at FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[subject])).rows[0];
   if(!eligibilityAllowed(permissionRow))throw fail(403,'permission_required');const permission=permissionRow.revision;
   const requestHash=hash([owner,input]);
   const receipt=(await c.query('SELECT *,undo_until>now() AS undo_live FROM origen_binder_changes WHERE account_id=$1 AND operation_id=$2',[owner,input.operationId])).rows[0];
   const reply=(row,replayed)=>({id:row.result_id,version:row.result_version,replayed,withdrawnSuggestions:row.withdrawn,undo:row.action!=='undo'&&!row.undone_by&&row.undo_live?{operationId:row.operation_id,id:row.result_id,version:row.result_version,before:input.before,expiresAt:row.undo_until}:null});
   if(receipt){
    if(receipt.request_hash!==requestHash)throw fail(409,'operation_changed');
    if(receipt.permission_revision!==permission)throw fail(409,'undo_unavailable');
    signal?.throwIfAborted();await commit();return reply(receipt,true);
   }
   // Bound metadata growth. Version preconditions still reject stale operations
   // after the documented 90-day replay window; no item content is retained here.
   await c.query("DELETE FROM origen_binder_changes WHERE account_id=$1 AND created_at<now()-interval '90 days'",[owner]);
   if(Number((await c.query('SELECT count(*) AS n FROM origen_binder_changes WHERE account_id=$1',[owner])).rows[0].n)>=20000)throw fail(429,'correction_limit');
   const table=input.store==='memory'?'origen_student_memories':'origen_topic_notes';
   const current=async id=>(await c.query(`SELECT * FROM ${table} WHERE account_id=$1 AND id=$2 ${input.store==='memory'?"AND status<>'superseded'":''} FOR UPDATE`,[owner,id])).rows[0];
   let old=await current(input.id),undoReceipt;
   if(input.action==='undo'){
    undoReceipt=(await c.query('SELECT *,undo_until>now() AS undo_live FROM origen_binder_changes WHERE account_id=$1 AND operation_id=$2',[owner,input.undoOf])).rows[0];
    if(!undoReceipt||undoReceipt.store!==input.store||undoReceipt.student_id!==input.studentId||undoReceipt.result_id!==input.id||undoReceipt.result_version!==input.version||undoReceipt.undone_by||!undoReceipt.undo_live||undoReceipt.action==='undo'||undoReceipt.permission_revision!==permission||undoReceipt.before_hash!==hash([owner,input.before]))throw fail(409,'undo_unavailable');
    if(undoReceipt.action==='delete'){
     if(input.store==='note'?!!old:!old||old.status!=='deleted'||old.version!==input.version)throw fail(409,'item_changed');
    }else if(!old||old.version!==input.version||old.student_id!==input.studentId||old.status==='deleted')throw fail(409,'item_changed');
   }else if(!old||old.student_id!==input.studentId||old.status==='deleted')throw fail(404,'item_not_found');
   else if(old.version!==input.version||hash(correctionSnapshot(old,input.store))!==hash(input.before))throw fail(409,'item_changed');
   const sourceId=input.before.summaryId;
   let sourceHash=null;
   if(sourceId){
    const source=(await c.query('SELECT summary FROM origen_conversation_summaries WHERE account_id=$1 AND id=$2 AND student_id IS NOT DISTINCT FROM $3',[owner,sourceId,input.studentId])).rows[0];
    if(!source)throw fail(409,'undo_unavailable');sourceHash=hash(source.summary);
    if(undoReceipt&&undoReceipt.source_hash!==sourceHash)throw fail(409,'undo_unavailable');
   }
   let withdrawn=0;
   if(sourceId&&input.action!=='confirm'&&undoReceipt?.action!=='confirm'){
    await c.query('INSERT INTO origen_memory_batches(account_id,summary_id,source_version,suppressed) VALUES($1,$2,$3,true) ON CONFLICT(account_id,summary_id) DO UPDATE SET suppressed=true',[owner,sourceId,sourceHash]);
    withdrawn=(await c.query("UPDATE origen_student_memories SET status='deleted',last_action='delete',content='',source_quote='',version=version+1,updated_at=now() WHERE account_id=$1 AND source_summary_id=$2 AND status='proposed' AND NOT context_current AND id<>$3",[owner,sourceId,input.store==='memory'?input.id:randomUUID()])).rowCount;
   }
   // Hard-erased IDs stay erased. Undoing a removal creates a private replacement
   // with the original provenance, never bypassing the deletion journal.
   const replacement=undoReceipt?.action==='delete';
   const id=replacement?randomUUID():input.id,version=replacement?1:input.version+1;
   if(input.action==='delete'){
    if(input.store==='note')await c.query('DELETE FROM origen_topic_notes WHERE account_id=$1 AND id=$2',[owner,id]);
    else await c.query("UPDATE origen_student_memories SET status='deleted',last_action='delete',content='',source_quote='',version=version+1,updated_at=now() WHERE account_id=$1 AND id=$2 AND version=$3",[owner,id,input.version]);
   }else{
    const value=input.action==='update'?{...input.before,...input.value,status:input.store==='memory'?'confirmed':'saved'}:input.action==='confirm'?{...input.before,status:'confirmed'}:input.before;
    if(input.store==='memory'){
     if(replacement&&Number((await c.query("SELECT count(*) AS n FROM origen_student_memories WHERE account_id=$1 AND status IN ('proposed','confirmed')",[owner])).rows[0].n)>=200)throw fail(409,'memory_limit');
     if(!replacement)await c.query("UPDATE origen_student_memories SET status='superseded',content='',source_quote='',updated_at=now() WHERE account_id=$1 AND id=$2 AND version=$3",[owner,id,input.version]);
     await c.query("INSERT INTO origen_student_memories(account_id,id,version,student_id,category,content,language,speaker,reported_by,last_action,status,source_summary_id,source_version,source_quote,source_at,organization,context_current) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)",[owner,id,version,input.studentId,value.category,value.content,value.language,value.speaker,value.reportedBy,input.action==='confirm'?'confirm':'update',value.status,sourceId,value.sourceVersion,value.quote,value.conversationAt,value.organization]);
    }else{
     if(replacement){
      if(Number((await c.query('SELECT count(*) AS n FROM origen_topic_notes WHERE account_id=$1',[owner])).rows[0].n)>=2000)throw fail(409,'note_limit');
      await c.query("INSERT INTO origen_topic_notes(account_id,id,version,student_id,topic,kind,content,language,status,origin,source_summary_id,source_quote,organization,context_current,restored_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14)",[owner,id,version,input.studentId,value.topic,value.kind,value.content,value.language,value.status,value.origin,sourceId,value.quote,value.organization,input.id]);
     }else await c.query("UPDATE origen_topic_notes SET topic=$3,kind=$4,content=$5,language=$6,status=$7,translations='{}'::jsonb,organization=$8,context_current=true,version=$9,updated_at=now() WHERE account_id=$1 AND id=$2",[owner,id,value.topic,value.kind,value.content,value.language,value.status,value.organization,version]);
    }
   }
   await c.query('INSERT INTO origen_memory_scopes(account_id,scope_key,student_id) VALUES($1,$2,$3) ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1',[owner,input.studentId??'',input.studentId]);
   if(undoReceipt)await c.query('UPDATE origen_binder_changes SET undone_by=$3 WHERE account_id=$1 AND operation_id=$2',[owner,input.undoOf,input.operationId]);
   const saved=(await c.query('INSERT INTO origen_binder_changes(account_id,operation_id,student_id,store,item_id,action,request_hash,before_hash,result_id,result_version,source_summary_id,source_hash,permission_revision,undo_of,withdrawn) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *,true AS undo_live',[owner,input.operationId,input.studentId,input.store,input.id,input.action,requestHash,hash([owner,input.before]),id,version,sourceId,sourceHash,permission,input.undoOf??null,withdrawn])).rows[0];
   if(!correctionsEnabled(env))throw fail(503,'binder_corrections_disabled');
   await beforeCommit?.(c);await guardAccountTransaction(c,subject);
   if(!correctionsEnabled(env))throw fail(503,'binder_corrections_disabled');
   const finalPermission=(await c.query("SELECT revision,status,permission_expires_at FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[subject])).rows[0];
   if(!eligibilityAllowed(finalPermission)||finalPermission.revision!==permission)throw fail(403,'permission_required');
   signal?.throwIfAborted();await commit();return reply(saved,false);
  }catch(error){if(!transactionClient)await c.query('ROLLBACK').catch(()=>{});throw error;}finally{if(!transactionClient)c.release();}
 };
}
export function createCorrectionsHandler(database,env){
 const run=createCorrectionService(database,env);
 return async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/binder-changes')return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
  try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32000)return send(413,{error:'too_large'});}let input;try{input=validateCorrection(JSON.parse(raw));}catch{return send(400,{error:'invalid_correction'});}return send(200,await run(req.origenIdentity.sub,input));}
  catch(error){const known=[400,403,404,409,429].includes(error.status);if(!known)req.log?.({event:'api_error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'correction_unavailable'});}
 };
}
