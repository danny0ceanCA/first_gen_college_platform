import {randomUUID} from 'node:crypto';
import {diagnosticRecord} from './diagnostics.mjs';

const routes=new Set(['healthz','readyz','api/account-data','api/institution-metrics/event','api/institution-metrics/report','api/ai','api/chat','api/family','api/plans','api/institutions','api/institution-campaigns','api/institution-inquiries/public','api/institution-inquiries/staff','api/account-links','api/conversation-history','api/conversation-summary','api/voice-diagnostics','api/profile-voice','api/finance-research','api/admissions-research','api/guidance-history','api/progress']);
// Never log error messages: database errors can include SQL, values or credentials.
export function safeErrorCode(error){
 const code=error?.code;
 if(typeof code==='string'&&/^[0-9][A-Z0-9]{4}$/.test(code))return `postgres_${code}`;
 if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EHOSTUNREACH'].includes(code))return code;
 if(error?.name==='TimeoutError')return 'timeout';
 if(error?.name==='AbortError')return 'aborted';
 return 'operation_failed';
}

export function instrumentRequest(req,res,write){
 const started=performance.now();
 const route=(req.url||'').split('?')[0].replace(/^\//,'');
 const endpoint=routes.has(route)?route.replaceAll('/','.'):'unknown_route';
 const method=['GET','POST','OPTIONS','PUT','PATCH','DELETE','HEAD'].includes(req.method)?req.method:'OTHER';
 const requestId=randomUUID();req.requestId=requestId;
 res.setHeader('X-Request-ID',requestId);
 const emit=input=>{try{write(diagnosticRecord({...input,requestId,endpoint,method}));}catch{/* Logging must not prevent an API response. */}};
 req.log=emit;
 let code,completed=false;
 const end=res.end;
 res.end=function(chunk,...args){
  if(res.statusCode>=400&&(typeof chunk==='string'||Buffer.isBuffer(chunk))&&Buffer.byteLength(chunk)<4096){
   try{const value=JSON.parse(chunk.toString()).error;if(typeof value==='string'&&/^[a-z_]{1,80}$/.test(value))code=value;}catch{/* Non-JSON errors are recorded by status only. */}
  }
  return end.call(this,chunk,...args);
 };
 const complete=aborted=>{
  if(completed)return;completed=true;
  const status=aborted?499:res.statusCode;
  // Successful probe requests are omitted to keep production logs useful.
  if(!aborted&&status<400&&['healthz','readyz','api/account-data','api/institution-metrics/event','api/institution-metrics/report'].includes(endpoint))return;
  emit({event:aborted?'api_aborted':'api_request',level:status>=500?'error':status>=400?'warn':'info',httpStatus:status,durationMs:Math.round(performance.now()-started),code:aborted?'client_disconnected':code});
 };
 res.once('finish',()=>complete(false));res.once('close',()=>complete(!res.writableFinished));
}
