import { PREFERENCES, PREFERENCE_ACTIONS } from '../preference-rubric.mjs';

const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const validStamp = stamp => stamp && ['scopeGeneration', 'inputRevision'].every(key => Number.isSafeInteger(stamp[key]) && stamp[key] >= 0)
  && ['questionId', 'studentId', 'sessionId'].every(key => typeof stamp[key] === 'string' && stamp[key].length > 0 && stamp[key].length <= 256);

// Assistant speech invalidates ordinary observations. An explicit ongoing style
// request is different: retain its candidate and let the parent gate recheck the
// caller revision and scope. Never revive a discarded research/support verdict.
export function createPreferenceCandidateBridge({ enabled = false, log = () => {} } = {}) {
  const stamps = new Map(), emitted = new Set();
  const remember = (collection, key, value) => {
    if (collection instanceof Map) collection.set(key, value); else collection.add(key);
    if (collection.size > 64) collection.delete(collection.keys().next().value);
  };
  return Object.freeze({
    capture(snapshot, stamp) {
      if (!enabled || !validStamp(stamp) || !snapshot?.fingerprint || snapshot.closed || !snapshot.authorized) return false;
      const latestUser = [...(snapshot.recentTranscripts ?? [])].reverse().find(turn => turn.role === 'user');
      if (!latestUser?.complete || latestUser.id !== stamp.questionId || snapshot.studentId !== stamp.studentId || snapshot.callId !== stamp.sessionId) return false;
      remember(stamps, snapshot.fingerprint, { scopeGeneration: stamp.scopeGeneration, inputRevision: stamp.inputRevision,
        questionId: stamp.questionId, studentId: stamp.studentId, sessionId: stamp.sessionId });
      return true;
    },
    project(row) {
      const filtered = reason => {
        if (enabled) log({ type: 'decisions_preference_candidate_filtered', reason,
          callId: row?.callId ?? null, studentId: row?.studentId ?? null, fingerprint: row?.fingerprint ?? null,
          operationId: row?.operationId ?? null, requestId: row?.requestId ?? null,
          sourceStatus: row?.status ?? null, contextSent: false, playbackClaim: false });
        return null;
      };
      const stamp = stamps.get(row?.fingerprint);
      stamps.delete(row?.fingerprint);
      if (!enabled) return null;
      if (!stamp) return filtered('no_matching_caller_stamp');
      if (row.studentId !== stamp.studentId || row.callId !== stamp.sessionId) return filtered('scope_mismatch');
      if (!(row.status === 'completed' || row.status === 'discarded' && row.reason === 'stale_after_request')) return filtered('record_status_ineligible');
      const changes = row.result?.preferenceChanges;
      if (!Array.isArray(changes) || changes.length !== PREFERENCES.length
        || changes.some((change, index) => change?.preference !== PREFERENCES[index]
          || !PREFERENCE_ACTIONS.includes(change.action) || !probability(change.confidence) || !probability(change.selectedProbability))) return filtered('invalid_preference_result');
      const key = JSON.stringify(stamp);
      if (emitted.has(key)) return filtered('duplicate_caller_stamp');
      remember(emitted, key);
      return { type: 'preference_candidate', stamp,
        record: { status: 'completed', sourceStatus: row.status, sourceReason: row.reason ?? null,
          operationId: row.operationId, requestId: row.requestId, callId: row.callId, studentId: row.studentId,
          sourceTranscriptIds: row.sourceTranscriptIds, result: { preferenceChanges: Object.fromEntries(changes.map(change => [change.preference, {
            action: change.action, selectedProbability: change.selectedProbability, confidence: change.confidence,
          }])) } } };
    },
    clear() { stamps.clear(); emitted.clear(); },
  });
}
