import {brandVoicePronunciation} from './voiceStyle.mjs';

// Serialize replies across transcription, interruptions and asynchronous tool calls.
export function voiceTurns(send, onRecovery = () => {}, {schedule=setTimeout,cancel=clearTimeout,transcriptionTimeout=12000,onMissing=()=>{},onBusy=()=>{}}={}) {
  let active = false, pending = false, tools = 0, replyHolds = 0;
  let interrupted = false, heardSpeech = false, recoveryUsed = false, resume = false;
  const seen = new Set(), finished = new Set(), awaiting = new Set();
  const timers=new Map();
  const playing=new Set();
  let stopped=false;
  let progressActive = false, progressId = '', progressEvent = '';
  let progressSequence = 0, progressToken = '';
  const progressResponses = new Set();
  const progressRequests = new Set();
  const retiredProgress = new Set();
  let lastBusy;
  const busy=()=>!stopped&&Boolean(active||pending||tools||replyHolds||awaiting.size||progressActive||playing.size);
  function notify(){const next=busy();if(next!==lastBusy){lastBusy=next;onBusy(next);}}
  function flush() {
    try{
    if (stopped || !pending || active || progressActive || tools || replyHolds || awaiting.size || playing.size) return;
    active = true; pending = false;
    if (resume) {
      resume = false; recoveryUsed = true; onRecovery();
      send({type:'response.create'});
    } else send({type:'response.create'});
    }finally{notify();}
  }
  function request() { pending = true; flush(); }
  function cancelProgress(id){
    if(!id)return;
    retiredProgress.add(id);
    try{
      const event=send({type:'response.cancel',response_id:id});
      if(event)progressRequests.add(event);
      if(playing.has(id))send({type:'output_audio_buffer.clear'});
    }catch{/* A failed status cancellation must still release the local reply. */}
    finally{playing.delete(id);}
  }
  return {
    busy,
    playback(event){
      if(stopped)return;
      if(retiredProgress.has(event.response_id))return;
      if(event.type==='output_audio_buffer.started')playing.add(event.response_id||'audio');
      if(event.type==='output_audio_buffer.stopped'||event.type==='output_audio_buffer.cleared'){
        const clearedAnswer=event.type==='output_audio_buffer.cleared'&&(event.response_id?playing.has(event.response_id)&&!progressResponses.has(event.response_id):[...playing].some(id=>!progressResponses.has(id)));
        // Generation can finish before playback. Noise may clear that buffered
        // audio without producing another response.done cancellation event.
        if(clearedAnswer&&interrupted&&!heardSpeech&&!recoveryUsed){resume=true;pending=true;}
        if(event.response_id)playing.delete(event.response_id);else playing.clear();
        flush();
      }
      notify();
    },
    request,
    holdReply(){
      if(stopped)return ()=>{};
      replyHolds++;notify();let released=false;
      return ()=>{if(released)return;released=true;replyHolds=Math.max(0,replyHolds-1);if(!stopped)flush();};
    },
    speechStopped(itemId){
      if(stopped||!awaiting.has(itemId)||timers.has(itemId))return;
      timers.set(itemId,schedule(()=>{timers.delete(itemId);awaiting.delete(itemId);onMissing(itemId);if(resume&&!awaiting.size)pending=true;flush();},transcriptionTimeout));
    },
    stop(){stopped=true;for(const timer of timers.values())cancel(timer);timers.clear();awaiting.clear();playing.clear();notify();},
    progress(sentence) {
      if (stopped || !tools || active || progressActive || awaiting.size || playing.size) return false;
      progressActive = true;
      progressToken = String(++progressSequence);
      try{
        progressEvent = send({type:'response.create',response:{conversation:'none',metadata:{topic:'origen_lookup_progress',request:progressToken},input:[],output_modalities:['audio'],tool_choice:'none',instructions:`${brandVoicePronunciation}\nKeep the same warm voice, volume and pace as this call. No greeting, filler or extra claims. Say only this brief status update: ${sentence}`}}) || '';
      }catch{progressActive=false;progressEvent='';notify();return false;}
      if(!progressEvent){progressActive=false;notify();return false;}
      if (progressEvent) progressRequests.add(progressEvent);
      notify();return true;
    },
    endProgress(){
      // An expired/cancelled lookup cannot wait indefinitely for status audio.
      const ids=new Set([progressId,...[...playing].filter(id=>progressResponses.has(id))]);
      try{for(const id of ids)cancelProgress(id);}finally{
        progressActive=false;progressId='';progressEvent='';progressToken='';flush();
      }
    },
    progressEvent(event) {
      if (event.response?.metadata?.topic === 'origen_lookup_progress') {
        const id=event.response.id,token=event.response.metadata.request;
        if(id)progressResponses.add(id);
        if(!progressActive||(token&&token!==progressToken)){
          if(event.type==='response.created')cancelProgress(id);
          return true;
        }
        progressId = id;
        if (event.type === 'response.created' && awaiting.size && progressId) {
          const id = send({type:'response.cancel',response_id:progressId});
          if (id) progressRequests.add(id);
        }
      }
      const owned = progressResponses.has(event.response_id || event.response?.id);
      const failed = event.type === 'error' && progressEvent && event.error?.event_id === progressEvent;
      if ((owned && event.type === 'response.done' && !retiredProgress.has(event.response?.id)) || failed) {
        progressActive = false; progressId = ''; progressEvent = ''; flush();
      }
      return Boolean(owned || (event.type === 'error' && progressRequests.has(event.error?.event_id)));
    },
    created() { active = true; interrupted = false; heardSpeech = false;notify(); },
    speechStarted(itemId) {
      if (itemId) { awaiting.add(itemId); if (active||[...playing].some(id=>!progressResponses.has(id))) interrupted = true; }
      if (progressActive && progressId) {
        const id = send({type:'response.cancel',response_id:progressId});
        if (id) progressRequests.add(id);
      }
      notify();
    },
    // Lock before awaiting a lookup so overlapping events cannot create a reply.
    beginDone(responseId, hasTools = false, cancelled = false) {
      if (responseId && finished.has(responseId)) return false;
      if (responseId) finished.add(responseId);
      active = false;
      if (cancelled && interrupted && !heardSpeech && !recoveryUsed) resume = true;
      if (hasTools) tools++;
      notify();
      return true;
    },
    toolsCompleted() { tools = Math.max(0, tools - 1); request(); },
    failed(responseId, retry = false) {
      if(stopped || responseId && finished.has(responseId))return false;
      if(responseId)finished.add(responseId);
      active=false;resume=false;
      // Keep a newer user request queued, but never retry permanently on errors.
      if(retry)pending=true;
      flush();return true;
    },
    completed(continueTool = false) {
      active = false;
      if (continueTool) pending = true;
      if (resume && !awaiting.size) pending = true;
      flush();
    },
    recover(code) {
      if (code !== 'conversation_already_has_active_response') return false;
      // The server's active reply will deliver response.done; do not retry now.
      active = true; pending = true;
      notify();
      return true;
    },
    transcript(itemId, text) {
      if(stopped)return false;
      if(timers.has(itemId)){cancel(timers.get(itemId));timers.delete(itemId);}
      if (!itemId || seen.has(itemId)) return false;
      seen.add(itemId); awaiting.delete(itemId);
      if (typeof text !== 'string' || !/[\p{L}\p{N}]/u.test(text)) {
        // Ignore empty audio locally. Deleting an audio item that is no longer
        // available can produce invalid_value and must not end a conversation.
        if (resume && !awaiting.size) pending = true;
        flush();
        return false;
      }
      heardSpeech = true; resume = false; recoveryUsed = false;
      request();
      return true;
    },
  };
}
