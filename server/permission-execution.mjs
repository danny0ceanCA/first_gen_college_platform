import {permissionContext,assertPermission,permissionError,eligibilityAllowed} from './permission-context.mjs';
import {subjectHash} from './account-lifecycle.mjs';
import {runRetentionJob} from './account-isolation.mjs';
import {guardAccountTransaction} from './account-guard.mjs';

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
   }catch(error){await hangup(request,env,callId).catch(()=>{});throw error;}
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
export async function sweepPermissionCalls(database,env,request=fetch,now=Date.now()){
 if(!database)return;
 const {rows}=await database.query('SELECT c.*,e.status,e.permission_expires_at,e.revision AS current_revision FROM origen_permission_calls c LEFT JOIN origen_eligibility e ON e.subject_hash=c.subject_hash');
 for(const row of rows){
  if(eligibilityAllowed(row,now)&&row.revision===row.current_revision&&Date.parse(row.expires_at)>now)continue;
  try{await hangup(request,env,row.call_id);await database.query('DELETE FROM origen_permission_calls WHERE call_id=$1',[row.call_id]);}catch{/* Retry next sweep, without logging call identifiers or credentials. */}
 }
}
export function startPermissionSupervisor(database,env,request=fetch){
 let busy=false;const tick=()=>{if(busy)return;busy=true;void runRetentionJob(()=>sweepPermissionCalls(database,env,request)).catch(()=>{}).finally(()=>{busy=false;});};
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
