// response.done means generation finished, not that the person heard the audio.
export function voiceSaveCompletion(complete){
 let armed=false,responseId,generated=false,drained=false,finished=false;
 const finish=()=>{if(!armed||finished)return;finished=true;complete();};
 return {
  arm(){if(!finished)armed=true;},
  event(event){
   if(!armed||finished)return;
   if(event.type==='response.created'&&!responseId&&event.response?.metadata?.topic!=='origen_lookup_progress')responseId=event.response?.id;
   if(!responseId)return;
   if(event.type==='response.done'&&event.response?.id===responseId){
    if(event.response.status!=='completed'){responseId=undefined;generated=false;drained=false;return;}
    // If another tool was called, wait for the actual spoken confirmation.
    if(event.response.output?.some(item=>item.type==='function_call')){responseId=undefined;generated=false;drained=false;return;}
    generated=true;
   }
   if(event.type==='output_audio_buffer.stopped'&&event.response_id===responseId)drained=true;
   if(event.type==='output_audio_buffer.cleared'&&event.response_id===responseId){responseId=undefined;generated=false;drained=false;}
   if(generated&&drained)finish();
  },
  ended:finish,
 };
}
