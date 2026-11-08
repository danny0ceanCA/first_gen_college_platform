// Offline analysis only. No model calls, database access, or session writes.
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const median = xs => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
const counts = (rows, field) => rows.reduce((out, row) => { const key = row[field] ?? 'unspecified'; out[key] = (out[key] ?? 0) + 1; return out; }, {});
const summaries = report.runs.map(run => {
  const records = run.observerRecords ?? [];
  const type = name => records.filter(row => row.type === name);
  const complete = type('early_decisions_completed');
  const sent = type('support_early_sent');
  const acks = type('support_early_context_acknowledged');
  const events = run.events ?? [];
  const inputEvents = events.filter(row => row.type === 'session.input_transcript.delta');
  const rows = sent.map(row => {
    const source = inputEvents.filter(event => row.sourceEventIds.includes(event.event_id));
    const contributionStart = source[0]?.at;
    const nextOutput = events.find(event => event.at >= Date.parse(row.at) && event.type === 'session.output_transcript.delta' && event.delta?.trim());
    const ack = acks.find(event => event.operationId === row.operationId);
    return { contributionId: row.contributionId, revision: row.revision,
      text: source.map(event => event.delta).join(''),
      inputOpen: row.inputOpen, sourceComplete: row.sourceComplete,
      firstInputToSendMs: Number.isFinite(contributionStart) ? Date.parse(row.at) - contributionStart : null,
      evidenceToSendMs: row.inputEvidenceToSendMs,
      classificationToSendMs: row.classificationToSendMs,
      ackLogged: !!ack, nextOutputAfterSendMs: nextOutput ? nextOutput.at - Date.parse(row.at) : null,
    };
  });
  return { language: run.language, mode: run.mode, callId: run.callId,
    configHash: run.configHash, errors: run.errors, researchAttempts: run.researchAttempts,
    introPlaybackActivityMs: run.intro?.firstAudioMs,
    introText: run.intro?.text,
    turns: run.turns.map((turn, index) => {
      const stop = run.turns[index + 1]?.startedAt ?? Infinity;
      const window = events.filter(event => event.at >= turn.startedAt && event.at < stop);
      const lexical = window.find(event => event.at >= turn.inputEndedAt && event.type === 'session.output_transcript.delta' && event.delta?.trim());
      const audio = window.find(event => event.at >= turn.inputEndedAt && event.type === 'session.output_audio.delta' && event.audioPayloadAllZero === false);
      return { step: turn.step, playbackActivityMs: turn.firstAudioMs, text: turn.text,
        firstLexicalAfterInputMs: lexical ? lexical.at - turn.inputEndedAt : null,
        firstSidebandNonzeroAfterInputMs: audio ? audio.at - turn.inputEndedAt : null,
        nativeTextThroughNextInputOrClose: window.filter(event => event.type === 'session.output_transcript.delta').map(event => event.delta).join(''),
      };
    }),
    medianPlaybackActivityMs: median(run.turns.map(turn => turn.firstAudioMs)),
    earlyRequests: type('early_decisions_started').length,
    earlyCompleted: complete.length, medianEarlyApiMs: median(complete.map(row => row.durationMs)),
    freshCompleted: complete.filter(row => row.freshAtWorker).length,
    actionCounts: counts(complete.map(row => row.result ?? {}), 'action'),
    validated: type('support_early_validated').length, sent: sent.length, acknowledged: acks.length,
    skipped: counts(type('support_early_skipped'), 'reason'),
    deferred: counts(type('support_early_deferred'), 'reason'),
    evidenceClosed: counts(type('early_evidence_closed'), 'reason'),
    stateCleared: counts(type('support_early_state_cleared'), 'reason'),
    deliveries: rows, totalQuietAppends: run.sent.filter(row => row.type === 'session.thinking.append').length,
    finalDrain: run.finalDrain ?? null, voiceCostUsd: run.cost?.total, usageComplete: run.cost?.complete,
  };
});
console.log(JSON.stringify({ source: process.argv[2], evidenceLimits: report.evidenceLimits, runs: summaries }, null, 2));
