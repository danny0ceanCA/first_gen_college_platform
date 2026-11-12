import {responseMeasurement} from './live-measurements.mjs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {financeResearchRequest,parseFinanceResearch} from './finance-research.mjs';
import {admissionsResearchRequest,parseAdmissionsResearch} from './admissions-research.mjs';
import {runtimeLog} from './observability/logger.mjs';
import {researchBriefRequest,parseResearchBrief} from './research-brief.mjs';
import {researchRecoveryPlan,researchRecoveryOutcome,recoveryResearchRequest,researchAttemptDiagnostics,mergeRecoveryResearch,parseUnverifiedResearch,reconcileResearchFindings} from './research-recovery.mjs';
import {mergeComparisonAddition,mergeReusedResearchSources,reuseResearchRequest,parseReusedOnlyResearch,cachedResearchForCoverage,retainVerifiedResearch} from './research-reuse.mjs';
import {researchBriefSelection} from '../src/researchBrief.mjs';
import {createResearchTraceWriter,researchTraceKeys} from './research-trace.mjs';
import {comparisonResearchRequest,parseComparisonResearch} from './voice-comparison-update.mjs';
import {findingSubjectMentioned} from '../src/researchFindings.mjs';
import {auditResearchTask,createResearchTask,researchTaskEntities} from '../src/researchTask.mjs';
export async function processResearchJob(database,env,{request=fetch,signal,now=Date.now,log=runtimeLog,lookupCatalog}={}){
 // Atomic claim; a crashed job is failed, never retried automatically at extra cost.
 await database.query("UPDATE origen_voice_research_jobs SET status='failed',finished_at=now() WHERE status='running' AND started_at<now()-interval '3 minutes'");
 await database.query('DELETE FROM origen_voice_research_jobs WHERE expires_at<now()');
 const job=(await database.query("UPDATE origen_voice_research_jobs SET status='running',started_at=now() WHERE id=(SELECT id FROM origen_voice_research_jobs WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,input,session_id,created_at,started_at")).rows[0];
 if(!job)return false;
 const measurementRun=randomBytes(16).toString('hex');
 const keys=researchTraceKeys(job.session_id,job.id),trace=createResearchTraceWriter(database,{sessionId:job.session_id,jobId:job.id,log,env});
 const write=event=>{try{log({...event,...keys});}catch{/* Diagnostics cannot change research results. */}};
 const record=(stage,data={})=>{trace.record(stage,{...data,component:'research_worker',measurementRun});write({event:'voice.research.lifecycle',researchStage:stage,...data});};
 record('claimed',{queueMs:Math.max(0,Date.parse(job.started_at)-Date.parse(job.created_at)),language:job.input.language,mode:job.input.mode});
 const started=now(),attempts=[];let publishedResult;
 const controller=new AbortController();
 // Every pass shares this deadline and cancellation. A recovery never buys
 // another 90 seconds or repeats the durable job.
 const jobSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000),...(signal?[signal]:[])]);
 let checking=false;
 const watch=setInterval(()=>{if(checking)return;checking=true;void database.query('SELECT status FROM origen_voice_research_jobs WHERE id=$1',[job.id]).then(r=>{if(r.rows[0]?.status!=='running')controller.abort();}).catch(()=>controller.abort()).finally(()=>{checking=false;});},1000);
 try{
  const finance=['finance','loans'].includes(job.input.mode);
  // Legacy campus-specific jobs cannot silently acquire a different meaning.
  if(job.input.comparisonOfficialUrl)throw Error('legacy_comparison_plan_unsupported');
  const comparison=Boolean(job.input.comparisonPlan);
  const task=job.input.researchTask?.version===1?job.input.researchTask:createResearchTask(job.input);
  const lookupEntities=researchTaskEntities(job.input.lookupInstitutions?.length?job.input.lookupInstitutions:job.input.institution);
  const lookupTask={...task,entities:lookupEntities.length?lookupEntities:task.entities};
  const withCoverage=result=>({...result,researchTask:task,requestCoverage:auditResearchTask(task,result)});
  const initialBase=finance?financeResearchRequest(env,job.input):admissionsResearchRequest(env,job.input);
  const base=comparison||job.input.comparisonAddition?initialBase:reuseResearchRequest(initialBase,job.input);
  const body=comparison?comparisonResearchRequest(base,job.input):env.ORIGEN_RESEARCH_BRIEFS==='false'?base:researchBriefRequest(base,lookupTask);
  if(!comparison)body.max_tool_calls=2;
  let latestData;const usage={inputTokens:0,outputTokens:0};
  async function run(requestBody,pass){
   const passStarted=now(),attemptId=randomUUID();let data,httpStatus,passOutcome,providerRequestId,networkFailure,failureStage='request';
   const configurationHash=createHash('sha256').update(JSON.stringify({model:requestBody.model,reasoning:requestBody.reasoning,max_output_tokens:requestBody.max_output_tokens,max_tool_calls:requestBody.max_tool_calls,tools:requestBody.tools,text:requestBody.text})).digest('hex');
   const attemptConfig={configurationHash,requestedModel:requestBody.model,maxOutputTokens:requestBody.max_output_tokens,maxToolCalls:requestBody.max_tool_calls,reasoningEffort:requestBody.reasoning?.effort};
   record('attempt_started',{pass,attemptId,...attemptConfig});
   try{
    jobSignal.throwIfAborted();
    const response=await request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json','X-Client-Request-Id':attemptId},body:JSON.stringify(requestBody),signal:jobSignal});
    httpStatus=response.status;providerRequestId=response.headers?.get('x-request-id');failureStage='http';if(!response.ok)throw new Error('research_failed');
    failureStage='body';
    data=await response.json();latestData=data;usage.inputTokens+=data.usage?.input_tokens||0;usage.outputTokens+=data.usage?.output_tokens||0;
    failureStage='validation';
    const parsed=comparison?parseComparisonResearch(data,job.input,now):mergeReusedResearchSources((finance?parseFinanceResearch:parseAdmissionsResearch)(data,job.input.institution,job.input)||parseReusedOnlyResearch(data,job.input)||parseUnverifiedResearch(data),job.input);
    const parsedBrief=comparison||env.ORIGEN_RESEARCH_BRIEFS==='false'?parsed:parseResearchBrief(parsed,job.input.language);
    // The comparison parser alone owns changed/retained evidence. Merging the
    // ordinary cache again could restore a fact invalidated by this update.
    const result=parsedBrief?(comparison?parsedBrief:job.input.comparisonAddition?mergeComparisonAddition(parsedBrief,job.input):retainVerifiedResearch(parsedBrief,job.input)):null;
    if(!result)throw new Error('sources_unverified');
    attempts.push(researchAttemptDiagnostics(data,{pass,outcome:'completed',durationMs:now()-passStarted,httpStatus}));
    passOutcome='completed';return reconcileResearchFindings(result);
   }catch(error){networkFailure=['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error?.cause?.code)?error.cause.code:undefined;attempts.push(researchAttemptDiagnostics(data,{pass,outcome:jobSignal.aborted?'aborted':'failed',durationMs:now()-passStarted,httpStatus}));throw error;}
   finally{
    const measurement={...responseMeasurement(data,httpStatus),...(passOutcome!=='completed'&&responseMeasurement(data,httpStatus).failureKind==='none'?{failureKind:'invalid_output'}:{})};
    if(jobSignal.aborted)measurement.failureKind='unknown';
    record('attempt_finished',{pass,attemptId,...attemptConfig,providerModel:data?.model,networkFailure,stopReason:jobSignal.aborted?(signal?.aborted?'shutdown':jobSignal.reason?.name==='TimeoutError'?'deadline':'job_state_changed'):undefined,outcome:passOutcome==='completed'?'completed':'failed',durationMs:now()-passStarted,...measurement,providerRequestId,providerResponseId:data?.id,providerStatus:data?.status,incompleteReason:data?.incomplete_details?.reason,failureStage:passOutcome==='completed'?undefined:jobSignal.aborted?'aborted':failureStage,actions:attempts.at(-1)?.actions});
    write({event:'voice.live.measurement',measurementRun,configurationHash,measurementStage:'research_attempt',durationMs:now()-passStarted,...measurement});
   }
  }
  // A new wording can be entirely covered by a server-selected prior result.
  // Reuse it without forcing a web call merely because this job was queued.
  let catalogResult;
  if(finance&&!comparison&&lookupCatalog){
   const lookupStarted=now();
   let catalogReason;
   try{catalogResult=await lookupCatalog(job.input,{observe:event=>{catalogReason=event.reason;}});}catch{catalogReason='catalog_error';}
   record('catalog_checked',{outcome:catalogResult?'completed':'deferred',catalogReason,durationMs:now()-lookupStarted,sourceCount:catalogResult?.sources?.length||0});
  }
  let result=withCoverage(catalogResult||(!comparison&&cachedResearchForCoverage(job.input,job.input))||await run(body,'initial'));
  record('reuse_selected',{reusedCount:comparison?job.input.comparisonPlan.retained.length:job.input.reusedEvidence?.length||0,
   lookupCount:comparison?1:job.input.lookupInstitutions?.length||0,retainedFindingCount:result.retainedFindingCount||0});
  // A new campus can fail even though its retained neighbor is verified.
  // Recover that campus's missing requested facts without reopening old work.
  const recoveryEvidence=job.input.comparisonAddition?{...result,voiceBrief:{...result.voiceBrief,
   findings:(result.voiceBrief?.findings||[]).filter(f=>findingSubjectMentioned(f.subject,job.input.institution,{exact:true})),
  }}:result;
  const plan=env.ORIGEN_RESEARCH_BRIEFS==='false'||comparison||catalogResult?null:researchRecoveryPlan(recoveryEvidence,{...job.input,researchTask:lookupTask});
  record('recovery_decided',{recoveryStatus:plan?'unresolved':'not_needed',unverifiedCount:plan?.gaps.length||0,recoveryGapCount:plan?.gaps.length||0,requestStatus:result.requestCoverage.status,requestedFactCount:task.requirements.length*Math.max(1,task.entities.length),missingFactCount:result.requestCoverage.missing.length});
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
    jobSignal.throwIfAborted();
    // The initial pass is a complete checked response, not streaming JSON or
    // speculative tokens. Publish useful cited findings before optional work.
    if((researchBriefSelection(result).findings||[]).some(f=>f.status!=='unverified'&&f.sourceIds.length)){
     const initial={...result,evidenceVersion:1,researchPending:true,researchDiagnostics:{recoveryStatus:'running',attempts:[...attempts]}};
     const published=await database.query("UPDATE origen_voice_research_jobs SET result=$2 WHERE id=$1 AND status='running' AND expires_at>now()",[job.id,initial]);
     if(published.rowCount===0){controller.abort();jobSignal.throwIfAborted();}
     publishedResult=initial;
     record('initial_published',{evidenceVersion:1,durationMs:now()-started,sourceCount:initial.sources.length,requestStatus:initial.requestCoverage.status,missingFactCount:initial.requestCoverage.missing.length});
     write({event:'voice.research.initial_ready',outcome:'completed',durationMs:now()-started,sourceCount:initial.sources.length});
    }
    const recovered=await run(recoveryResearchRequest(body,{...recoveryEvidence,researchDiagnostics:{attempts:[...attempts]}},plan),'recovery');
    const merged=mergeRecoveryResearch(result,recovered,job.input.language,plan);
    if(merged!==result){result=merged;recoveryStatus=researchRecoveryOutcome(result,plan);}
   }catch{recoveryStatus=jobSignal.aborted?'aborted':'failed';}
  }else if(plan)recoveryStatus='deadline';
  // A cancelled/shutdown job must not publish even an earlier partial answer.
  if(controller.signal.aborted||signal?.aborted)throw new Error('cancelled');
  result={...withCoverage(result),evidenceVersion:publishedResult?2:1,researchPending:false,researchDiagnostics:{recoveryStatus,attempts,answerStatus:auditResearchTask(task,result).status}};
  const saved=await database.query("UPDATE origen_voice_research_jobs SET status='completed',result=$2,finished_at=now() WHERE id=$1 AND status='running' AND expires_at>now()",[job.id,result]);
  if(saved.rowCount===0){record('publish_rejected',{outcome:'cancelled'});return true;}
  const findings=researchBriefSelection(result).findings||[];
  record('completed',{outcome:'completed',durationMs:now()-started,evidenceVersion:result.evidenceVersion,recoveryStatus,sourceCount:result.sources.length,verifiedCount:findings.filter(f=>f.status==='verified').length,partialCount:findings.filter(f=>f.status==='partial').length,unverifiedCount:findings.filter(f=>f.status==='unverified').length,retainedFindingCount:result.retainedFindingCount||0,requestStatus:result.requestCoverage.status,requestedFactCount:task.requirements.length*Math.max(1,task.entities.length),missingFactCount:result.requestCoverage.missing.length,conflictCount:result.researchConflicts?.length||0,...usage});
  write({event:'voice.research.finished',outcome:'completed',durationMs:now()-started,sourceCount:result.sources.length,model:latestData?.model,...usage});
 }catch{
  // Preserve facts already published if recovery is interrupted. Cancellation
  // still wins through the durable status predicate and clears its own result.
  const retained=publishedResult?{...publishedResult,evidenceVersion:2,researchPending:false,researchDiagnostics:{recoveryStatus:jobSignal.aborted?'aborted':'failed',attempts}}:{researchDiagnostics:{recoveryStatus:jobSignal.aborted?'aborted':'failed',attempts}};
  record('failed',{outcome:'failed',durationMs:now()-started,recoveryStatus:jobSignal.aborted?'aborted':'failed'});
  write({event:'voice.research.finished',outcome:'failed',durationMs:now()-started,sourceCount:0});
  try{await database.query("UPDATE origen_voice_research_jobs SET status='failed',result=$2,finished_at=now() WHERE id=$1 AND status='running'",[job.id,retained]);}
  catch(error){record('failed',{outcome:'failed',failureStage:'persistence',durationMs:now()-started});throw error;}
 }
 finally{clearInterval(watch);await trace.close();}
 return true;
}
