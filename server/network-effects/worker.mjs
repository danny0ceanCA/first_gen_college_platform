import { createResponsesExtractor, extractionReasoningEffort } from '../../research/network-effects/extractor.mjs';
import { createResponsesVerifier } from '../../research/network-effects/verifier.mjs';
import { verifyExtractionCandidate } from '../../research/network-effects/verified-extraction.mjs';
import { pricing, reserveEstimate } from '../../research/network-effects/calibration-budget.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };

/** One independent evidence job. No voice connection, operational writes or automatic collection. */
export async function runNetworkExtraction(repository, { apiKey, budgetId, capUsd, signal, fetcher = globalThis.fetch } = {}) {
  if (!apiKey || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(budgetId ?? '')
      || !Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 100) fail('network_worker_configuration_required');
  signal?.throwIfAborted();
  const job = await repository.claim({ leaseMs: 120000, maxAttempts: 1 });
  if (!job) return null;
  let budgetBlocked = false;
  const started = performance.now(), steps = [];
  const hooks = stage => {
    const reservationId = `${job.id}.${job.token}.${stage}`;
    let reservation = null;
    return {
    beforeRequest: async request => {
      const estimate = reserveEstimate(request);
      const result = await repository.reserveBudget({ budgetId, limitUsd: capUsd, reservationId, amountUsd: estimate.reservedMicros / 1e6 });
      if (!result.accepted || result.duplicate) { budgetBlocked = true; fail(result.duplicate ? 'network_request_already_reserved' : 'network_budget_exhausted'); }
      reservation = estimate;
    },
    onDiagnostic: async diagnostic => {
      steps.push({ stage, ...diagnostic });
      // Unknown provider usage keeps the entire reservation. A restart cannot replenish it.
      if (reservation) {
        const cost = diagnostic.sent === false ? 0 : diagnostic.usage
          ? Math.ceil(diagnostic.usage.inputTokens * pricing.inputPerMillion + diagnostic.usage.outputTokens * pricing.outputPerMillion) / 1e6 : null;
        if (cost !== null && cost <= reservation.reservedMicros / 1e6)
          await repository.settleBudget({ reservationId, actualUsd: cost });
        else if (cost !== null) fail('network_pricing_bound_exceeded');
      }
      await repository.recordJobDiagnostic(job, diagnostic);
    },
    };
  };
  const extract = createResponsesExtractor({ apiKey, model: pricing.model, serviceTier: 'default', reasoningEffort: extractionReasoningEffort,
    maxOutputTokens: 3000, timeoutMs: 45000, signal, fetcher, ...hooks('extraction') });
  const verify = createResponsesVerifier({ apiKey, model: pricing.model, maxOutputTokens: 6000,
    timeoutMs: 45000, signal, fetcher, ...hooks('verification') });
  try {
    const context = await repository.contextFor(job.source);
    const initial = await extract(job.source, context);
    const audit = await verifyExtractionCandidate({ source: job.source, initial, context, verify, steps,
      recordAudit: value => repository.recordVerification(job, value) });
    const items = await repository.complete(job, audit.final, performance.now() - started);
    return { id: job.id, status: 'completed', items, verification: audit.decision };
  } catch (error) {
    if (['stale_job_lease', 'stale_source_version'].includes(error.code)) return { id: job.id, status: 'obsolete' };
    try {
      const status = await repository.failure(job, error, { maxAttempts: 1 });
      return { id: job.id, status, stop: budgetBlocked || error.code === 'network_pricing_bound_exceeded' };
    } catch (failureError) {
      if (['stale_job_lease', 'stale_source_version'].includes(failureError.code)) return { id: job.id, status: 'obsolete' };
      throw failureError;
    }
  }
}
