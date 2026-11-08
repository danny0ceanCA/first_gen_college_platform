const actions = {
  confusion: ['needs_simpler_explanation', 'resolved', 'topic_changed', 'none', 'unclear'],
  continuation: ['accepted_conversational_offer', 'declined', 'none', 'unclear'],
};
export function validConversationSupport(value) {
  return value && Object.entries(actions).every(([key, labels]) => labels.includes(value[key]?.action)
    && ['confidence', 'selectedProbability'].every(field => Number.isFinite(value[key][field])
      && value[key][field] >= 0 && value[key][field] <= 1));
}
export function createConversationCandidateBridge({ enabled = false, log = () => {} } = {}) {
  const stamps = new Map(), emitted = new Set();
  const bound = collection => { if (collection.size > 64) collection.delete(collection.keys().next().value); };
  return {
    capture(snapshot, stamp) {
      const caller = [...(Array.isArray(snapshot?.recentTranscripts) ? snapshot.recentTranscripts : [])].reverse().find(turn => turn?.role === 'user');
      if (!enabled || !snapshot?.authorized || snapshot.closed || !stamp
        || !['scopeGeneration', 'inputRevision'].every(key => Number.isSafeInteger(stamp[key]) && stamp[key] >= 0)
        || !caller?.complete || caller.id !== stamp.questionId || snapshot.studentId !== stamp.studentId
        || snapshot.callId !== stamp.sessionId) return false;
      stamps.set(snapshot.fingerprint, { ...stamp }); bound(stamps); return true;
    },
    project(row) {
      const stamp = stamps.get(row?.fingerprint); stamps.delete(row?.fingerprint);
      if (!enabled || !stamp) return null;
      const reject = reason => { log({ type: 'decisions_conversation_candidate_filtered', reason,
        callId: row.callId, operationId: row.operationId, contextSent: false, playbackClaim: false }); return null; };
      if (row.callId !== stamp.sessionId || row.studentId !== stamp.studentId) return reject('scope_mismatch');
      if (!Array.isArray(row.sourceTranscriptIds) || row.sourceTranscriptIds.some(id => typeof id !== 'string')
        || !row.sourceTranscriptIds.includes(stamp.questionId)) return reject('source_mismatch');
      if (!(row.status === 'completed' || row.status === 'discarded' && row.reason === 'stale_after_request')) return reject('ineligible_status');
      if (!validConversationSupport(row.result?.conversationSupport)) return reject('invalid_classification');
      const key = JSON.stringify(stamp);
      if (emitted.has(key)) return reject('duplicate_caller');
      emitted.add(key); bound(emitted);
      return { type: 'conversation_candidate', stamp, record: {
        status: 'completed', sourceStatus: row.status, sourceReason: row.reason ?? null,
        callId: row.callId, studentId: row.studentId, operationId: row.operationId, requestId: row.requestId,
        sourceTranscriptIds: row.sourceTranscriptIds,
        result: { conversationSupport: Object.fromEntries(Object.keys(actions).map(name => [name, {
          action: row.result.conversationSupport[name].action,
          confidence: row.result.conversationSupport[name].confidence,
          selectedProbability: row.result.conversationSupport[name].selectedProbability,
        }])) },
      } };
    },
    clear() { stamps.clear(); emitted.clear(); },
  };
}
