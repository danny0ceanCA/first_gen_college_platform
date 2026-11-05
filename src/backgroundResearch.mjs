// One scope-bound job per physical voice session. New spoken turns do not cancel it.
export function backgroundResearch({post,read,remove,isCurrent,isQuiet,deliver,onState=()=>{},onRequest=()=>{},schedule=setTimeout,cancel=clearTimeout,now=Date.now,requireReplacementChange=false,progressive=false}){
 let active=null,closed=false;
 let requestSequence=0;
 const state=(job,status)=>{job.state=status;onRequest({requestId:job.requestId,revision:job.revision,jobId:job.id,state:status,question:job.question,institution:job.input.institution||'',studentId:job.input.studentId??null,language:job.input.language,mode:job.input.mode,elapsedMs:now()-job.started});};
 // Stop local delivery immediately. Only the DELETE receipt confirms that the
 // server accepted cancellation; a lost response must not be called success.
 const stop=()=>{const job=active;active=null;if(job){cancel(job.timer);state(job,'cancelled');}onState(false);
  return (async()=>{try{if(job?.id)await remove(job.id);else if(job)return {status:'research_cancellation_requested',instruction:'Local delivery stopped while enqueue was pending. Server cancellation is not yet confirmed; do not claim the worker stopped.'};return {status:'research_cancelled'};}catch{return {status:'research_cancellation_unconfirmed',instruction:'Local result delivery stopped, but server cancellation could not be confirmed. Do not claim the worker stopped.'};}})();};
 const receipt=job=>({status:job.id?'research_pending':'research_requesting',...(job.id?{jobId:job.id}:{}),requestId:job.requestId,revision:job.revision,question:job.question,institution:job.input.institution||'',
  instruction:job.id?'This source check is already accepted. Continue the conversation without another lookup or progress announcement. Rephrasing and ordinary follow-ups reuse it. Only a material change requested by the caller replaces it: copy this requestId and revision into replaceRequestId and replaceRevision.'+(requireReplacementChange?' Compare the full accepted question first. Choosing or narrowing scenarios it already covers keeps this job; it does not invalidate its findings. Replacement also requires replacementChange identifying the specific corrected assumption or additional evidence that this question cannot answer.':''):'The source-check request is awaiting its application receipt. Do not claim research is running or enqueue it again.'});
 const normalized=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const finishEvidence=job=>job.latestEvidence?{...job.latestEvidence,evidenceVersion:job.latestEvidence.evidenceVersion+1,researchPending:false,recoveryUnavailable:true}:undefined;
 const failed=job=>({status:'failed',...(progressive&&job.latestEvidence?{result:finishEvidence(job)}:{})});
 function replacementIssue(input){
  if(!requireReplacementChange)return null;
  if(normalized(input.question)===normalized(active.question)&&normalized(input.institution)===normalized(active.input.institution)&&input.mode===active.input.mode)return 'same_question';
  const change=input.replacementChange;
  if(change?.kind==='focus_existing')return 'already_covered';
  if(!['correct_scope','expand_scope'].includes(change?.kind)||typeof change.uncoveredNeed!=='string'||change.uncoveredNeed.trim().length<8||change.uncoveredNeed.length>500)return 'missing_change';
  // Semantic intent belongs to the backend, not a topic-keyword router. The
  // structured comparison makes it explicit; exact existing facets also cannot
  // be used as justification for throwing away an accepted search.
  if(normalized(active.question).includes(normalized(change.uncoveredNeed)))return 'already_covered';
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
     active=null;onState(false);
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
   if(!isCurrent(input))return {status:'research_scope_changed'};
   if(active&&((active.input.studentId??null)!==(input.studentId??null)||active.input.sessionId!==input.sessionId))return {status:'research_scope_changed'};
   const replacing=input.replaceRequestId!==undefined||input.replaceRevision!==undefined;
   let requestId=input.requestKey||String(++requestSequence),revision=1;
   if(replacing){
    if(!active||input.replaceRequestId!==active.requestId||input.replaceRevision!==active.revision)return {...(active?{activeTask:receipt(active)}:{}),status:'research_request_changed',instruction:'The replacement refers to an outdated research revision and was not applied. Use the current task receipt; do not repeat old arguments or start an automatic retry.'};
    const issue=replacementIssue(input);
    if(issue)return {...receipt(active),replacementApplied:false,reuseReason:issue,instruction:receipt(active).instruction+' The existing job was preserved. Use its forthcoming findings for the requested focus. Do not automatically resubmit a replacement; only genuinely missing evidence or a corrected assumption warrants a new search.'};
    requestId=active.requestId;revision=active.revision+1;void stop();
   }else if(active){
    // Never infer a replacement from wording, topic, language, or forceRefresh.
    // The backend expresses semantic changes through the explicit revision.
    return receipt(active);
   }
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
