import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { buildEarlyRequest, parseEarlyResponse, EARLY_RUBRIC_VERSION } from './early-rubric.mjs';
import { sameEarlyEvidenceStamp } from './early-projector.mjs';

// The projector serializes calls and coalesces newer fragments. This evaluator
// only returns a typed candidate to the parent; it has no Live writer.
export function createEarlyEvaluator({ client, budget, current, onResult, log = () => {},
  now = () => performance.now(), maxEvaluations = 8 } = {}) {
  let closed = false, count = 0, active = null;
  const pending = new Set();
  const matches = snapshot => {
    const latest = current();
    return !closed && latest?.usable && sameEarlyEvidenceStamp(latest.stamp, snapshot.stamp)
      && (latest.supportRevision ?? 0) === (snapshot.supportRevision ?? 0)
      && (latest.assistantOutputRevision ?? 0) === (snapshot.assistantOutputRevision ?? 0);
  };
  async function evaluate(snapshot) {
    const operationId = randomUUID(), startedAt = now();
    const meta = { ...snapshot.stamp, operationId, sourceEventIds: snapshot.sourceEventIds,
      rubricVersion: EARLY_RUBRIC_VERSION, supportRevision: snapshot.supportRevision ?? 0,
      assistantOutputRevision: snapshot.assistantOutputRevision ?? 0, provisional: true, complete: false,
      triggerBasis: snapshot.triggerBasis ?? null,
      explanationHistorySummary: snapshot.explanationHistory ? {
        retainedRows: snapshot.explanationHistory.retainedRows,
        selectedRows: snapshot.explanationHistory.rows.length,
        omittedRows: snapshot.explanationHistory.omittedRows,
        unavailable: snapshot.explanationHistory.unavailable,
        playback: 'unknown', comprehension: 'unknown' } : null,
      contextSent: false, playbackClaim: false };
    const emit = (stage, values = {}) => log({ type: 'early_decisions_' + stage, ...meta, ...values });
    if (!matches(snapshot) || count >= maxEvaluations) {
      emit('skipped', { reason: closed ? 'closed' : count >= maxEvaluations ? 'call_limit' : 'stale_before_request' }); return;
    }
    let reservation, settled = false, outcome;
    const controller = new AbortController(); active = controller;
    try {
      const request = buildEarlyRequest(snapshot);
      const fingerprint = createHash('sha256').update(JSON.stringify(snapshot.stamp)).digest('hex');
      reservation = budget.reserve({ operationId, metadata: { callId: snapshot.callId, snapshotHash: fingerprint } });
      count++;
      emit('started', { reservationId: reservation.id, requestBytes: Buffer.byteLength(JSON.stringify(request)),
        questionCount: request.questions.length, evaluationCount: count, maxEvaluations,
        inputAgeMs: Math.max(0, now() - snapshot.lastObservedAtMs), budget: budget.summary() });
      outcome = await client.evaluate(request, { signal: controller.signal });
      const cost = budget.settle(reservation.id, outcome.response?.usage); settled = true;
      const parsed = parseEarlyResponse(outcome.response, snapshot);
      const fresh = matches(snapshot);
      emit('completed', { reservationId: reservation.id, requestId: outcome.requestId,
        status: parsed.status, reason: parsed.reason ?? null, result: parsed.result, policyDecision: parsed.decision ?? null,
        freshAtWorker: fresh, durationMs: outcome.durationMs, totalMs: now() - startedAt,
        usage: outcome.response?.usage, costUsd: cost.costUsd, budget: budget.summary() });
      if (!closed && parsed.status === 'completed') {
        // The parent independently validates source IDs, current scope, input,
        // playback and intro. Worker freshness never proves spoken delivery.
        onResult({ type: 'early_candidate', stamp: snapshot.stamp, record: {
          status: 'completed', callId: snapshot.callId, studentId: snapshot.studentId,
          sourceEventIds: snapshot.sourceEventIds, operationId, requestId: outcome.requestId,
          result: parsed.result, policyDecision: parsed.decision, freshAtWorker: fresh,
          sourceText: snapshot.text, supportRevision: snapshot.supportRevision ?? 0,
          assistantOutputRevision: snapshot.assistantOutputRevision ?? 0,
          assistantOutputOriginRevision: snapshot.assistantSinceNeed?.originOutputRevision ?? null,
          assistantEvidenceComplete: snapshot.assistantSinceNeed?.evidenceComplete === true,
          sourceOutputEventIds: snapshot.assistantSinceNeed?.sourceEventIds ?? [],
          triggerBasis: snapshot.triggerBasis ?? null, classifiedAtMs: now(),
        } });
      }
    } catch (error) {
      if (reservation && !settled) budget.markUnknown(reservation.id, error.code || 'early_request_unknown');
      emit('failed', { reason: error.code ?? (['invalid_early_evidence'].includes(error.message) ? error.message : 'early_request_failed'),
        requestId: outcome?.requestId ?? error.requestId ?? null, durationMs: now() - startedAt,
        reservationRetained: Boolean(reservation && !settled), budget: budget.summary() });
    } finally { if (active === controller) active = null; }
  }
  return {
    evaluate(snapshot) {
      const work = evaluate(snapshot); pending.add(work);
      void work.finally(() => pending.delete(work)).catch(() => {}); return work;
    },
    close() { closed = true; active?.abort(); },
    async idle() { await Promise.allSettled([...pending]); },
    status() { return { closed, evaluations: count, pending: pending.size }; },
  };
}
