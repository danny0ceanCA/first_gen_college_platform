// Local worker telemetry only. Keep request/transcript text, provider response
// text, credentials and private reasoning out of these structured lifecycle rows.
import { diagnosticClassifications } from '../diagnostic-classifications.mjs';
import { MAX_DECISIONS_REQUEST_BYTES, serializeDecisionRequest } from '../client.mjs';
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value) ? value : null;
const elapsed = (now, started) => Number.isFinite(started) ? Math.max(0, now() - started) : null;
const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const usageSummary = usage => usage ? {
  inputTokens: tokens(usage.input_tokens), outputTokens: tokens(usage.output_tokens),
  totalTokens: tokens(usage.total_tokens), cachedInputTokens: tokens(usage.input_tokens_details?.cached_tokens),
  cacheWriteTokens: tokens(usage.input_tokens_details?.cache_write_tokens),
  reasoningTokens: tokens(usage.output_tokens_details?.reasoning_tokens),
} : null;

export function createDecisionDiagnostics({ log, now = () => performance.now(), rubricVersion } = {}) {
  if (typeof log !== 'function') throw Error('diagnostic_writer_required');
  const contexts = new Map(), requests = new WeakMap(), responses = new WeakMap(), reservations = new Map();
  let active = null, sequence = 0;
  const meta = context => ({ callId: context?.callId ?? null, studentId: context?.studentId ?? null,
    fingerprint: context?.fingerprint ?? null, operationId: context?.operationId ?? null,
    requestId: context?.requestId ?? null, reservationId: context?.reservationId ?? null,
    questionId: context?.questionId ?? null, sourceTranscriptIds: context?.sourceTranscriptIds ?? [],
    scopeEpoch: context?.scopeEpoch ?? null, connectionEpoch: context?.connectionEpoch ?? null,
    questionRevision: context?.questionRevision ?? null, inputRevision: context?.inputRevision ?? null,
    language: context?.language ?? null, rubricVersion });
  const emit = (stage, context, details = {}) => {
    try { log({ type: `decisions_${stage}`, schemaVersion: 1,
      sequence: ++sequence, ...meta(context), ...details, contextSent: false, playbackClaim: false,
      evidenceBasis: 'local_worker_lifecycle_not_audio_or_model_reasoning' }); }
    catch { const error = Error('diagnostic_write_failed'); error.code = 'diagnostic_write_failed'; throw error; }
  };
  function contextFor(snapshot) {
    return { callId: snapshot.callId, studentId: snapshot.studentId, fingerprint: snapshot.fingerprint,
      questionId: snapshot.currentQuestion?.id ?? null, sourceTranscriptIds: (snapshot.recentTranscripts ?? []).map(turn => turn.id),
      scopeEpoch: snapshot.scopeEpoch, connectionEpoch: snapshot.connectionEpoch,
      questionRevision: snapshot.questionRevision, inputRevision: snapshot.inputRevision, language: snapshot.language,
      offeredAt: now() };
  }
  function offer(snapshot) {
    const duplicateOffer = contexts.has(snapshot.fingerprint);
    const context = contexts.get(snapshot.fingerprint) ?? contextFor(snapshot); contexts.set(snapshot.fingerprint, context);
    if (contexts.size > 128) {
      const evict = [...contexts.keys()].find(key => contexts.get(key) !== active);
      if (evict) contexts.delete(evict);
    }
    emit('snapshot_offered', context, { transcriptCount: snapshot.recentTranscripts?.length ?? 0,
      researchTaskCount: snapshot.researchTasks?.length ?? 0, researchFindingCount: snapshot.researchFindings?.length ?? 0,
      latestUserComplete: [...(snapshot.recentTranscripts ?? [])].reverse().find(turn => turn.role === 'user')?.complete === true,
      authorized: snapshot.authorized === true, duplicateOffer, queueState: active ? 'inference_in_flight' : 'idle' });
  }
  return Object.freeze({
    offer,
    receipt(snapshot, receipt) {
      emit('enqueue_result', contexts.get(snapshot.fingerprint) ?? contextFor(snapshot), { queued: receipt.queued === true, reason: safeCode(receipt.reason) });
    },
    wrapPolicy(policy) {
      return { ...policy,
        buildRequest(snapshot, { operationId } = {}) {
          const context = contexts.get(snapshot.fingerprint) ?? contextFor(snapshot); active = context;
          if (operationId) context.operationId = operationId;
          contexts.set(snapshot.fingerprint, context); const started = now();
          let request;
          try { request = policy.buildRequest(snapshot); }
          catch (error) {
            emit('request_preparation_failed', context, { reason: safeCode(error.code || error.message) ?? 'preparation_failed',
              buildMs: elapsed(now, started), requestBytes: tokens(error.requestBytes), requestLimitBytes: tokens(error.requestLimitBytes) });
            throw error;
          }
          requests.set(request, context); context.preparedAt = now();
          context.queueWaitMs = Math.max(0, started - context.offeredAt);
          context.buildMs = elapsed(now, started);
          emit('request_prepared', context, { model: request.model, questionCount: request.questions.length,
              questionNames: request.questions.map(question => question.name),
              configuredRequestBytes: Buffer.byteLength(JSON.stringify(request)),
              requestBytes: Buffer.byteLength(serializeDecisionRequest(request), 'utf8'),
              requestLimitBytes: MAX_DECISIONS_REQUEST_BYTES,
              inputBytes: Buffer.byteLength(typeof request.input === 'string' ? request.input : JSON.stringify(request.input)),
              queueWaitMs: context.queueWaitMs, buildMs: context.buildMs,
              cacheMode: request.prompt_cache_options?.mode ?? 'default', requestContentsLogged: false });
          return request;
        },
        parseResponse(response) {
          const context = responses.get(response) ?? active, started = now();
          let parsed;
          try { parsed = policy.parseResponse(response); }
          catch (error) { emit('response_parse_failed', context, { parseMs: elapsed(now, started), reason: safeCode(error.code || error.message) ?? 'parse_failed' }); throw error; }
            if (context) context.parseMs = elapsed(now, started);
            const classifications = diagnosticClassifications(response?.answers);
            emit('response_parsed', context, { status: parsed.status, reason: safeCode(parsed.reason),
              parseMs: elapsed(now, started), model: safeCode(response?.model), answerCount: Array.isArray(response?.answers) ? response.answers.length : null,
              classificationPath: 'completed', classificationValidated: parsed.status === 'completed',
              classificationAnswers: classifications.answers, omittedClassificationAnswers: classifications.omittedAnswers,
              // These are allowlisted classification labels, never generated prose.
              supportNeed: parsed.result?.supportNeed ?? null,
              preferenceChanges: parsed.result?.preferenceChanges ?? null,
              conversationSupport: parsed.result?.conversationSupport ?? null,
              classificationOnly: true, eligibleForDelivery: 'not_evaluated_here' });
          return parsed;
        },
      };
    },
    wrapClient(client) {
      return { async evaluate(request, options) {
        const context = requests.get(request) ?? active, started = now();
        if (context) context.apiStartedAt = started;
        emit('api_started', context, { model: request.model, preparedToApiMs: context ? Math.max(0, started - context.preparedAt) : null,
          queueWaitMs: context?.queueWaitMs ?? null, buildMs: context?.buildMs ?? null,
          timeoutPolicy: 'bounded_existing_client', attempt: 1, automaticRetries: 0 });
        let outcome;
        try { outcome = await client.evaluate(request, options); }
        catch (error) {
          if (context) context.requestId = error.requestId ?? null;
          emit('api_failed', context, { reason: safeCode(error.code) ?? 'transport_error', providerStatus: error.status ?? null,
            transportAndJsonMs: error.durationMs ?? elapsed(now, started), usageKnown: false,
            outcome: ['aborted', 'timeout'].includes(error.code) ? 'cancelled_or_timed_out_locally_provider_completion_unknown' : 'request_unavailable' });
          throw error;
        }
        if (context) { context.requestId = outcome.requestId; context.apiMs = outcome.durationMs; }
        if (outcome.response && typeof outcome.response === 'object') responses.set(outcome.response, context);
        emit('api_completed', context, { transportAndJsonMs: outcome.durationMs, clientAwaitMs: elapsed(now, started),
          model: safeCode(outcome.response?.model), usage: usageSummary(outcome.response?.usage),
          providerRequestCompleted: true, classificationValidated: false });
        return outcome;
      } };
    },
    wrapBudget(budget) {
      return { ...budget,
        reserve(options) {
          const context = contexts.get(options.metadata?.snapshotHash) ?? active;
          if (context) context.operationId = options.operationId;
          let reservation;
          try { reservation = budget.reserve(options); }
          catch (error) { emit('budget_rejected', context, { reason: safeCode(error.code) ?? 'budget_error', budget: budget.summary() }); throw error; }
          if (context) { context.reservationId = reservation.id; reservations.set(reservation.id, context); }
          emit('budget_reserved', context, { budget: budget.summary() }); return reservation;
        },
        settle(id, usage) {
          const context = reservations.get(id) ?? active;
          let result;
          try { result = budget.settle(id, usage); }
          catch (error) { emit('budget_settlement_failed', context, { reason: safeCode(error.code) ?? 'accounting_error', budget: budget.summary() }); throw error; }
          if (context) context.costUsd = result.costUsd;
          emit('budget_settled', context, { costUsd: result.costUsd, reservedUsd: result.reservedUsd,
            exceededReservation: result.exceededReservation, usage: usageSummary(usage), budget: budget.summary() });
          reservations.delete(id); return result;
        },
        markUnknown(id, reason) {
          const context = reservations.get(id) ?? active;
          const result = budget.markUnknown(id, reason);
          emit('budget_outcome_unknown', context, { reason: safeCode(reason), reservationRetained: true, budget: budget.summary() });
          reservations.delete(id); return result;
        },
      };
    },
    finish(row) {
      const tracked = contexts.get(row.fingerprint);
      const context = { ...(tracked ?? {}), ...meta(row),
        sourceTranscriptIds: row.sourceTranscriptIds ?? tracked?.sourceTranscriptIds ?? [],
        questionId: tracked?.questionId ?? row.currentQuestion?.id ?? null,
        operationId: row.operationId ?? tracked?.operationId ?? null,
        requestId: row.requestId ?? tracked?.requestId ?? null,
        reservationId: tracked?.reservationId ?? row.reservationId ?? null };
      emit('observation_finished', context, { status: row.status, reason: safeCode(row.reason),
        parsedClassificationAvailable: Boolean(row.result), stale: row.status === 'discarded',
        totalWorkerMs: elapsed(now, context.offeredAt), transportAndJsonMs: row.durationMs ?? null,
        parseMs: context.parseMs ?? null, costUsd: context.costUsd ?? null,
        evaluationCount: row.evaluationCount ?? null, ordinaryEvaluationCount: row.ordinaryEvaluationCount ?? null,
        maxEvaluations: row.maxEvaluations ?? null, researchReserve: row.researchReserve ?? null,
        trigger: row.trigger ?? null,
        deliveryDisposition: 'separate_candidate_and_gate_events', broadResearchActionAuthorized: false });
      if (active === tracked) active = null;
      contexts.delete(row.fingerprint);
    },
    candidate(kind, row, stamp) {
      emit('candidate_forwarded', { ...row, questionId: stamp.questionId }, { kind, candidateStamp: stamp,
        sourceStatus: row.status, sourceReason: safeCode(row.reason),
        eligibility: 'awaiting_parent_scope_confidence_and_playback_checks', broadResearchActionAuthorized: false });
    },
  });
}
