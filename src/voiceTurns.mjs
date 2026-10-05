// Serialize replies across transcription, interruptions and asynchronous tool calls.
export function voiceTurns(send, onRecovery = () => {}, {schedule=setTimeout,cancel=clearTimeout,transcriptionTimeout=12000,onMissing=()=>{}}={}) {
  let active = false, pending = false, tools = 0;
  let interrupted = false, heardSpeech = false, recoveryUsed = false, resume = false;
  const seen = new Set(), finished = new Set(), awaiting = new Set();
  const timers=new Map();
  let stopped=false;
  let progressActive = false, progressId = '', progressEvent = '';
  const progressResponses = new Set();
  const progressRequests = new Set();
  function flush() {
    if (!pending || active || progressActive || tools || awaiting.size) return;
    active = true; pending = false;
    if (resume) {
      resume = false; recoveryUsed = true; onRecovery();
      send({type:'response.create'});
    } else send({type:'response.create'});
  }
  function request() { pending = true; flush(); }
  return {
    busy(){return !stopped&&Boolean(active||pending||tools||awaiting.size||progressActive);},
    request,
    speechStopped(itemId){
      if(stopped||!awaiting.has(itemId)||timers.has(itemId))return;
      timers.set(itemId,schedule(()=>{timers.delete(itemId);awaiting.delete(itemId);onMissing(itemId);flush();},transcriptionTimeout));
    },
    stop(){stopped=true;for(const timer of timers.values())cancel(timer);timers.clear();awaiting.clear();},
    progress(sentence) {
      if (!tools || active || progressActive || awaiting.size) return false;
      progressActive = true;
      progressEvent = send({type:'response.create',response:{conversation:'none',metadata:{topic:'origen_lookup_progress'},input:[],output_modalities:['audio'],tool_choice:'none',instructions:`Say exactly this brief status update and nothing else: ${sentence}`}}) || '';
      if (progressEvent) progressRequests.add(progressEvent);
      return true;
    },
    progressEvent(event) {
      if (event.response?.metadata?.topic === 'origen_lookup_progress') {
        progressId = event.response.id;
        if (progressId) progressResponses.add(progressId);
        if (event.type === 'response.created' && awaiting.size && progressId) {
          const id = send({type:'response.cancel',response_id:progressId});
          if (id) progressRequests.add(id);
        }
      }
      const owned = progressResponses.has(event.response_id || event.response?.id);
      const failed = event.type === 'error' && progressEvent && event.error?.event_id === progressEvent;
      if ((owned && event.type === 'response.done') || failed) {
        progressActive = false; progressId = ''; progressEvent = ''; flush();
      }
      return Boolean(owned || (event.type === 'error' && progressRequests.has(event.error?.event_id)));
    },
    created() { active = true; interrupted = false; heardSpeech = false; },
    speechStarted(itemId) {
      if (itemId) { awaiting.add(itemId); if (active) interrupted = true; }
      if (progressActive && progressId) {
        const id = send({type:'response.cancel',response_id:progressId});
        if (id) progressRequests.add(id);
      }
    },
    // Lock before awaiting a lookup so overlapping events cannot create a reply.
    beginDone(responseId, hasTools = false, cancelled = false) {
      if (responseId && finished.has(responseId)) return false;
      if (responseId) finished.add(responseId);
      active = false;
      if (cancelled && interrupted && !heardSpeech && !recoveryUsed) resume = true;
      if (hasTools) tools++;
      return true;
    },
    toolsCompleted() { tools = Math.max(0, tools - 1); request(); },
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
