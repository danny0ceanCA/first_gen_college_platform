import {randomUUID} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {publicResearchInput,researchPrivateNames} from './provider-privacy.mjs';
import {allowedRequest} from './origin.mjs';
import {selectResearchReuse} from './research-reuse.mjs';
import {researchTraceKeys} from './research-trace.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function assertBackgroundResearchReady(database,env){
 if(env.ORIGEN_BACKGROUND_RESEARCH!=='true')return;
 if(!database)throw Error('background_research_database_required');
 const table=(await database.query("SELECT to_regclass('origen_voice_research_jobs') AS id")).rows[0]?.id;
 if(!table)throw Error('background_research_migration_123_required');
 const access=(await database.query("SELECT has_table_privilege(current_user,'origen_voice_research_jobs','SELECT') AND has_table_privilege(current_user,'origen_voice_research_jobs','INSERT') AND has_table_privilege(current_user,'origen_voice_research_jobs','UPDATE') AS ready")).rows[0]?.ready;
 if(!access)throw Error('background_research_runtime_grants_required');
 const trace=(await database.query("SELECT to_regclass('origen_voice_research_traces') AS id")).rows[0]?.id;
 if(!trace)throw Error('background_research_migration_124_required');
 const traceAccess=(await database.query("SELECT has_table_privilege(current_user,'origen_voice_research_traces','SELECT') AND has_table_privilege(current_user,'origen_voice_research_traces','INSERT') AND has_table_privilege(current_user,'origen_voice_research_traces','UPDATE') AND has_table_privilege(current_user,'origen_voice_research_trace_events','SELECT') AND has_table_privilege(current_user,'origen_voice_research_trace_events','INSERT') AS ready")).rows[0]?.ready;
 if(!traceAccess)throw Error('background_research_trace_grants_required');
}
export function createVoiceResearchJobsHandler(database,env){
 return async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/voice-research-jobs')return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const params=new URL(req.url,'http://localhost').searchParams,diagnostics=req.method==='GET'&&params.get('diagnostics')==='1';
  if(!database||env.ORIGEN_BACKGROUND_RESEARCH!=='true'&&!diagnostics)return send(503,{error:'background_research_disabled'});
  if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'unauthorized'});
  if(!allowedRequest(req,env))return send(403,{error:'origin_not_allowed'});
  if(!['POST','GET','DELETE'].includes(req.method))return send(405,{error:'method_not_allowed'});
  let c;
  try{
   let input;
   if(req.method==='POST'){
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>10000)return send(413,{error:'request_too_large'});}
    input=JSON.parse(raw);
    if(!uuid.test(input.sessionId)||typeof input.requestKey!=='string'||!input.requestKey||input.requestKey.length>100||!['finance','admissions','planning','loans'].includes(input.mode)||!['en','es'].includes(input.language)||typeof input.question!=='string'||!input.question.trim()||input.question.length>3000||typeof input.institution!=='string'||input.institution.length>300)return send(400,{error:'invalid_request'});
    input={...input,...publicResearchInput(input,await researchPrivateNames(req,database))};
   }
   const id=params.get('id'),sessionId=params.get('sessionId'),after=params.get('after'),afterId=params.get('afterId');
   if(diagnostics? !uuid.test(sessionId||'')||!!after!==!!afterId||after&&(!Number.isFinite(Date.parse(after))||!uuid.test(afterId||'')):req.method!=='POST'&&!uuid.test(id||''))return send(400,{error:'invalid_request'});
   c=await database.connect();await c.query('BEGIN');await guardAccountTransaction(c,req.origenIdentity.sub);
   const account=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[req.origenIdentity.sub])).rows[0];
   if(!account){await c.query('ROLLBACK');return send(404,{error:'account_not_found'});}
   if(diagnostics){
    const reports=params.get('includeReports')==='1';
    const jobs=(await c.query(`SELECT id,session_id,mode,language,status,queued_at,started_at,finished_at,diagnostics_dropped,snapshot_omitted${reports?',request_snapshot,result_snapshot':''} FROM origen_voice_research_traces WHERE account_id=$1 AND session_id=$2 ORDER BY queued_at,id LIMIT 100`,[account.id,sessionId])).rows;
    const events=(await c.query(`SELECT id,job_id,session_id,stage,observed_at::text AS observed_at,received_at::text AS received_at,data FROM origen_voice_research_trace_events WHERE account_id=$1 AND session_id=$2 AND ($3::timestamptz IS NULL OR (received_at,id)>($3::timestamptz,$4::uuid)) ORDER BY origen_voice_research_trace_events.received_at,id LIMIT 500`,[account.id,sessionId,after??null,afterId??null])).rows;
    const last=events.at(-1);await c.query('COMMIT');return send(200,{jobs:jobs.map(job=>({...job,...researchTraceKeys(sessionId,job.id)})),events,next:events.length===500?{after:last.received_at,afterId:last.id}:null,retention:'until_account_deletion',evidenceNote:'Provider completion, transcript observation and browser playback reports are separate evidence.'});
   }
   let row;
   if(req.method==='POST'){
    if(input.studentId!=null&&!(await c.query('SELECT 1 FROM origen_students WHERE account_id=$1 AND id=$2',[account.id,input.studentId])).rows.length){await c.query('ROLLBACK');return send(403,{error:'student_unavailable'});}
    row=(await c.query('SELECT id,status FROM origen_voice_research_jobs WHERE account_id=$1 AND session_id=$2 AND request_key=$3 AND expires_at>now()',[account.id,input.sessionId,input.requestKey])).rows[0];
    if(!row){
     const count=(await c.query("SELECT count(*)::int AS n FROM origen_voice_research_jobs WHERE account_id=$1 AND created_at>now()-interval '10 minutes'",[account.id])).rows[0].n;
     if(count>=6){await c.query('ROLLBACK');return send(429,{error:'research_limit'});}
     // Reuse is rebuilt from authorized stored results, never accepted from the
     // POST body. An explicit refresh bypasses both exact-cache and evidence reuse.
     const prior=env.ORIGEN_RESEARCH_DELIVERY_V2==='true'&&input.forceRefresh!==true?
      (await c.query("SELECT input,result,status,finished_at FROM origen_voice_research_jobs WHERE account_id=$1 AND session_id=$2 AND student_id IS NOT DISTINCT FROM $3 AND status='completed' AND finished_at>now()-interval '5 minutes' AND expires_at>now() ORDER BY finished_at DESC LIMIT 8",[account.id,input.sessionId,input.studentId??null])).rows:[];
     const payload={question:input.question,institution:input.institution,language:input.language,mode:input.mode,purpose:input.mode==='planning'?'planning':undefined,...selectResearchReuse(input,prior)};
     row=(await c.query('INSERT INTO origen_voice_research_jobs(id,account_id,student_id,session_id,request_key,input) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status',[randomUUID(),account.id,input.studentId??null,input.sessionId,input.requestKey,payload])).rows[0];
    }
   }else if(req.method==='DELETE')row=(await c.query("UPDATE origen_voice_research_jobs SET status='cancelled',result=NULL,finished_at=now() WHERE id=$1 AND account_id=$2 RETURNING id,status",[id,account.id])).rows[0];
   else row=(await c.query('SELECT id,status,result,session_id,student_id FROM origen_voice_research_jobs WHERE id=$1 AND account_id=$2 AND expires_at>now()',[id,account.id])).rows[0];
   await c.query('COMMIT');send(row?200:404,row||{error:'job_unavailable'});
  }catch(error){await c?.query('ROLLBACK').catch(()=>{});send(error.status||(error instanceof SyntaxError?400:503),{error:'research_job_unavailable'});}finally{c?.release();}
 };
}
