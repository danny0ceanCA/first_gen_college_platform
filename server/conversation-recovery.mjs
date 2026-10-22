import {createHash,randomUUID} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {permissionContext,eligibilityAllowed,assertPermission} from './permission-context.mjs';
import {permissionFetch} from './permission-execution.mjs';
import {runAsAccount} from './account-isolation.mjs';
import {createHistoryRepository,validateMemory} from './history.mjs';
import {generateNarrativeSummary} from './summary-generation.mjs';
import {redactCoordinatorTurns} from '../src/coordinatorCodes.mjs';
import {allowedRequest} from './origin.mjs';
import {guidanceEnabled,guidanceConfig,validateSummarySegments} from './guidance-history.mjs';
import {narrativeSummaryInstructions} from './summary-style.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
export const recoveryEnabled=env=>env.ORIGEN_CONVERSATION_RECOVERY==='true';
// Migration 066 is atomic. Detect its dispatch table, which is visible to both
// application and maintenance roles, without granting visibility into private text.
export async function recoveryReady(db){return !!db&&(await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_conversation_checkpoints'")).rows.length>0;}
export async function assertRecoveryReady(db,env){if(recoveryEnabled(env)&&(!await recoveryReady(db)||env.ORIGEN_BINDER_JOBS!=='true'))throw new Error('conversation_recovery_configuration_required');}
const revision=async(c,owner,student)=>(await c.query('SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key=$2',[owner,student??''])).rows[0]?.revision||0;
const present=r=>({id:r.id,studentId:r.student_id,mode:r.mode,status:r.status,sequence:r.sequence,expiresAt:new Date(r.expires_at).toISOString(),createdAt:new Date(r.created_at).toISOString()});

export function validateCheckpointBody(body){
 if(!body||!['en','es'].includes(body.language)||!Array.isArray(body.turns)||!body.turns.length||body.turns.length>200||!body.turns.some(t=>t?.role==='user')||body.turns.some(t=>!t||!['user','assistant'].includes(t.role)||typeof t.text!=='string'||!t.text.trim()||t.text.length>12000))throw fail(400,'invalid_checkpoint');
 const item=validateMemory({...body,summary:'pending'});
 const result={...item,summary:undefined,language:body.language,scopeName:typeof body.scopeName==='string'?body.scopeName.slice(0,100):'',turns:redactCoordinatorTurns(body.turns.map(({role,text})=>({role,text})))};
 if(body.guidance){const g=body.guidance;if(!id(g.sessionId)||!Array.isArray(g.segmentIds)||g.segmentIds.length>30||g.segmentIds.some(s=>!id(s)))throw fail(400,'invalid_checkpoint');result.guidance={sessionId:g.sessionId,segmentIds:g.segmentIds};}
 if(Buffer.byteLength(JSON.stringify(result))>80000)throw fail(413,'checkpoint_limit');
 return JSON.parse(JSON.stringify(result));
}
export async function cancelRecovery(c,owner,studentId){
 // Rotate the account generation even for scoped erasure. An old in-flight open
 // cannot create new content after this barrier; existing other scopes survive.
 await c.query('INSERT INTO origen_recovery_epochs(account_id,epoch) VALUES($1,2) ON CONFLICT(account_id) DO UPDATE SET epoch=origen_recovery_epochs.epoch+1',[owner]);
 await c.query(`UPDATE origen_conversation_checkpoints SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE account_id=$1 AND status NOT IN ('complete','cancelled')${studentId===undefined?'':' AND student_id IS NOT DISTINCT FROM $2'}`,[owner,...(studentId===undefined?[]:[studentId])]);
}
export function createRecoveryRepository(database,env){return async(subject,input)=>{
 if(!input||!['status','checkpoint','finalize','read','discard','stop','review'].includes(input.action))throw fail(400,'invalid_checkpoint');
 if(!await recoveryReady(database)){if(input.action==='stop')return {stopped:true,enabled:false};if(input.action==='status')return {enabled:false,items:[]};throw fail(503,'recovery_unavailable');}
 if(!recoveryEnabled(env)&&!['status','read','discard','stop'].includes(input.action))throw fail(503,'recovery_disabled');
 const body=['checkpoint','review'].includes(input.action)?validateCheckpointBody(input.body):undefined;
 if(!['status','stop'].includes(input.action)&&!id(input.id))throw fail(400,'invalid_checkpoint');
 if(body&&body.id!==input.id)throw fail(400,'invalid_checkpoint');
 if(body&&(!Number.isSafeInteger(input.sequence)||input.sequence<1||input.sequence>10000))throw fail(400,'invalid_checkpoint');
 const c=await database.connect();try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const owner=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0]?.id;
  if(!owner)throw fail(404,'account_not_found');
  await c.query('INSERT INTO origen_recovery_epochs(account_id) VALUES($1) ON CONFLICT DO NOTHING',[owner]);
  const epoch=(await c.query('SELECT epoch FROM origen_recovery_epochs WHERE account_id=$1',[owner])).rows[0].epoch;
  const permission=(await c.query("SELECT revision,status,permission_expires_at FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[subject])).rows[0];
  await c.query("UPDATE origen_conversation_checkpoints SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE account_id=$1 AND status NOT IN ('complete','cancelled') AND (expires_at<=now() OR permission_revision<>$2 OR NOT $3)",[owner,permission?.revision??-1,eligibilityAllowed(permission)]);
  if(input.action==='stop'){await cancelRecovery(c,owner);await c.query('COMMIT');return {stopped:true};}
  if(input.action==='status'){
   const items=(await c.query("SELECT * FROM origen_conversation_checkpoints WHERE account_id=$1 AND status<>'cancelled' AND expires_at>now() ORDER BY created_at DESC LIMIT 10",[owner])).rows.map(present);
   await c.query('COMMIT');return {enabled:recoveryEnabled(env),epoch,items,retentionHours:24};
  }
  let row=(await c.query('SELECT * FROM origen_conversation_checkpoints WHERE account_id=$1 AND id=$2 FOR UPDATE',[owner,input.id])).rows[0];
  if(input.action==='discard'){
   if(row&&row.status!=='complete')await c.query("UPDATE origen_conversation_checkpoints SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE account_id=$1 AND id=$2",[owner,input.id]);
   await c.query('COMMIT');return {discarded:true};
  }
  if(!eligibilityAllowed(permission))throw fail(403,'permission_required');
  if(input.action==='checkpoint'&&!row){
   if(input.epoch!==epoch)throw fail(409,'recovery_session_ended');
   if(body.studentId!==null&&!(await c.query('SELECT 1 FROM origen_students WHERE account_id=$1 AND id=$2',[owner,body.studentId])).rows.length)throw fail(404,'student_not_found');
   if((await c.query('SELECT 1 FROM origen_conversation_lifecycle WHERE account_id=$1 AND id=$2',[owner,input.id])).rows.length)throw fail(410,'checkpoint_closed');
   if(Number((await c.query("SELECT count(*) AS n FROM origen_conversation_checkpoints WHERE account_id=$1 AND expires_at>now()",[owner])).rows[0].n)>=10)throw fail(409,'checkpoint_limit');
   const current=await revision(c,owner,body.studentId);
   if(!Number.isSafeInteger(input.contextRevision)||input.contextRevision<0)throw fail(400,'invalid_checkpoint');
   await c.query('INSERT INTO origen_conversation_lifecycle(account_id,id,student_id,mode) VALUES($1,$2,$3,$4)',[owner,input.id,body.studentId,body.mode]);
   row=(await c.query("INSERT INTO origen_conversation_checkpoints(account_id,id,student_id,mode,permission_revision,epoch,context_revision,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[owner,input.id,body.studentId,body.mode,permission.revision,epoch,input.contextRevision,current===input.contextRevision?'active':'review'])).rows[0];
  }
  if(!row)throw fail(404,'checkpoint_not_found');
  if(row.status==='cancelled')throw fail(410,'checkpoint_closed');
  const current=await revision(c,owner,row.student_id);
  if(input.action==='read'){
   const saved=(await c.query('SELECT body FROM origen_checkpoint_text WHERE account_id=$1 AND id=$2',[owner,row.id])).rows[0]?.body;
   await c.query('COMMIT');return {...present(row),body:saved,contextRevision:current,needsReview:row.context_revision!==current||row.status==='review'};
  }
  if(body){
   if(body.studentId!==row.student_id||body.mode!==row.mode)throw fail(409,'checkpoint_scope_changed');
   const digest=hash(body);
   if(input.sequence===row.sequence){if(digest!==row.payload_hash)throw fail(409,'checkpoint_conflict');await c.query('COMMIT');return {...present(row),acknowledged:true};}
   if(input.sequence<row.sequence||!['active','review',...(input.action==='review'&&row.manual_retries<2?['failed']:[])].includes(row.status))throw fail(409,'checkpoint_changed');
   if(input.epoch!==epoch||input.action!=='review'&&row.epoch!==epoch)throw fail(409,'recovery_session_ended');
   if(input.action==='review'&&(input.reviewed!==true||input.contextRevision!==current||input.sequence!==row.sequence+1))throw fail(409,'checkpoint_review_changed');
   const context=input.action==='review'?current:row.context_revision;
   if(row.status==='failed')await c.query('UPDATE origen_conversation_checkpoints SET manual_retries=manual_retries+1,attempts=0 WHERE account_id=$1 AND id=$2',[owner,row.id]);
   await c.query('INSERT INTO origen_checkpoint_text(account_id,id,body) VALUES($1,$2,$3) ON CONFLICT(account_id,id) DO UPDATE SET body=$3',[owner,row.id,JSON.stringify(body)]);
   row=(await c.query("UPDATE origen_conversation_checkpoints SET sequence=$3,payload_hash=$4,context_revision=$5,status=$6,epoch=$7 WHERE account_id=$1 AND id=$2 RETURNING *",[owner,row.id,input.sequence,digest,context,context===current?'active':'review',epoch])).rows[0];
  }
  if(input.action==='finalize'){
   if(input.sequence!==row.sequence||!row.sequence)throw fail(409,'checkpoint_changed');
   if(['active','review'].includes(row.status)){
    row=(await c.query("UPDATE origen_conversation_checkpoints SET status=$3,available_at=now() WHERE account_id=$1 AND id=$2 RETURNING *",[owner,row.id,current===row.context_revision?'pending':'review'])).rows[0];
   }
  }
  await c.query('COMMIT');return {...present(row),acknowledged:true};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});if(input.action==='stop'&&error.message==='account_closed')return {stopped:true};throw error;}finally{c.release();}
};}

// This uses the existing binder worker's dispatcher and backoff pattern. Its
// maintenance credential cannot SELECT the separate private-text table.
export async function claimRecoveryJob(dispatch,{claim=true}={}){
 const c=await dispatch.connect();try{
  await c.query('BEGIN');
  await c.query("UPDATE origen_conversation_checkpoints SET status='cancelled',lease_until=NULL,lease_token=NULL WHERE ctid IN (SELECT ctid FROM origen_conversation_checkpoints WHERE status NOT IN ('complete','cancelled') AND expires_at<=now() ORDER BY expires_at LIMIT 250 FOR UPDATE SKIP LOCKED)");
  await c.query("DELETE FROM origen_conversation_checkpoints WHERE ctid IN (SELECT ctid FROM origen_conversation_checkpoints WHERE created_at<now()-interval '7 days' AND status IN ('complete','cancelled') LIMIT 250)");
  await c.query("UPDATE origen_conversation_checkpoints SET status='failed',lease_until=NULL,lease_token=NULL WHERE status='running' AND lease_until<now() AND attempts>=5");
  const job=claim?(await c.query(`SELECT j.*,a.auth0_subject FROM origen_conversation_checkpoints j JOIN origen_accounts a ON a.id=j.account_id
   WHERE j.expires_at>now() AND j.attempts<5 AND (j.status='pending' AND j.available_at<=now() OR j.status='running' AND j.lease_until<now())
   AND (SELECT count(*) FROM origen_conversation_checkpoints b CROSS JOIN LATERAL unnest(b.attempt_times) t(at) WHERE b.account_id=j.account_id AND t.at>now()-interval '1 hour')<10
   ORDER BY j.available_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`)).rows[0]:null;
  if(!job){await c.query('COMMIT');return null;}
  const token=randomUUID();await c.query("UPDATE origen_conversation_checkpoints SET status='running',attempts=attempts+1,attempt_times=array_append(attempt_times,now()),lease_token=$3,lease_until=now()+interval '90 seconds' WHERE account_id=$1 AND id=$2",[job.account_id,job.id,token]);
  await c.query('COMMIT');return {...job,lease_token:token,attempts:job.attempts+1};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
export function createRecoveryProcessor(db,env,request=fetch){return async(job,{signal=new AbortController().signal}={})=>runAsAccount({sub:job.auth0_subject},()=>permissionContext.run({subject:job.auth0_subject,revision:job.permission_revision,signal},async()=>{
 const proof=async c=>{
  if(!recoveryEnabled(env)||env.ORIGEN_BINDER_JOBS!=='true')throw fail(503,'recovery_disabled');signal.throwIfAborted();await assertPermission(c);
  const row=(await c.query("SELECT 1 FROM origen_conversation_checkpoints WHERE account_id=$1 AND id=$2 AND status='running' AND lease_token=$3 AND lease_until>now() AND expires_at>now() FOR UPDATE",[job.account_id,job.id,job.lease_token])).rows[0];
  if(!row)throw fail(409,'checkpoint_changed');
  if(await revision(c,job.account_id,job.student_id)!==job.context_revision)throw fail(409,'checkpoint_review_required');
 };
 try{
  const c=await db.connect();let input;try{await c.query('BEGIN');await guardAccountTransaction(c,job.auth0_subject);await proof(c);input=(await c.query('SELECT body FROM origen_checkpoint_text WHERE account_id=$1 AND id=$2',[job.account_id,job.id])).rows[0]?.body;await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  if(!input)throw fail(410,'checkpoint_closed');
  let attribution;
  if(guidanceEnabled(env)&&input.guidance){attribution={...input.guidance,language:input.language,configuration:guidanceConfig(env.OPENAI_MODEL_SUMMARY||env.OPENAI_MODEL_CONVERSATION||'gpt-4.1-mini','summary',{instructions:narrativeSummaryInstructions({...input,scopeName:'selected student'})},env)};await validateSummarySegments(db,job.auth0_subject,input,attribution);}
  const {summary}=await generateNarrativeSummary(env,input,permissionFetch(db,env,request));
  await createHistoryRepository(db)(job.auth0_subject,{action:'save',item:{...input,summary},language:input.language,attribution},{beforeSave:proof,afterSave:async c=>{await proof(c);await c.query("UPDATE origen_conversation_checkpoints SET status='complete',lease_until=NULL,lease_token=NULL WHERE account_id=$1 AND id=$2 AND lease_token=$3",[job.account_id,job.id,job.lease_token]);}});
  return 'complete';
 }catch(error){
  const status=error.message==='checkpoint_review_required'?'review':!signal.aborted&&[403,404,409,410].includes(error.status)?'cancelled':job.attempts>=5?'failed':'pending';
  const c=await db.connect();try{await c.query('BEGIN');await c.setAccountScope?.(job.auth0_subject);await c.query("UPDATE origen_conversation_checkpoints SET status=$4,available_at=now()+($5::int*interval '1 second'),lease_until=NULL,lease_token=NULL WHERE account_id=$1 AND id=$2 AND lease_token=$3",[job.account_id,job.id,job.lease_token,status,Math.min(300,2**job.attempts*5)]);await c.query('COMMIT');}catch(failure){await c.query('ROLLBACK');throw failure;}finally{c.release();}
  return status;
 }
}));}
export function createRecoveryHandler(db,env){const run=createRecoveryRepository(db,env);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/conversation-recovery')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>100000)throw fail(413,'checkpoint_limit');}let input;try{input=JSON.parse(raw);}catch{throw fail(400,'invalid_checkpoint');}
  return send(200,await run(req.origenIdentity.sub,input));
 }catch(error){const status=[400,403,404,409,410,413,503].includes(error.status)?error.status:503;return send(status,{error:status===503?'recovery_unavailable':error.message});}
};}
