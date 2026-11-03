// Separate private archive: never send transcript text to operational logging.
export const CAPTURE_EMAIL='danielgojeda.1@gmail.com';
export function capturePayload(event,direction='provider'){
 const type=event?.type;
 if(typeof type!=='string')return null;
 const base={type,direction,itemId:event.item_id||event.item?.id,responseId:event.response_id||event.response?.id};
 if(/transcription.completed$|audio_transcript.done$/.test(type))return {...base,text:event.transcript};
 if(['session.input_transcript.delta','session.output_transcript.delta','response.output_audio_transcript.delta','response.audio_transcript.delta'].includes(type))return {...base,text:event.delta,partial:true};
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
 let queue=[],timer,busy=false,enabled=false,sequence=0,failures=0,paused=false;
 async function flush(){
  clearTimeout(timer);timer=undefined;if(busy||paused||!queue.length)return;
  busy=true;const batch=[];
  while(queue.length&&batch.length<8){if(batch.length&&new TextEncoder().encode(JSON.stringify([...batch,queue[0]])).length>48000)break;batch.push(queue.shift());}
  try{await post(batch);failures=0;}catch(error){failures++;paused=error?.retryable===false;queue.unshift(...batch);if(queue.length>128)queue=queue.slice(0,128);}
  finally{busy=false;if(queue.length&&!paused)timer=setTimeout(()=>void flush(),failures?Math.min(30000,1500*2**Math.min(failures-1,5)):300);}
 }
 return {enable(value){enabled=value===true;},event(event,scope){if(!enabled||!scope.sessionId)return;const data=capturePayload(event);if(!data)return;const encoded=JSON.stringify(data),fragmentId=crypto.randomUUID();const chunks=[];for(let i=0;i<encoded.length;i+=8000)chunks.push(encoded.slice(i,i+8000));
  for(let i=0;i<chunks.length;i++)queue.push({...scope,id:crypto.randomUUID(),sequence:++sequence,clientAt:new Date().toISOString(),data:chunks.length===1?data:{type:'capture.fragment',originalType:data.type,fragmentId,index:i,count:chunks.length,text:chunks[i]}});
  if(queue.length>128){const dropped=queue.length-127;queue.splice(0,dropped);queue.push({...scope,id:crypto.randomUUID(),sequence:++sequence,clientAt:new Date().toISOString(),data:{type:'capture.gap',dropped}});}
  if(!timer&&!paused)timer=setTimeout(()=>void flush(),300);
 },flush};
}
