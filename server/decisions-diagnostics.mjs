import { randomUUID } from 'node:crypto';
import { createBoundedWriter } from './observability/logger.mjs';
import { runAsAccount } from './account-isolation.mjs';
import { decisionsDiagnosticData } from './decisions-diagnostic-data.mjs';
export { decisionsDiagnosticData } from './decisions-diagnostic-data.mjs';
export function createDecisionsDiagnosticWriter(database, { subject, sessionId, release = null, onGap = () => {} }) {
  let sequence = 0, failed = false;
  const runId = randomUUID();
  const writer = createBoundedWriter(async line => {
    const row = JSON.parse(line);
    await runAsAccount({ sub: subject }, () => database.query(
      `INSERT INTO origen_decisions_events(id,account_id,session_id,sequence,stage,observed_at,release,data,run_id)
       VALUES($1,origen_current_account_id(),$2,$3,$4,$5,$6,$7,$8)`,
      [row.id,sessionId,row.sequence,row.stage,row.at,release,row.data,runId]));
  }, { capacity: 128, timeoutMs: 1000, onGap(reason) { failed = true; onGap(reason); } });
  return {
    record(event) {
      if (failed || !/^[a-z_]{1,100}$/.test(event?.type ?? '')) return false;
      // Existing browser capture owns raw transcript/playback. Keep durable
      // Decisions logs metadata-only and avoid per-fragment diagnostic floods.
      if (['native_transcript_interval','snapshot_observed','decisions_worker_packet_received','playback_observation','early_native_evidence'].includes(event.type)) return true;
      if (writer.stats().pending >= 120) { failed = true; onGap('queue_full'); return false; }
      void writer(JSON.stringify({ id: randomUUID(), sequence: ++sequence, stage: event.type,
        at: new Date().toISOString(), data: decisionsDiagnosticData(event) })); return true;
    },
    close: writer.close, flush: writer.flush, stats: writer.stats,
  };
}
