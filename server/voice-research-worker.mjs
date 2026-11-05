import {financeResearchRequest,parseFinanceResearch} from './finance-research.mjs';
import {admissionsResearchRequest,parseAdmissionsResearch} from './admissions-research.mjs';
import {runtimeLog} from './observability/logger.mjs';
import {researchBriefRequest,parseResearchBrief} from './research-brief.mjs';
import {researchRecoveryPlan,recoveryResearchRequest,researchAttemptDiagnostics,mergeRecoveryResearch,parseUnverifiedResearch} from './research-recovery.mjs';
import {mergeReusedResearchSources,reuseResearchRequest,parseReusedOnlyResearch,cachedResearchForCoverage} from './research-reuse.mjs';
export async function processResearchJob(database,env,{request=fetch,signal,now=Date.now}={}){
 // Atomic claim; a crashed job is failed, never retried automatically at extra cost.
 await database.query("UPDATE origen_voice_research_jobs SET status='failed',finished_at=now() WHERE status='running' AND started_at<now()-interval '3 minutes'");
 await database.query('DELETE FROM origen_voice_research_jobs WHERE expires_at<now()');
 const job=(await database.query("UPDATE origen_voice_research_jobs SET status='running',started_at=now() WHERE id=(SELECT id FROM origen_voice_research_jobs WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,input")).rows[0];
 if(!job)return false;
 const started=now(),attempts=[];
 const controller=new AbortController();
 // Every pass shares this deadline and cancellation. A recovery never buys
 // another 90 seconds or repeats the durable job.
 const jobSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000),...(signal?[signal]:[])]);
 let checking=false;
 const watch=setInterval(()=>{if(checking)return;checking=true;void database.query('SELECT status FROM origen_voice_research_jobs WHERE id=$1',[job.id]).then(r=>{if(r.rows[0]?.status!=='running')controller.abort();}).catch(()=>controller.abort()).finally(()=>{checking=false;});},1000);
 try{
  const finance=['finance','loans'].includes(job.input.mode);
  const base=reuseResearchRequest(finance?financeResearchRequest(env,job.input):admissionsResearchRequest(env,job.input),job.input);
  const body=env.ORIGEN_RESEARCH_BRIEFS==='false'?base:researchBriefRequest(base);
  body.max_tool_calls=2;
  let latestData;const usage={inputTokens:0,outputTokens:0};
  async function run(requestBody,pass){
   const passStarted=now();let data,httpStatus;
   try{
    jobSignal.throwIfAborted();
    const response=await request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(requestBody),signal:jobSignal});
    httpStatus=response.status;if(!response.ok)throw new Error('research_failed');
    data=await response.json();latestData=data;usage.inputTokens+=data.usage?.input_tokens||0;usage.outputTokens+=data.usage?.output_tokens||0;
    const parsed=mergeReusedResearchSources((finance?parseFinanceResearch:parseAdmissionsResearch)(data,job.input.institution)||parseReusedOnlyResearch(data,job.input)||parseUnverifiedResearch(data),job.input);
    const result=env.ORIGEN_RESEARCH_BRIEFS==='false'?parsed:parseResearchBrief(parsed);
    if(!result)throw new Error('sources_unverified');
    attempts.push(researchAttemptDiagnostics(data,{pass,outcome:'completed',durationMs:now()-passStarted,httpStatus}));
    return result;
   }catch(error){attempts.push(researchAttemptDiagnostics(data,{pass,outcome:jobSignal.aborted?'aborted':'failed',durationMs:now()-passStarted,httpStatus}));throw error;}
  }
  // A new wording can be entirely covered by a server-selected prior result.
  // Reuse it without forcing a web call merely because this job was queued.
  let result=cachedResearchForCoverage(job.input)||await run(body,'initial');
  const plan=env.ORIGEN_RESEARCH_BRIEFS==='false'?null:researchRecoveryPlan(result);
  let recoveryStatus='not_needed';
  // Leave a useful first result intact if time is almost exhausted. Recovery
  // failure is not failure of the verified evidence already obtained.
  if(plan&&!jobSignal.aborted&&now()-started<75000){
   recoveryStatus='unresolved';
   try{
    // Recheck a request changed/cancelled during the first search before
    // spending its remaining recovery allowance.
    const state=await database.query('SELECT status FROM origen_voice_research_jobs WHERE id=$1',[job.id]);
    if(state.rows[0]?.status!=='running')controller.abort();
    const recovered=await run(recoveryResearchRequest(body,result,plan),'recovery');
    const merged=mergeRecoveryResearch(result,recovered,job.input.language);
    if(merged!==result){result=merged;recoveryStatus=researchRecoveryPlan(result)?'partial':'recovered';}
   }catch{recoveryStatus=jobSignal.aborted?'aborted':'failed';}
  }else if(plan)recoveryStatus='deadline';
  // A cancelled/shutdown job must not publish even an earlier partial answer.
  if(controller.signal.aborted||signal?.aborted)throw new Error('cancelled');
  result={...result,researchDiagnostics:{recoveryStatus,attempts}};
  const saved=await database.query("UPDATE origen_voice_research_jobs SET status='completed',result=$2,finished_at=now() WHERE id=$1 AND status='running' AND expires_at>now()",[job.id,result]);
  if(saved.rowCount===0)return true;
  runtimeLog({event:'voice.research.finished',outcome:'completed',durationMs:now()-started,sourceCount:result.sources.length,model:latestData?.model,...usage});
 }catch{
  await database.query("UPDATE origen_voice_research_jobs SET status='failed',result=$2,finished_at=now() WHERE id=$1 AND status='running'",[job.id,{researchDiagnostics:{recoveryStatus:jobSignal.aborted?'aborted':'failed',attempts}}]);
  runtimeLog({event:'voice.research.finished',outcome:'failed',durationMs:now()-started,sourceCount:0});
 }
 finally{clearInterval(watch);}
 return true;
}
