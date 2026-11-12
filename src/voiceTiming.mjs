// Measurement only. Never schedules replies or changes consent.
// Transcript text is transient classification input, never timing telemetry.
// Live supplies transcript boundaries, not microphone VAD: label that estimate.
const progressTopics=new Set(['origen_lookup_progress','origen_farewell']);
export const timingClassifierVersion='preamble-v2';
const acknowledgments=['of course','thank you','de acuerdo','i see','got it','all right','a ver','alright','okay','sure','right','thanks','claro','entiendo','gracias','yeah','yep','yes','well','bueno','ok','si','vale','aja','mhm','mm hmm','oh','ah'];
const pendingPreambles=['i m','i am','i ll','i will','we re','we are','we ll','let me','let s','i m going to','i am going to','voy a','vamos a','estoy','estamos','dejame','permiteme','un momento','one moment','just a moment','give me a moment','dame un momento'];
for(const [subjects,verbs]of [
 [['i m','i am','we re','we are'],['checking','looking','comparing','reviewing','verifying','confirming','finding','searching','working','pulling']],
 [['i ll','i will','we ll','we will','let me','let s','i m going to','i am going to'],['check','look','compare','review','verify','confirm','find','search','pull']],
 [['estoy','estamos','sigo','seguimos'],['revisando','buscando','comparando','verificando','confirmando','comprobando','consultando']],
 [['voy a','vamos a','dejame','permiteme'],['revisar','buscar','comparar','verificar','confirmar','comprobar','consultar']],
])for(const subject of subjects)for(const verb of verbs)for(const modifier of ['','still ','just ','todavia '])pendingPreambles.push(`${subject} ${modifier}${verb}`);
const progressStarts=[
 /^(?:(?:i m|i am|we re|we are)\s+(?:(?:still|just)\s+)?(?:checking|looking|comparing|reviewing|verifying|confirming|finding|searching|working|pulling)\b|(?:i ll|i will|we ll|we will|let me|let s|i m going to|i am going to)\s+(?:just\s+)?(?:check|look|compare|review|verify|confirm|find|search|pull)\b)/,
 /^(?:(?:estoy|estamos|sigo|seguimos)\s+(?:todavia\s+)?(?:revisando|buscando|comparando|verificando|confirmando|comprobando|consultando)\b|(?:voy a|vamos a|dejame|permiteme)\s+(?:revisar|buscar|comparar|verificar|confirmar|comprobar|consultar)\b)/,
 /^(?:one moment|just a moment|un momento|dame un momento|give me a moment)\b/,
 /^(?:(?:the|your|that|this)\s+[\p{L}\p{N}\s]{0,100}\s+(?:is|are)\s+(?:still\s+)?(?:being\s+)?(?:checked|verified|reviewed|confirmed|pending)|(?:el|la|los|las)\s+[\p{L}\p{N}\s]{0,100}\s+(?:esta|estan|sigue|siguen)\s+(?:todavia\s+)?(?:pendiente|pendientes|en revision|en verificacion|siendo revisado|siendo verificado))\b/u,
];
const normalizeWords=text=>String(text||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
function clauseKind(text){
 let words=normalizeWords(text);if(!words)return 'unclassified';
 // Consume only bounded conversational lead-ins; a factual suffix still wins.
 for(let i=0;i<12;i++){
  if(acknowledgments.includes(words))return 'acknowledgment';
  if(acknowledgments.some(phrase=>phrase.startsWith(words)))return 'incomplete_preamble';
  const prefix=acknowledgments.find(phrase=>words.startsWith(phrase+' '));
  if(!prefix)break;words=words.slice(prefix.length+1);
 }
 if(progressStarts.some(pattern=>pattern.test(words)))return 'progress';
 if(pendingPreambles.some(phrase=>phrase.startsWith(words)))return 'incomplete_preamble';
 return 'answer_candidate';
}
// A comma can end a preamble or merely separate lookup subjects. Only split it
// when the suffix looks like an independent statement or useful clarification.
function independentTail(text){
 const words=normalizeWords(text);
 return /^(?:(?:what|which|how|where|when|do you|are you|will you|is that|is it|would you|que|cual|como|donde|cuando|te refieres|quieres|prefieres|vas a)\b|[\p{L}\p{N}\s]{1,70}\s+(?:is|are|was|were|costs|includes|requires|means|es|son|cuesta|incluye|requiere|significa)\b)/u.test(words);
}
export function parseContextTiming(header){
 const result={};
 for(const part of String(header||'').split(',')){
  const match=part.trim().match(/^(version|memory|profile|history|workspace|retrieval|continuity|coordinator|session_guards|opening|brief|teachings|negotiate|total);dur=(\d+(?:\.\d+)?)$/);
  if(match)result[match[1]]=Math.min(600000,Number(match[2]));
 }
 return result;
}
function classifyText(text,topic,{streaming=false}={}){
 if(progressTopics.has(topic))return {kind:'progress',hasCompletedPreamble:!streaming};
 const value=String(text||'').slice(0,16000);if(!normalizeWords(value))return {kind:'unclassified',hasCompletedPreamble:false};
 // Keep separators so a streamed final clause cannot lock in an answer from
 // only "The total..." before "...is still being verified" arrives.
 const clauses=value.split(/([.!?](?:\s+|$)|[;:\n]|\s+(?:but|pero|however|sin embargo)\s+)/iu).slice(0,128);
 const kinds=[];let hasCompletedPreamble=false;
 const observe=(segment,complete)=>{
  const kind=clauseKind(segment);
  if(complete&&['acknowledgment','progress'].includes(kind))hasCompletedPreamble=true;
  kinds.push(kind==='answer_candidate'&&!complete?'unclassified':kind);
 };
 for(let i=0;i<clauses.length;i+=2){
  const clause=clauses[i],complete=!streaming||i+1<clauses.length;
  const parts=clause.split(/,\s*/).slice(0,32);let segment=parts.shift()||'';
  for(const part of parts){if(independentTail(part)){observe(segment,true);segment=part;}else segment+=', '+part;}
  observe(segment,complete);
 }
 // Generated transcript content is only an answer candidate, never proof of
 // accuracy, comprehension or which words the caller actually heard.
 for(const kind of ['answer_candidate','progress','incomplete_preamble','acknowledgment'])if(kinds.includes(kind))return {kind,hasCompletedPreamble};
 return {kind:'unclassified',hasCompletedPreamble};
}
export function answerKind(text,topic,options){return classifyText(text,topic,options).kind;}
export function createVoiceTiming({emit,clock=()=>performance.now()}={}){
 const origin=clock(),backends=new Map(),responses=new Map(),calls=new Map();
 let current,turnIndex=0,stopped=false,routingPolicy='unavailable';
 const write=(stage,turn,extra={})=>{if(stopped)return;try{emit({timingStage:stage,timingClassifierVersion,routingPolicy:turn?.routingPolicy||routingPolicy,turnIndex:turn?.index||0,offsetMs:Math.max(0,clock()-origin),boundary:turn?.boundary||'unavailable',...extra});}catch{}};
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
  write('turn_complete',current,{timingOutcome:outcome,observedDelegations,routingObservation,preambleResponseCount:current.preambleResponses.size,...(current.playedCandidate!==undefined?{timingAudioEvidence:'audio_energy_after_transcript'}:{}),...measures});
 }
 function span(stage,turn=current){const at=clock();let done=false;return (outcome='completed',extra={})=>{if(done)return;done=true;write(stage,turn,{durationMs:clock()-at,timingOutcome:outcome,...extra});};}
 function observeTranscript(response,responseId,streaming){
  const {kind,hasCompletedPreamble}=classifyText(response.text,response.topic,{streaming});
  if(response.turn===current&&current&&!current.finished){
   if(hasCompletedPreamble)current.preambleResponses.add(responseId);
   if(response.kind!==kind&&(response.classificationCount||0)<16){response.classificationCount=(response.classificationCount||0)+1;write('transcript_classified',current,{timingTextKind:kind,preambleResponseCount:current.preambleResponses.size});}
   if(kind==='answer_candidate'){
    // This observes when enough transcript is available to classify a clause,
    // not its first spoken word. Missing punctuation may defer it to done.
    if(current.candidate===undefined){current.candidate=clock();write('answer_candidate',current,{timingTextKind:kind,...(current.end!==undefined?{durationMs:clock()-current.end}:{})});}
    if(!responses.has(current.candidateResponse))current.candidateResponse=responseId;
   }
  }
  response.kind=kind;
 }
 function event(e){
  if(stopped)return;
  const type=e.type;
  if(type==='origen.configuration.applied'&&Number.isFinite(e.durationMs)&&e.durationMs>=0){write('configuration_ack',current,{durationMs:e.durationMs,timingOutcome:'completed'});return;}
  if(type==='session.created'||type==='session.updated'){setRouting(e.session?.routingPolicy);return;}
  if(type==='input_audio_buffer.speech_started'){
   for(const [id,response]of responses)if(response.backend)responses.delete(id);
   finish('interrupted');current={index:++turnIndex,itemId:e.item_id,routingPolicy,backendIds:new Set(),preambleResponses:new Set(),routingUnknown:[...backends.values()].some(work=>!work.turn),boundary:e.liveBoundary==='transcript_observed'?'transcript_quiet_estimate':'provider_vad'};
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
   response.text=((response.text||'')+String(e.delta||'')).slice(0,16000);
   observeTranscript(response,responseId,true);return;
  }
  if(type==='response.done'){
   if(response&&!response.backend){
    if(response.turn===current&&['failed','cancelled','incomplete'].includes(e.response.status))finish(e.response.status);
    // Retain classification until the playback boundary; drop the text there.
    observeTranscript(response,responseId,false);
    if(!response.text&&e.response.output?.some(item=>item.type==='function_call'))response.backend=true;
   }
   return;
  }
  if(type==='output_audio_buffer.stopped'||type==='output_audio_buffer.cleared'){
   if(type==='output_audio_buffer.cleared'&&!responseId){finish('interrupted');for(const [id,item]of responses)if(!item.backend)responses.delete(id);return;}
   if(response?.turn===current&&!response.backend&&current?.playedCandidate!==undefined&&responseId===current.candidateResponse){
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
  const active=[...responses.entries()].filter(([,r])=>!r.backend&&r.turn===current);if(active.length!==1||progressTopics.has(active[0][1].topic))return;
  if(current.audio===undefined){current.audio=clock();write('first_audio',current,{timingAudioEvidence:'audio_energy',...(current.end!==undefined?{durationMs:clock()-current.end}:{})});}
  // Energy has no word-aligned playhead: it may still be a preamble even after
  // useful text arrives. Report an estimate, and never attribute mixed responses.
  if(current.candidate!==undefined&&current.playedCandidate===undefined&&active[0][0]===current.candidateResponse&&active[0][1].kind==='answer_candidate'){current.playedCandidate=clock();write('candidate_audio',current,{timingAudioEvidence:'audio_energy_after_transcript',...(current.end!==undefined?{durationMs:clock()-current.end}:{})});}
 }
 return {event:e=>{try{event(e||{});}catch{}},playback,span,
  toolStart(item,responseId){if(stopped||calls.has(item.call_id))return;const turn=responses.get(responseId)?.turn||null;calls.set(item.call_id,{done:span(item.name==='recall_student_context'?'history_tool':item.name==='lookup_education_planning'?'research_tool':'tool',turn)});},
  sent(e){if(e.type==='session.update')setRouting('unavailable');if(e.type==='conversation.item.create'&&e.item?.type==='function_call_output'){const call=calls.get(e.item.call_id);call?.done('returned');calls.delete(e.item.call_id);}},
  stop(){if(stopped)return;for(const work of backends.values())work.done('abandoned');for(const call of calls.values())call.done('abandoned');finish('closed');write('call_complete',undefined);stopped=true;backends.clear();responses.clear();calls.clear();current=undefined;},
 };
}
