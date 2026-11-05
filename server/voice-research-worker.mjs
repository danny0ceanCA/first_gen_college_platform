import {financeResearchRequest,parseFinanceResearch} from './finance-research.mjs';
import {admissionsResearchRequest,parseAdmissionsResearch} from './admissions-research.mjs';
import {runtimeLog} from './observability/logger.mjs';
import {researchBriefRequest,parseResearchBrief} from './research-brief.mjs';
export async function processResearchJob(database,env,{request=fetch,signal}={}){
 // Atomic claim; a crashed job is failed, never retried automatically at extra cost.
 await database.query("UPDATE origen_voice_research_jobs SET status='failed',finished_at=now() WHERE status='running' AND started_at<now()-interval '3 minutes'");
 await database.query('DELETE FROM origen_voice_research_jobs WHERE expires_at<now()');
 const job=(await database.query("UPDATE origen_voice_research_jobs SET status='running',started_at=now() WHERE id=(SELECT id FROM origen_voice_research_jobs WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,input")).rows[0];
 if(!job)return false;
 const started=Date.now();
 const controller=new AbortController();
 let checking=false;
 const watch=setInterval(()=>{if(checking)return;checking=true;void database.query('SELECT status FROM origen_voice_research_jobs WHERE id=$1',[job.id]).then(r=>{if(r.rows[0]?.status!=='running')controller.abort();}).catch(()=>controller.abort()).finally(()=>{checking=false;});},1000);
 try{
  const finance=['finance','loans'].includes(job.input.mode);
  const base=finance?financeResearchRequest(env,job.input):admissionsResearchRequest(env,job.input);
  const body=env.ORIGEN_RESEARCH_BRIEFS==='false'?base:researchBriefRequest(base);
  body.max_tool_calls=2;
  const response=await request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000),...(signal?[signal]:[])])});
  if(!response.ok)throw new Error('research_failed');
  const data=await response.json();const parsed=(finance?parseFinanceResearch:parseAdmissionsResearch)(data,job.input.institution);
  const result=env.ORIGEN_RESEARCH_BRIEFS==='false'?parsed:parseResearchBrief(parsed);
  if(!result)throw new Error('sources_unverified');
  const saved=await database.query("UPDATE origen_voice_research_jobs SET status='completed',result=$2,finished_at=now() WHERE id=$1 AND status='running' AND expires_at>now()",[job.id,result]);
  if(saved.rowCount===0)return true;
  runtimeLog({event:'voice.research.finished',outcome:'completed',durationMs:Date.now()-started,sourceCount:result.sources.length,model:data.model,inputTokens:data.usage?.input_tokens,outputTokens:data.usage?.output_tokens});
 }catch{await database.query("UPDATE origen_voice_research_jobs SET status='failed',finished_at=now() WHERE id=$1 AND status='running'",[job.id]);}
 finally{clearInterval(watch);}
 return true;
}
