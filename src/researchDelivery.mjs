import {researchContextPackets,selectedResearchContextFindings} from './liveResearchContext.mjs';
import {researchBriefSelection} from './researchBrief.mjs';
import {researchAnswerOverlap,researchLimitationOverlap,researchPortionObserved,researchScopeCompatible} from './researchDiscussion.mjs';
import {focusedResearchFindings,findingSubjectMentioned} from './researchFindings.mjs';
import {requestedResearchAspects} from './researchQuestion.mjs';
export {researchAnswerOverlap} from './researchDiscussion.mjs';

// A delivery opportunity is separate from a completed job. This controller never
// starts research, cancels speech, requests a backend response, or changes scope.
// Transcript overlap is conservative duplicate suppression, NOT a semantic
// grader or proof the listener heard/understood the answer.
const words=text=>String(text||'').replace(/\[\d+\]/gu,'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const evidenceText=text=>words(text).join(' ');
function topicSwitch(text){
 const request=evidenceText(text).replace(/^(?:(?:actually|okay|ok|well|bueno|bien|mejor|en realidad|ahora) )+/u,'');
 return /^(?:different question|new topic|(?:(?:let s|can we|could we|i want to|i d like to) )?(?:switch|change) (?:topics?|the (?:topic|subject))|changing topics|otra pregunta|otro tema|cambiando de tema|(?:podemos |quiero |quisiera )?cambiar de tema|cambiemos de tema|pasemos a otro tema)\b/u.test(request);
}
const sameFinding=(a,b)=>a.aspect===b.aspect&&(a.status==='unverified')===(b.status==='unverified')&&['subject','answer','qualification'].every(key=>evidenceText(a[key])===evidenceText(b[key]));
// Speech dedup tolerates paraphrases and citation renumbering. Transport reuse
// must also preserve exact status and provenance for later answers/citations.
const sameContextFinding=(a,b)=>['subject','aspect','status','answer','qualification','sourceIds','contextSources']
 .every(key=>JSON.stringify(a[key])===JSON.stringify(b[key]));
// A housing choice can narrow an existing total-budget question. It does not
// silently replace that question with a rent-only request. Explicit requests
// for the housing component still select only that component.
function housingScenario(text){
 const value=evidenceText(text);
 return /\b(?:off campus|on campus|with (?:his |her |their |my )?parents|fuera del campus|en el campus|con (?:sus |mis )?padres)\b/u.test(value)&&
  !/\b(?:rent|rental|alquiler|just|only|solo|solamente|housing cost|cost of housing|costo de (?:la )?vivienda|costo del alojamiento)\b/u.test(value);
}
// A campus/program mention in a reflection is not a replacement request. This
// only selects evidence for an optional update; Live still answers every turn.
function requestsSubject(text,findings=[]){
 const value=evidenceText(text).replace(/^(?:(?:i see|okay|ok|thanks|entiendo|gracias|vale|ah|oh)\s+)*/u,'');
 const bare=value.replace(/^(?:please|por favor)\s+|\s+(?:please|por favor)$/gu,'');
 const continuation=bare.replace(/^(?:(?:and|y|then|entonces|instead|mejor|actually|ahora|but|pero)\s+)+/u,'');
 const correction=/^\s*no\s*[,;:]\s*/iu.test(text)?evidenceText(String(text).replace(/^\s*no\s*[,;:]\s*/iu,'')):'';
 if(findings.some(f=>[bare,continuation,correction].some(candidate=>findingSubjectMentioned(f.subject,candidate,{exact:true}))))return true;
 return /^(?:(?:but|and|so|actually|instead|then|please|pero|y|entonces|mejor|ahora|por favor)\s+)*(?:what|which|how|when|where|why|can (?:you|we)|could (?:you|we)|would you|tell me|show me|explain|compare|check|look up|i want|i would like|i d like|i mean|just|only|que|cual|cuales|como|cuando|donde|por que|puedes|podrias|podemos|dime|dinos|explica|explicame|muestra|muestrame|compara|revisa|busca|quiero|quisiera|me gustaria|me refiero|solo|solamente)\b/u.test(value);
}
function primaryQuestion(question){
 // A backend may prepend comparison context before the actual question. That
 // context is not a caller request to announce every comparison's outcome.
 // Explicit "Compare A and B" requests still keep both subjects.
 return String(question||'')
  .replace(/^(?:for comparison with|compared (?:with|to)|en comparaci[oó]n con|comparado con)\b[\s\S]*?[,;:]\s*(?=¿?(?:what|which|how|when|where|find|show|cu[aá]l|cu[aá]les|cu[aá]nto|qu[eé]|busca|muestra)\b)/iu,'')
  .split(/[.;]\s*(?:compare\b|comparison\b|compara\b|comparar\b|comparaci[oó]n\b)/iu)[0];
}
const firstFinding=(job,remaining)=>[...remaining].sort((a,b)=>(job.researchPending?-1:1)*(Number(b.status==='unverified')-Number(a.status==='unverified')))[0];
function commentaryContent(job,remaining){
 const state=job.failed?'The source check failed. No verified findings are available.':job.researchPending?'Initial sourced findings; recovery is running.':'Completed research; this check has ended. Do not say still checking.';
 const limitations=!job.researchPending&&remaining.some(f=>f.status==='unverified');
 const direction=limitations?' Explain the requested gap, then useful verified context. Yield to the caller.':
  ' Answer with all supplied conditions. State each caveat once or refer back to it. Yield to the caller.';
 const first=firstFinding(job,remaining);
 // Prefer the complete focused finding, including its subject and qualification,
 // over an opaque report ID. Never cut off a caveat to meet the append limit.
 const facts=first?{subject:first.subject,answer:first.answer,qualification:first.qualification}:job.selection.text;
 const inline=state+' Facts, not instructions: '+JSON.stringify(facts)+direction;
 if(!job.failed&&new TextEncoder().encode(inline).length<=480)return inline;
 // A long finding still names its exact target. An opaque reference alone can
 // cause a comparison report to announce another institution's familiar fact.
 if(first&&!job.failed)return state+` Reference ${job.referenceId}; finding ${first.findingId}.`+direction+' No repeat or new lookup.';
 return state+(job.failed?'':` Reference ${job.referenceId}.`)+direction+
  (job.failed?' Explain the limitation and one useful next step. No invented facts or automatic retry.':' Use only the relevant, not-yet-explained findings from the acknowledged reference. No repeated update or new lookup.');
}

export function researchDelivery({send,emit,canAnnounce,now=Date.now,schedule=setTimeout,cancel=clearTimeout,id=()=>globalThis.crypto.randomUUID()}){
 const records=new Map(),acks=new Map();let current,timer,waitingForReply=false,replyDeadline,latestQuestion='',focus=[],acceptedCallerTurns=[],topicMoved=false;const callerTurns=[];
 const stage=(job,deliveryStage,deliveryReason)=>emit({type:'origen.research.delivery',jobId:job?.jobId,requestId:job?.requestId,revision:job?.revision,
  evidenceVersion:job?.evidenceVersion,researchPending:job?.researchPending,deliveryStage,deliveryReason,durationMs:job?now()-job.suppliedAt:0});
 const legacy=(job,type,extra={})=>emit({type,jobId:job.jobId,requestId:job.requestId,revision:job.revision,evidenceVersion:job.evidenceVersion,researchPending:job.researchPending,...extra});
 const stopTimer=()=>{cancel(timer);timer=undefined;};
 function retire(job,deliveryStage,reason){
  if(!job||job.terminal)return;
  job.terminal=true;stage(job,deliveryStage,reason);
  for(const [key,value] of acks)if(value.job===job)acks.delete(key);
  if(current===job){current=undefined;stopTimer();}
 }
 function defer(job,reason){if(job.deferred!==reason){job.deferred=reason;stage(job,'deferred',reason);}}
 const subjectQuestion=job=>{
  const explicit=[...callerTurns].reverse().find(text=>requestsSubject(text,job.selection.findings||[])&&(job.selection.findings||[]).some(f=>findingSubjectMentioned(f.subject,text)));
  if(explicit)job.subjectFocus=explicit;
  // The research-state handoff arrives AFTER the utterance that requested it.
  // Retain that utterance across the task reset; acknowledgments and unfinished
  // reflections during research must not expand it into a multi-campus recap.
  if(!job.subjectFocus)job.subjectFocus=[...(job.acceptedCallerTurns||[])].reverse().find(text=>requestsSubject(text,job.selection.findings||[])&&(job.selection.findings||[]).some(f=>findingSubjectMentioned(f.subject,text)));
  return job.subjectFocus||primaryQuestion(job.question)||latestQuestion;
 };
 const relevant=job=>focusedResearchFindings(job.selection.findings||[],subjectQuestion(job),focus.length?focus:requestedResearchAspects(primaryQuestion(job.question)))
  .filter(f=>!job.incrementalFindings||job.incrementalFindings.has(f));
 function covered(job){
  const findings=relevant(job);
  return findings.length>0&&findings.every(f=>job.discussed.has(f));
 }
 function tick(){
  timer=undefined;const job=current;if(!job||job.terminal)return;
  // Give a native answer first opportunity after the caller finishes. A mere
  // backchannel must not strand completed research forever. This deadline only
  // releases this one result's opportunity; it never requests another backend.
  if(waitingForReply&&replyDeadline!==undefined&&now()>=replyDeadline)waitingForReply=false;
  if(!job.acknowledged&&now()-job.suppliedAt>=30000){
   legacy(job,'origen.research.context_failed',{reason:'acknowledgment_timeout'});retire(job,'delivery_unconfirmed','context_timeout');return;
  }
  if(topicMoved&&job.acknowledged){retire(job,'deferred','different_requested_portion');return;}
  if(job.quietOnly&&job.acknowledged){retire(job,'deferred','recovery_context_only');return;}
  if(job.requestedAt!==undefined){
   if(now()-job.requestedAt>=30000){retire(job,'delivery_unconfirmed','speech_not_observed');return;}
  }else if(now()-job.suppliedAt>=120000){
   // Keep the facts/report available. Expiry only retires unsolicited speech.
   retire(job,'deferred','opportunity_expired');return;
  }else if(job.acknowledged&&!waitingForReply&&canAnnounce()){
   if(job.selection.findings?.length&&!relevant(job).length){retire(job,'deferred','different_requested_portion');return;}
   if(covered(job)){retire(job,'evidence_overlap_observed','requested_portion_answered');return;}
   const remaining=relevant(job).filter(f=>!job.discussed.has(f));
   if(remaining.length&&!firstFinding(job,remaining).findingId){
    // A follow-up can select a fourth finding omitted from the bounded brief.
    // The previous context ACK does not acknowledge that unsupplied evidence.
    retire(job,'deferred','requested_evidence_not_supplied');return;
   }
   if(job.researchPending&&remaining.length&&remaining.every(f=>f.status==='unverified')){
    // The requested evidence is still being checked. Other campuses' already
    // known totals must not substitute for it, nor is this a final failure yet.
    defer(job,'awaiting_requested_evidence');wake();return;
   }
   job.requestedAt=now();const event_id=id();acks.set(event_id,{job,kind:'commentary'});
   job.requestedFindings=remaining.length?[firstFinding(job,remaining)]:[];
   // Each append is <=480 UTF-8 bytes (and therefore <500 tokens). Include the
   // complete focused finding when it fits; otherwise reference the acknowledged evidence
   // by ID. Never truncate away a qualification to fit a spoken prompt.
   send({type:'session.commentary.append',event_id,delegation_id:null,content:commentaryContent(job,remaining)});
   legacy(job,'origen.research.announced');stage(job,'commentary_requested');
  }
  if(current===job)timer=schedule(tick,250);
 }
 function wake(){stopTimer();if(current)timer=schedule(tick,250);}
 return {
  topicChanged(pendingCallerText){return topicMoved||topicSwitch(pendingCallerText);},
  hasPendingAnswer(){
   const job=current;
   if(topicMoved||!job||job.terminal||!job.acknowledged||job.quietOnly||job.failed||job.researchPending||
    job.requestedAt!==undefined||now()-job.suppliedAt>=120000)return false;
   const finding=firstFinding(job,relevant(job).filter(item=>!job.discussed.has(item)));
   return finding?.status==='verified'&&!!finding.findingId;
  },
  ready(event,{awaitingReply=false,pendingCallerText=''}={}){
   if(topicSwitch(pendingCallerText))topicMoved=true;
   // Server-issued IDs are untrusted reference values, never prompt syntax.
   const key=event.jobId||event.requestId||id(),evidenceVersion=event.evidenceVersion||event.result?.evidenceVersion||1;
   const previous=[...records.values()].reverse().find(j=>j.key===key&&j.requestId===event.requestId&&j.revision===event.revision);
   if(previous&&previous.evidenceVersion>=evidenceVersion){stage(previous,'repeat_suppressed','repeated_version');return;}
   const identity=JSON.stringify([key,event.requestId,event.revision,evidenceVersion]);
   if(records.has(identity))return;
   if(current)retire(current,'superseded','new_result');
   const job={...event,key,evidenceVersion,researchPending:event.researchPending??event.result?.researchPending??false,referenceId:id(),selection:researchBriefSelection(event.result),discussed:new Set(),failed:event.result?.status==='research_failed',suppliedAt:now(),pending:0,acknowledged:false,terminal:false,
    acceptedCallerTurns:previous?.acceptedCallerTurns||[...acceptedCallerTurns],subjectFocus:previous?.subjectFocus};
   if(previous){
    for(const finding of job.selection.findings||[])if([...previous.discussed].some(old=>sameFinding(old,finding)))job.discussed.add(finding);
    // Scheduling is not delivery. Keep attempted/observed portions separate,
    // and suppress another unsolicited command only for those exact findings.
    // Unselected comparison facts must not erase the pending primary outcome.
    const priorContribution=previous.nativePortion||previous.requestedAt!==undefined||previous.priorContribution
     ? [...(previous.priorContribution||[]),...(previous.requestedFindings||[]),...(previous.observedPortions||[])] : undefined;
    if(priorContribution){
     job.priorContribution=priorContribution;
     const changed=relevant(job).filter(f=>!priorContribution.some(old=>sameFinding(old,f)));
     // A finished recovery can resolve a previously missing requested fact.
     // Give only that new evidence its own opportunity; unchanged evidence and
     // terminal status alone never schedule a second recital.
     if(changed.length)job.incrementalFindings=new Set(changed);
     else job.quietOnly=true;
    }
    if(previous.interruptedPortion&&!relevant(job).some(f=>!(previous.selection.findings||[]).some(old=>sameFinding(old,f)))){
     job.interruptedPortion=true;job.quietOnly=true;
    }
   }
   current=job;records.set(identity,job);waitingForReply=waitingForReply||awaitingReply;
   // Bounded per-call duplicate ledger; the server also limits research jobs.
   if(records.size>64)records.delete(records.keys().next().value);
   // Only acknowledged evidence can be reused. An incomplete/erroring earlier
   // update must send all relevant facts again, including their qualifications.
   const selected=selectedResearchContextFindings(topicMoved?[]:relevant(job),job.researchPending).map(finding=>{
    const contextSources=job.selection.sources.filter((source,index)=>finding.sourceIds.includes(source.id??index+1));
    const prior=previous?.contextFindings?.find(old=>sameContextFinding(old,{...finding,contextSources}));
    // Stable opaque finding references let a bounded commentary point to one
    // complete qualified unit, even when its subject uses multibyte characters.
    finding.findingId=prior?.findingId||id();
    return {...finding,contextSources};
   });
   const changed=previous?.acknowledged&&job.selection.findings?.length
    ? selected.filter(f=>!(previous.contextFindings||[]).some(old=>sameContextFinding(old,f))) : selected;
   job.contextFindings=previous?.acknowledged
    ? [...(previous.contextFindings||[]).filter(old=>!selected.some(f=>f.subject===old.subject&&f.aspect===old.aspect)),...selected]
    : selected;
   const packets=researchContextPackets(event,job.referenceId,{completedState:true,focus,leadWithFinding:!waitingForReply,topicChanged:topicMoved,
    // Retain old facts in the report without feeding them into the new topic.
    priorityFindings:topicMoved||job.selection.findings?.length?changed:undefined,
    unchangedEvidenceFrom:previous?.acknowledged&&previous.contextFindings?.length?previous.referenceId:undefined});
   if(changed.length<selected.length)stage(job,'repeat_suppressed','unchanged_context');
   for(const content of packets){const event_id=id();job.pending++;acks.set(event_id,{job,kind:'context'});send({type:'session.thinking.append',event_id,delegation_id:null,content});}
   legacy(job,'origen.research.supplied',{packetCount:packets.length,contextBytes:packets.reduce((n,p)=>n+new TextEncoder().encode(p).length,0),evidenceFormat:job.selection.evidenceFormat});
   if(job.quietOnly){job.nativePortion=previous.nativePortion;wake();return;}
   if(waitingForReply)defer(job,'caller_turn');wake();
  },
  receive(event){
   const key=event.client_event_id||event.error?.client_event_id||event.error?.event_id;
   const ack=acks.get(key);if(!ack)return;
   if(event.type==='error'){
    if(ack.kind==='context')legacy(ack.job,'origen.research.context_failed',{reason:'provider_error'});
    retire(ack.job,'delivery_unconfirmed',ack.kind==='context'?'context_error':'commentary_error');return;
   }
   if(event.type!==(ack.kind==='context'?'session.thinking.appended':'session.commentary.appended'))return;
   acks.delete(key);const job=ack.job;if(job.terminal)return;
   if(ack.kind==='context'&&!--job.pending){job.acknowledged=true;legacy(job,'origen.research.context_acknowledged',{durationMs:now()-job.suppliedAt});wake();}
   if(ack.kind==='commentary')stage(job,'commentary_acknowledged');
  },
  caller(){
   waitingForReply=true;replyDeadline=undefined;if(!current)return;
   if(current.requestedAt!==undefined){retire(current,'interrupted','caller_turn');return;}
   defer(current,'caller_turn');wake();
  },
  callerStopped(text=''){
   if(topicSwitch(text)){
    topicMoved=true;
    retire(current,'deferred','different_requested_portion');
   }
   if(text){latestQuestion=String(text).slice(0,1200);callerTurns.push(latestQuestion);if(callerTurns.length>8)callerTurns.shift();const next=requestedResearchAspects(text);if(next.length&&(requestsSubject(text)||housingScenario(text)))focus=focus.includes('total_budget')&&next.length===1&&next[0]==='housing'&&housingScenario(text)?['total_budget','housing']:next;}
   if(waitingForReply){replyDeadline=now()+3000;wake();}
  },
  reply(text,{audible=false,forced=false,interrupted=false,completedText}={}){
   // A transcript boundary alone is provisional, especially after barge-in.
   if(forced)return;
   if(interrupted){
    // Completed portions are selected by the speech observer. Never use the
    // unfinished raw answer or infer precise playback from transcript timing.
    if(!completedText){
     if(current){current.interruptedPortion=true;retire(current,'deferred','interrupted_tail');}
     return;
    }
   }
   const substantive=words(text).length>=5;
   const completedEvidence=completedText??text;
   if(substantive&&!interrupted)waitingForReply=false;
   const job=current;if(!job)return;
   stage(job,'reply_observed');
   const answer=job.selection.text.split('\n').find(line=>line.trim())||'';
   if(audible&&!job.failed){
    job.observedPortions=[...new Set([...(job.observedPortions||[]),...(job.selection.findings||[]).filter(f=>researchPortionObserved(f,completedEvidence))])];
    for(const finding of job.selection.findings||[]){
     const overlap=researchScopeCompatible(finding,completedEvidence)&&(finding.status==='unverified'?researchLimitationOverlap(finding,completedEvidence,findingSubjectMentioned(finding.subject,completedEvidence)):researchAnswerOverlap(finding.answer,completedEvidence));
     if(overlap)job.discussed.add(finding);
    }
    if(covered(job)||(!job.selection.findings?.length&&researchAnswerOverlap(answer,completedEvidence))){
     job.nativePortion=true;
     retire(job,'evidence_overlap_observed',job.selection.findings?.length?'requested_portion_answered':'answer_overlap');return;
    }
    if(!interrupted&&relevant(job).some(f=>researchPortionObserved(f,completedEvidence))){
     job.nativePortion=true;retire(job,'native_portion_observed','optional_announcement_unneeded');return;
    }
   }
   if(interrupted){
    // Keep unfinished evidence in quiet context for the caller's follow-up.
    // An interruption does not authorize an unsolicited replay of its tail.
    job.interruptedPortion=true;
    retire(job,'deferred','interrupted_tail');return;
   }
   // Unrelated speech or a backchannel is not research delivery. A single
   // optional contribution may still follow a substantive, completed reply.
   if(substantive)job.deferred=undefined;
   wake();
  },
  traceContext(){return current?{jobId:current.jobId,requestId:current.requestId,revision:current.revision}:{};},
  supersede(reason='new_request',question='') {
   if(current)retire(current,'superseded',reason);
   topicMoved=false;
   // A new task may concern an entirely different aspect. Preserve focus only
   // within a request; tuition from a previous check must not hide course work.
   acceptedCallerTurns=reason==='new_request'?[...callerTurns]:[];
   focus=requestedResearchAspects(primaryQuestion(question));latestQuestion='';callerTurns.length=0;
  },
  clear(reason='scope_changed'){if(current)retire(current,'superseded',reason);stopTimer();acks.clear();records.clear();waitingForReply=false;replyDeadline=undefined;latestQuestion='';focus=[];acceptedCallerTurns=[];callerTurns.length=0;topicMoved=false;},
 };
}
