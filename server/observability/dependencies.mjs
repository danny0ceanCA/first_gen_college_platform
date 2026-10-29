import {createHash} from 'node:crypto';
import {runtimeLog} from './logger.mjs';
import {currentDiagnosticContext,withDiagnosticSpan} from './context.mjs';
import {safeErrorCode} from './error-codes.mjs';
import {metrics,dependencyOperations} from './metrics.mjs';
import {detailedSpansEnabled} from './collection-policy.mjs';

const models=new Set(['gpt-4.1-mini','gpt-4o-mini','gpt-realtime','gpt-realtime-2.1','gpt-live-1','gpt-realtime-2_1','gpt-6-luna','gpt-6.1','gpt-6.1-sol']);
const pending=new Map();let next=0;
export const approvedModel=value=>models.has(value)?value:'other';
export function sampledOperation(context=currentDiagnosticContext()){
 const key=context?.operationId||context?.traceId;if(!key)return false;
 return createHash('sha256').update(key).digest().readUInt32BE(0)%10===0;
}
function attempt(family,operation,{log=runtimeLog,clock=()=>performance.now(),detailed=detailedSpansEnabled()}={}){
 if(!dependencyOperations.includes(operation))throw new Error('unapproved_diagnostic_operation');
 const context=currentDiagnosticContext(),started=clock(),id=++next;let finished=false,finishAttempt;
 const emit=(record,frame=context)=>{try{log(record,frame);}catch{/* Best effort diagnostics never replace the operation's result. */}};
 const detail=detailed&&sampledOperation(context);
 if(pending.size<1000)pending.set(id,{at:Date.now(),operation,family,context,log:emit,expire:()=>finishAttempt('unknown')});
 else emit({event:'telemetry.gap',reason:'capacity'});
 if(detail)emit({event:'dependency.started',operation,dependency:family,samplingProbability:0.1},context);
 finishAttempt=(outcome,fields={})=>{
  if(finished)return;finished=true;pending.delete(id);const durationMs=Math.max(0,clock()-started);
  metrics.observe(family,operation,outcome,durationMs);
  emit({event:family==='provider'?'provider.operation.finished':'db.operation.finished',operation,outcome,durationMs,samplingProbability:1,...fields},context);
  if(detail||outcome==='failed')emit({event:'dependency.span.finished',operation,dependency:family,outcome,durationMs,samplingProbability:detail?0.1:1,coverage:detail?'sampled':'terminal-only'},context);
 };
 return finishAttempt;
}
export function detectStaleAttempts(now=Date.now(),ageMs=300000){
 let count=0;for(const [id,row] of pending)if(now-row.at>=ageMs){pending.delete(id);count++;row.expire();row.log({event:'dependency.incomplete',operation:row.operation,dependency:row.family,outcome:'unknown'},row.context);}
 metrics.gauge('staleAttempts',count);return count;
}
// Explicit call-site adapter. URL/options and response content are never inspected
// for telemetry. The original permission-aware body readers still run first.
export function providerOperation(operation,request,{model='other',...settings}={}){
 return (url,options)=>withDiagnosticSpan(async()=>{
  const finish=attempt('provider',operation,settings),started=performance.now();let response,requestMs;
  try{
   response=await request(url,options);requestMs=performance.now()-started;
   const base={httpStatus:response.status,requestMs,model:approvedModel(model),usageState:'unknown'};
   if(!response.ok){finish('failed',base);return response;}
   return new Proxy(response,{get(target,key){
    if(['json','text','arrayBuffer'].includes(key))return async(...args)=>{
     const bodyStarted=performance.now();
     try{
      const result=await target[key](...args);const usage={usageState:'unknown'};
      if(key==='json'&&result?.usage&&typeof result.usage==='object'){
       for(const [source,dest] of [['input_tokens','inputTokens'],['output_tokens','outputTokens'],['total_tokens','totalTokens']])if(Number.isSafeInteger(result.usage[source])&&result.usage[source]>=0)usage[dest]=result.usage[source];
       if(Object.keys(usage).length>1)usage.usageState='reported';
      }
      finish('completed',{...base,bodyMs:performance.now()-bodyStarted,...usage});return result;
     }catch(error){finish(error?.name==='AbortError'?'cancelled':'failed',{...base,bodyMs:performance.now()-bodyStarted,failureStage:'body',code:error?.status===403?'permission_required':safeErrorCode(error)});throw error;}
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }});
  }catch(error){finish(error?.name==='AbortError'?'cancelled':'failed',{requestMs:performance.now()-started,model:approvedModel(model),failureStage:'request',code:error?.status===403?'permission_required':safeErrorCode(error)});throw error;}
 });
}
// Selected repositories opt in; pg, SQL text and parameters are never logged.
export async function databaseOperation(database,operation,settings={}){
 return withDiagnosticSpan(async()=>{
  const finish=attempt('database',operation,settings),started=performance.now();let client,acquireMs,executeMs=0,commitMs=0,rows=0,committed=false,error,closed=false;
  try{client=await database.connect();acquireMs=performance.now()-started;}
  catch(cause){finish('failed',{acquireMs:performance.now()-started,code:safeErrorCode(cause)});throw cause;}
  return {
   ...(client.setAccountScope?{setAccountScope:client.setAccountScope.bind(client)}:{}),
   async query(sql,...args){
    const commit=typeof sql==='string'&&/^\s*COMMIT\s*;?\s*$/i.test(sql),at=performance.now();
    try{const result=await client.query(sql,...args);if(commit)committed=true;rows+=Number.isSafeInteger(result?.rowCount)?Math.max(0,result.rowCount):0;return result;}
    catch(cause){error=cause;throw cause;}
    finally{if(commit)commitMs+=performance.now()-at;else executeMs+=performance.now()-at;}
   },
   release(...args){if(closed)return;closed=true;try{return client.release(...args);}finally{finish(error?'failed':committed?'completed':'unknown',{acquireMs,executeMs,commitMs,rowBucket:rows===0?'zero':rows===1?'one':rows<=10?'few':'many',...(error?{code:safeErrorCode(error)}:{})});}},
  };
 });
}
export async function databaseQueryOperation(operation,work,settings={}){
 return withDiagnosticSpan(async()=>{
  const finish=attempt('database',operation,settings),started=performance.now();
  try{const result=await work();finish('completed',{executeMs:performance.now()-started});return result;}
  catch(error){finish('failed',{executeMs:performance.now()-started,code:safeErrorCode(error)});throw error;}
 });
}
