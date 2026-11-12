// One scope-bound job per physical voice session. New spoken turns do not cancel it.
export function backgroundResearch({post,read,remove,isCurrent,isQuiet,deliver,onState=()=>{},onRequest=()=>{},schedule=setTimeout,cancel=clearTimeout,now=Date.now,requireReplacementChange=false,progressive=false}){
 // Retain one terminal identity for this call. Finishing polling must not make
 // a later caller correction look like a stale revision. New work, explicit
 // cancellation and scope changes invalidate this bounded receipt.
 let active=null,settled=null,closed=false;
 let requestSequence=0;
 const state=(job,status)=>{job.state=status;onRequest({requestId:job.requestId,revision:job.revision,jobId:job.id,state:status,question:job.question,institution:job.input.institution||'',studentId:job.input.studentId??null,language:job.input.language,mode:job.input.mode,elapsedMs:now()-job.started,...(progressive||job.input.comparisonBaseJobId?{quietProgress:true}:{})});};
 // Stop local delivery immediately. Only the DELETE receipt confirms that the
 // server accepted cancellation; a lost response must not be called success.
 const stop=()=>{const job=active;active=null;settled=null;if(job){cancel(job.timer);state(job,'cancelled');}onState(false);
  return (async()=>{try{if(job?.id)await remove(job.id);else if(job)return {status:'research_cancellation_requested',instruction:'Local delivery stopped while enqueue was pending. Server cancellation is not yet confirmed; do not claim the worker stopped.'};return {status:'research_cancelled'};}catch{return {status:'research_cancellation_unconfirmed',instruction:'Local result delivery stopped, but server cancellation could not be confirmed. Do not claim the worker stopped.'};}})();};
 function receipt(job){
  const instruction=job.result
   ?'Silent receipt: reuse the saved findings with their caveats. Do not narrate task completion or repeat an answered figure. Its question and findings define what was checked; an unaddressed scenario is not researched here. A material correction may use this requestId/revision with replacementChange.'
   :job.id?'This source check is accepted. The receipt is silent. A prior “okay” or other acknowledgment counts for this lookup; do not say you are checking as part of its continuation. Answer substantive follow-ups directly. Share progress only if asked. Rephrasing and ordinary follow-ups reuse the same check. Only a material change requested by the caller replaces it: copy this requestId and revision into replaceRequestId and replaceRevision.'+(requireReplacementChange?' Compare the full accepted question first. Choosing or narrowing scenarios it already covers keeps this job; it does not invalidate its findings. Replacement also requires replacementChange identifying the specific corrected assumption or additional evidence that this question cannot answer.':'')
   :'The source-check request is awaiting its application receipt. Do not claim research is running or enqueue it again.';
  return {status:job.result?`research_${job.result.status}`:job.id?'research_pending':'research_requesting',...(job.id?{jobId:job.id}:{}),requestId:job.requestId,revision:job.revision,question:job.question,institution:job.input.institution||'',...(job.result?{researchPending:false}:{}),instruction};
 }
 const normalized=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const finishEvidence=job=>job.latestEvidence?{...job.latestEvidence,evidenceVersion:job.latestEvidence.evidenceVersion+1,researchPending:false,recoveryUnavailable:true}:undefined;
 const failed=job=>({status:'failed',...(progressive&&job.latestEvidence?{result:finishEvidence(job)}:{})});
 function replacementIssue(input,target){
  if(!requireReplacementChange)return null;
  if(normalized(input.question)===normalized(target.question)&&normalized(input.institution)===normalized(target.input.institution)&&input.mode===target.input.mode)return 'same_question';
  const change=input.replacementChange;
  if(change?.kind==='focus_existing')return 'already_covered';
  if(!['correct_scope','expand_scope'].includes(change?.kind)||typeof change.uncoveredNeed!=='string'||change.uncoveredNeed.trim().length<8||change.uncoveredNeed.length>500)return 'missing_change';
  // Semantic intent belongs to the backend, not a topic-keyword router. The
  // structured comparison makes it explicit; exact existing facets also cannot
  // be used as justification for throwing away an accepted search.
  if(normalized(target.question).includes(normalized(change.uncoveredNeed)))return 'already_covered';
  return null;
 }
 async function poll(job){
  if(closed||active!==job)return;
  if(!isCurrent(job.input)){stop();return;}
  if(now()>job.deadline&&!job.result){job.result=failed(job);if(job.id)void remove(job.id).catch(()=>{});}
  try{
   let result=job.result||await read(job.id);
   job.readFailures=0;
   if(closed||active!==job)return;
   if(!isCurrent(job.input)){stop();return;}
   if(progressive&&result.status==='running'&&result.result?.researchPending===true&&Number.isSafeInteger(result.result.evidenceVersion)&&result.result.evidenceVersion>0)job.latestEvidence=result.result;
   // A failed optional continuation cannot erase a finished pass. Normalize
   // crash/expiry records as a newer terminal context update, never new facts.
   if(progressive&&result.status==='failed'){
    if(result.result?.researchPending===true)job.latestEvidence=result.result;
    if(job.latestEvidence&&(!result.result?.evidenceVersion||result.result.researchPending===true))result={...result,result:finishEvidence(job)};
   }
   if(result.status!==job.state)state(job,result.status);
   if(progressive&&result.status==='running'&&result.result?.researchPending===true&&Number.isSafeInteger(result.result.evidenceVersion)&&result.result.evidenceVersion>0&&result.result.evidenceVersion>(job.deliveredVersion||0)&&isQuiet()){
    job.deliveredVersion=result.result.evidenceVersion;
    deliver({...result,id:job.id,requestId:job.requestId,revision:job.revision,question:job.question,query:job.input,durationMs:now()-job.started});
   }
   if(['completed','failed','cancelled'].includes(result.status)){
    job.result=result;
    if(isQuiet()){
     active=null;settled=result.status==='cancelled'?null:job;onState(false);
     if(result.status!=='cancelled')deliver({...result,id:job.id,requestId:job.requestId,revision:job.revision,question:job.question,query:job.input,durationMs:now()-job.started});
     return;
    }
   }
   job.timer=schedule(()=>void poll(job),750);
  }catch(error){if(!closed&&active===job){
   if(!isCurrent(job.input)){stop();return;}
   const terminal=[400,401,403,404,405,410].includes(error?.status);
   // A dropped response or temporary 5xx is not a failed research job.
   // Retry within the overall deadline without enqueueing another search.
   if(terminal||now()>=job.deadline){if(job.id)void remove(job.id).catch(()=>{});job.result=failed(job);}
   job.readFailures=(job.readFailures||0)+1;
   job.timer=schedule(()=>void poll(job),job.result?0:Math.min(8000,750*2**Math.min(job.readFailures,4)));
  }}
 }
 return {
  async start(input){
   if(closed)throw new Error('research_closed');
   if(active&&!isCurrent(active.input))void stop();
   if(settled&&!isCurrent(settled.input))settled=null;
   if(!isCurrent(input))return {status:'research_scope_changed'};
   const target=active||settled;
   if(target&&((target.input.studentId??null)!==(input.studentId??null)||target.input.sessionId!==input.sessionId))return {status:'research_scope_changed'};
   const replacing=input.replaceRequestId!==undefined||input.replaceRevision!==undefined;
   let requestId=input.requestKey||String(++requestSequence),revision=1;
   if(replacing){
    if(!target||input.replaceRequestId!==target.requestId||input.replaceRevision!==target.revision)return {...(target?{activeTask:receipt(target)}:{}),status:'research_request_changed',replacementApplied:false,searchStarted:false,instruction:'The replacement refers to an outdated research revision and was not applied. This attempted correction ran no search; it is not evidence that the requested information is unavailable. The current task may already cover it: compare that receipt and its findings. Do not repeat old arguments or start an automatic retry.'};
    const issue=replacementIssue(input,target);
    if(issue)return {...receipt(target),replacementApplied:false,searchStarted:false,reuseReason:issue,instruction:receipt(target).instruction+' The existing check was preserved. Use its available or forthcoming findings for the covered focus. No search for a changed scope was started. Do not automatically resubmit a replacement; only genuinely missing evidence or a corrected assumption warrants a new search.'};
    requestId=target.requestId;revision=target.revision+1;if(active)void stop();
   }else if(active){
    // Never infer a replacement from wording, topic, language, or forceRefresh.
    // The backend expresses semantic changes through the explicit revision.
    return receipt(active);
   }
   else if(settled&&input.requestKey&&input.requestKey===settled.input.requestKey)return receipt(settled);
   settled=null;
   const {replaceRequestId,replaceRevision,replacementChange,...query}=input;
   const job={input:query,requestId,revision,started:now(),id:null,question:input.question,deadline:now()+110000,timer:null,result:null};active=job;onState(true);state(job,'requesting');
   try{
    const result=await post(query);job.id=result.id;
    if(closed||active!==job||!isCurrent(job.input)){try{if(job.id)await remove(job.id);return {status:'research_cancelled',requestId:job.requestId,revision:job.revision};}catch{return {status:'research_cancellation_unconfirmed',requestId:job.requestId,revision:job.revision};}}
    if(!job.id)throw Error('research_receipt_missing');
    state(job,result.status==='running'?'running':'queued');
    job.timer=schedule(()=>void poll(job),750);
    return {...receipt(job),instruction:receipt(job).instruction+' Keep helping with the latest concern while sources are checked. Explain the useful concept or distinction already supported by known context now; only source-dependent facts must wait. If a missing preference would help the next decision, ask one relevant unanswered question, then listen and carry the answer forward. An explanation can be enough; do not re-ask an answered question, fill silence with a questionnaire, or make another waiting announcement. Results arrive separately; do not invent findings or an ETA.'};
   }catch(error){if(active!==job||closed)return {status:'research_cancelled',requestId:job.requestId,revision:job.revision};active=null;cancel(job.timer);onState(false);state(job,'failed');throw error;}
  },cancel:stop,close(){closed=true;void stop();},
 };
}
