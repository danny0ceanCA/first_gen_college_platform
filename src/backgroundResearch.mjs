// One scope-bound job per physical voice session. New spoken turns do not cancel it.
export function backgroundResearch({post,read,remove,isCurrent,isQuiet,deliver,onState=()=>{},onRequest=()=>{},schedule=setTimeout,cancel=clearTimeout,now=Date.now}){
 let active=null,closed=false;
 let requestSequence=0;
 const state=(job,status)=>{job.state=status;onRequest({requestId:job.requestId,jobId:job.id,state:status,question:job.question,institution:job.input.institution||'',studentId:job.input.studentId??null,language:job.input.language,mode:job.input.mode,elapsedMs:now()-job.started});};
 const stop=()=>{const job=active;active=null;if(job){cancel(job.timer);if(job.id)void remove(job.id).catch(()=>{});state(job,'cancelled');}onState(false);};
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
     if(result.status!=='cancelled')deliver({...result,id:job.id,question:job.question,query:job.input,durationMs:now()-job.started});
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
   if(active&&['mode','question','institution','language','studentId'].every(k=>active.input[k]===input[k])&&!input.forceRefresh)return active.id
    ? {status:'research_pending',jobId:active.id,instruction:'The same source check is already accepted. Continue the conversation; do not start it again.'}
    : {status:'research_requesting',instruction:'The same request is awaiting the application receipt. Do not claim research is running or send another request.'};
   stop();const job={input,requestId:input.requestKey||String(++requestSequence),started:now(),id:null,question:input.question,deadline:now()+110000,timer:null,result:null};active=job;onState(true);state(job,'requesting');
   try{
    const result=await post(input);job.id=result.id;
    if(closed||active!==job||!isCurrent(job.input)){if(job.id)void remove(job.id).catch(()=>{});return {status:'research_cancelled'};}
    if(!job.id)throw Error('research_receipt_missing');
    state(job,result.status==='running'?'running':'queued');
    job.timer=schedule(()=>void poll(job),750);
    return {status:'research_pending',jobId:job.id,instruction:'Official-source research is running in the background. Stay available to the caller. Briefly acknowledge it once; answer clarifications using known context, or ask one useful question if needed. Let the caller wait quietly if they prefer. Do not claim findings yet, repeat this lookup, or cancel it for ordinary conversation. Results will arrive separately. If the caller abandons this research, call cancel_background_research.'};
   }catch(error){if(active===job){active=null;cancel(job.timer);onState(false);state(job,'failed');}throw error;}
  },cancel:stop,close(){closed=true;stop();},
 };
}
