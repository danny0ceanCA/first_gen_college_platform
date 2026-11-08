import {createHash,randomBytes} from 'node:crypto';
import {enumFields} from './observability/event-catalog.mjs';
import {researchTraceKeys} from './research-trace.mjs';
// Only fixed categories, counts and a random per-connection key cross this boundary.
// Native IDs stay in bounded, connection-local maps; content never enters a record.
export function responseMeasurement(data={},httpStatus){
 data=data&&typeof data==='object'?data:{};
 const refusal=(Array.isArray(data.output)?data.output:[]).some(i=>(Array.isArray(i?.content)?i.content:[]).some(c=>c?.type==='refusal'));
 const failureKind=httpStatus===429?'rate_limited':httpStatus>=400?'http_error':refusal?'refusal':
  data.incomplete_details?.reason==='max_output_tokens'?'output_limit':data.status==='incomplete'?'incomplete':data.error||data.status==='failed'?'provider_error':data.status==='completed'?'none':'unknown';
 return {failureKind,inputTokens:data.usage?.input_tokens,outputTokens:data.usage?.output_tokens,
  reasoningTokens:data.usage?.output_tokens_details?.reasoning_tokens,cachedTokens:data.usage?.input_tokens_details?.cached_tokens,...(httpStatus?{httpStatus}:{})};
}
export function liveMeasurements({log=()=>{},config={},sessionId,researchDeliveryV2=false,now=()=>performance.now()}={}){
 const measurementRun=randomBytes(16).toString('hex'),start=now();let sequence=0,turnIndex=0,closed=false;
 const responses=new Map(),research=new Map();let researchSequence=0;
 // Deliberately exclude instructions, input, credentials and person-specific values.
 const fingerprint=value=>createHash('sha256').update(JSON.stringify({version:1,model:'gpt-live-1',backend:'gpt-6-luna',
  language:value.language,routingPolicy:value.routingPolicy,researchDeliveryV2,maxOutputTokens:value.max_output_tokens,
  tools:(value.tools||[]).map(t=>({name:t.name,parameters:t.parameters,strict:false}))})).digest('hex');
 let configurationHash=fingerprint(config);
 const write=(measurementStage,fields={})=>{const {jobId,...safe}=fields;try{log({event:'voice.live.measurement',measurementRun,configurationHash,measurementStage,turnIndex,offsetMs:Math.max(0,now()-start),...safe,...researchTraceKeys(sessionId,jobId)});}catch{/* Measurement never changes the call. */}};
 const usage=data=>responseMeasurement(data);
 return {
  start(){write('configuration',{language:config.language,routingPolicy:config.routingPolicy});},
  native(e){
   if(closed)return;
   if(e.type==='session.usage.updated')write('voice_usage',{voiceSeconds:e.usage?.seconds});
   if(e.type==='session.closed')write('session_closed',{voiceSeconds:e.usage?.seconds,closeReason:['close_requested','expired','content','remote_hangup','connection_lost'].includes(e.reason)?e.reason:'unknown'});
   if(e.type==='error'&&e.error?.code==='responses_validation_failed')write('configuration',{failureKind:'provider_error'});
   if(e.type!=='response.event')return;const v=e.event||{},id=v.response?.id||v.response_id;
   if(v.type==='response.created'){
    while(responses.size>=128)responses.delete(responses.keys().next().value);
    responses.set(id,{index:++sequence,start:now(),tools:new Map()});write('backend_started',{responseIndex:sequence});
   }
   const row=responses.get(id)||[...responses.values()].find(r=>r.delegation===e.delegation_id);
   if(v.type==='response.output_item.done'&&v.item?.type==='function_call'){
    // Envelopes identify a delegation; item events may omit response_id.
    const owner=responses.get(id)||[...responses.values()].find(r=>r.delegation===e.delegation_id);
    if(owner&&owner.tools.size<64){owner.tools.set(v.item.call_id,now());write('tool_ready',{responseIndex:owner.index});}
   }
   if(v.type==='response.created')responses.get(id).delegation=e.delegation_id;
   if(['response.completed','response.failed','response.incomplete','response.cancelled'].includes(v.type)&&row){
    write('backend_finished',{responseIndex:row.index,durationMs:now()-row.start,...usage(v.response)});
    // Retain bounded state until canonical dispatch, which follows this event.
   }
  },
  application(e){
   if(closed)return;
   if(e.type==='input_audio_buffer.speech_started')turnIndex++;
   if(e.type==='response.done'&&e.response?.output?.some(i=>i.type==='function_call')){
    const row=responses.get(e.response.id);
    if(row)for(const item of e.response.output){const ready=row.tools.get(item.call_id);if(ready!==undefined){write('tool_dispatched',{responseIndex:row.index,durationMs:now()-ready});row.tools.delete(item.call_id);}}
   }
   if(e.type==='origen.configuration.applied'){config=e.session||config;write('configuration',{durationMs:e.durationMs});}
   if(e.type==='session.updated'){config={...config,...e.session};configurationHash=fingerprint(config);write('configuration',{language:config.language,routingPolicy:config.routingPolicy});}
   if(e.type==='origen.live.context')write('context_selection',{contextAvailable:e.contextAvailable,contextIncluded:e.contextIncluded,contextBytes:e.contextBytes});
   if(e.type==='origen.selection.recovery'&&enumFields.recoveryStage.includes(e.stage))write('selection_recovery',{
    recoveryStage:e.stage,recoveryReason:enumFields.recoveryReason.includes(e.reason)?e.reason:undefined,
    durationMs:Number.isFinite(e.durationMs)&&e.durationMs>=0?Math.min(e.durationMs,600000):undefined,
   });
   if(e.type==='origen.research.speech_observed')write('speech_observation',{
    jobId:e.jobId,requestRevision:e.revision,
    speechOutcome:e.speechOutcome,completedPortions:e.completedPortions,
    unfinishedPortion:e.unfinishedPortion,playbackObserved:e.playbackObserved,overlapCount:e.overlapCount,
   });
   const stages={...(!researchDeliveryV2?{'origen.research.announced':'commentary_requested','origen.research.native_reply_observed':'native_reply_observed'}:{}),'origen.research.supplied':'supplied','origen.research.context_acknowledged':'context_acknowledged','origen.research.context_failed':'context_failed'};
   if(e.type==='origen.research.delivery'||stages[e.type]){
    const key=e.requestId||e.jobId;
    if(key&&!research.has(key)){while(research.size>=128)research.delete(research.keys().next().value);research.set(key,++researchSequence);}
    write('research_delivery',{jobId:e.jobId,researchIndex:research.get(key),requestRevision:e.revision,deliveryStage:stages[e.type]||e.deliveryStage,deliveryReason:e.deliveryReason,durationMs:e.durationMs,packetCount:e.packetCount,contextBytes:e.contextBytes});}
  },
  close(){if(closed)return;write('control_closed');closed=true;responses.clear();research.clear();},
 };
}
