import { randomUUID } from 'node:crypto';
import { createBoundedWriter } from './observability/logger.mjs';
import { runAsAccount } from './account-isolation.mjs';

const idKeys = new Set(['operationId','requestId','reservationId','eventId','contributionId','questionId','workerRunId','rubricVersion','supportKind','supportNeed','reason','status','action','triggerBasis','deliveryMode','inputBoundaryEvidence','callerAudioEnded','kind','source','eventType']);
const numberKeys = new Set(['durationMs','totalMs','clientAwaitMs','transportAndJsonMs','requestBytes','questionCount','revision','supportRevision','assistantOutputRevision','workerSequence','workerElapsedMs','sourceToWorkerMs','classificationToSendMs','inputEvidenceToSendMs','evaluationCount','requestCount','costUsd']);
const booleanKeys = new Set(['contextSent','playbackClaim','inputOpen','sourceComplete','freshAtWorker','reservationRetained','providerRequestCompleted']);
export function decisionsDiagnosticData(event) {
  const data = {};
  for (const [key, value] of Object.entries(event ?? {})) {
    if (idKeys.has(key) && typeof value === 'string' && /^[a-zA-Z0-9_.: -]{1,200}$/.test(value)) data[key] = value;
    if (numberKeys.has(key) && Number.isFinite(value) && value >= 0) data[key] = value;
    if (booleanKeys.has(key) && typeof value === 'boolean') data[key] = value;
  }
  for (const key of ['sourceEventIds','sourceTranscriptIds','sourceOutputEventIds'])
    if (Array.isArray(event?.[key])) data[key] = event[key].filter(id => typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(id)).slice(0,128);
  const facts = event?.result?.facts;
  if (facts && typeof facts === 'object') data.probabilities = Object.fromEntries(Object.entries(facts)
    .filter(([key,value]) => /^[a-z_]{1,60}$/.test(key) && Number.isFinite(value) && value >= 0 && value <= 1));
  for (const key of ['budget','explanationHistorySummary']) if (event?.[key] && typeof event[key] === 'object')
    data[key] = Object.fromEntries(Object.entries(event[key]).filter(([name,value]) => /^[a-zA-Z]{1,50}$/.test(name)
      && (typeof value === 'boolean' || Number.isFinite(value) && value >= 0)));
  return data;
}
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
