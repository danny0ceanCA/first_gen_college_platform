import { parentPort, workerData } from 'node:worker_threads';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCallProjector } from './projector.mjs';
import { createObserver } from '../observer.mjs';
import { createDecisionsClient } from '../client.mjs';
import { createLocalObserverBudget } from './observer-budget.mjs';
import { broadPolicy } from '../broad-rubric.mjs';
import { preferencePolicy } from '../preference-rubric.mjs';
import { conversationPolicy } from '../conversation-rubric.mjs';
import { createPreferenceCandidateBridge } from './preference-candidates.mjs';
import { createConversationCandidateBridge } from './conversation-candidates.mjs';
import { conversationOwnsSupport } from './support-routing.mjs';
import { createDecisionDiagnostics } from './decision-diagnostics.mjs';
import { createEarlyProjector } from './early-projector.mjs';
import { createEarlyEvaluator } from './early-evaluator.mjs';
import { createEarlyRefinementBudget } from './early-refinement-budget.mjs';
import { createMicrophoneBudget } from './microphone-budget.mjs';
import { withEarlyNeedContext } from './early-need-context.mjs';
import { EARLY_QUESTION_COUNT, EARLY_RUBRIC_VERSION } from './early-rubric.mjs';
import { createDecisionsCallBudget } from '../../../server/decisions-call-budget.mjs';

let observer, budget, failed = false, closing = false, currentSupportStamp = null, currentPreferenceStamp = null, currentConversationStamp = null;
let earlyProjector, earlyEvaluator, currentEarlySupport = null, currentEarlyAllowed = false;
let currentEarlySupportRevision = 0;
let currentLateAllowed = false;
const supportStamps = new Map();
const basePolicy = workerData.conversationEnabled === true ? conversationPolicy : workerData.preferencesEnabled === true ? preferencePolicy : broadPolicy;
if (!workerData.production) mkdirSync(dirname(workerData.logPath), { recursive: true });
const send = message => { try { parentPort.postMessage(message); } catch {} };
const workerStartedAt = performance.now();
const workerRunId = randomUUID();
let workerSequence = 0;
const log = event => {
  if (workerData.production && ['native_transcript_interval','snapshot_observed','decisions_worker_packet_received','playback_observation','early_native_evidence'].includes(event.type)) return;
  const record = { ...event,
  at: new Date().toISOString(), schemaVersion: 1, workerRunId, workerSequence: ++workerSequence,
  workerElapsedMs: Math.max(0, performance.now() - workerStartedAt),
  callId: event.callId ?? workerData.seed.callId,
  intervention: event.type?.startsWith('support_') && event.contextSent === true };
  if (workerData.production) parentPort.postMessage({ type: 'diagnostic', event: record });
  else appendFileSync(workerData.logPath, JSON.stringify(record) + '\n');
};
const diagnostics = createDecisionDiagnostics({ log, rubricVersion: basePolicy.version });
const policy = diagnostics.wrapPolicy(basePolicy);
const preferenceCandidates = createPreferenceCandidateBridge({ enabled: workerData.preferencesEnabled === true, log });
const conversationCandidates = createConversationCandidateBridge({ enabled: workerData.conversationEnabled === true, log });
function fail(reason) {
  if (failed) return;
  failed = true;
  try { log({ type: 'decisions_worker_failed', reason, contextSent: false, playbackClaim: false }); } catch {}
  preferenceCandidates.clear();
  conversationCandidates.clear();
  // Invalidate before cancelling inference, including failure to write the log.
  try { projector.stop(reason); } catch {}
  observer?.close();
  earlyProjector?.close(); earlyEvaluator?.close();
  send({ type: 'failed', reason });
}
const projector = createCallProjector(workerData.seed, (state, eligibility) => {
  const snapshot = state.snapshot();
  log({ type: 'snapshot_observed', fingerprint: snapshot.fingerprint, questionRevision: snapshot.questionRevision,
    transcripts: snapshot.recentTranscripts, researchTasks: snapshot.researchTasks ?? [],
    rubricVersion: policy.version, eligibility,
    classification: !workerData.paid ? 'disabled' : eligibility.eligible ? 'eligible' : 'context_only' });
  if (!workerData.paid) return;
  if (!eligibility.eligible) {
    log({ type: 'decision_observation_skipped', reason: eligibility.reason, fingerprint: snapshot.fingerprint,
      questionRevision: snapshot.questionRevision, eligibility, paidRequestStarted: false, contextSent: false, playbackClaim: false });
    return;
  }
  diagnostics.offer(snapshot);
  if (workerData.supportEnabled && currentSupportStamp) {
    supportStamps.set(snapshot.fingerprint, currentSupportStamp);
    if (supportStamps.size > 64) supportStamps.delete(supportStamps.keys().next().value);
  }
  preferenceCandidates.capture(snapshot, currentPreferenceStamp);
  conversationCandidates.capture(snapshot, currentConversationStamp);
  observer ??= createObserver({ state, client: diagnostics.wrapClient(createDecisionsClient({ apiKey: workerData.apiKey })), budget,
    mode: 'observe', policy, maxEvaluations: workerData.earlyEnabled ? 16 : workerData.supportEnabled ? 32 : 12,
    researchReserve: workerData.supportEnabled ? 4 : 0, onRecord: row => {
      try {
        diagnostics.finish(row);
        log({ type: 'decision_observation', ...row });
        const conversationCandidate = !closing && !failed ? conversationCandidates.project(row) : null;
        if (conversationCandidate) { diagnostics.candidate('conversation_continuation', row, conversationCandidate.stamp); send(conversationCandidate); }
        const stamp = supportStamps.get(row.fingerprint);
        supportStamps.delete(row.fingerprint);
        const handledByConversation = workerData.conversationEnabled === true && conversationOwnsSupport(row.result);
        if (handledByConversation && workerData.supportEnabled && stamp) {
          log({ type: 'decisions_legacy_support_suppressed', reason: 'conversation_classification_uses_separate_gate',
            callId: row.callId, studentId: row.studentId, fingerprint: row.fingerprint,
            operationId: row.operationId ?? null, requestId: row.requestId ?? null,
            conversationCandidateForwarded: Boolean(conversationCandidate), contextSent: false, playbackClaim: false });
        }
        if (workerData.supportEnabled && stamp && row.status === 'completed' && !handledByConversation) {
          diagnostics.candidate('one_turn_support', row, stamp);
          const { supportNeed, alreadyAddressed, selectedProbability, confidence, addressedProbability } = row.result ?? {};
          send({ type: 'support_candidate', stamp, record: { status: row.status, operationId: row.operationId,
            requestId: row.requestId, callId: row.callId, sourceTranscriptIds: row.sourceTranscriptIds,
            studentId: row.studentId, result: { supportNeed, alreadyAddressed,
              selectedProbability, confidence, addressedProbability } } });
        }
        const candidate = !closing && !failed ? preferenceCandidates.project(row) : null;
        if (candidate) { diagnostics.candidate('lasting_preference', row, candidate.stamp); send(candidate); }
      } catch { fail('observer_log_failed'); }
    } });
  const receipt = observer.observe(snapshot, { researchChanged: eligibility.researchChanged });
  diagnostics.receipt(snapshot, receipt);
  if (!receipt.queued) log({ type: 'decision_observation_skipped', reason: receipt.reason, fingerprint: snapshot.fingerprint, eligibility });
}, log, { allowedStudentIds: workerData.allowedStudentIds });
if (workerData.paid) {
  const rawBudget = workerData.production === true ? createDecisionsCallBudget() : workerData.microphoneBudgetApproved === true ? createMicrophoneBudget(workerData) : workerData.earlyEnabled ? createEarlyRefinementBudget({ budgetPath: workerData.budgetPath,
    conversationEnabled: workerData.conversationEnabled, earlyEnabled: true }) : createLocalObserverBudget({ budgetPath: workerData.budgetPath,
    conversationEnabled: workerData.conversationEnabled, supportEnabled: workerData.supportEnabled,
    continuationRefinement: workerData.continuationRefinement });
  budget = diagnostics.wrapBudget(rawBudget);
  if (workerData.earlyEnabled) {
    earlyEvaluator = createEarlyEvaluator({ client: createDecisionsClient({ apiKey: workerData.apiKey, timeoutMs: 2500 }),
      budget: rawBudget, current: () => earlyProjector && withEarlyNeedContext(earlyProjector.snapshot(), currentEarlySupport, currentEarlySupportRevision), log,
      onResult: candidate => { if (!failed && !closing) send(candidate); }, maxEvaluations: 16 });
    earlyProjector = createEarlyProjector(workerData.seed, snapshot => earlyEvaluator.evaluate(
      withEarlyNeedContext(snapshot, currentEarlySupport, currentEarlySupportRevision)), log, { allowedStudentIds: workerData.allowedStudentIds,
      enabled: () => currentEarlyAllowed && !failed && !closing, maxPerCall: 16, maxPerContribution: 2,
      distributed: true, lateAllowed: () => workerData.lateEnabled === true && currentLateAllowed,
      needsRevalidation: () => currentEarlySupport?.status === 'provisional' && !currentEarlySupport.blockedReason,
      supportRevision: () => currentEarlySupportRevision });
  }
}
log({ type: 'decisions_worker_started', studentId: workerData.seed.studentId,
  rubricVersion: policy.version, paidClassification: workerData.paid === true,
  supportEnabled: workerData.supportEnabled === true, preferencesEnabled: workerData.preferencesEnabled === true,
  conversationEnabled: workerData.conversationEnabled === true,
  earlyEnabled: workerData.earlyEnabled === true,
  lateExperimentEnabled: workerData.lateEnabled === true,
  earlyEvaluationPolicy: workerData.earlyEnabled ? { earlyMaximum: 16, completedMaximum: 16,
    burst: 3, refillMs: 25000, maximumPerContribution: 2, scheduledPolling: false,
    combinedMaximum: 32, completedResearchReserve: 4, earlyQuestions: EARLY_QUESTION_COUNT, earlyRubricVersion: EARLY_RUBRIC_VERSION, voiceNeverWaits: true } : null,
  evaluationPolicy: { maximumPerCall: workerData.supportEnabled ? 32 : 12, reservedForResearch: workerData.supportEnabled ? 4 : 0,
    assistantBoundaries: 'capture_only', callerContributions: 'complete_meaningful_change', research: 'changed_evidence_or_terminal_status' },
  researchObserveOnly: true, budget: budget?.summary() ?? null, allocation: budget?.allocation ?? null,
  retention: workerData.production ? 'durable_account_metadata_no_automatic_expiry' : 'append_only_local_file_no_automatic_expiry',
  requestContentsLogged: false, credentialsLogged: false, contextSent: false, playbackClaim: false });
parentPort.on('message', async message => {
  if (closing) { send({ type: 'ack' }); return; }
  try {
    const receivedAt = performance.now();
    log({ type: 'decisions_worker_packet_received', source: message.source ?? message.type ?? null,
      eventType: message.event?.type ?? null, sourceMonotonicMs: Number.isFinite(message.atMs) ? message.atMs : null,
      workerReceiptMonotonicMs: receivedAt, sourceToWorkerMs: Number.isFinite(message.atMs) ? Math.max(0, receivedAt - message.atMs) : null,
      contextSent: false, playbackClaim: false });
    if (message.type === 'close') {
      closing = true;
      log({ type: 'decisions_worker_closing', reason: message.reason ?? 'call_closed', contextSent: false, playbackClaim: false });
      preferenceCandidates.clear();
      conversationCandidates.clear();
      if (message.reason) { try { projector.stop(message.reason); } catch {} }
      projector.close(); observer?.close(); await observer?.idle();
      earlyProjector?.close(); earlyEvaluator?.close(); await earlyEvaluator?.idle();
      const finalBudget = budget?.summary() ?? null;
      budget?.close(); log({ type: 'decisions_worker_closed', budget: finalBudget, contextSent: false, playbackClaim: false });
      send({ type: 'closed' }); parentPort.close(); return;
    }
    if (!failed) {
      if (message.type === 'support_diagnostic') { log(message.event); return; }
      currentSupportStamp = message.supportStamp ?? null;
      currentPreferenceStamp = message.preferenceStamp ?? null;
      currentConversationStamp = message.conversationStamp ?? null;
      currentEarlySupport = message.earlySupport ?? null;
      currentEarlySupportRevision = message.earlySupportRevision ?? 0;
      currentEarlyAllowed = message.earlyAllowed === true;
      currentLateAllowed = message.lateAllowed === true;
      earlyProjector?.receive(message);
      if (message.source === 'early-state') earlyProjector?.refresh();
      else projector.receive(message);
      if (!projector.state.snapshot().authorized) fail('observer_context_gap');
    }
  } catch { fail('observer_ingestion_failed'); }
  finally { send({ type: 'ack' }); }
});
send({ type: 'ready' });
