import {recoveryEnabled,recoveryReady,claimRecoveryJob,createRecoveryProcessor} from './conversation-recovery.mjs';
import {runtimeLog} from './observability/logger.mjs';
import {metrics} from './observability/metrics.mjs';
import {safeErrorCode} from './observability/error-codes.mjs';
import {runDiagnosticJob} from './observability/context.mjs';
import {randomUUID} from 'node:crypto';
import {runAsAccount,runRetentionJob,isolateDatabase} from './account-isolation.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {permissionContext,assertPermission} from './permission-context.mjs';
import {permissionFetch} from './permission-execution.mjs';
import {createTopicService} from './topic-notes.mjs';

const disabled=()=>Object.assign(new Error('binder_processing_disabled'),{status:503});
export const binderJobsEnabled=env=>env.ORIGEN_BINDER_JOBS==='true';
export async function binderJobsReady(database){return !!database&&(await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_binder_jobs'")).rows.length>0;}

export async function binderJobStatus(database,subject,input){
 const c=await database.connect();try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const owner=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0]?.id;
  if(!owner)throw Object.assign(new Error('account_not_found'),{status:404});
  if(input.action==='retry')await c.query("UPDATE origen_binder_jobs SET status='pending',attempts=0,manual_retries=manual_retries+1,available_at=now(),lease_until=NULL,lease_token=NULL WHERE account_id=$1 AND student_id IS NOT DISTINCT FROM $2 AND status='failed' AND manual_retries<2",[owner,input.studentId]);
  if(input.action==='sync'||input.action==='suggest'){
   // Explicitly requested catch-up only; schema deployment performs no backfill.
   await c.query(`INSERT INTO origen_binder_jobs(account_id,summary_id,student_id,permission_revision,language)
    SELECT s.account_id,s.id,s.student_id,e.revision,$3 FROM origen_conversation_summaries s
    JOIN origen_accounts a ON a.id=s.account_id JOIN origen_eligibility e ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')
    WHERE s.account_id=$1 AND s.student_id IS NOT DISTINCT FROM $2 AND ($4::text IS NULL OR s.id=$4)
    AND NOT EXISTS(SELECT 1 FROM origen_topic_note_batches b WHERE b.account_id=s.account_id AND b.summary_id=s.id)
    ORDER BY s.conversation_at DESC LIMIT 100 ON CONFLICT DO NOTHING`,[owner,input.studentId,input.language||'en',input.summaryId||null]);
  }
  const rows=(await c.query("SELECT status,count(*)::int AS n,bool_or(manual_retries<2) AS retryable FROM origen_binder_jobs WHERE account_id=$1 AND student_id IS NOT DISTINCT FROM $2 AND created_at>now()-interval '7 days' GROUP BY status",[owner,input.studentId])).rows;
  await c.query('COMMIT');const count=status=>rows.find(r=>r.status===status)?.n||0;
  return {enabled:true,pending:count('pending')+count('running'),failed:count('failed'),canRetry:rows.some(r=>r.status==='failed'&&r.retryable),retryAfterMs:3000};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}

// Maintenance can lease metadata only. Content processing uses the separate
// account-scoped application identity and the original permission revision.
export async function claimBinderJob(dispatch){
 const c=await dispatch.connect();try{
  await c.query('BEGIN');
  await c.query("DELETE FROM origen_binder_jobs WHERE created_at<now()-interval '7 days'");
  await c.query("UPDATE origen_binder_jobs SET status='failed',lease_until=NULL,lease_token=NULL WHERE status='running' AND lease_until<now() AND attempts>=5");
  const job=(await c.query(`SELECT j.*,a.auth0_subject FROM origen_binder_jobs j JOIN origen_accounts a ON a.id=j.account_id
   WHERE j.created_at>now()-interval '7 days' AND j.attempts<5 AND
    (j.status='pending' AND j.available_at<=now() OR j.status='running' AND j.lease_until<now())
    AND (SELECT count(*) FROM origen_binder_jobs b CROSS JOIN LATERAL unnest(b.attempt_times) t(at) WHERE b.account_id=j.account_id AND t.at>now()-interval '1 hour')<20
   ORDER BY j.available_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`)).rows[0];
  if(!job){await c.query('COMMIT');return null;}
  const token=randomUUID();
  await c.query("UPDATE origen_binder_jobs SET status='running',attempts=attempts+1,attempt_times=array_append(attempt_times,now()),lease_token=$3,lease_until=now()+interval '90 seconds' WHERE account_id=$1 AND summary_id=$2",[job.account_id,job.summary_id,token]);
  await c.query('COMMIT');return {...job,lease_token:token,attempts:job.attempts+1};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}

export function createBinderProcessor(database,env,request=fetch){
 const topic=createTopicService(database,env,permissionFetch(database,env,request));
 return async(job,{signal=new AbortController().signal}={})=>runAsAccount({sub:job.auth0_subject},()=>permissionContext.run({subject:job.auth0_subject,revision:job.permission_revision,signal},async()=>{
  const proof=async c=>{
   if(!binderJobsEnabled(env))throw disabled();signal?.throwIfAborted();
   const current=(await c.query("SELECT 1 FROM origen_binder_jobs WHERE account_id=$1 AND summary_id=$2 AND status='running' AND lease_token=$3 AND lease_until>now() FOR UPDATE",[job.account_id,job.summary_id,job.lease_token])).rows.length;
   if(!current)throw Object.assign(new Error('binder_lease_changed'),{status:409});
  };
  const finish=async(status)=>{
   const c=await database.connect();try{await c.query('BEGIN');await guardAccountTransaction(c,job.auth0_subject);await proof(c);await c.query('UPDATE origen_binder_jobs SET status=$4,lease_until=NULL,lease_token=NULL WHERE account_id=$1 AND summary_id=$2 AND lease_token=$3',[job.account_id,job.summary_id,job.lease_token,status]);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  };
  try{
   if(!binderJobsEnabled(env))throw disabled();await assertPermission(database);
   await topic(job.auth0_subject,{action:'suggest',studentId:job.student_id,summaryId:job.summary_id,language:job.language},{beforeCommit:proof});
   await finish('complete');return 'complete';
  }catch(error){
   // Permission/closure failures cannot use a fresh approval to revive this job.
   // A full binder is recoverable after the student removes items. Surface it
   // as failed/retryable immediately rather than cancelling or spending AI retries.
   const capacity=['memory_limit','note_limit'].includes(error.message);
   const cancel=!capacity&&!signal.aborted&&[403,404,409,410].includes(error.status),terminal=capacity||job.attempts>=5;
   const c=await database.connect();try{
    await c.query('BEGIN');await c.setAccountScope?.(job.auth0_subject);
    await c.query("UPDATE origen_binder_jobs SET status=$4,available_at=now()+($5::int*interval '1 second'),lease_until=NULL,lease_token=NULL WHERE account_id=$1 AND summary_id=$2 AND lease_token=$3",[job.account_id,job.summary_id,job.lease_token,cancel?'cancelled':terminal?'failed':'pending',Math.min(300,2**job.attempts*5)]);
    await c.query('COMMIT');
   }catch(failure){await c.query('ROLLBACK').catch(()=>{});throw failure;}finally{c.release();}
   return cancel?'cancelled':terminal?'failed':'pending';
  }
 }));
}

export function startBinderWorker({application,maintenance,env,request=fetch,intervalMs=3000,schema='public'}){
 let stopped=false,running;const abort=new AbortController(),dispatch=isolateDatabase(maintenance,{schema}),process=createBinderProcessor(application,env,request);
 const recover=createRecoveryProcessor(application,env,request);let recoveryTurn=true;
 const tick=()=>{
  if(stopped||running||!binderJobsEnabled(env))return;
  running=runDiagnosticJob(async()=>{
   let recoveryJob=null;
   if(recoveryEnabled(env)&&recoveryTurn&&await recoveryReady(application))recoveryJob=await runRetentionJob(()=>claimRecoveryJob(dispatch));
   recoveryTurn=!recoveryTurn;
   const job=recoveryJob||await runRetentionJob(()=>claimBinderJob(dispatch));if(!job||stopped)return;
   const started=performance.now(),jobName=recoveryJob?'conversation-recovery':'binder-processing';runtimeLog({event:'job.started',job:jobName});
   const status=await (recoveryJob?recover:process)(job,{signal:abort.signal}),outcome=status==='complete'?'completed':status==='cancelled'?'cancelled':'failed',durationMs=performance.now()-started;
   metrics.observe('job',jobName,outcome,durationMs);runtimeLog({event:'job.finished',job:jobName,outcome,durationMs,sourceCount:1});
  }).catch(error=>runtimeLog({event:'job.finished',job:'binder-processing',outcome:'failed',code:safeErrorCode(error)})).finally(()=>{running=undefined;});
 };
 const timer=setInterval(tick,intervalMs);timer.unref();tick();
 return async()=>{stopped=true;clearInterval(timer);abort.abort();await running;};
}
