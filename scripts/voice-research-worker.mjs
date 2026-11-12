import pg from 'pg';
import {processResearchJob} from '../server/voice-research-worker.mjs';
import {runtimeLog} from '../server/observability/logger.mjs';
if(!process.env.RESEARCH_WORKER_DATABASE_URL||!process.env.OPENAI_API_KEY)throw new Error('Worker configuration missing');
const pool=new pg.Pool({connectionString:process.env.RESEARCH_WORKER_DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
const stop=new AbortController();
let catalog;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop.abort());
try{
 const identity=(await pool.query("SELECT current_user AS name,has_table_privilege(current_user,'origen_students','SELECT') AS student_access FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb")).rows[0];
 if(identity?.name!=='origen_research_worker'||identity.student_access)throw Error('restricted_research_worker_role_required');
 const ready=(await pool.query("SELECT has_table_privilege(current_user,'origen_voice_research_traces','SELECT') AND has_table_privilege(current_user,'origen_voice_research_traces','INSERT') AND has_table_privilege(current_user,'origen_voice_research_traces','UPDATE') AND has_table_privilege(current_user,'origen_voice_research_trace_events','INSERT') AS ready")).rows[0]?.ready;
 if(!ready)throw Error('research_trace_migration_and_grants_required');
 if(process.env.ORIGEN_LOCAL_COST_CATALOG==='true'){
  const {createLocalCatalogProvider}=await import('../research/cost-catalog/local-provider.mjs');
  catalog=await createLocalCatalogProvider(process.env);
 }
 runtimeLog({event:'voice.research.worker_ready'});
 while(!stop.signal.aborted){try{if(await processResearchJob(pool,process.env,{signal:stop.signal,lookupCatalog:catalog?.lookup}))continue;}catch{runtimeLog({event:'voice.research.worker_error',workerPhase:'poll',failureStage:'persistence'});}await new Promise(r=>setTimeout(r,750));}}catch{runtimeLog({event:'voice.research.worker_error',workerPhase:'startup',failureStage:'persistence'});process.exitCode=1;}finally{await catalog?.close();await pool.end();await runtimeLog.flush();}
