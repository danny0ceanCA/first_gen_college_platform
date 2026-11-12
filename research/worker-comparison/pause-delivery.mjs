import {researchDelivery} from '../../src/researchDelivery.mjs';
import {isResearchAcknowledgment} from '../../src/researchSpeechObservation.mjs';
import {validatedResearchFindings,findingSubjectMentioned} from '../../src/researchFindings.mjs';
import {researchAnswerOverlap,researchScopeCompatible} from '../../src/researchDiscussion.mjs';
import {researchFactValue,researchScopeLabel} from '../../src/researchRecord.mjs';
import {requestedResearchFacts,researchFactMatchesRequirement} from '../../src/researchTask.mjs';
import {qualificationsObserved} from './qualified-observation.mjs';

// One complete fact-specific unit, not a rewritten or truncated report. Long
// records and additional facts stay in the research job. Each selected unit
// carries every scope field and its entire fact qualification. At <=500 UTF-8
// bytes it is conservatively within Live's 500-token append limit.
export function scoutSpokenUnit(event){
 const language=event.language==='es'?'es':'en',requirements=requestedResearchFacts(event.question||'',language);
 const candidates=validatedResearchFindings(event.result).flatMap(f=>{
  // A sibling rule can be the eligibility condition of the tempting short
  // fact. Without explicit dependency metadata, keep multi-fact records
  // together on the full path instead of stripping that condition.
  if(!f.evidence||f.status!=='verified'||f.evidence.facts.length!==1||f.evidence.facts.some(fact=>fact.kind==='step'))return [];
  const scope=[researchScopeLabel(f.evidence,language),f.evidence.scope.validThrough].filter(Boolean).join(' · ');
  return f.evidence.facts.filter(fact=>fact.status==='verified').map(fact=>{
   const unit={s:f.subject,c:scope,v:researchFactValue(fact,language),q:fact.qualification,refs:fact.sourceCitation};
   const extended={sourceFact:{...unit,q:[fact.qualification,f.qualification].filter(Boolean).join(' ')}};
   const extendedContent=JSON.stringify(extended);
   const includeFindingQualification=!!f.qualification&&new TextEncoder().encode(extendedContent).length<=500;
   // A finding-wide limitation can change the meaning of this fact (for
   // example, a phone number does not establish Spanish-language support).
   // Never drop it merely to force the faster inline path.
   const content=f.qualification?extendedContent:JSON.stringify({sourceFact:unit});
   const genericAnswer=f.evidence.complete&&f.evidence.facts.length===1&&fact.key==='answer'&&
    f.evidence.expectedFacts.length===1&&f.evidence.expectedFacts[0]==='answer'&&
    requirements.every(r=>['text','rule','requirement'].includes(r.kind));
   return {content,key:fact.key,bytes:new TextEncoder().encode(content).length,qualificationCoverage:includeFindingQualification?'fact_and_finding':'fact',requested:requirements.some(r=>researchFactMatchesRequirement(fact,r))||genericAnswer};
  });
 });
 const matches=requirements.length?candidates.filter(c=>c.requested):candidates;
 return matches.filter(c=>c.bytes<=500).sort((a,b)=>Number(b.qualificationCoverage==='fact_and_finding')-Number(a.qualificationCoverage==='fact_and_finding')||a.bytes-b.bytes)[0];
}

// Like the shared controller's native-portion rule, this only retires an
// optional recital. It is NOT a complete-answer or comprehension assessment.
// Inspect complete typed clauses, rather than generated labels/concatenated
// summaries that can hide an already spoken fact behind unrelated wording.
export function typedPortionObserved(result,text){
 const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const negative=value=>/\b(?:no|not|never|without|cannot|can['’]?t|sin|nunca)\b/u.test(fold(value));
 const uncertain=/\b(?:might|maybe|could be|not verified|not confirmed|checking|verifying|will check|going to check|quizas|tal vez|podria|sin verificar|sin confirmar|revisando|verificando|voy a revisar)\b/u;
 const findings=validatedResearchFindings(result);
 // Do not let a positive partial answer erase a remaining explicit gap.
 if(!findings.length||findings.some(f=>f.status!=='verified'||f.evidence?.facts.some(fact=>fact.status!=='verified')))return false;
 return findings.every(f=>{
  const facts=f.evidence?.facts.filter(fact=>fact.status==='verified'&&typeof fact.value==='string');
  if(!facts?.length||!qualificationsObserved(f,text))return false;
  const statements=String(text||'').split(/(?<=[.!?])\s+/u).filter(statement=>/[.!]["”’')]*\s*$/u.test(statement)&&
   !uncertain.test(fold(statement))&&findingSubjectMentioned(f.subject,statement)&&researchScopeCompatible(f,statement));
  return facts.every(fact=>fact.value.split(/(?<=[.;])\s+/u).every(clause=>statements.some(statement=>
   negative(clause)===negative(statement)&&researchAnswerOverlap(clause,statement))));
 });
}

// Isolated delivery adapter. It reuses the application's evidence/ACK/dedup
// controller, but observes a completed thought plus audio idle rather than
// waiting for the end of the entire continuous transcript answer. No cancel,
// response.create, instructions append, or additional model calls are used.
export function createPauseDelivery({send,log=()=>{},now=Date.now,schedule=setTimeout,cancel=clearTimeout,id=()=>globalThis.crypto.randomUUID(),quietMs=650,supplementalOnly=false,canDeliver=()=>true,prepare=event=>event}){
 let closed=false,callerActive=false,awaitingAnswer=false,latestCaller='',output='',outputVersion=0,observedVersion=0;
 let audioIdle=false,audioAt=-Infinity,inputAt=-Infinity,outputAt=-Infinity,backend=new Set(),delegations=new Set(),timer;
 let taskKey,readyAt,firstPauseAt,result,lastComplete='',pending,lastHold;const nativeVersions=new Map(),inlineVersions=new Map(),inlineAcks=new Map(),retiredTasks=new Set();
 const trace=(stage,extra={})=>log({stage,...extra});
 const tracker=researchDelivery({send,emit:event=>trace(event.type,{...event}),now,schedule,cancel,id,
  canAnnounce:()=>!closed&&canDeliver()&&!callerActive&&!awaitingAnswer&&!backend.size&&!delegations.size&&audioIdle&&
   now()-Math.max(audioAt,inputAt,outputAt)>=(/[?？]["”’')]*\s*$/u.test(output)?3000:quietMs)&&(!output||/[.!?。！？]["”’')]*\s*$/u.test(output))});
 function observeTypedPortion(text){
  if(supplementalOnly)return;
  // Later evidence can contain a new fact alongside an unchanged clause. Let
  // the shared incremental-finding ledger own those versions; an old clause
  // must not suppress an entire recovery update.
  if(!result||result.evidenceVersion!==1||!typedPortionObserved(result,text))return;
  nativeVersions.set(taskKey,result.evidenceVersion||1);
  if(nativeVersions.size>64)nativeVersions.delete(nativeVersions.keys().next().value);
  tracker.clear('native_typed_portion');
  trace('native_typed_portion_observed',{taskKey,evidence:'completed_transcript_and_audio_idle_estimate',completeAnswer:false});
 }
 function poll(){
  if(closed)return;
  for(const [eventId,ack] of inlineAcks)if(now()-ack.at>=30000){inlineAcks.delete(eventId);trace('inline_delivery_unconfirmed',{taskKey:ack.key,reason:'acknowledgment_timeout',playbackConfirmed:false});}
  const quiet=audioIdle&&now()-Math.max(audioAt,inputAt,outputAt)>=quietMs;
  if(pending){
   const hold=!canDeliver()?'primary_or_formal_owner':callerActive?'caller_active':supplementalOnly&&awaitingAnswer?'caller_answer_pending':
    backend.size?'backend_active':delegations.size?'delegation_active':!audioIdle?'audio_active':!quiet?'settling_audio':
     output&&!/[.!?。！？]["”’')]*\s*$/u.test(output)?'unfinished_clause':
      /[?？]["”’')]*\s*$/u.test(output)&&now()-Math.max(audioAt,inputAt,outputAt)<3000?'caller_response_space':null;
   if(hold!==lastHold){lastHold=hold;trace('delivery_hold_changed',{taskKey,reason:hold||'eligible',waitMs:now()-readyAt,playbackEvidence:'audio_idle_estimate'});}
  }
  if(pending&&now()-readyAt>=120000){pending=undefined;trace('pending_expired',{taskKey,reason:'no_safe_context_boundary'});}
  if(!callerActive&&quiet&&outputVersion!==observedVersion&&/[.!?。！？]["”’')]*\s*$/u.test(output)){
   observedVersion=outputVersion;
   // The floor evidence is PCM/playback idle plus a complete transcript. It
   // remains an estimate, not proof that a physical listener heard the words.
   tracker.reply(output,{audible:true,completedText:output});
   lastComplete=output;observeTypedPortion(output);
   awaitingAnswer=false;
   trace('thought_boundary',{transcript:output,playbackEvidence:'audio_idle_estimate'});
  }
  // Even quiet context can influence the next words. Stage it until the same
  // audio/complete-thought boundary instead of changing context mid-sentence.
  if(pending&&canDeliver()&&(!supplementalOnly||!awaitingAnswer)&&!callerActive&&!backend.size&&!delegations.size&&quiet&&
   (!output||/[.!?。！？]["”’')]*\s*$/u.test(output))&&
   (!/[?？]["”’')]*\s*$/u.test(output)||now()-Math.max(audioAt,inputAt,outputAt)>=3000)){
   let event=pending;pending=undefined;
   try{event=prepare(event);}catch{trace('result_withheld',{taskKey,reason:'preparation_failed'});event=null;}
   if(!event){trace('result_withheld',{taskKey,reason:'no_new_applicable_evidence'});timer=schedule(poll,100);return;}
   result={...event.result,evidenceVersion:event.evidenceVersion||1};
   if((nativeVersions.get(taskKey)||0)<(event.evidenceVersion||event.result?.evidenceVersion||1)){
    const unit=(event.evidenceVersion||1)===1&&!tracker.topicChanged(supplementalOnly?'':latestCaller)&&!awaitingAnswer?scoutSpokenUnit(event):undefined;
    if(unit){
     const event_id=id();inlineVersions.set(taskKey,event.evidenceVersion||1);inlineAcks.set(event_id,{key:taskKey,at:now()});
     if(inlineVersions.size>64)inlineVersions.delete(inlineVersions.keys().next().value);
     send({type:'session.commentary.append',event_id,delegation_id:null,content:unit.content});
     trace('inline_commentary_requested',{taskKey,factKey:unit.key,bytes:unit.bytes,qualificationCoverage:unit.qualificationCoverage,readyToRequestMs:now()-readyAt,completeAnswer:false});
    }else{
     tracker.ready(event,{awaitingReply:awaitingAnswer,pendingCallerText:supplementalOnly?'':latestCaller});
     trace('context_published_at_pause',{taskKey,readyToPublishMs:now()-readyAt});
     if(!awaitingAnswer)observeTypedPortion(lastComplete);
    }
   }
  }
  if(taskKey&&readyAt!==undefined&&firstPauseAt===undefined&&canDeliver()&&!callerActive&&!awaitingAnswer&&!backend.size&&!delegations.size&&quiet&&
   (!output||/[.!?。！？]["”’')]*\s*$/u.test(output))&&(!/[?？]["”’')]*\s*$/u.test(output)||now()-Math.max(audioAt,inputAt,outputAt)>=3000)){
   firstPauseAt=now();trace('first_eligible_pause',{taskKey,readyToPauseMs:now()-readyAt});
  }
  timer=schedule(poll,100);
 }
 timer=schedule(poll,100);
 return {
  ready(event,{key=event.jobId||event.requestId}={}){
   if(closed)return;
   if(retiredTasks.has(key)){trace('result_discarded',{taskKey:key,reason:'retired_task'});return;}
   const version=event.evidenceVersion||event.result?.evidenceVersion||1;
   if((inlineVersions.get(key)||0)>=version){trace('repeat_suppressed',{taskKey:key,reason:'inline_already_requested'});return;}
   if((nativeVersions.get(key)||0)>=version){trace('repeat_suppressed',{taskKey:key,reason:'native_typed_portion'});return;}
   // A formal lookup joining the scout is the same evidence delivery, not a
   // new announcement. Canonical identity survives that ownership handoff.
   if(taskKey!==key){
    // This adapter's supplemental question is a separate accepted task. The
    // main question's COA/deadline focus must not filter out its bus/waiver
    // facts. Real subsequent caller turns still update/retire this tracker.
    if(supplementalOnly)tracker.clear('new_supplemental_task');
    tracker.supersede('new_request',event.question||'');readyAt=undefined;firstPauseAt=undefined;lastHold=undefined;
    if(latestCaller&&!supplementalOnly)tracker.callerStopped(latestCaller);
   }
   taskKey=key;readyAt??=now();result={...event.result,evidenceVersion:version};
   pending={...event,jobId:key,requestId:key,revision:1};
   trace('result_queued',{taskKey:key,awaitingAnswer,callerActive});
  },
  receive(e){
   if(closed)return;
   tracker.receive(e);
   const receiptId=e.client_event_id||e.error?.client_event_id||e.error?.event_id;
   const inline=inlineAcks.get(receiptId);
   if(inline&&['session.commentary.appended','error'].includes(e.type)){
    inlineAcks.delete(receiptId);
    trace(e.type==='error'?'inline_delivery_unconfirmed':'inline_commentary_acknowledged',{taskKey:inline.key,playbackConfirmed:false});
   }
   if(e.type==='response.event'){
    const nested=e.event,key=nested?.response?.id||e.response_id||e.delegation_id;
    if(nested?.type==='response.created')backend.add(key);
    if(['response.completed','response.failed','response.cancelled','response.incomplete'].includes(nested?.type)){
     backend.delete(key);delegations.delete(e.delegation_id);
    }
   }
   if(e.type==='session.delegation.created'&&e.delegation?.target==='responses')delegations.add(e.delegation.id);
   if(e.type==='session.input_transcript.delta')inputAt=now();
   if(e.type==='session.output_transcript.delta'){
    if(observedVersion===outputVersion)output='';
    output+=e.delta||'';outputVersion++;outputAt=now();
   }
  },
  callerStarted(){
   if(closed||callerActive)return;
   callerActive=true;awaitingAnswer=true;inputAt=now();
   // Discard unfinished transcript evidence across a real user turn. The
   // production tracker keeps already completed portions separately.
   output='';lastComplete='';observedVersion=outputVersion;tracker.caller();
  },
  callerStopped(text){
   if(closed)return;
   callerActive=false;inputAt=now();latestCaller=String(text||'');
   if(/\b(?:set (?:that|this|it) aside|stop (?:that|this|the research|the lookup)|dejemos (?:eso|esto)|deja (?:eso|esto) (?:por ahora|a un lado))\b/iu.test(latestCaller)){
    if(taskKey){retiredTasks.add(taskKey);if(retiredTasks.size>64)retiredTasks.delete(retiredTasks.values().next().value);}
    pending=undefined;tracker.clear('caller_set_task_aside');trace('topic_changed',{taskKey,reason:'caller_set_task_aside'});return;
   }
   if(isResearchAcknowledgment(latestCaller))awaitingAnswer=false;
   tracker.callerStopped(latestCaller);
   if(tracker.topicChanged(latestCaller))trace('topic_changed',{taskKey});
  },
  playback({idle}){if(idle!==audioIdle){audioIdle=idle;audioAt=now();}},
  clear(reason='scope_changed'){
   tracker.clear(reason);taskKey=undefined;readyAt=undefined;firstPauseAt=undefined;lastHold=undefined;latestCaller='';result=undefined;lastComplete='';pending=undefined;nativeVersions.clear();inlineVersions.clear();inlineAcks.clear();
   trace('delivery_cleared',{reason});
  },
  close(){closed=true;cancel(timer);tracker.clear('closed');backend.clear();delegations.clear();inlineAcks.clear();pending=undefined;},
 };
}
