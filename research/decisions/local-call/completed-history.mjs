import { explanationHistoryInput } from './explanation-history.mjs';

// Side evidence must not mutate the immutable observer snapshot: its hash is
// used before and after inference to reject changed caller/task state.
export function createCompletedHistoryEvidence({ maximum = 32 } = {}) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 32) throw Error('invalid_history_capture_limit');
  const captures = new Map();
  const scope = value => JSON.stringify([value.accountId, value.callId, value.studentId, value.language,
    value.connectionEpoch, value.scopeEpoch, value.permissionRevision]);
  return {
    capture(snapshot, early) {
      if (!snapshot?.authorized || snapshot.closed || typeof snapshot.fingerprint !== 'string'
        || !early?.usable || ['callId', 'studentId', 'language', 'connectionEpoch'].some(key => early[key] !== snapshot[key])
        || !explanationHistoryInput(early.explanationHistory)) return false;
      if (captures.has(snapshot.fingerprint)) return false;
      captures.set(snapshot.fingerprint, { scope: scope(snapshot), history: structuredClone(early.explanationHistory) });
      while (captures.size > maximum) captures.delete(captures.keys().next().value);
      return true;
    },
    enrich(snapshot) {
      const capture = captures.get(snapshot?.fingerprint);
      if (!capture || capture.scope !== scope(snapshot) || !snapshot.authorized || snapshot.closed) return snapshot;
      return { ...snapshot, explanationHistory: structuredClone(capture.history) };
    },
    release(fingerprint) { captures.delete(fingerprint); },
    clear() { captures.clear(); },
    size() { return captures.size; },
  };
}
