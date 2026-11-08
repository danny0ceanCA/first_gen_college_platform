import { createObserverState } from '../state.mjs';

// Application boundaries are estimates. Native intervals and browser playback
// remain separate evidence. No provider writer is accepted here.
export function createCallProjector(seed, observe, log, { allowedStudentIds = [seed.studentId] } = {}) {
  const state = createObserverState(seed);
  const allowed = new Set([...allowedStudentIds, 'unselected']);
  let stopped = false, suspended = false, sequence = 0, scopeGeneration = 0, playback = { idle: false, version: 0 };
  const seen = new Map(), nativeSeen = new Set(), intervals = new Map(), scopeBoundaryFence = new Set();
  const researchEvidence = new Map(), pendingResearch = new Set();
  function resetEligibility() { researchEvidence.clear(); pendingResearch.clear(); }
  function researchKey(task) {
    // Poll revisions, evidence version counters, and queued -> running are not
    // new facts. Preserve complete fact qualifications and terminal outcomes.
    return JSON.stringify({ status: ['completed', 'failed', 'cancelled'].includes(task.status) ? task.status : 'pending',
      availability: task.evidenceAvailability,
      findings: task.findings.map(finding => JSON.stringify({ ...finding, sourceIds: [...finding.sourceIds].sort() })).sort() });
  }
  function capture({ callerChanged = false, reason = 'assistant_context_only' } = {}) {
    const researchJobIds = [...pendingResearch];
    const researchChanged = researchJobIds.length > 0;
    const eligible = callerChanged || researchChanged;
    observe(state, { eligible, callerChanged, researchChanged, researchJobIds,
      reason: researchChanged ? callerChanged ? 'caller_and_research_changed' : 'research_evidence_changed' : reason });
    if (eligible) pendingResearch.clear();
  }
  function stop(reason) {
    if (stopped) return;
    stopped = true; state.apply({ type: 'revoke' });
    resetEligibility();
    log({ type: 'observer_scope_closed', reason, intervention: false });
  }
  function apply(event) {
    const result = state.apply(event);
    if (!result.accepted && result.reason !== 'duplicate') stop(`observer_gap_${result.reason}`);
    return result.accepted;
  }
  function receive(packet) {
    if (stopped) return;
    const event = packet.event;
    if (seed.productionSession === true && packet.source === 'scope' && event?.type === 'scope_changed' && typeof event.studentId === 'string') allowed.add(event.studentId);
    if (!event || typeof event.type !== 'string') return;
    if (packet.source === 'connection' && event.type === 'browser_control_detached') {
      apply({ type: 'reconnect', reason: 'browser_control_detached', atMs: packet.atMs });
      resetEligibility(); intervals.clear();
      scopeBoundaryFence.add('user'); scopeBoundaryFence.add('assistant');
      playback = { idle: false, version: playback.version };
      log({ type: 'observer_connection_gap', reason: 'browser_control_detached', playbackComplete: 'unknown', intervention: false });
      return;
    }
    if (packet.source === 'scope') {
      if (event.type === 'scope_transition') {
        scopeGeneration = Number.isSafeInteger(event.scopeGeneration) ? event.scopeGeneration : scopeGeneration + 1;
        suspended = true; resetEligibility(); apply({ type: 'invalidate' }); return;
      }
      if (event.type === 'scope_changed' && typeof event.studentId === 'string' && allowed.has(event.studentId)) {
        if (apply({ type: 'scope', studentId: event.studentId, language: event.language })) {
          suspended = false; seen.clear(); nativeSeen.clear(); intervals.clear();
          resetEligibility();
          scopeBoundaryFence.add('user'); scopeBoundaryFence.add('assistant');
          log({ type: 'observer_scope_changed', studentId: event.studentId, confirmed: event.confirmed, intervention: false });
        }
        return;
      }
      if (event.type === 'context_changed') { apply({ type: 'context', language: event.language }); return; }
      stop(event.type); return;
    }
    if (packet.source === 'research') {
      if (suspended || event.scopeGeneration !== scopeGeneration) {
        log({ type: 'research_observation_ignored', reason: 'stale_scope', jobId: event.jobId ?? null, intervention: false });
        return;
      }
      if (event.type === 'research_observation_gap') { stop(event.reason); return; }
      if (event.type !== 'research_task') return;
      const result = state.apply(event);
      if (!result.accepted) {
        if (['duplicate', 'stale_research_task'].includes(result.reason)) return;
        stop(`observer_gap_${result.reason}`); return;
      }
      log({ type: 'research_task_observed', jobId: event.jobId, revision: event.revision, status: event.status,
        evidenceVersion: event.evidenceVersion, evidenceAvailability: event.evidenceAvailability,
        findingCount: event.findings.length, evidenceSource: 'copied_backend_result', independentlyVerified: false,
        playbackComplete: 'unknown', intervention: false });
      const task = state.snapshot().researchTasks.find(item => item.jobId === event.jobId);
      const key = researchKey(task), previous = researchEvidence.get(event.jobId);
      const meaningful = previous !== key && (previous !== undefined || task.findings.length > 0
        || ['completed', 'failed', 'cancelled'].includes(task.status));
      researchEvidence.set(event.jobId, key);
      if (researchEvidence.size > 8) researchEvidence.delete(researchEvidence.keys().next().value);
      if (meaningful) pendingResearch.add(event.jobId);
      if (pendingResearch.size > 8) pendingResearch.delete(pendingResearch.values().next().value);
      if (intervals.has('user')) {
        log({ type: 'decision_observation_deferred', reason: 'user_input_incomplete', jobId: event.jobId, intervention: false });
        return;
      }
      if (intervals.has('assistant')) {
        log({ type: 'decision_observation_deferred', reason: 'assistant_output_incomplete', jobId: event.jobId, intervention: false });
        return;
      }
      if (state.snapshot().currentQuestion) capture({ reason: 'research_lifecycle_only' });
      return;
    }
    if (packet.source === 'playback') {
      if (typeof event.idle !== 'boolean' || !Number.isSafeInteger(event.version) || event.version < playback.version
        || event.idle === playback.idle && event.version === playback.version) return;
      playback = { idle: event.idle, version: event.version };
      if (apply({ type: 'playback', id: `play-${++sequence}`, state: event.idle ? 'ended' : 'playing', atMs: packet.atMs })) {
        log({ type: 'playback_observation', version: event.version, idle: event.idle, heard: 'unknown' });
      }
      return;
    }
    if (packet.source === 'native') {
      if (!['session.input_transcript.delta', 'session.output_transcript.delta'].includes(event.type)) return;
      if (typeof event.delta !== 'string' || !event.delta.length) return;
      if (!Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) || event.start_ms < 0 || event.end_ms < event.start_ms) {
        stop('observer_gap_invalid_native_interval'); return;
      }
      const key = event.event_id ?? JSON.stringify([event.type, event.start_ms, event.end_ms, event.delta]);
      if (nativeSeen.has(key)) return;
      nativeSeen.add(key); if (nativeSeen.size > 128) nativeSeen.delete(nativeSeen.values().next().value);
      const role = event.type.includes('input') ? 'user' : 'assistant';
      if (!suspended) {
        apply({ type: 'invalidate' });
        const previous = intervals.get(role);
        const text = previous?.overflow ? null : (previous?.text ?? '') + event.delta;
        const overflow = previous?.overflow === true || Buffer.byteLength(text ?? '') > 8192;
        intervals.set(role, { startMs: Math.min(previous?.startMs ?? event.start_ms, event.start_ms),
          endMs: Math.max(previous?.endMs ?? event.end_ms, event.end_ms), text: overflow ? null : text, overflow });
      }
      log({ type: 'native_transcript_interval', direction: role === 'user' ? 'input' : 'output', eventId: event.event_id ?? null,
        delta: event.delta, startMs: event.start_ms, endMs: event.end_ms, complete: false });
      return;
    }
    if (event.type === 'session.closed') { stopped = true; resetEligibility(); state.apply({ type: 'close' }); return; }
    if (suspended) return;
    let role, id, text;
    if (event.type === 'conversation.item.input_audio_transcription.completed') { role = 'user'; id = event.item_id; text = event.transcript; }
    if (event.type === 'response.output_audio_transcript.done') { role = 'assistant'; id = event.response_id; text = event.transcript; }
    if (!role) return;
    if (typeof id !== 'string' || typeof text !== 'string') { stop('observer_gap_invalid_application_boundary'); return; }
    const key = `${role}:${id}`;
    if (seen.has(key)) { if (seen.get(key) !== text) stop('observer_gap_changed_final_boundary'); return; }
    const interval = intervals.get(role);
    if (scopeBoundaryFence.has(role)) {
      scopeBoundaryFence.delete(role);
      // The live adapter can flush words buffered before the student switch.
      // Only attribute this first estimated span when all of its exact text was
      // also observed after selection. Skip ambiguity; never rewrite the words.
      if (!interval || interval.overflow || interval.text.trim() !== text.trim()) {
        intervals.delete(role); apply({ type: 'invalidate' });
        log({ type: 'decision_observation_deferred', reason: 'scope_boundary_ambiguous', role, intervention: false });
        return;
      }
    }
    if (!apply({ type: 'transcript', id: key, role, text, startMs: interval?.startMs ?? packet.atMs, endMs: interval?.endMs ?? packet.atMs, complete: true })) return;
    if (role === 'user' && !apply({ type: 'question', id: key, text })) return;
    seen.set(key, text); if (seen.size > 128) seen.delete(seen.keys().next().value);
    intervals.delete(role);
    log({ type: 'application_transcript_boundary', role, id: key, boundary: 'application_estimate',
      timingSource: interval ? 'provider_intervals' : 'application_receipt', playbackComplete: 'unknown' });
    // A fresh caller span is meaningful even if it repeats "okay": it may
    // replace an in-flight acceptance whose caller stamp just became stale.
    // Deduplicate event/span IDs above, not distinct spoken contributions.
    const callerChanged = role === 'user', reason = role === 'user' ? 'caller_contribution' : 'assistant_context_only';
    if (intervals.has('user')) {
      log({ type: 'decision_observation_deferred', reason: 'user_input_incomplete', intervention: false });
      return;
    }
    capture({ callerChanged, reason });
  }
  return { receive, state, stop, close() { stopped = true; resetEligibility(); state.apply({ type: 'close' }); } };
}
