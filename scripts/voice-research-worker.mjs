import pg from 'pg';
import {processResearchJob} from '../server/voice-research-worker.mjs';
if(!process.env.RESEARCH_WORKER_DATABASE_URL||!process.env.OPENAI_API_KEY)throw new Error('Worker configuration missing');
const pool=new pg.Pool({connectionString:process.env.RESEARCH_WORKER_DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
const stop=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop.abort());
try{
 const identity=(await pool.query("SELECT current_user AS name,has_table_privilege(current_user,'origen_students','SELECT') AS student_access FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb")).rows[0];
 if(identity?.name!=='origen_research_worker'||identity.student_access)throw Error('restricted_research_worker_role_required');
 console.log(JSON.stringify({event:'research_worker_ready'}));
 while(!stop.signal.aborted){try{if(await processResearchJob(pool,process.env,{signal:stop.signal}))continue;}catch{console.error('research_worker_iteration_failed');}await new Promise(r=>setTimeout(r,750));}}finally{await pool.end();}
