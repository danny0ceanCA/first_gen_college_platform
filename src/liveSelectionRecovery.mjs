// A single safety net for an initial spoken scope choice. This only wakes the
// existing managed backend: it never chooses a student or authorizes context.
export const selectionRecoveryDelayMs=1200;
export const selectionRecoveryStartDeadlineMs=6000;
const words=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
function candidate(text,names){
 const value=words(text).join(' '),padded=` ${value} `;
 const aliases=[...new Set(names.flatMap(name=>{const parts=words(name);return parts.length?[parts.join(' '),parts[0]]:[];}))];
 const namesMentioned=aliases.some(name=>padded.includes(` ${name} `));
 const family=/^(?:college in general|general family questions|general questions|in general|college generally|universidad en general|la universidad en general|en general|preguntas generales|preguntas de la familia)$/u.test(value);
 if(!namesMentioned&&!family)return null;
 // This distinguishes a name-only choice from a choice plus a question solely
 // for recap scheduling. The backend still interprets the complete request.
 const selection=value.replace(/^(?:about|for|it s about|let s talk about|hablemos de|sobre|es sobre|para) /u,'').replace(/ (?:please|por favor)$/u,'');
 return {onlySelection:family||aliases.includes(selection)};
}
export function liveSelectionRecovery({send,emit,id,now,schedule=setTimeout,cancel=clearTimeout,getState}){
 let waiting=null,attempt=null,used=false,selectionStarted=false,assistantText='',ignoreEarlierClause=false,earlierClause='';
 const eligible=()=>{const s=getState();return s.started&&!s.closed&&!s.ending&&!s.session.onboarding&&
  s.session.selectionRecovery?.pending===true&&s.session.liveContext?.scope?.confirmed!==true&&
  s.session.tools?.some(tool=>tool.name==='request_conversation_target');};
 const log=(job,stage,reason,extra={})=>emit({type:'origen.selection.recovery',recoveryId:job.id,item_id:job.itemId,
  eventId:job.eventId,response_id:job.responseId,stage,...(reason?{reason}:{}),durationMs:Math.max(0,now()-job.at),...extra});
 function suppress(reason){if(!waiting)return;cancel(waiting.timer);log(waiting,'suppressed',reason);waiting=null;}
 function observed(job){cancel(job.timer);job.timer=null;}
 function aliasOutput(callId){
  const first=attempt.result;
  const result=attempt.superseded?{status:'target_update_failed',instruction:'This earlier selection was superseded by a newer scope configuration. Keep the current authorized context and latest caller request. Do not reopen the earlier selection, replay its brief, ask for the name again, or announce this internal update.'}:first.status==='target_confirmed'?{
   status:'target_confirmed',selectionDelivery:{mode:'already_delivered',callId,originalCallId:attempt.callId},
   instruction:'This is a duplicate of the same initial selection, already completed by the original callId. Its original selection receipt owns the conversation continuation and recap decision. Use that authorized context and the latest caller question. Do not acknowledge the choice again, repeat a recap, add an invitation, or restart selection.'
  }:first;
  send({type:'response.item.create',event_id:id(),item:{type:'function_call_output',call_id:callId,output:JSON.stringify(result)}});
 }
 return {
  input({newTurn=false,assistantContinuation=false}={}){
   suppress('new_input');
   if(newTurn){assistantText='';ignoreEarlierClause=assistantContinuation;earlierClause='';}
  },
  settled({transcript,itemId,epoch}){
   if(!eligible()||used||selectionStarted)return;
   const state=getState();
   if(state.busy||state.inputPending||state.epoch!==epoch||state.lastDelegatedEpoch===epoch)return;
   const choice=candidate(transcript,state.session.selectionRecovery.names||[]);if(!choice)return;
   suppress('new_input');
   const job={id:id(),itemId,epoch,at:now(),callerText:choice.onlySelection?'':transcript};waiting=job;
   log(job,'scheduled');
   job.timer=schedule(()=>{
    if(waiting!==job)return;
    const current=getState();
    if(!eligible()||current.busy||current.inputPending||current.epoch!==job.epoch||current.lastDelegatedEpoch===job.epoch){
     suppress(current.epoch!==job.epoch||current.inputPending?'new_input':current.lastDelegatedEpoch===job.epoch?'native_delegation':'unavailable');return;
    }
    waiting=null;used=true;attempt=job;job.eventId=id();job.assistantText=assistantText;
    log(job,'requested');
    // Live supplies its conversation to the configured Responses backend. No
    // replayed transcript, force-tool setting, voice append, or audio command.
    try{send({type:'response.create',event_id:job.eventId});}catch{log(job,'unconfirmed','provider_error');return;}
    job.timer=schedule(()=>{job.timer=null;if(!job.responseId)log(job,'unconfirmed','backend_not_observed');},selectionRecoveryStartDeadlineMs);
   },selectionRecoveryDelayMs);
  },
  assistant(delta){
   if(used||!eligible())return;
   // The caller can answer before the old scope question finishes. Exclude
   // that already-started clause; keep the new acknowledgment even when it
   // arrives before the transcript quiet window. This is delivery evidence,
   // never proof of a completed turn or permission to select a student.
   if(ignoreEarlierClause){
    earlierClause=(earlierClause+delta).slice(-800);const end=earlierClause.search(/[.!?。！？]/u);if(end<0)return;
    // The old question may have stopped completely. Do not discard a new,
    // unmistakable short acknowledgment in its place (including split deltas).
    const acknowledgment=/^(?:of course|sure|okay|ok|got it|claro|por supuesto|de acuerdo)[.!。！]$/iu.test(earlierClause.slice(0,end+1).trim());
    delta=acknowledgment?earlierClause:earlierClause.slice(end+1);ignoreEarlierClause=false;earlierClause='';
   }
   assistantText=(assistantText+delta).slice(-800);
  },
  delegated(){suppress('native_delegation');},
  backendStarted(responseId,epoch){
   suppress('native_delegation');
   if(!attempt||attempt.responseId||attempt.epoch!==epoch)return '';
   observed(attempt);attempt.responseId=responseId;log(attempt,'backend_started');
   return attempt.assistantText;
  },
  selectionDispatched(callId,responseId,scope,epoch){
   selectionStarted=true;suppress('native_delegation');
   if(!attempt||attempt.epoch!==epoch)return {callerText:''};
   // A native delegation can race the single recovery request. Coalesce only
   // this same initial choice in the same input epoch. Every provider call_id
   // still gets a result; the existing handler authorizes just one selection.
   if(attempt.callId&&scope&&attempt.scope===scope&&callId!==attempt.callId){
    if(attempt.result)aliasOutput(callId);
    else (attempt.aliases??=new Set()).add(callId);
    log(attempt,'suppressed','native_delegation');
    return {duplicate:true,ready:!!attempt.result};
   }
   if(attempt.callId)return {callerText:''};
   attempt.callId=callId;attempt.scope=scope;attempt.responseId=responseId;
   log(attempt,'selection_dispatched');return {callerText:attempt.callerText,assistantText:attempt.assistantText};
  },
  complete(item){
   if(!attempt||attempt.callId!==item.call_id)return;
   let result;try{result=JSON.parse(item.output);}catch{}
   const status=result?.status;
   attempt.result=result&&typeof result==='object'?result:{status:'target_update_failed',instruction:'The original selection result could not be read. Do not claim the student context is ready or retry automatically.'};
   for(const callId of attempt.aliases||[])aliasOutput(callId);
   attempt.aliases?.clear();
   log(attempt,'selection_completed',['target_confirmed','target_update_failed'].includes(status)?status:'target_unconfirmed');
  },
  configuration(value,previous){
   suppress('configuration_changed');
   const scope=value?.scope;if(!attempt?.scope||!scope||attempt.superseded)return;
   // Language-only updates may carry the full, still-unconfirmed prior scope.
   // They do not revoke a selection whose authorized load is in progress.
   if(previous?.scope?.confirmed===scope.confirmed&&previous.scope.studentId===scope.studentId)return;
   const target=scope.studentId===null?'family':`student:${scope.studentId}`;
   if(!scope.confirmed||target!==attempt.scope){attempt.superseded=true;log(attempt,'suppressed','configuration_changed');}
  },
  error(eventId){if(attempt?.eventId===eventId){observed(attempt);log(attempt,'unconfirmed','provider_error');}},
  close(){suppress('call_ended');if(attempt?.timer){observed(attempt);log(attempt,'unconfirmed','call_ended');}},
 };
}
