import {createHash,randomUUID} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {safeErrorCode} from './api-logging.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const topics=['profile','finance','admissions','planning','loans'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const guidanceEnabled=env=>env.GUIDANCE_HISTORY_ENABLED==='true';
export function guidanceConfig(model,operation,configuration,env={}){
 const fields={model_id:model,operation,prompt_hash:digest(configuration.instructions||''),tool_schema_hash:digest(JSON.stringify(configuration.tools||[])),policy_version:'guidance-v1',application_revision:env.RENDER_GIT_COMMIT||env.APPLICATION_REVISION||'unversioned'};
 return {id:digest(JSON.stringify(fields)),...fields};
}
async function configRow(c,config){
 await c.query('INSERT INTO origen_ai_configurations(id,model_id,operation,prompt_hash,tool_schema_hash,policy_version,application_revision) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[config.id,config.model_id,config.operation,config.prompt_hash,config.tool_schema_hash,config.policy_version,config.application_revision]);
}
async function transaction(database,subject,run){
 if(!database)throw fail(503,'guidance_unavailable');
 const c=await database.connect();
 try{await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const account=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
  if(!account)throw fail(404,'account_not_found');
  const result=await run(c,account.id);await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
async function sessionRow(c,owner,id){
 if(!uuid(id))throw fail(400,'invalid_guidance_request');
 const row=(await c.query('SELECT * FROM origen_guidance_sessions WHERE account_id=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0];
 if(!row)throw fail(404,'session_not_found');return row;
}
async function segmentRow(c,owner,sessionId,id){
 if(!uuid(id))throw fail(400,'invalid_guidance_request');
 const row=(await c.query('SELECT * FROM origen_guidance_segments WHERE account_id=$1 AND session_id=$2 AND id=$3',[owner,sessionId,id])).rows[0];
 if(!row)throw fail(404,'segment_not_found');return row;
}
async function eventRow(c,owner,sessionId,segmentId,name,payload={},options={}){
 const id=options.id||randomUUID();
 const previous=(await c.query('SELECT * FROM origen_guidance_events WHERE account_id=$1 AND id=$2',[owner,id])).rows[0];
 if(previous){if(previous.session_id!==sessionId||previous.segment_id!==(segmentId||null)||previous.name!==name||previous.producer!==(options.producer||'server')||previous.sequence!==(options.sequence??null)||canonical(previous.payload)!==canonical(payload))throw fail(409,'event_conflict');return;}
 if(options.sequence!==undefined&&(await c.query('SELECT id FROM origen_guidance_events WHERE account_id=$1 AND session_id=$2 AND producer=$3 AND sequence=$4',[owner,sessionId,options.producer||'server',options.sequence])).rows.length)throw fail(409,'event_sequence_conflict');
 if(Number((await c.query('SELECT count(*) AS count FROM origen_guidance_events WHERE account_id=$1 AND session_id=$2',[owner,sessionId])).rows[0].count)>=5000)throw fail(429,'event_limit');
 // This committed event log is the local transactional outbox. No external sink.
 await c.query('INSERT INTO origen_guidance_events(account_id,session_id,segment_id,id,producer,name,sequence,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,sessionId,segmentId||null,id,options.producer||'server',name,options.sequence??null,options.occurredAt||new Date().toISOString(),JSON.stringify(payload)]);
}

export async function bindGuidanceIdentity(database,subject,issuer){
 return transaction(database,subject,async(c,owner)=>{
  const mappings=(await c.query('SELECT issuer FROM origen_account_identities WHERE account_id=$1',[owner])).rows;
  if(mappings.some(row=>row.issuer!==issuer))throw fail(403,'identity_issuer_conflict');
  await c.query('INSERT INTO origen_account_identities(account_id,issuer,subject) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO NOTHING',[owner,issuer,subject]);
 });
}
export async function backfillGuidanceIdentities(database,issuer,allowLegacy=false){
 if(!database)return;
 const conflict=await database.query('SELECT issuer FROM origen_account_identities WHERE issuer <> $1 LIMIT 1',[issuer]);
 if(conflict.rows.length)throw fail(403,'identity_issuer_conflict');
 const representativeConflict=await database.query('SELECT issuer FROM origen_representative_identities WHERE issuer <> $1 LIMIT 1',[issuer]);if(representativeConflict.rows.length)throw fail(403,'identity_issuer_conflict');
 const unmapped=await database.query('SELECT a.id FROM origen_accounts a LEFT JOIN origen_account_identities i ON i.account_id=a.id WHERE i.account_id IS NULL LIMIT 1');
 const unmappedRepresentatives=await database.query('SELECT r.auth0_subject FROM origen_institution_representatives r LEFT JOIN origen_representative_identities i ON i.auth0_subject=r.auth0_subject WHERE i.auth0_subject IS NULL LIMIT 1');
 if(!allowLegacy&&(unmapped.rows.length||unmappedRepresentatives.rows.length))throw fail(409,'legacy_issuer_confirmation_required');
 await database.query('INSERT INTO origen_account_identities(account_id,issuer,subject) SELECT id,$1,auth0_subject FROM origen_accounts ON CONFLICT(issuer,subject) DO NOTHING',[issuer]);
 await database.query('INSERT INTO origen_representative_identities(auth0_subject,issuer) SELECT auth0_subject,$1 FROM origen_institution_representatives ON CONFLICT(issuer,auth0_subject) DO NOTHING',[issuer]);
}

export function createGuidanceRepository(database){return {
 async begin(subject,input,config){
  if(!uuid(input.sessionId)||!uuid(input.segmentId)||!topics.includes(input.topic)||!['en','es'].includes(input.language)||!['parent','student','unknown'].includes(input.role)||!['unresolved','family','student'].includes(input.targetKind))throw fail(400,'invalid_guidance_request');
  if(input.targetKind==='student'&&(typeof input.studentId!=='string'||!input.studentId||input.studentId.length>128)||input.targetKind!=='student'&&input.studentId!==null)throw fail(400,'invalid_guidance_request');
  return transaction(database,subject,async(c,owner)=>{
   if(input.studentId!==null&&!(await c.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,input.studentId])).rows.length)throw fail(404,'student_not_found');
   await configRow(c,config);
   const existing=(await c.query('SELECT * FROM origen_guidance_sessions WHERE account_id=$1 AND id=$2',[owner,input.sessionId])).rows[0];
   if(existing?.ended_at)throw fail(409,'session_ended');
   if(!existing){await c.query('INSERT INTO origen_guidance_sessions(account_id,id,actor_role,initial_language) VALUES($1,$2,$3,$4)',[owner,input.sessionId,input.role,input.language]);await eventRow(c,owner,input.sessionId,null,'voice.start_requested',{topic:input.topic,language:input.language});}
   const old=(await c.query('SELECT * FROM origen_guidance_segments WHERE account_id=$1 AND session_id=$2 ORDER BY ordinal DESC',[owner,input.sessionId])).rows;
   const duplicate=old.find(row=>row.id===input.segmentId);
   if(duplicate){if(duplicate.topic!==input.topic||duplicate.target_kind!==input.targetKind||duplicate.student_id!==input.studentId||duplicate.configuration_id!==config.id)throw fail(409,'segment_conflict');return {sessionId:input.sessionId,segmentId:input.segmentId};}
   const ordinal=existing?.next_ordinal??0;if(ordinal>=100)throw fail(429,'segment_limit');
   const pending=input.topic==='profile'&&input.targetKind==='unresolved'&&typeof input.pendingStudentId==='string'&&input.pendingStudentId.length>0&&input.pendingStudentId.length<=128?input.pendingStudentId:null;
   await c.query('INSERT INTO origen_guidance_segments(account_id,session_id,id,ordinal,topic,target_kind,student_id,configuration_id,pending_student_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,input.sessionId,input.segmentId,ordinal,input.topic,input.targetKind,input.studentId,config.id,pending]);
   await c.query('UPDATE origen_guidance_sessions SET next_ordinal=$3 WHERE account_id=$1 AND id=$2',[owner,input.sessionId,ordinal+1]);
   await eventRow(c,owner,input.sessionId,input.segmentId,'guidance.segment_started',{topic:input.topic,targetKind:input.targetKind});
   await c.query('UPDATE origen_guidance_sessions SET last_activity_at=now() WHERE account_id=$1 AND id=$2',[owner,input.sessionId]);
   return {sessionId:input.sessionId,segmentId:input.segmentId};
  });
 },
 async event(subject,input){
  const event=validateGuidanceEvent(input);
  return transaction(database,subject,async(c,owner)=>{
   const session=await sessionRow(c,owner,event.sessionId);if(event.segmentId)await segmentRow(c,owner,event.sessionId,event.segmentId);
   if(new Date(session.started_at).getTime()<Date.now()-90*86400000)throw fail(410,'session_expired');
   await eventRow(c,owner,event.sessionId,event.segmentId,event.name,event.payload,{id:event.eventId,producer:'browser',sequence:event.sequence,occurredAt:event.occurredAt});
   if(['voice.connected','guidance.configuration_applied'].includes(event.name)&&event.segmentId){
    const segment=await segmentRow(c,owner,event.sessionId,event.segmentId);
    if(!segment.ended_at){await c.query("UPDATE origen_guidance_segments SET configuration_state='applied' WHERE account_id=$1 AND id=$2",[owner,event.segmentId]);await c.query('UPDATE origen_guidance_segments SET ended_at=now() WHERE account_id=$1 AND session_id=$2 AND ordinal < $3 AND ended_at IS NULL',[owner,event.sessionId,segment.ordinal]);}
   }
   await c.query('UPDATE origen_guidance_sessions SET last_activity_at=now() WHERE account_id=$1 AND id=$2',[owner,event.sessionId]);
   if(event.name==='voice.ended'&&!session.ended_at){await c.query('UPDATE origen_guidance_sessions SET ended_at=now(),end_reason=$3 WHERE account_id=$1 AND id=$2',[owner,event.sessionId,event.payload.reason]);await c.query('UPDATE origen_guidance_segments SET ended_at=now() WHERE account_id=$1 AND session_id=$2 AND ended_at IS NULL',[owner,event.sessionId]);}
   return {ok:true};
  });
 },
 async startExecution(subject,scope,config,operation){
  return transaction(database,subject,async(c,owner)=>{
   const session=await sessionRow(c,owner,scope.sessionId);const segment=await segmentRow(c,owner,scope.sessionId,scope.segmentId);
   if(operation!=='summary'&&(session.ended_at||segment.ended_at))throw fail(409,'segment_ended');
   await configRow(c,config);const id=randomUUID();
   await c.query("INSERT INTO origen_ai_executions(account_id,id,session_id,segment_id,configuration_id,operation,status) VALUES($1,$2,$3,$4,$5,$6,'started')",[owner,id,scope.sessionId,scope.segmentId,config.id,operation]);
   await eventRow(c,owner,scope.sessionId,scope.segmentId,operation==='voice'?'voice.negotiation_started':operation==='summary'?'summary.generation_started':'tool.started',{operation});return id;
  });
 },
 async finishExecution(subject,id,{status,durationMs,upstreamRequestId,errorCode,sources=[],tool,usage=null,resolvedModel=null}){
  return transaction(database,subject,async(c,owner)=>{
   const row=(await c.query('SELECT * FROM origen_ai_executions WHERE account_id=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0];if(!row)throw fail(404,'execution_not_found');if(row.status!=='started')return;
   const safeSources=sources.slice(0,30).map(source=>{try{const url=new URL(source.url);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return null;return {url:url.href,publisher:url.hostname,fetchedAt:new Date().toISOString(),effectivePeriod:null};}catch{return null;}}).filter(Boolean);
   const requestId=typeof upstreamRequestId==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(upstreamRequestId)?upstreamRequestId:null;
   const code=typeof errorCode==='string'&&/^[a-z_]{1,80}$/.test(errorCode)?errorCode:null;
   const safeUsage=usage&&Object.fromEntries(['input_tokens','output_tokens','total_tokens'].filter(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0).map(key=>[key,usage[key]]));
   const model=typeof resolvedModel==='string'&&/^[a-zA-Z0-9._:-]{1,160}$/.test(resolvedModel)?resolvedModel:null;
   await c.query('UPDATE origen_ai_executions SET status=$3,finished_at=now(),duration_ms=$4,upstream_request_id=$5,error_code=$6,usage=$7,resolved_model=$8 WHERE account_id=$1 AND id=$2',[owner,id,status,Math.min(2147483647,Math.max(0,Math.round(durationMs))),requestId,code,safeUsage&&Object.keys(safeUsage).length?JSON.stringify(safeUsage):null,model]);
   if(tool)await c.query('INSERT INTO origen_tool_calls(account_id,execution_id,tool_name,tool_version,status,source_count,sources) VALUES($1,$2,$3,$4,$5,$6,$7)',[owner,id,tool,'v1',status,safeSources.length,JSON.stringify(safeSources)]);
   await eventRow(c,owner,row.session_id,row.segment_id,status==='completed'?'operation.finished':'operation.failed',{operation:row.operation});
  });
 },
 async report(subject){return transaction(database,subject,async(c,owner)=>{
  const sessions=(await c.query('SELECT id,started_at,end_reason FROM origen_guidance_sessions WHERE account_id=$1 ORDER BY started_at DESC LIMIT 1000',[owner])).rows;
  const events=(await c.query("SELECT session_id,name FROM origen_guidance_events WHERE account_id=$1 AND name IN ('voice.connected','voice.start_failed','voice.ended')",[owner])).rows;
  const connected=new Set(events.filter(row=>row.name==='voice.connected').map(row=>row.session_id));const failed=new Set(events.filter(row=>row.name==='voice.start_failed').map(row=>row.session_id));
  const serverFailures=(await c.query("SELECT session_id,status FROM origen_ai_executions WHERE account_id=$1 AND operation='voice'",[owner])).rows;for(const row of serverFailures)if(row.status==='failed')failed.add(row.session_id);
  return {scope:'signed-in-account',retentionDays:90,sessionCount:sessions.length,connectedCount:sessions.filter(row=>connected.has(row.id)).length,sessionsWithNegotiationFailure:sessions.filter(row=>failed.has(row.id)).length,negotiationAttemptCount:serverFailures.length,failedNegotiationCount:serverFailures.filter(row=>row.status==='failed').length,missingConnectionObservationCount:sessions.filter(row=>!connected.has(row.id)&&!failed.has(row.id)).length,truncated:sessions.length===1000,coverage:'Counts begin at server SDP negotiation, after microphone permission. Browser observations may be missing; connections do not establish useful answers. Student reconnections share a logical session.'};
 });}
};}

const payloadSchemas={
 'voice.connected':{},'guidance.configuration_applied':{},'voice.start_failed':{phase:['permission','token','transport']},'voice.ended':{reason:['completed','disconnected','failed']},'response.started':{},'response.finished':{status:['completed','failed','cancelled','incomplete']},
 'guidance.language_changed':{language:['en','es'],basis:['user-selection','transcript-detection','model-detection']},
 'guidance.route_changed':{route:['home','finance','planning','admissions','loans','support','profile']},
};
export function validateGuidanceEvent(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['eventId','sessionId','segmentId','name','sequence','occurredAt','payload'].includes(k))||!uuid(input.eventId)||!uuid(input.sessionId)||input.segmentId!==null&&!uuid(input.segmentId)||!Number.isInteger(input.sequence)||input.sequence<0||input.sequence>100000||!Object.hasOwn(payloadSchemas,input.name)||typeof input.occurredAt!=='string'||!Number.isFinite(Date.parse(input.occurredAt))||Math.abs(Date.now()-Date.parse(input.occurredAt))>86400000)throw fail(400,'invalid_guidance_event');
 const schema=payloadSchemas[input.name],payload=input.payload;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==Object.keys(schema).length||Object.keys(payload).some(k=>!Object.hasOwn(schema,k)||!schema[k].includes(payload[k])))throw fail(400,'invalid_guidance_event');
 return input;
}
export async function purgeGuidanceHistory(database,now=new Date()){
 if(!database)return;
 await database.query('DELETE FROM origen_guidance_sessions WHERE started_at < $1',[new Date(now.getTime()-90*86400000)]);
 await database.query("UPDATE origen_guidance_sessions SET ended_at=$1,end_reason='abandoned' WHERE ended_at IS NULL AND last_activity_at < $2",[now,new Date(now.getTime()-30*60000)]);
 await database.query("UPDATE origen_ai_executions SET status='abandoned',finished_at=$1 WHERE status='started' AND started_at < $2",[now,new Date(now.getTime()-30*60000)]);
}
export function createGuidanceHandler(database,env){const run=createGuidanceRepository(database);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/guidance-history')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!guidanceEnabled(env))return send(200,{enabled:false});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}const input=JSON.parse(raw);
  if(input?.action==='report'&&Object.keys(input).length===1)return send(200,await run.report(req.origenIdentity.sub));
  return send(200,await run.event(req.origenIdentity.sub,input));
 }catch(error){const known=[400,403,404,409,410,429].includes(error.status);if(!known)req.log?.({event:'guidance_error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'guidance_unavailable'});}
};}

const matchesSummary=(segment,item)=>segment.target_kind==='unresolved'?segment.topic==='profile'&&segment.pending_student_id===item.studentId&&item.studentId!==null:segment.student_id===item.studentId;
export async function attachSummarySegments(c,owner,item,attribution){
 if(!attribution)return;
 if(!uuid(attribution.sessionId)||!Array.isArray(attribution.segmentIds)||!attribution.segmentIds.length||attribution.segmentIds.length>100||new Set(attribution.segmentIds).size!==attribution.segmentIds.length||!['en','es'].includes(attribution.language))throw fail(400,'invalid_summary_attribution');
 const existing=(await c.query('SELECT segment_id,language FROM origen_summary_segments WHERE account_id=$1 AND summary_id=$2',[owner,item.id])).rows;
 if(existing.length&&(existing.length!==attribution.segmentIds.length||existing.some(row=>!attribution.segmentIds.includes(row.segment_id)||row.language!==attribution.language)))throw fail(409,'summary_attribution_conflict');
 await sessionRow(c,owner,attribution.sessionId);
 for(const id of attribution.segmentIds){const segment=await segmentRow(c,owner,attribution.sessionId,id);if(!matchesSummary(segment,item))throw fail(409,'summary_scope_conflict');if(segment.target_kind==='unresolved'){if(!(await c.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,item.studentId])).rows.length)throw fail(404,'student_not_found');await c.query("UPDATE origen_guidance_segments SET target_kind='student',student_id=$3,pending_student_id=NULL WHERE account_id=$1 AND id=$2",[owner,id,item.studentId]);await eventRow(c,owner,attribution.sessionId,id,'guidance.target_confirmed',{basis:'reviewed-profile-save'});}}
 if(attribution.configuration)await configRow(c,attribution.configuration);
 for(const id of attribution.segmentIds)await c.query('INSERT INTO origen_summary_segments(account_id,summary_id,segment_id,language,configuration_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[owner,item.id,id,attribution.language,attribution.configuration?.id||null]);
 await eventRow(c,owner,attribution.sessionId,attribution.segmentIds.at(-1),'summary.saved',{summaryId:item.id},{id:uuid(item.id)?item.id:undefined});
}

export async function validateSummarySegments(database,subject,item,attribution){
 return transaction(database,subject,async(c,owner)=>{
  if(!uuid(attribution.sessionId)||!Array.isArray(attribution.segmentIds)||!attribution.segmentIds.length||attribution.segmentIds.length>100||new Set(attribution.segmentIds).size!==attribution.segmentIds.length)throw fail(400,'invalid_summary_attribution');
  await sessionRow(c,owner,attribution.sessionId);
  for(const id of attribution.segmentIds){const segment=await segmentRow(c,owner,attribution.sessionId,id);if(!matchesSummary(segment,item))throw fail(409,'summary_scope_conflict');}
 });
}

export async function deferSummaryAttribution(database,subject,item,attribution){
 return transaction(database,subject,async(c,owner)=>{
  await configRow(c,attribution.configuration);
  const old=(await c.query('SELECT * FROM origen_guidance_summary_intents WHERE account_id=$1 AND summary_id=$2',[owner,item.id])).rows[0];
  if(old&&(old.session_id!==attribution.sessionId||old.student_id!==item.studentId||JSON.stringify(old.segment_ids)!==JSON.stringify(attribution.segmentIds)))throw fail(409,'summary_scope_conflict');
  await c.query('INSERT INTO origen_guidance_summary_intents(account_id,summary_id,session_id,segment_ids,student_id,language,configuration_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[owner,item.id,attribution.sessionId,JSON.stringify(attribution.segmentIds),item.studentId,attribution.language,attribution.configuration.id]);
 });
}
export async function reconcileSummaryAttribution(c,owner,item){
 if(!(await c.query("SELECT table_name FROM information_schema.tables WHERE table_name='origen_guidance_summary_intents'")).rows.length)return;
 const row=(await c.query('SELECT * FROM origen_guidance_summary_intents WHERE account_id=$1 AND summary_id=$2',[owner,item.id])).rows[0];if(!row)return;
 if(row.student_id!==item.studentId)throw fail(409,'summary_scope_conflict');
 const configuration=(await c.query('SELECT * FROM origen_ai_configurations WHERE id=$1',[row.configuration_id])).rows[0];
 await attachSummarySegments(c,owner,item,{sessionId:row.session_id,segmentIds:row.segment_ids,language:row.language,configuration});
 await c.query('DELETE FROM origen_guidance_summary_intents WHERE account_id=$1 AND summary_id=$2',[owner,item.id]);
}

export async function trackResearch(req,env,database,body,tool){
 if(!req.origenAuthorized||!guidanceEnabled(env)||!req.headers['x-origen-session']||!req.headers['x-origen-segment'])return {finish:async()=>{}};
 const repo=createGuidanceRepository(database),started=Date.now();
 const id=await repo.startExecution(req.origenIdentity.sub,{sessionId:req.headers['x-origen-session'],segmentId:req.headers['x-origen-segment']},guidanceConfig(body.model,tool,body,env),tool);
 return {finish:result=>repo.finishExecution(req.origenIdentity.sub,id,{durationMs:Date.now()-started,tool,...result})};
}
