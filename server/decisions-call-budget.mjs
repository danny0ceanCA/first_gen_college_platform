import { randomUUID } from 'node:crypto';

// Finite per-physical-call allowance. Usage/reservations are also emitted to the
// durable account-scoped diagnostic sink. This is not a global billing cap.
export function createDecisionsCallBudget({ maxRequests = 32 } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 32) throw Error('invalid_decisions_call_limit');
  const records = new Map(), operations = new Set();
  let closed = false;
  const reservationUsd = 0.005;
  return {
    reserve({ operationId } = {}) {
      if (closed || typeof operationId !== 'string' || operations.has(operationId) || records.size >= maxRequests)
        throw Object.assign(Error('decisions_call_limit'), { code: 'budget_exhausted' });
      const id = randomUUID(); records.set(id, { status: 'reserved' }); operations.add(operationId); return { id };
    },
    settle(id, usage) {
      const row = records.get(id);
      const valid = value => Number.isSafeInteger(value) && value >= 0;
      if (!row || !valid(usage?.input_tokens) || !valid(usage?.output_tokens)
        || usage.total_tokens !== usage.input_tokens + usage.output_tokens
        || usage.input_tokens_details?.cached_tokens !== 0 || usage.input_tokens_details?.cache_write_tokens !== 0)
        throw Object.assign(Error('invalid_decisions_usage'), { code: 'invalid_usage' });
      const costUsd = usage.input_tokens / 10000000;
      if (row.status === 'settled' && row.costUsd !== costUsd) throw Error('decisions_usage_conflict');
      row.status = 'settled'; row.costUsd = costUsd;
      if (costUsd > reservationUsd) closed = true;
      return { id, costUsd, exceededReservation: costUsd > reservationUsd };
    },
    markUnknown(id) { const row = records.get(id); if (row && row.status !== 'settled') row.status = 'unknown'; },
    summary() {
      const rows = [...records.values()], spentUsd = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
      const reservedUsd = rows.filter(row => row.status !== 'settled').length * reservationUsd;
      return { maxRequests, requestCount: rows.length, reservationUsd, capUsd: maxRequests * reservationUsd,
        spentUsd, reservedUsd, availableUsd: Math.max(0, maxRequests * reservationUsd - spentUsd - reservedUsd),
        unknownCount: rows.filter(row => row.status === 'unknown').length, accountingScope: 'physical_call' };
    },
    close() { closed = true; },
  };
}
