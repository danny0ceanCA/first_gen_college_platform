// response.done means generation finished, not that the person heard the audio.
export function voiceSaveCompletion(complete,{onEvent=()=>{},now=()=>performance.now(),retryAfterInterruption=true}={}){
 let armed=false,responseId,generated=false,drained=false,finished=false,began=0,audioStarted=false;
 const emit=(name,metadata={})=>{try{onEvent(name,metadata);}catch{}};
 const interrupt=reason=>{emit('save_confirmation_interrupted',{reason});responseId=undefined;generated=false;drained=false;if(!retryAfterInterruption)finished=true;};
 const finish=(reason='drained')=>{if(!armed||finished)return;finished=true;emit(reason==='drained'?'save_confirmation_finished':'save_confirmation_skipped',{durationMs:Math.round(Math.max(0,Math.min(600000,now()-began))),...(reason==='drained'?{status:'drained'}:{reason})});complete(reason);};
 return {
  arm(){if(!finished&&!armed){armed=true;began=now();emit('save_confirmation_waiting');}},
  event(event){
   if(!armed||finished)return;
   if(event.type==='response.created'&&!responseId&&event.response?.metadata?.topic!=='origen_lookup_progress'){responseId=event.response?.id;audioStarted=false;if(responseId)emit('save_confirmation_started');}
   if(!responseId)return;
   if(event.type==='output_audio_buffer.started'&&event.response_id===responseId&&!audioStarted){audioStarted=true;emit('save_confirmation_audio_started');}
   if(event.type==='response.done'&&event.response?.id===responseId){
    if(event.response.status!=='completed'){interrupt(['cancelled','failed','incomplete'].includes(event.response.status)?event.response.status:'unknown');return;}
    // If another tool was called, wait for the actual spoken confirmation.
    if(event.response.output?.some(item=>item.type==='function_call')){responseId=undefined;generated=false;drained=false;return;}
    generated=true;
   }
   if(event.type==='output_audio_buffer.stopped'&&event.response_id===responseId)drained=true;
   if(event.type==='output_audio_buffer.cleared'&&event.response_id===responseId)interrupt('buffer_cleared');
   if(generated&&drained)finish();
  },
  ended:(reason='call_ended')=>finish(reason),
 };
}
