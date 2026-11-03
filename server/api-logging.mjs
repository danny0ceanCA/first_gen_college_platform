import {randomUUID} from 'node:crypto';
import {diagnosticRecord} from './diagnostics.mjs';
import {safeCode} from './observability/event-schema.mjs';
import {createDiagnosticContext,currentDiagnosticContext} from './observability/context.mjs';
import {metrics} from './observability/metrics.mjs';
export {safeErrorCode} from './observability/error-codes.mjs';

const routes=new Set(['api/coordinator-notifications','api/coordinator-feedback','api/coordinator-binders','api/binder-sharing','api/coordinator-access','api/coordinator-connections','api/eligibility','api/guardian-permission','api/admin','api/privacy','api/activity','healthz','readyz','api/account-data','api/institution-metrics/event','api/institution-metrics/report','api/ai','api/chat','api/family','api/onboarding-events','api/plans','api/binder-changes','api/topic-notes','api/student-memory','api/live-memory','api/workspace-sheets','api/institutions','api/institution-campaigns','api/institution-inquiries/public','api/institution-inquiries/staff','api/account-links','api/conversation-history','api/conversation-summary','api/conversation-recovery','api/voice-diagnostics','api/profile-voice','api/finance-research','api/admissions-research','api/guidance-history','api/progress']);
// Never log error messages: database errors can include SQL, values or credentials.
export function instrumentRequest(req,res,write,observe=()=>{},metadata){
 const started=performance.now();
 const route=(req.url||'').split('?')[0].replace(/^\//,'');
 const endpoint=routes.has(route)?route.replaceAll('/','.'):'unknown_route';
 const method=['GET','POST','OPTIONS','PUT','PATCH','DELETE','HEAD'].includes(req.method)?req.method:'OTHER';
 const requestId=randomUUID();req.requestId=requestId;
 const context=createDiagnosticContext({requestId,endpoint,method,metadata});
 res.setHeader('X-Request-ID',requestId);
 const emit=input=>{try{const current=currentDiagnosticContext();const result=write(diagnosticRecord(input,current?.requestId===requestId?current:context.snapshot()));if(result?.then)void result.catch(()=>{});}catch{/* Logging must not prevent an API response. */}};
 req.log=emit;
 let code,completed=false;
 req.setDiagnosticCode=value=>{code=safeCode(value);};
 const end=res.end;
 res.end=function(chunk,...args){
  if(res.statusCode>=400&&(typeof chunk==='string'||Buffer.isBuffer(chunk))&&Buffer.byteLength(chunk)<4096){
   try{code=code||safeCode(JSON.parse(chunk.toString()).error);}catch{/* Non-JSON errors are recorded by status only. */}
  }
  return end.call(this,chunk,...args);
 };
 const complete=aborted=>{
  if(completed)return;completed=true;
  const status=aborted?499:res.statusCode;
  metrics.observe('api',endpoint,aborted?'cancelled':status>=500?'failed':'completed',performance.now()-started);
  try{observe({subject:req.origenIdentity?.sub,endpoint,status});}catch{/* Response delivery does not depend on best-effort denial monitoring. */}
  // Successful probe requests are omitted to keep production logs useful.
  if(!aborted&&status<400&&['healthz','readyz','api/account-data','api/institution-metrics/event','api/institution-metrics/report'].includes(endpoint))return;
  emit({event:aborted?'api_aborted':'api_request',level:status>=500?'error':status>=400?'warn':'info',httpStatus:status,durationMs:Math.round(performance.now()-started),code:aborted?'client_disconnected':code});
 };
 res.once('finish',()=>complete(false));res.once('close',()=>complete(!res.writableFinished));
 return context;
}
