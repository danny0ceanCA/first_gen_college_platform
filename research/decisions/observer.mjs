import { randomUUID } from 'node:crypto';
import { buildDecisionRequest, parseDecisionResponse, shadowDisposition, RUBRIC_VERSION } from './rubric.mjs';

const legacyPolicy = Object.freeze({ version: RUBRIC_VERSION, buildRequest: buildDecisionRequest,
  parseResponse: parseDecisionResponse, disposition: shadowDisposition });

// The only output is a local observation. There is deliberately no delivery callback.
export function createObserver({ state, client, budget, mode = 'off', threshold = null, onRecord = () => {}, maxEvaluations = 12, researchReserve = 0, policy = legacyPolicy }) {
  if (!['off', 'observe'].includes(mode)) throw new Error('unsupported_observer_mode');
  if (!Number.isInteger(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > 60) throw new Error('invalid_evaluation_limit');
  if (!Number.isInteger(researchReserve) || researchReserve < 0 || researchReserve >= maxEvaluations) throw new Error('invalid_research_reserve');
  if (!policy || typeof policy.version !== 'string' || !policy.version || policy.version.length > 100
    || ['buildRequest', 'parseResponse', 'disposition'].some(key => typeof policy[key] !== 'function')) throw new Error('invalid_observation_policy');
  let active = false, stopped = false, pending = null, count = 0, ordinaryCount = 0, controller;
  const seen = new Set(), records = [], waiters = [];
  function record(snapshot, details) {
    const row = Object.freeze({
      at: new Date().toISOString(), rubricVersion: policy.version,
      accountId: snapshot.accountId, callId: snapshot.callId, studentId: snapshot.studentId,
      permissionRevision: snapshot.permissionRevision, connectionEpoch: snapshot.connectionEpoch,
      scopeEpoch: snapshot.scopeEpoch, questionRevision: snapshot.questionRevision, inputRevision: snapshot.inputRevision,
      fingerprint: snapshot.fingerprint,
      sourceTranscriptIds: snapshot.recentTranscripts.map(t => t.id),
      researchJobIds: [...new Set([...snapshot.researchFindings, ...(snapshot.researchTasks ?? [])].map(f => f.jobId))],
      researchTaskEvidence: (snapshot.researchTasks ?? []).map(task => ({ jobId: task.jobId, revision: task.revision,
        status: task.status, evidenceAvailability: task.evidenceAvailability, findingCount: task.findings.length })),
      intervention: false, contextSent: false, playbackClaim: false,
      evaluationCount: count, ordinaryEvaluationCount: ordinaryCount, maxEvaluations, researchReserve,
      ...details,
    });
    records.push(row);
    if (records.length > 256) records.shift();
    try { onRecord(row); } catch { /* Diagnostics cannot authorize or trigger an action. */ }
    return row;
  }
  function releaseWaiters() { if (!active && !pending) waiters.splice(0).forEach(resolve => resolve()); }
  function limitReason(trigger) {
    if (count >= maxEvaluations) return 'evaluation_limit';
    if (!trigger.researchChanged && ordinaryCount >= maxEvaluations - researchReserve) return 'research_capacity_reserved';
    return null;
  }
  async function run({ snapshot, trigger }) {
    active = true;
    controller = new AbortController();
    let reservation, outcome, settled = false;
    const started = performance.now();
    const operationId = randomUUID();
    try {
      if (!state.matches(snapshot) || stopped) { record(snapshot, { status: 'discarded', reason: 'stale_before_request' }); return; }
      const limit = limitReason(trigger);
      if (limit) { record(snapshot, { status: 'skipped', reason: limit, trigger }); return; }
      const request = policy.buildRequest(snapshot, { operationId });
      reservation = budget.reserve({ operationId, metadata: { callId: snapshot.callId, snapshotHash: snapshot.fingerprint } });
      count++;
      if (!trigger.researchChanged) ordinaryCount++;
      outcome = await client.evaluate(request, { signal: controller.signal });
      // Usage is accounted even when its classification has become stale.
      budget.settle(reservation.id, outcome.response?.usage);
      settled = true;
      const parsed = policy.parseResponse(outcome.response);
      const stale = stopped || !state.matches(snapshot);
      record(snapshot, {
        operationId, requestId: outcome.requestId, model: outcome.response?.model,
        durationMs: outcome.durationMs, usage: outcome.response?.usage,
        status: stale ? 'discarded' : parsed.status,
        reason: stale ? 'stale_after_request' : parsed.reason,
        result: parsed.result,
        disposition: stale ? 'stale' : policy.disposition(snapshot, parsed.result, threshold),
        trigger,
      });
    } catch (error) {
      if (reservation && !settled) {
        try { budget.markUnknown(reservation.id, error.code || 'unresolved_request'); }
        catch { stopped = true; /* A broken ledger disables observation, never voice. */ }
      }
      record(snapshot, { operationId, status: 'unavailable', reason: error.code || error.message || 'observer_error', result: null,
        requestId: outcome?.requestId ?? error.requestId ?? null, usage: outcome?.response?.usage ?? null,
        providerStatus: error.status ?? null, durationMs: outcome?.durationMs ?? error.durationMs ?? performance.now() - started });
    } finally {
      active = false;
      controller = null;
      const next = pending;
      pending = null;
      if (next && !stopped && !limitReason(next.trigger)) void run(next);
      else {
        if (next) record(next.snapshot, { status: 'skipped', reason: stopped ? 'closed' : limitReason(next.trigger), trigger: next.trigger });
        releaseWaiters();
      }
    }
  }
  return {
    // Synchronous enqueue: no consumer has to await inference.
    observe(snapshot = state.snapshot(), { researchChanged = false } = {}) {
      if (mode === 'off') return { queued: false, reason: 'disabled' };
      if (stopped || snapshot.closed || !snapshot.authorized) return { queued: false, reason: 'closed_or_unauthorized' };
      if (!state.matches(snapshot)) return { queued: false, reason: 'stale' };
      // Coalescing keeps a genuine pending research update eligible when a newer
      // caller turn carries the same complete evidence and scope. This does not
      // resurrect an outdated task or create an extra request.
      const retainedResearch = pending?.trigger.researchChanged === true
        && snapshot.studentId === pending.snapshot.studentId && snapshot.callId === pending.snapshot.callId
        && snapshot.scopeEpoch === pending.snapshot.scopeEpoch && snapshot.connectionEpoch === pending.snapshot.connectionEpoch
        && JSON.stringify(snapshot.researchTasks ?? []) === JSON.stringify(pending.snapshot.researchTasks ?? []);
      const trigger = { researchChanged: researchChanged === true || retainedResearch === true };
      const limit = limitReason(trigger);
      if (limit) return { queued: false, reason: limit };
      const evidenceKey = snapshot.relevanceFingerprint ?? snapshot.fingerprint;
      if (seen.has(evidenceKey)) return { queued: false, reason: 'duplicate' };
      seen.add(evidenceKey);
      if (seen.size > 128) seen.delete(seen.values().next().value);
      if (active) {
        if (pending) record(pending.snapshot, { status: 'skipped', reason: 'coalesced', trigger: pending.trigger });
        pending = { snapshot, trigger };
      } else void run({ snapshot, trigger });
      return { queued: true };
    },
    idle() { return !active && !pending ? Promise.resolve() : new Promise(resolve => waiters.push(resolve)); },
    close() {
      stopped = true;
      if (pending) record(pending.snapshot, { status: 'skipped', reason: 'closed', trigger: pending.trigger });
      pending = null;
      controller?.abort();
      releaseWaiters();
    },
    records() { return structuredClone(records); },
  };
}
