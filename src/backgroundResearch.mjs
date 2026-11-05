// One scope-bound job per physical voice session. New spoken turns do not cancel it.
export function backgroundResearch({post,read,remove,isCurrent,isQuiet,deliver,onState=()=>{},onRequest=()=>{},schedule=setTimeout,cancel=clearTimeout,now=Date.now}){
 let active=null,closed=false;
 let requestSequence=0;
 const state=(job,status)=>{job.state=status;onRequest({requestId:job.requestId,revision:job.revision,jobId:job.id,state:status,question:job.question,institution:job.input.institution||'',studentId:job.input.studentId??null,language:job.input.language,mode:job.input.mode,elapsedMs:now()-job.started});};
 // Stop local delivery immediately. Only the DELETE receipt confirms that the
 // server accepted cancellation; a lost response must not be called success.
 const stop=()=>{const job=active;active=null;if(job){cancel(job.timer);state(job,'cancelled');}onState(false);
  return (async()=>{try{if(job?.id)await remove(job.id);else if(job)return {status:'research_cancellation_requested',instruction:'Local delivery stopped while enqueue was pending. Server cancellation is not yet confirmed; do not claim the worker stopped.'};return {status:'research_cancelled'};}catch{return {status:'research_cancellation_unconfirmed',instruction:'Local result delivery stopped, but server cancellation could not be confirmed. Do not claim the worker stopped.'};}})();};
 const receipt=job=>({status:job.id?'research_pending':'research_requesting',...(job.id?{jobId:job.id}:{}),requestId:job.requestId,revision:job.revision,question:job.question,institution:job.input.institution||'',
  instruction:job.id?'This source check is already accepted. Continue the conversation without another lookup or progress announcement. Rephrasing and ordinary follow-ups reuse it. Only a material change requested by the caller replaces it: copy this requestId and revision into replaceRequestId and replaceRevision.':'The source-check request is awaiting its application receipt. Do not claim research is running or enqueue it again.'});
 async function poll(job){
  if(closed||active!==job)return;
  if(!isCurrent(job.input)){stop();return;}
  if(now()>job.deadline&&!job.result){job.result={status:'failed'};if(job.id)void remove(job.id).catch(()=>{});}
  try{
   const result=job.result||await read(job.id);
   job.readFailures=0;
   if(closed||active!==job)return;
   if(!isCurrent(job.input)){stop();return;}
   if(result.status!==job.state)state(job,result.status);
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
   if(terminal||now()>=job.deadline){if(job.id)void remove(job.id).catch(()=>{});job.result={status:'failed'};}
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
    requestId=active.requestId;revision=active.revision+1;void stop();
   }else if(active){
    // Never infer a replacement from wording, topic, language, or forceRefresh.
    // The backend expresses semantic changes through the explicit revision.
    return receipt(active);
   }
   const {replaceRequestId,replaceRevision,...query}=input;
   const job={input:query,requestId,revision,started:now(),id:null,question:input.question,deadline:now()+110000,timer:null,result:null};active=job;onState(true);state(job,'requesting');
   try{
    const result=await post(query);job.id=result.id;
    if(closed||active!==job||!isCurrent(job.input)){try{if(job.id)await remove(job.id);return {status:'research_cancelled',requestId:job.requestId,revision:job.revision};}catch{return {status:'research_cancellation_unconfirmed',requestId:job.requestId,revision:job.revision};}}
    if(!job.id)throw Error('research_receipt_missing');
    state(job,result.status==='running'?'running':'queued');
    job.timer=schedule(()=>void poll(job),750);
    return {...receipt(job),instruction:receipt(job).instruction+' Acknowledge once if useful, then respond to the caller normally from known context or listen. Results arrive separately; do not invent findings or an ETA.'};
   }catch(error){if(active!==job||closed)return {status:'research_cancelled',requestId:job.requestId,revision:job.revision};active=null;cancel(job.timer);onState(false);state(job,'failed');throw error;}
  },cancel:stop,close(){closed=true;void stop();},
 };
}
