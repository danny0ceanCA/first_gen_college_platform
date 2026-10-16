import {permissionContext,assertPermission,permissionError,eligibilityAllowed} from './permission-context.mjs';
import {subjectHash} from './account-lifecycle.mjs';
import {runRetentionJob} from './account-isolation.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {runtimeLog} from './observability/logger.mjs';
import {metrics} from './observability/metrics.mjs';
import {safeErrorCode} from './observability/error-codes.mjs';
import {runDiagnosticJob} from './observability/context.mjs';

// All provider work inherits the HTTP permission revision, including promises
// created by tool calls. Never let an old request continue on a fresh approval.
export function permissionFetch(database,env,request=fetch){
 return async(url,options={})=>{
  const lease=permissionContext.getStore();if(!lease)throw permissionError();
  await assertPermission(database,lease);
  const response=await request(url,{...options,signal:options.signal?AbortSignal.any([options.signal,lease.signal]):lease.signal});
  if(url==='https://api.openai.com/v1/realtime/calls'&&response.ok){
   const location=response.headers.get('location')||'',match=/^https:\/\/api\.openai\.com\/v1\/realtime\/calls\/([A-Za-z0-9_-]+)$/.exec(location)||/^\/v1\/realtime\/calls\/([A-Za-z0-9_-]+)$/.exec(location);
   if(!match)throw Object.assign(new Error('voice_supervision_unavailable'),{status:503});
   const callId=match[1];
   try{
    await database.query('INSERT INTO origen_permission_calls(call_id,subject_hash,revision,expires_at) VALUES($1,$2,$3,$4)',[callId,subjectHash(lease.subject),lease.revision,new Date(Date.now()+10*60000)]);
    await assertPermission(database,lease);
   }catch(error){const started=performance.now();try{await hangup(request,env,callId);runtimeLog({event:'permission.hangup.finished',outcome:'completed',durationMs:performance.now()-started});}catch(stopError){runtimeLog({event:'permission.hangup.finished',outcome:'failed',durationMs:performance.now()-started,code:safeErrorCode(stopError)});}throw error;}
  }else await assertPermission(database,lease);
  // Fetch resolves before the body. Recheck after every body read as well.
  return new Proxy(response,{get(target,key){
   if(['json','text','arrayBuffer'].includes(key))return async()=>{const value=await target[key]();await assertPermission(database,lease);return value;};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
 };
}
async function hangup(request,env,id){
 const response=await request(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(id)}/hangup`,{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(5000)});
 if(!response.ok&&![404,410].includes(response.status))throw new Error('voice_stop_failed');
}
// Durable rows survive API restarts; every process can sweep them safely. A
// failed hangup stays queued. Only call IDs, hashes and times are stored.
export async function sweepPermissionCalls(database,env,request=fetch,now=Date.now(),log=runtimeLog){
 if(!database)return;
 const {rows}=await database.query(`SELECT c.*,e.status,e.permission_expires_at,e.revision AS current_revision FROM origen_permission_calls c LEFT JOIN origen_eligibility e ON e.subject_hash=c.subject_hash
 WHERE e.subject_hash IS NULL OR e.revision<>c.revision OR c.expires_at<=$1 OR NOT(e.status='adult' OR (e.status='approved' AND e.permission_expires_at>$1))
 ORDER BY c.hangup_pending_at NULLS FIRST,c.expires_at LIMIT 100`,[new Date(now)]);
 let failed=0,oldestMs=0;
 for(const row of rows){
  if(eligibilityAllowed(row,now)&&row.revision===row.current_revision&&Date.parse(row.expires_at)>now)continue;
  const started=performance.now();let outcome='completed',code;
  try{await database.query('UPDATE origen_permission_calls SET hangup_pending_at=COALESCE(hangup_pending_at,$2),hangup_attempts=LEAST(1000000,hangup_attempts+1) WHERE call_id=$1',[row.call_id,new Date(now)]);await hangup(request,env,row.call_id);await database.query('DELETE FROM origen_permission_calls WHERE call_id=$1',[row.call_id]);}catch(error){outcome='failed';code=safeErrorCode(error);failed++;oldestMs=Math.max(oldestMs,now-Date.parse(row.hangup_pending_at||new Date(now)),0);}
  finally{const durationMs=performance.now()-started;metrics.observe('provider','permission.hangup',outcome,durationMs);log({event:'permission.hangup.finished',outcome,durationMs,code});}
 }
 const backlog=(await database.query(`SELECT count(*) AS count,min(c.hangup_pending_at) AS oldest FROM origen_permission_calls c LEFT JOIN origen_eligibility e ON e.subject_hash=c.subject_hash
 WHERE e.subject_hash IS NULL OR e.revision<>c.revision OR c.expires_at<=$1 OR NOT(e.status='adult' OR (e.status='approved' AND e.permission_expires_at>$1))`,[new Date(now)])).rows[0];
 const count=Number(backlog?.count)||0;oldestMs=backlog?.oldest?Math.max(0,now-new Date(backlog.oldest).getTime()):oldestMs;
 metrics.gauge('hangupBacklog',count);metrics.gauge('hangupOldestMs',oldestMs);
 log({event:'permission.supervisor.finished',outcome:failed?'failed':'completed',sourceCount:rows.length,backlog:count,...(backlog?.oldest?{oldestMs}:{})});
}
export function startPermissionSupervisor(database,env,request=fetch,runner){
 let busy=false;const tick=()=>{if(busy)return;busy=true;const task=runner?runner.run('permission-supervisor',db=>sweepPermissionCalls(db,env,request)):runDiagnosticJob(()=>runRetentionJob(()=>sweepPermissionCalls(database,env,request)));void task.catch(error=>runtimeLog({event:'permission.supervisor.finished',outcome:'failed',code:safeErrorCode(error)})).finally(()=>{busy=false;});};
 const timer=setInterval(tick,2000);timer.unref();tick();return()=>clearInterval(timer);
}

export async function runPermittedRequest(database,subject,revision,req,res,work){
 const controller=new AbortController(),lease={subject,revision,signal:controller.signal};
 return permissionContext.run(lease,async()=>{
  // Buffer the JSON response until a final serialized permission check. The
  // current API has no streaming responses. Add streaming only with a lease.
  const originalHead=res.writeHead,originalEnd=res.end;let head,body,ended=false,busy=false;
  res.writeHead=function(...args){head=args;return this;};
  res.end=function(chunk){body=chunk;ended=true;return this;};
  const stop=()=>controller.abort();req.once('aborted',stop);res.once('close',stop);
  const timer=setInterval(()=>{if(busy)return;busy=true;void assertPermission(database,lease).catch(stop).finally(()=>{busy=false;});},1000);timer.unref();
  try{
   await work();
   if(!ended)throw new Error('missing_response');
   const c=await database.connect();
   try{await c.query('BEGIN');await guardAccountTransaction(c,subject);originalHead.apply(res,head||[200]);originalEnd.call(res,body);await c.query('COMMIT');}
   catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  }catch(error){if(!res.headersSent){originalHead.call(res,error.status===403?403:503,{'Content-Type':'application/json'});originalEnd.call(res,JSON.stringify({error:error.status===403?'permission_required':'permission_unavailable'}));}}
  finally{clearInterval(timer);req.removeListener('aborted',stop);res.removeListener('close',stop);res.writeHead=originalHead;res.end=originalEnd;}
 });
}
