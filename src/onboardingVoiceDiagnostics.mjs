// Observe transport/playback signals without retaining words, audio, or provider IDs.
export function onboardingVoiceDiagnostics(record,{now=()=>performance.now()}={}){
 const began=now(),speeches=new Map(),responses=new Map(),seen=new Set(),playing=new Set();
 let stopped=false,speechIndex=0,responseIndex=0,firstSpeech=false,firstAudio=false,elementPlaying=false,blocked=false;
 const duration=start=>Math.round(Math.max(0,Math.min(600000,now()-start)));
 const emit=(name,metadata={})=>{if(!stopped)try{record(name,metadata);}catch{}};
 function response(id){
  if(!id)return {};
  if(!responses.has(id)){if(responses.size>=500)responses.delete(responses.keys().next().value);responses.set(id,++responseIndex);}
  return {responseIndex:responses.get(id)};
 }
 function speech(id){
  if(!id)return null;
  if(!speeches.has(id)){if(speeches.size>=500)speeches.delete(speeches.keys().next().value);speeches.set(id,{speechIndex:++speechIndex});}
  return speeches.get(id);
 }
 function once(key,run){if(seen.has(key))return;seen.add(key);if(seen.size>2000)seen.delete(seen.values().next().value);run();}
 function firstPlayback(){
  if(!firstAudio&&playing.size&&elementPlaying&&!blocked){firstAudio=true;emit('first_agent_audio',{durationMs:duration(began)});}
 }
 return {
  provider(event){
   if(stopped)return;
   const type=event.type,id=event.response_id||event.response?.id;
   if(type==='response.created')response(id);
   if(type==='output_audio_buffer.started'){
    const key=id||'audio';playing.add(key);once('audio-start:'+key,()=>emit('agent_audio_started',response(id)));firstPlayback();
   }
   if(type==='output_audio_buffer.stopped'||type==='output_audio_buffer.cleared'){
    once(type+':'+(id||'audio'),()=>emit(type.endsWith('cleared')?'agent_audio_cleared':'agent_audio_drained',response(id)));
    if(id)playing.delete(id);else playing.clear();
   }
   if(type==='input_audio_buffer.speech_started'){
    const s=speech(event.item_id);if(!s)return;
    once('speech-start:'+event.item_id,()=>{
     s.began=now();emit('user_speech_started',{speechIndex:s.speechIndex});
     if(!firstSpeech){firstSpeech=true;emit('first_user_speech',{durationMs:duration(began)});}
     if(playing.size)emit('speech_during_agent_audio',{speechIndex:s.speechIndex});
    });
   }
   if(type==='input_audio_buffer.speech_stopped'){
    const s=speech(event.item_id);if(s)once('speech-stop:'+event.item_id,()=>emit('user_speech_stopped',{speechIndex:s.speechIndex,...(s.began===undefined?{}:{durationMs:duration(s.began)})}));
   }
   if(type==='response.done'&&['completed','cancelled','failed','incomplete'].includes(event.response?.status))once('response-done:'+id,()=>emit('agent_response_finished',{...response(id),status:event.response.status}));
  },
  transcript(id,status){const s=speech(id);if(s&&['accepted','empty','failed','timeout'].includes(status))once('transcript:'+id+':'+status,()=>emit('user_speech_transcription',{speechIndex:s.speechIndex,status}));},
  playback(state){
   if(stopped)return;
   if(state==='blocked'){elementPlaying=false;if(!blocked)emit('audio_playback_blocked');blocked=true;}
   if(state==='playing'){
    if(!elementPlaying)emit(blocked?'audio_playback_resumed':'audio_playback_started');elementPlaying=true;blocked=false;firstPlayback();
   }
   if(state==='paused'){if(elementPlaying)emit('audio_playback_paused');elementPlaying=false;}
   if(state==='silent'){elementPlaying=false;}
  },
  ready(){return elementPlaying&&!blocked;},
  stop(){stopped=true;speeches.clear();responses.clear();seen.clear();playing.clear();},
 };
}
