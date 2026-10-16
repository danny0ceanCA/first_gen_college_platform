import {runRetentionJob,isolateDatabase} from '../account-isolation.mjs';
import {runDiagnosticJob} from './context.mjs';
import {runtimeLog} from './logger.mjs';
import {safeErrorCode} from './error-codes.mjs';
import {metrics,jobNames} from './metrics.mjs';
import {maintenanceBatch} from './maintenance-batches.mjs';

export function createJobRunner(pool,{log=runtimeLog,schema='public'}={}){
 const emit=event=>{try{log(event);}catch{/* Diagnostic failure cannot interrupt retention. */}};
 let stopped=false,chain=Promise.resolve();const lastSuccess=new Map();
 const run=(job,work)=>{
  if(!jobNames.includes(job))throw new Error('unapproved_maintenance_job');
  const task=chain.then(()=>runDiagnosticJob(async()=>{
   if(stopped)return {outcome:'cancelled'};
   const started=performance.now();let client,locked=false,lost=false,count=0,deletedCount=0,queryCount=0;
   const leaseLost=()=>{lost=true;};let outcome='failed',code;
   try{
    client=await pool.connect();client.on?.('error',leaseLost);
    locked=(await client.query('SELECT pg_try_advisory_lock(728420,$1) AS locked',[jobNames.indexOf(job)+1])).rows[0]?.locked===true;
    if(!locked){outcome='skipped-lock';return {outcome};}
    emit({event:'job.started',job});
    // Reuse the lock's single dedicated connection. No user transaction spans a
    // whole sweep. Each repository retains its own transaction-local RLS scope.
    const db=isolateDatabase({connect:async()=>{
     if(lost||stopped)throw new Error('maintenance_lease_lost');
     return {query:async(sql,...args)=>{if(lost||stopped)throw new Error('maintenance_lease_lost');const result=await client.query(maintenanceBatch(sql),...args);queryCount++;count+=Number.isSafeInteger(result?.rowCount)?Math.max(0,result.rowCount):0;if(result?.command==='DELETE')deletedCount+=Math.max(0,result.rowCount||0);return result;},release(){}};
    },end:async()=>{}},{schema});
    await runRetentionJob(()=>work(db));if(lost)throw new Error('maintenance_lease_lost');
    outcome='completed';lastSuccess.set(job,Date.now());return {outcome};
   }catch(error){code=safeErrorCode(error);return {outcome:'failed'};}
   finally{
    if(client){if(locked&&!lost)try{await client.query('SELECT pg_advisory_unlock(728420,$1)',[jobNames.indexOf(job)+1]);}catch{lost=true;}client.removeListener?.('error',leaseLost);client.release(lost?new Error('maintenance_lease_lost'):undefined);}
    const durationMs=performance.now()-started;metrics.observe('job',job,outcome,durationMs);emit({event:'job.finished',job,outcome,durationMs,code,sourceCount:count,deletedCount,queryCount,...(lastSuccess.has(job)?{lastSuccessAgeMs:Date.now()-lastSuccess.get(job)}:{})});
   }
  }));
  chain=task.catch(()=>{});return task;
 };
 return {run,lastSuccess:()=>Object.fromEntries(lastSuccess),stop:async()=>{stopped=true;await chain;}};
}
