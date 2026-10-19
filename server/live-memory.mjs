import {redactCoordinatorCodes} from '../src/coordinatorCodes.mjs';
import {requireLiveCapability} from './personalization-controls.mjs';
import {createHash} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {createMemoryRepository,validateMemoryRequest} from './student-memory.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {retrieveStudentHistory,retrievalInstructions} from './history-retrieval.mjs';
import {memoryIntent,acceptsProposal,normalizeIntent} from './live-memory-intent.mjs';
import {allowedRequest} from './origin.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function validateLiveChange(value){
 if(!value||!['create','update','delete','next-step'].includes(value.kind))throw fail(400,'invalid_memory_change');
 const out={kind:value.kind};
 if(['update','delete'].includes(value.kind)){if(!uuid(value.id)||!Number.isSafeInteger(value.version)||value.version<1)throw fail(400,'invalid_memory_change');out.id=value.id;out.version=value.version;}
 if(value.kind!=='delete'){
  if(!text(value.content,value.kind==='next-step'?2000:1000)||!(value.kind==='next-step'?['education','courses','transfer','degree','career','financial','applications','other']:['goal','constraint','preference','question']).includes(value.category))throw fail(400,'invalid_memory_change');
  if(redactCoordinatorCodes(value.content)!==value.content)throw fail(400,'invalid_memory_change');out.content=value.content.trim();out.category=value.category;
 }
 return out;
}
export function validateLiveMemoryRequest(input){
 if(!input||!['turn','read','write','present','close'].includes(input.action)||!uuid(input.sessionId)||input.studentId!==undefined||input.accountId!==undefined)throw fail(400,'invalid_live_memory');
 const out={action:input.action,sessionId:input.sessionId};if(out.action==='close')return out;
 if(!Number.isSafeInteger(input.sequence)||input.sequence<1||!text(input.turnId,128)||typeof input.transcript!=='string'||input.transcript.length>8000)throw fail(400,'invalid_live_memory');
 Object.assign(out,{sequence:input.sequence,turnId:input.turnId,transcript:input.transcript});
 if(out.action==='turn'){if(!['en','es'].includes(input.language))throw fail(400,'invalid_live_memory');out.language=input.language;}
 if(out.action==='read'){if(!text(input.query,1000))throw fail(400,'invalid_live_memory');out.query=input.query;}
 if(out.action==='write'){if(!uuid(input.requestId))throw fail(400,'invalid_live_memory');out.requestId=input.requestId;out.change=validateLiveChange(input.change);}
 if(out.action==='present'){if(!text(input.presentation,8000))throw fail(400,'invalid_live_memory');out.presentation=input.presentation;out.change=validateLiveChange(input.change);}
 return out;
}
const saved=receipt=>({status:'saved',kind:receipt.kind,id:receipt.record_id,version:receipt.record_version,revision:receipt.revision,reconnect:true,instruction:'The database committed this change. The app will acknowledge it and reconnect with fresh context. Do not save it again.'});

export function createLiveMemoryRepository(database,env={}){return async(subject,input,{signal}={})=>{
 requireLiveCapability(env,subject,input.action);
 if(!database)throw fail(503,'live_memory_unavailable');
 const c=await database.connect();let committed=false;
 try{
  signal?.throwIfAborted();await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");await guardAccountTransaction(c,subject);
  const account=(await c.query('SELECT id,role FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];if(!account)throw fail(404,'account_not_found');const owner=account.id;
  const ready=(await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_live_memory_sessions'")).rows.length;
  if(!ready){if(input.action==='open'){await c.query('COMMIT');committed=true;return undefined;}throw fail(503,'live_memory_unavailable');}
  const revision=async studentId=>(await c.query('SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key=$2',[owner,studentId??''])).rows[0]?.revision||0;
  if(input.action==='open'){
   if(input.sessionId!==undefined&&!uuid(input.sessionId))throw fail(400,'invalid_live_memory');
   if(input.studentId!==null&&!(await c.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,input.studentId])).rows.length)throw fail(404,'student_not_found');
   if(await revision(input.studentId)!==input.revision)throw fail(409,'memory_changed');
   await c.query('DELETE FROM origen_live_memory_sessions WHERE account_id=$1 AND (expires_at<now() OR closed)',[owner]);
   let session;
   if(input.sessionId){session=(await c.query('SELECT * FROM origen_live_memory_sessions WHERE account_id=$1 AND id=$2',[owner,input.sessionId])).rows[0];if(!session||session.student_id!==input.studentId||session.revision!==input.revision)throw fail(409,'memory_session_changed');}
   else{if(Number((await c.query('SELECT count(*) AS n FROM origen_live_memory_sessions WHERE account_id=$1',[owner])).rows[0].n)>=20)throw fail(429,'memory_session_limit');session=(await c.query('INSERT INTO origen_live_memory_sessions(account_id,student_id,revision) VALUES($1,$2,$3) RETURNING *',[owner,input.studentId,input.revision])).rows[0];}
   await c.query('COMMIT');committed=true;return {id:session.id,revision:session.revision};
  }
  const session=(await c.query('SELECT * FROM origen_live_memory_sessions WHERE account_id=$1 AND id=$2 FOR UPDATE',[owner,input.sessionId])).rows[0];
  if(!session||session.closed||Date.parse(session.expires_at)<=Date.now())throw fail(409,'memory_session_changed');
  if(input.action==='close'){await c.query('UPDATE origen_live_memory_sessions SET closed=true WHERE account_id=$1 AND id=$2',[owner,session.id]);await c.query('COMMIT');committed=true;return {status:'closed'};}
  const proof=hash(input.transcript);
  if(input.action==='turn'){
   if(input.sequence<session.turn_sequence||input.sequence===session.turn_sequence&&(input.turnId!==session.turn_id||session.transcript_hash!==hash('')&&session.transcript_hash!==proof))throw fail(409,'memory_turn_changed');
   // Speech-start fences the old turn; completed transcription fills that same
   // sequence. Preserve a pending proposal only for the immediately next turn.
   const preserve=session.proposal_turn===input.sequence-1||input.sequence===session.turn_sequence&&session.transcript_hash===proof;
   await c.query('UPDATE origen_live_memory_sessions SET turn_sequence=$3,turn_id=$4,transcript_hash=$5,turn_language=$6,proposal_hash=CASE WHEN $7 THEN proposal_hash ELSE NULL END,proposal_turn=CASE WHEN $7 THEN proposal_turn ELSE NULL END WHERE account_id=$1 AND id=$2',[owner,session.id,input.sequence,input.turnId,proof,input.language,preserve]);
   signal?.throwIfAborted();await c.query('COMMIT');committed=true;return {status:'registered'};
  }
  if(session.turn_sequence!==input.sequence||session.turn_id!==input.turnId||session.transcript_hash!==proof||!input.transcript.trim())throw fail(409,'memory_turn_changed');
  const fingerprint=input.change?hash(JSON.stringify(input.change)):null;
  const receipt=input.action==='write'?(await c.query('SELECT * FROM origen_live_memory_receipts WHERE account_id=$1 AND session_id=$2 AND turn_sequence=$3',[owner,session.id,input.sequence])).rows[0]:null;
  if(receipt){
   if(receipt.fingerprint!==fingerprint)throw fail(409,'memory_request_changed');
   // Replays never resurrect or claim that a subsequently removed/edited record
   // is still saved. Scope revision invalidation takes priority over replay.
   if(await revision(session.student_id)!==receipt.revision)throw fail(409,'memory_changed');
   await c.query('COMMIT');committed=true;return saved(receipt);
  }
  if(await revision(session.student_id)!==session.revision)throw fail(409,'memory_changed');
  if(input.action==='inspect'){await c.query('COMMIT');committed=true;return {studentId:session.student_id,revision:session.revision};}
  if(!['write','present'].includes(input.action))throw fail(400,'invalid_live_memory');
  const change=input.change;let old;
  if(['update','delete'].includes(change.kind)){
   old=(await c.query("SELECT * FROM origen_student_memories WHERE account_id=$1 AND id=$2 AND status IN ('proposed','confirmed')",[owner,change.id])).rows[0];
   if(!old||old.student_id!==session.student_id)throw fail(404,'memory_not_found');if(old.version!==change.version)throw fail(409,'memory_changed');
  }
  if(input.action==='present'){
   const spoken=normalizeIntent(input.presentation),includes=value=>spoken.includes(normalizeIntent(value));
   const question=input.presentation.includes('?')||/^(would|should|shall|can|do you want|quieres|deseas|debo|puedo|te gustaria)\b/.test(spoken);
   const valid=question&&session.proposal_hash===fingerprint&&session.proposal_turn===input.sequence&&/\b(save|saved|guardar|guarde|guarda|guardemos|guardarlo|guardamos|borre|borrar|delete|remove|forget)\b/.test(spoken)&&(change.kind==='delete'||includes(change.content))&&(!old||includes(old.content));
   if(valid)await c.query('UPDATE origen_live_memory_sessions SET proposal_presented=true WHERE account_id=$1 AND id=$2',[owner,session.id]);
   await c.query('COMMIT');committed=true;return {status:valid?'presented':'not_presented'};
  }
  const confirmed=acceptsProposal(input.transcript)&&session.proposal_presented&&session.proposal_hash===fingerprint&&session.proposal_turn===input.sequence-1&&Date.now()-Date.parse(session.proposal_at)<120000;
  const intent=memoryIntent(input.transcript,change,old?.content);
  if(!confirmed&&intent!=='authorized'){
   if(intent==='clarify'&&session.proposal_turn===input.sequence&&session.proposal_hash!==fingerprint)throw fail(409,'memory_request_changed');
   if(intent==='clarify')await c.query('UPDATE origen_live_memory_sessions SET proposal_hash=$3,proposal_turn=$4,proposal_at=now(),proposal_presented=false WHERE account_id=$1 AND id=$2',[owner,session.id,fingerprint,input.sequence]);
   await c.query('COMMIT');committed=true;return {status:intent==='clarify'?'clarification_required':'not_requested',...(intent==='clarify'?{proposal:{...change,...(old?{previousContent:old.content}:{})}}:{}),instruction:intent==='clarify'?'Nothing was saved. Describe this exact change and ask one focused spoken confirmation. On yes, repeat the identical arguments.':'Nothing was saved. The user did not request a durable change. Continue their question without proposing a save.'};
  }
  signal?.throwIfAborted();let recordId,recordVersion,newRevision;
  if(change.kind==='next-step'){
   const stepId='step-1';
   const plan=validatePlan({action:'create',requestId:input.requestId,plan:{studentId:session.student_id,title:change.content.slice(0,160),goal:'',category:change.category,status:'active',summaryIds:[],steps:[{id:stepId,title:change.content.slice(0,160),action:change.content,notes:'',status:'not-started',dueDate:null,sources:[]}]}});
   await createPlanRepository(database,env)(subject,plan,{client:c});
   const row=(await c.query('SELECT plan_id FROM origen_plan_creations WHERE account_id=$1 AND request_id=$2',[owner,input.requestId])).rows[0];recordId=row.plan_id;recordVersion=1;
   // New plans must refresh other active live scopes too.
   await c.query('INSERT INTO origen_memory_scopes(account_id,scope_key,student_id) VALUES($1,$2,$3) ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1',[owner,session.student_id??'',session.student_id]);newRevision=await revision(session.student_id);
  }else{
   recordId=change.kind==='create'?input.requestId:change.id;
   const memory=validateMemoryRequest({action:change.kind,studentId:session.student_id,id:recordId,version:change.version,memory:{category:change.category,content:change.content,language:session.turn_language,speaker:['parent','student'].includes(account.role)?account.role:'unknown'}});
   const result=await createMemoryRepository(database)(subject,memory,{client:c});newRevision=result.revision;recordVersion=change.kind==='create'?1:change.version+1;
  }
  await c.query('INSERT INTO origen_live_memory_receipts(account_id,session_id,turn_sequence,request_id,fingerprint,kind,record_id,record_version,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,session.id,input.sequence,input.requestId,fingerprint,change.kind,recordId,recordVersion,newRevision]);
  await c.query('UPDATE origen_live_memory_sessions SET revision=$3,proposal_hash=NULL,proposal_turn=NULL WHERE account_id=$1 AND id=$2',[owner,session.id,newRevision]);
  signal?.throwIfAborted();requireLiveCapability(env,subject,input.action);await c.query('COMMIT');committed=true;return saved({kind:change.kind,record_id:recordId,record_version:recordVersion,revision:newRevision});
 }catch(error){if(!committed)await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
};}
export function createLiveMemoryService(database,env={}){const run=createLiveMemoryRepository(database,env);return async(subject,input,options={})=>{
 if(input.action!=='read')return run(subject,input,options);
 const scope=await run(subject,{...input,action:'inspect'},options);
 const evidence=await retrieveStudentHistory(database,subject,{studentId:scope.studentId,query:input.query});options.signal?.throwIfAborted();
 const current=await run(subject,{...input,action:'inspect'},options);if(current.revision!==scope.revision)throw fail(409,'memory_changed');
 return {status:evidence.available?'retrieved':'unavailable',revision:current.revision,items:evidence.items,instruction:retrievalInstructions(evidence,{includeItems:false})};
};}
export function createLiveMemoryHandler(database,env={}){const run=createLiveMemoryService(database,env);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/live-memory')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 const abort=new AbortController();const cancelled=()=>{if(!res.writableEnded)abort.abort();};res.on?.('close',cancelled);req.on?.('aborted',cancelled);
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)return send(413,{error:'too_large'});}let input;try{input=validateLiveMemoryRequest(JSON.parse(raw));}catch{return send(400,{error:'invalid_live_memory'});}return send(200,await run(req.origenIdentity.sub,input,{signal:abort.signal}));}
 catch(error){const known=[400,403,404,409,429].includes(error.status);return send(known?error.status:503,{status:known?'rejected':'unavailable',error:known?error.message:'live_memory_unavailable',instruction:'No successful save is confirmed by this response. Do not claim success or automatically retry. Ask the user to review the binder if the save outcome is unknown.'});}
 finally{res.off?.('close',cancelled);req.off?.('aborted',cancelled);}
};}
