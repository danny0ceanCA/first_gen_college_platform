// A generated transcript is not proof that the person heard the question.
// Require matching response creation, successful generation and drained audio.
export function voicePresentation(delivered,currentSequence,canHear=()=>true){
 const responses=new Map();
 return {
  clear(){responses.clear();},
  event(event){
   if(event.type==='input_audio_buffer.speech_started'||event.type==='output_audio_buffer.cleared'){responses.clear();return;}
   const id=event.response?.id||event.response_id;if(!id)return;
   if(event.type==='response.created'){
    while(responses.size>=8)responses.delete(responses.keys().next().value);
    responses.set(id,{sequence:currentSequence(),text:'',parts:new Set(),started:false,complete:false,drained:false});return;
   }
   const row=responses.get(id);if(!row||row.sequence!==currentSequence())return;
   if(event.type==='response.done'){if(event.response.status!=='completed'){responses.delete(id);return;}row.complete=true;}
   if(event.type==='output_audio_buffer.started'){row.started=true;if(!canHear()){responses.delete(id);return;}}
   if(row.started&&!canHear()){responses.delete(id);return;}
   if(event.type==='output_audio_buffer.stopped')row.drained=true;
   if(event.type==='response.output_audio_transcript.done'&&typeof event.transcript==='string'&&!row.parts.has(event.item_id)){
    row.parts.add(event.item_id);row.text=(row.text+' '+event.transcript).trim().slice(0,8000);
   }
   if(row.started&&row.complete&&row.drained&&row.text){responses.delete(id);delivered(row.text);}
  },
 };
}
