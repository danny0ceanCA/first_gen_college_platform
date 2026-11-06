import {providerVoiceCapture} from './providerVoice.mjs';
// Separate private archive: never send transcript text to operational logging.
export const CAPTURE_EMAIL='danielgojeda.1@gmail.com';
export function capturePayload(event,direction='provider'){
 const type=event?.type;
 if(typeof type!=='string')return null;
 const base={type,direction,itemId:event.item_id||event.item?.id,responseId:event.response_id||event.response?.id};
 if(type==='origen.provider.voice')return {...providerVoiceCapture(event),direction};
 if(type==='origen.client.build')return {...base,buildId:event.buildId};
 if(type==='origen.client.revision')return {...base,revision:event.revision};
 if(type==='origen.control.ready')return {...base,durationMs:event.durationMs};
 if(type==='origen.configuration.applied')return {...base,configurationId:event.configurationId,contextDelivery:event.contextDelivery,durationMs:event.durationMs,contextPacketCount:event.contextPacketCount,instructionPacketCount:event.instructionPacketCount};
 if(type==='origen.selection.context')return {...base,stage:event.stage,callId:event.callId,configurationId:event.configurationId,eventId:event.eventId,durationMs:event.durationMs,startMs:event.startMs,endMs:event.endMs,contextBytes:event.contextBytes};
 if(type==='origen.selection.delivery')return {...base,callId:event.callId,deliveryMode:event.deliveryMode,assistantQuestionObserved:event.assistantQuestionObserved,callerSpeechObserved:event.callerSpeechObserved,durationMs:event.durationMs,stage:event.stage,eventId:event.eventId};
 if(type==='origen.control.tool_call')return {...base,name:event.item?.name,callId:event.item?.call_id,arguments:event.item?.arguments};
 if(type==='origen.control.tool_result')return {...base,callId:event.callId,output:event.output,durationMs:event.durationMs};
 if(type==='origen.research.state_changed')return {...base,requestId:event.requestId,revision:event.revision,jobId:event.jobId,state:event.state};
 if(type==='origen.research.delivery')return {...base,requestId:event.requestId,revision:event.revision,jobId:event.jobId,evidenceVersion:event.evidenceVersion,researchPending:event.researchPending,deliveryStage:event.deliveryStage,deliveryReason:event.deliveryReason,durationMs:event.durationMs};
 if(['origen.research.supplied','origen.research.context_acknowledged','origen.research.context_failed','origen.research.announced','origen.research.native_reply_observed'].includes(type))return {...base,requestId:event.requestId,revision:event.revision,jobId:event.jobId,evidenceVersion:event.evidenceVersion,researchPending:event.researchPending,durationMs:event.durationMs,packetCount:event.packetCount,contextBytes:event.contextBytes,evidenceFormat:event.evidenceFormat};
 if(type==='origen.research.turn_preserved')return base;
 if(type==='origen.backend.empty')return base;
 if(['origen.research.handoff_recovered','origen.speech.silence_recovered'].includes(type))return base;
 if(/transcription.completed$|audio_transcript.done$/.test(type))return {...base,text:event.transcript};
 if(['session.input_transcript.delta','session.output_transcript.delta','response.output_audio_transcript.delta','response.audio_transcript.delta'].includes(type))return {...base,text:event.delta,partial:true,startMs:event.start_ms,endMs:event.end_ms};
 if(type==='response.create')return {...base,instructions:event.response?.instructions};
 if(type==='response.done')return {...base,status:event.response?.status,usage:event.response?.usage,calls:event.response?.output?.filter(x=>x.type==='function_call').map(x=>({name:x.name,callId:x.call_id,arguments:x.arguments}))};
 if(type==='response.function_call_arguments.done')return {...base,name:event.name,callId:event.call_id,arguments:event.arguments};
 if(type==='conversation.item.create'&&event.item?.type==='function_call_output')return {...base,callId:event.item.call_id,output:event.item.output};
 if(type==='session.update'||type==='session.updated')return {...base,instructions:event.session?.instructions,model:event.session?.model,tools:event.session?.tools?.map(t=>t.name)};
 if(type==='context.received')return {...base,instructions:event.instructions,model:event.model};
 if(type==='diagnostic')return {...base,event:event.event,details:event.details};
 if(type==='error')return {...base,code:event.error?.code,eventId:event.error?.event_id};
 if(['input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','response.created','response.cancel','output_audio_buffer.started','output_audio_buffer.stopped','output_audio_buffer.cleared'].includes(type))return base;
 return null;
}
export function createVoiceCapture(post){
 // Keep events as groups so pressure cannot orphan half of a context payload.
 // Two reserved rows allow a loss marker in flight plus new losses during upload.
 const maxRows=126;
 let queue=[],timer,pending,busy=false,enabled=false,sequence=0,failures=0,paused=false;
 const row=(data,scope)=>({...scope,id:crypto.randomUUID(),sequence:++sequence,clientAt:new Date().toISOString(),data});
 const priority=data=>data.partial?0:data.type==='diagnostic'&&['audio_transport_sample','server_event','client_event'].includes(data.event)?1:2;
 function recordLoss(count,scope){
  const existing=queue.find(group=>group.gap&&!group.started);
  // This counts queue losses, potentially spanning connection attempts. It is
  // deliberately not evidence of missing audio or a complete session transcript.
  if(existing)existing.rows[0].data.dropped+=count;
  else queue.push({gap:true,started:false,rows:[row({type:'capture.gap',dropped:count,lossScope:'queue'},scope)]});
 }
 function bound(scope){
  let count=queue.reduce((n,group)=>n+(group.gap?0:group.rows.length),0),dropped=0;
  while(count>maxRows){
   // Started groups include in-flight retries and unsent tails. Finish those
   // groups before discarding any of their fragments.
   const candidates=queue.filter(group=>!group.gap&&!group.started);
   const candidate=candidates.reduce((best,group)=>!best||group.priority<best.priority?group:best,null);
   if(!candidate)break;
   queue.splice(queue.indexOf(candidate),1);count-=candidate.rows.length;dropped+=candidate.rows.length;
  }
  if(dropped)recordLoss(dropped,scope);
 }
 async function flush(){
  clearTimeout(timer);timer=undefined;if(busy||paused||!queue.length)return;
  busy=true;const batch=pending||[];
  if(!pending){outer:for(const group of queue)for(const entry of group.rows){
    if(batch.length===8||batch.length&&new TextEncoder().encode(JSON.stringify([...batch,entry])).length>48000)break outer;
    batch.push(entry);group.started=true;
   }pending=batch;
  }
  try{
   await post(batch);failures=0;pending=undefined;
   const saved=new Set(batch);for(const group of queue)group.rows=group.rows.filter(entry=>!saved.has(entry));
   queue=queue.filter(group=>group.rows.length);
  }catch(error){failures++;paused=error?.retryable===false;}
  // Keep the same IDs and payloads until acknowledged. New events cannot trim
  // a failed batch; retrying it is safe against the server's idempotent insert.
  finally{busy=false;if(queue.length&&!paused)timer=setTimeout(()=>void flush(),failures?Math.min(30000,1500*2**Math.min(failures-1,5)):300);}
 }
 return {enable(value){enabled=value===true;},event(event,scope){if(!enabled||!scope.sessionId)return;const data=capturePayload(event);if(!data)return;const encoded=JSON.stringify(data),fragmentId=crypto.randomUUID();const chunks=[];for(let i=0;i<encoded.length;i+=8000)chunks.push(encoded.slice(i,i+8000));
  queue.push({priority:priority(data),started:false,rows:chunks.map((text,index)=>row(chunks.length===1?data:{type:'capture.fragment',originalType:data.type,fragmentId,index,count:chunks.length,text},scope))});
  bound(scope);
  if(!timer&&!paused)timer=setTimeout(()=>void flush(),300);
 },flush};
}
