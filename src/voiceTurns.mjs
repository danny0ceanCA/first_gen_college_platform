// Serialize replies across transcription, interruptions and asynchronous tool calls.
export function voiceTurns(send) {
  let active = false, pending = false, tools = 0;
  const seen = new Set(), finished = new Set(), awaiting = new Set();
  function flush() {
    if (!pending || active || tools || awaiting.size) return;
    active = true; pending = false;
    send({type:'response.create'});
  }
  function request() { pending = true; flush(); }
  return {
    request,
    created() { active = true; },
    speechStarted(itemId) { if (itemId) awaiting.add(itemId); },
    // Lock before awaiting a lookup so overlapping events cannot create a reply.
    beginDone(responseId, hasTools = false) {
      if (responseId && finished.has(responseId)) return false;
      if (responseId) finished.add(responseId);
      active = false;
      if (hasTools) tools++;
      return true;
    },
    toolsCompleted() { tools = Math.max(0, tools - 1); request(); },
    completed(continueTool = false) {
      active = false;
      if (continueTool) pending = true;
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
        flush();
        return false;
      }
      request();
      return true;
    },
  };
}
