// Serialize replies across transcription, interruptions and asynchronous tool calls.
export function voiceTurns(send, onRecovery = () => {}) {
  let active = false, pending = false, tools = 0;
  let interrupted = false, heardSpeech = false, recoveryUsed = false, resume = false;
  const seen = new Set(), finished = new Set(), awaiting = new Set();
  function flush() {
    if (!pending || active || tools || awaiting.size) return;
    active = true; pending = false;
    if (resume) {
      resume = false; recoveryUsed = true; onRecovery();
      send({type:'response.create'});
    } else send({type:'response.create'});
  }
  function request() { pending = true; flush(); }
  return {
    request,
    created() { active = true; interrupted = false; heardSpeech = false; },
    speechStarted(itemId) { if (itemId) { awaiting.add(itemId); if (active) interrupted = true; } },
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
