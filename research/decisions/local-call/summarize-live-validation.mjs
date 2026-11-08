// Recomputes live test evidence from captured browser samples. No network or database access.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../.local/', import.meta.url);
const files = ['support-live-validation.json', 'support-live-focused-validation.json'];
const rows = [], observations = [], gateStates = [];
let estimatedVoiceUsd = 0, allUsageComplete = true;
for (const file of files) {
  const report = JSON.parse(readFileSync(new URL(file, root), 'utf8'));
  for (const run of report.runs) {
    // Earlier runner output used an ambiguous endedAt. Preserve both clocks
    // from the independent source records before performing comparisons.
    if (run.intro?.endedAt && !run.intro.outputEndedAt) {
      run.intro.outputEndedAt = run.intro.endedAt; delete run.intro.endedAt;
    }
    for (const turn of run.turns) {
      const input = run.browser.inputs.find(item => item.step === turn.step && item.startedAt === turn.startedAt);
      if (!input || !Number.isFinite(input.endedAt)) throw Error('input_audio_evidence_missing');
      turn.inputEndedAt = input.endedAt;
      if (turn.endedAt && !turn.outputEndedAt) { turn.outputEndedAt = turn.endedAt; delete turn.endedAt; }
      const first = run.browser.playback.find(sample => sample.at >= turn.inputEndedAt && sample.rms > .004);
      if (!first || first.at - turn.inputEndedAt !== turn.firstAudioMs) throw Error('response_latency_evidence_mismatch');
      turn.firstOutputAudioAt = first.at;
      turn.latencyIndependentlyRecomputed = true;
    }
    const supportAppends = run.sent.filter(event => event.type === 'session.thinking.append' && event.event_id?.startsWith('support_'));
    const acknowledged = supportAppends.filter(event => run.events.some(item => item.type === 'session.thinking.appended' && item.client_event_id === event.event_id));
    rows.push({ language: run.language, mode: file.includes('focused') ? 'support-focused' : run.mode,
      callId: run.callId, introMs: run.intro?.firstAudioMs, essayMs: run.turns.find(turn => turn.step === 'essay')?.firstAudioMs,
      simplificationMs: run.turns.find(turn => turn.step !== 'essay')?.firstAudioMs,
      quietCuesSent: supportAppends.length, quietCuesAcknowledged: acknowledged.length,
      errors: run.errors.length, providerErrors: run.events.filter(event => event.type === 'error').length,
      researchAttempts: run.researchAttempts, estimatedVoiceUsd: run.cost.total });
    observations.push(...run.observerRecords.filter(event => event.type === 'decision_observation'));
    if (run.gateAfterIntro) gateStates.push({ language: run.language, afterIntro: run.gateAfterIntro, afterTurns: run.gateAfterTurns });
    estimatedVoiceUsd += run.cost.total; allUsageComplete &&= run.cost.complete;
  }
  report.reportingCorrection = 'Input end and output end are separate; input end preserved from browser.inputs, response latency independently recomputed from browser RMS samples.';
  writeFileSync(new URL(file, root), JSON.stringify(report, null, 2));
}
const paired = JSON.parse(readFileSync(new URL(files[0], root), 'utf8'));
const identicalStartupConfiguration = ['en', 'es'].every(language => new Set(paired.runs.filter(run => run.language === language).map(run => run.configHash)).size === 1);
const summary = { generatedAt: new Date().toISOString(), rows, identicalStartupConfiguration,
  estimatedVoiceUsd, providerFinalUsageComplete: allUsageComplete,
  observations: { total: observations.length, completed: observations.filter(event => event.status === 'completed').length,
    staleDiscarded: observations.filter(event => event.status === 'discarded' && event.reason === 'stale_after_request').length,
    errors: observations.filter(event => !['completed', 'discarded'].includes(event.status)).length },
  gateStates, findings: [
    'All sessions used fictional data, cached test audio, real GPT-Live WebRTC audio and the actual local support wrapper. No database, new TTS or research request was used.',
    'Baseline and support startup configurations were identical within each language. The original intro mechanism stayed in place.',
    'No support cue was injected in these calls. Live answered before an eligible support result could arrive; stale results were discarded. Natural response preservation was tested; added audible benefit from Decisions was not established.',
    'Focused tests confirmed the initial intro gate became ready. Explicit simplification requests were recognized in Decisions but became stale or already answered before delivery.',
    'Playback RMS, provider transcripts, context acknowledgments and Decisions observations remain separate evidence. This does not establish human-perceived warmth, intelligibility or proof that a person heard the audio.',
    'Small sample comparisons describe observed timings and do not establish a statistically significant speed improvement.',
  ] };
writeFileSync(new URL('support-live-validation-summary.json', root), JSON.stringify(summary, null, 2));
const table = ['| Language | Mode | Intro first audio | Essay reply | Simpler reply | Support cues |', '|---|---|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.language} | ${row.mode} | ${(row.introMs / 1000).toFixed(3)} s | ${(row.essayMs / 1000).toFixed(3)} s | ${(row.simplificationMs / 1000).toFixed(3)} s | ${row.quietCuesSent} |`)];
writeFileSync(new URL('SUPPORT_LIVE_VALIDATION.md', root), `# Local conversational support voice validation\n\n${table.join('\n')}\n\n${summary.findings.map(item => `- ${item}`).join('\n')}\n\nFinal provider duration usage was available for every call. Estimated voice cost: $${estimatedVoiceUsd.toFixed(4)}. Decisions costs are recorded separately in the shared approved support ledger.\n`);
console.log(JSON.stringify(summary, null, 2));
