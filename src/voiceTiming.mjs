// Measurement only. Never schedules replies or changes consent.
// Transcript text is transient classification input, never timing telemetry.
// Live supplies transcript boundaries, not microphone VAD: label that estimate.
const progressTopics=new Set(['origen_lookup_progress','origen_farewell']);
const acknowledgments=['okay','ok','sure','yes','right','of course','i see','got it','let me check','one moment','thanks','thank you','claro','si','entiendo','de acuerdo','un momento','dejame revisar','gracias'];
export function parseContextTiming(header){
 const result={};
 for(const part of String(header||'').split(',')){
  const match=part.trim().match(/^(version|memory|profile|history|workspace|retrieval|continuity|coordinator|session_guards|opening|brief|teachings|negotiate|total);dur=(\d+(?:\.\d+)?)$/);
  if(match)result[match[1]]=Math.min(600000,Number(match[2]));
 }
 return result;
}
export function answerKind(text,topic){
 if(progressTopics.has(topic))return 'progress';
 const words=String(text||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
 if(!words)return 'unclassified';
 // Streaming chunks can stop halfway through "Claro" or "Let me check".
 // Treat a prefix of a known acknowledgment conservatively until more arrives.
 const pending=[words],seen=new Set();
 while(pending.length){const rest=pending.pop();if(seen.has(rest))continue;seen.add(rest);
  for(const phrase of acknowledgments){if(phrase.startsWith(rest))return 'acknowledgment';if(rest.startsWith(phrase+' '))pending.push(rest.slice(phrase.length+1));}
 }
 // This is a candidate, not a semantic judgment of usefulness or correctness.
 return 'answer_candidate';
}
export function createVoiceTiming({emit,clock=()=>performance.now()}={}){
 const origin=clock(),backends=new Map(),responses=new Map(),calls=new Map();
 let current,turnIndex=0,stopped=false,routingPolicy='unavailable';
 const write=(stage,turn,extra={})=>{if(stopped)return;try{emit({timingStage:stage,routingPolicy:turn?.routingPolicy||routingPolicy,turnIndex:turn?.index||0,offsetMs:Math.max(0,clock()-origin),boundary:turn?.boundary||'unavailable',...extra});}catch{}};
 function setRouting(value){
  routingPolicy=['backend-first','bounded-follow-up-v1'].includes(value)?value:'unavailable';
  if(current&&!current.finished&&current.routingPolicy!==routingPolicy)current.routingPolicy='mixed';
 }
 function finish(outcome){
  if(!current||current.finished)return;current.finished=true;
  const measures={};
  if(current.end!==undefined){
   measures.durationMs=clock()-current.end;
   for(const [key,time]of [['firstAudioMs',current.audio],['answerCandidateMs',current.candidate],['candidateAudioMs',current.playedCandidate]])if(time!==undefined&&time>=current.end)measures[key]=time-current.end;
   const earlier=[current.audio,current.candidate,current.playedCandidate].filter(time=>time!==undefined&&time<current.end);
   if(earlier.length)measures.boundaryOverlapMs=current.end-Math.min(...earlier);
  }
  const observedDelegations=current.backendIds.size;
  const routingObservation=observedDelegations?'backend_observed':['backend-first','bounded-follow-up-v1'].includes(current.routingPolicy)&&!current.routingUnknown?'no_backend_observed':'unavailable';
  write('turn_complete',current,{timingOutcome:outcome,observedDelegations,routingObservation,...measures});
 }
 function span(stage,turn=current){const at=clock();let done=false;return (outcome='completed',extra={})=>{if(done)return;done=true;write(stage,turn,{durationMs:clock()-at,timingOutcome:outcome,...extra});};}
 function event(e){
  if(stopped)return;
  const type=e.type;
  if(type==='origen.configuration.applied'&&Number.isFinite(e.durationMs)&&e.durationMs>=0){write('configuration_ack',current,{durationMs:e.durationMs,timingOutcome:'completed'});return;}
  if(type==='session.created'||type==='session.updated'){setRouting(e.session?.routingPolicy);return;}
  if(type==='input_audio_buffer.speech_started'){
   for(const [id,response]of responses)if(response.backend)responses.delete(id);
   finish('interrupted');current={index:++turnIndex,itemId:e.item_id,routingPolicy,backendIds:new Set(),routingUnknown:[...backends.values()].some(work=>!work.turn),boundary:e.liveBoundary==='transcript_observed'?'transcript_quiet_estimate':'provider_vad'};
   write('speech_started',current);return;
  }
  if(type==='input_audio_buffer.speech_stopped'&&current?.itemId===e.item_id&&current.end===undefined){current.end=clock();write('speech_end',current);if(current.pendingOutcome)finish(current.pendingOutcome);return;}
  if(type==='origen.backend.started'){
   if(backends.has(e.response_id))return;
   const turn=current&&e.item_id===current.itemId?current:null;
   if(turn)turn.backendIds.add(e.response_id);else if(current&&!current.finished&&!e.item_id)current.routingUnknown=true;
   backends.set(e.response_id,{turn,done:span('backend_model',turn)});write('backend_started',turn);return;
  }
  if(type==='origen.backend.model_finished'){
   const work=backends.get(e.response_id);if(!work)return;work.done(e.outcome||'unknown');backends.delete(e.response_id);
   responses.set(e.response_id,{turn:work.turn,backend:true});
   if(work.turn===current&&['failed','cancelled','incomplete','timed_out'].includes(e.outcome))finish(e.outcome);
   return;
  }
  if(type==='response.created'){
   if(!responses.has(e.response.id))responses.set(e.response.id,{turn:current,text:'',topic:e.response.metadata?.topic});return;
  }
  const responseId=e.response_id||e.response?.id;
  const response=responses.get(responseId);
  if(['response.output_audio_transcript.delta','response.audio_transcript.delta'].includes(type)&&response&&!response.backend){
   response.text=(response.text||'')+e.delta;
   if(response.text.length>16000)response.text=response.text.slice(-16000);
   if(response.turn===current&&!current?.finished&&current?.candidate===undefined&&answerKind(response.text,response.topic)==='answer_candidate'){
    current.candidate=clock();current.candidateResponse=responseId;write('answer_candidate',current,current.end!==undefined?{durationMs:clock()-current.end}:{});
   }return;
  }
  if(type==='response.done'){
   if(response&&!response.backend){
    if(response.turn===current&&['failed','cancelled','incomplete'].includes(e.response.status))finish(e.response.status);
    // Retain classification until the playback boundary; drop the text there.
    response.kind=answerKind(response.text,response.topic);
    if(!response.text&&e.response.output?.some(item=>item.type==='function_call'))response.backend=true;
   }
   return;
  }
  if(type==='output_audio_buffer.stopped'||type==='output_audio_buffer.cleared'){
   if(type==='output_audio_buffer.cleared'&&!responseId){finish('interrupted');for(const [id,item]of responses)if(!item.backend)responses.delete(id);return;}
   if(response?.turn===current&&!response.backend&&current?.playedCandidate!==undefined){
    const outcome=type.endsWith('cleared')?'interrupted':'answered_candidate';
    if(current.end===undefined&&outcome==='answered_candidate')current.pendingOutcome=outcome;else finish(outcome);
   }
   responses.delete(responseId);
  }
 }
 function playback(){
  if(stopped||!current||current.finished)return;
  // Do not attribute an older, still-running utterance or backend to new input.
  const speech=[...responses.values()].filter(r=>!r.backend);
  if([...backends.values()].some(r=>r.turn&&r.turn!==current)||speech.some(r=>r.turn!==current))return;
  const active=speech.filter(r=>r.turn===current&&!progressTopics.has(r.topic));if(!active.length)return;
  if(current.audio===undefined){current.audio=clock();write('first_audio',current,current.end!==undefined?{durationMs:clock()-current.end}:{});}
  if(current.candidate!==undefined&&current.playedCandidate===undefined&&responses.get(current.candidateResponse)?.turn===current){current.playedCandidate=clock();write('candidate_audio',current,current.end!==undefined?{durationMs:clock()-current.end}:{});}
 }
 return {event:e=>{try{event(e||{});}catch{}},playback,span,
  toolStart(item,responseId){if(stopped||calls.has(item.call_id))return;const turn=responses.get(responseId)?.turn||null;calls.set(item.call_id,{done:span(item.name==='recall_student_context'?'history_tool':item.name==='lookup_education_planning'?'research_tool':'tool',turn)});},
  sent(e){if(e.type==='session.update')setRouting('unavailable');if(e.type==='conversation.item.create'&&e.item?.type==='function_call_output'){const call=calls.get(e.item.call_id);call?.done('returned');calls.delete(e.item.call_id);}},
  stop(){if(stopped)return;for(const work of backends.values())work.done('abandoned');for(const call of calls.values())call.done('abandoned');finish('closed');write('call_complete',undefined);stopped=true;backends.clear();responses.clear();calls.clear();current=undefined;},
 };
}
