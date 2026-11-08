import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { voiceControlSession } from '../../../server/voice-control.mjs';
import { createResearchObservationTap } from './research-observation.mjs';
import { createSupportGate } from './support.mjs';
import { createTerminalResearchStateGuard } from './research-terminal-state.mjs';
import { createEarlyEvidenceTracker } from './early-projector.mjs';
import { EARLY_REFINEMENT_BUDGET_FILE } from './early-refinement-budget.mjs';
import { MICROPHONE_BUDGET_FILE } from './microphone-budget.mjs';

const nativeTypes = new Set(['session.input_transcript.delta', 'session.output_transcript.delta']);
const applicationTypes = new Set(['conversation.item.input_audio_transcription.completed', 'response.output_audio_transcript.done', 'session.closed']);
const studentId = scope => scope?.studentId ?? 'unselected';

// Only the isolated launcher imports this module. The optional dependencies are
// a local test seam; they are never accepted from a browser or Live event.
export function createObservedLocalSession(options, lab, dependencies = {}) {
  const fictional = lab?.fictional === true && lab.seed?.fictional === true;
  const isolatedCopy = lab?.dataKind === 'isolated-copy' && lab.seed?.dataKind === 'isolated-copy'
    && lab.seed?.isolatedLocal === true && lab.seed?.fictional === false;
  if (lab?.localOnly !== true || (!fictional && !isolatedCopy) || process.env.NODE_ENV === 'production'
    || !lab.allowedCallIds?.includes(lab.seed?.callId) || lab.seed.callId !== options.scope.sessionId
    || lab.seed.studentId !== studentId(options.scope)) throw new Error('isolated_allowlisted_call_required');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(lab.seed.callId)) throw new Error('invalid_local_call_id');
  const allowedStudents = new Set(lab.allowedStudentIds ?? [lab.seed.studentId]);
  allowedStudents.add('unselected');
  if (!allowedStudents.has(lab.seed.studentId)) throw new Error('isolated_allowlisted_student_required');
  if (lab.supportEnabled && lab.paid !== true) throw new Error('support_requires_approved_classification');
  if (lab.preferencesEnabled && !lab.supportEnabled) throw new Error('preferences_require_local_support');
  if (lab.conversationEnabled && !lab.supportEnabled) throw new Error('conversation_support_requires_local_support');
  if (lab.earlyEnabled && !lab.conversationEnabled) throw new Error('early_support_requires_conversation_support');
  if (lab.lateEnabled && !lab.earlyEnabled) throw new Error('late_experiment_requires_early_support');
  return createObservedSessionCore(options, lab, dependencies);
}

// Shared server-owned controller. Only the local guarded launcher or the
// authenticated production factory constructs settings; never browser input.
export function createObservedSessionCore(options, lab, dependencies = {}) {
  const allowedStudents = new Set(lab.allowedStudentIds ?? [lab.seed.studentId]);
  allowedStudents.add('unselected');
  const root = resolve(import.meta.dirname, '../.local');
  let worker, pending = 0, dropped = 0, failed = false, closing = false, failureReason = null, timer, bootTimer;
  let currentScope = { ...options.scope }, currentLanguage = options.config.language;
  let earlyConfiguring = false;
  let playback = { idle: false, version: 0, lateAllowed: false };
  let readyResolve, closeResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const closed = new Promise(resolve => { closeResolve = resolve; });
  const earlyTracker = lab.earlyEnabled ? createEarlyEvidenceTracker(lab.seed, { allowedStudentIds: [...allowedStudents] }) : null;
  const status = () => ({ pending, dropped, failed, closing, reason: failureReason,
    intervention: support.status().sent > 0 || support.status().preferences.attempts > 0 || support.status().conversation.attempts > 0 || support.status().early.attempts > 0, support: support.status() });
  const support = createSupportGate({ enabled: lab.supportEnabled === true, preferencesEnabled: lab.preferencesEnabled === true, conversationEnabled: lab.conversationEnabled === true,
    earlyEnabled: lab.earlyEnabled === true, earlyObserveOnly: lab.earlyObserveOnly === true, lateEnabled: lab.lateEnabled === true, getEarlyEvidence: () => {
      const snapshot = earlyTracker?.snapshot();
      return snapshot && earlyConfiguring ? { ...snapshot, usable: false } : snapshot;
    }, scope: options.scope, language: options.config.language,
    now: dependencies.now ?? (() => performance.now()),
    send(event) {
      if (closing || failed || options.provider.readyState !== undefined && options.provider.readyState !== 1) return false;
      options.provider.send(JSON.stringify(event)); return true;
    },
    log(event) {
      if (!worker || failed || closing) return;
      if (pending >= 64) { fail('support_log_queue_gap'); return; }
      try { worker.postMessage({ type: 'support_diagnostic', event, atMs: performance.now() }); pending++; }
      catch { fail('support_log_failed'); }
    },
  });
  function report() { try { lab.onStatus?.(status()); } catch { /* Observation never controls voice. */ } }
  function terminateLater() {
    if (timer || !worker) return;
    timer = setTimeout(() => { try { void worker.terminate().catch(() => {}); } catch {} }, 2000);
    timer.unref?.();
  }
  function fail(reason) {
    if (failed) return;
    failed = true; failureReason = reason; clearTimeout(bootTimer); readyResolve(false); report();
    support.close();
    earlyTracker?.close();
    // A gap makes every in-flight observation stale. Stopping the worker never
    // sends a message to Live or waits in the voice controller's event path.
    try { worker?.postMessage({ type: 'close', reason, atMs: performance.now() }); } catch {}
    if (worker) terminateLater(); else closeResolve();
  }
  function copy(source, event, alreadyTrackedAt) {
    if (source === 'native' && !nativeTypes.has(event?.type)) return;
    if (source === 'application' && !applicationTypes.has(event?.type)) return;
    if (closing || failed || !worker) { dropped++; return; }
    if (pending >= 64) { dropped++; fail('observer_queue_gap'); return; }
    try {
      // Never clone provider objects, audio, credentials, full tool arguments or
      // config. Research packets contain only the bounded observer projection.
      const fields = source === 'scope'
        ? ['type', 'studentId', 'language', 'confirmed', 'scopeGeneration']
        : source === 'research'
        ? ['type', 'jobId', 'revision', 'question', 'status', 'evidenceVersion', 'evidenceAvailability', 'scopeGeneration', 'reason']
        : ['type', 'event_id', 'item_id', 'response_id', 'transcript', 'delta', 'start_ms', 'end_ms', 'version', 'idle'];
      const minimal = {};
      for (const key of fields) if (Object.hasOwn(event, key)) {
        const value = event[key];
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) minimal[key] = value;
      }
      if (source === 'research' && Array.isArray(event.findings)) minimal.findings = structuredClone(event.findings);
      if (Buffer.byteLength(JSON.stringify(minimal)) > 8192) { dropped++; fail('observer_packet_gap'); return; }
      const atMs = alreadyTrackedAt ?? performance.now();
      if (alreadyTrackedAt === undefined) earlyTracker?.receive({ source, event: minimal, atMs });
      worker.postMessage({ source, event: minimal, atMs,
        ...(lab.supportEnabled ? { supportStamp: support.stamp() } : {}),
        ...(lab.preferencesEnabled ? { preferenceStamp: support.preferenceStamp() } : {}),
        ...(lab.conversationEnabled ? { conversationStamp: support.conversationStamp() } : {}),
        ...(lab.earlyEnabled ? { earlySupport: support.earlySupport(), earlySupportRevision: support.earlySupportRevision(),
          earlyAllowed: !earlyConfiguring && support.earlyAllowed(), lateAllowed: !earlyConfiguring && support.lateAllowed() } : {}) }); pending++;
    } catch { fail('observer_post_failed'); }
  }
  // Construct the unmodified voice engine first. Filesystem work belongs to the
  // worker, and any observer boot error leaves this engine usable.
  const researchTap = createResearchObservationTap((...args) => options.jobRequest(...args), event => copy('research', event), options.scope);
  const terminalState = createTerminalResearchStateGuard({ diagnostic(event) {
    if (!worker || failed || closing) return;
    if (pending >= 64) { fail('research_state_log_queue_gap'); return; }
    try { worker.postMessage({ type: 'support_diagnostic', event, atMs: performance.now() }); pending++; }
    catch { fail('research_state_log_failed'); }
  } });
  const provider = { get readyState() { return options.provider.readyState; }, send(value) {
    if (lab.supportEnabled) { try {
      const original = JSON.parse(value);
      const event = lab.conversationEnabled ? terminalState.transform(original) : original;
      if (event !== original) value = JSON.stringify(event);
      support.providerCommand(event);
    } catch { support.close(); } }
    return options.provider.send(value);
  } };
  const engine = voiceControlSession({ ...options, provider, jobRequest: researchTap.request,
    emit: event => {
      const atMs = performance.now();
      if (applicationTypes.has(event.type)) earlyTracker?.receive({ source: 'application', event, atMs });
      support.boundary(event);
      if (event.type === 'origen.research.active') support.researchBusy(event.active);
      copy('application', event, atMs); return options.emit(event);
    } });
  try {
    const spawn = dependencies.createWorker ?? ((url, settings) => new Worker(url, settings));
    worker = spawn(new URL('./worker.mjs', import.meta.url), { env: {}, workerData: {
      production: lab.production === true, seed: lab.seed, paid: lab.paid === true, apiKey: lab.paid === true ? lab.apiKey : undefined,
      supportEnabled: lab.supportEnabled === true,
      preferencesEnabled: lab.preferencesEnabled === true,
      conversationEnabled: lab.conversationEnabled === true,
      earlyEnabled: lab.earlyEnabled === true,
      lateEnabled: lab.lateEnabled === true,
      microphoneBudgetApproved: lab.microphoneBudgetApproved === true,
      continuationRefinement: lab.continuationRefinement === true,
      allowedStudentIds: [...allowedStudents], logPath: resolve(root, lab.seed.callId + '.jsonl'),
      budgetPath: resolve(root, lab.microphoneBudgetApproved === true ? MICROPHONE_BUDGET_FILE : lab.earlyEnabled ? EARLY_REFINEMENT_BUDGET_FILE : lab.conversationEnabled ? lab.continuationRefinement === true
        ? 'approved-continuation-refinement-decisions-budget.sqlite' : 'approved-continuation-decisions-budget.sqlite'
        : lab.supportEnabled ? 'approved-support-decisions-budget.sqlite' : 'approved-five-dollar-budget.sqlite'),
    } });
    worker.on('message', message => {
      if (message?.type === 'diagnostic' && lab.production === true && dependencies.onDiagnostic?.(message.event) === false) fail('durable_diagnostic_gap');
      if (message?.type === 'ack') pending = Math.max(0, pending - 1);
      if (message?.type === 'ready' && !failed && !closing) { clearTimeout(bootTimer); readyResolve(true); report(); }
      if (message?.type === 'closed') { clearTimeout(bootTimer); clearTimeout(timer); closeResolve(); }
      if (message?.type === 'failed') fail(message.reason ?? 'observer_worker_failed');
      if (message?.type === 'support_candidate' && lab.supportEnabled && !failed && !closing) support.consider(message);
      if (message?.type === 'preference_candidate' && lab.preferencesEnabled && !failed && !closing) support.considerPreference(message);
      if (message?.type === 'conversation_candidate' && lab.conversationEnabled && !failed && !closing) support.considerConversation(message);
      if (message?.type === 'early_candidate' && lab.earlyEnabled && !failed && !closing) {
        const before = support.earlySupportRevision();
        support.considerEarly(message);
        // A retained need is observation-only. Send its version back to the
        // isolated classifier so its next bounded request checks the suffix.
        if (support.earlySupportRevision() !== before) copy('early-state', { type: 'support_state_changed' });
      }
    });
    worker.on('error', () => { fail('observer_worker_error'); closeResolve(); });
    worker.on('exit', () => {
      if (!closing && !failed) fail('observer_worker_exit');
      clearTimeout(bootTimer); clearTimeout(timer); readyResolve(false); closeResolve();
    });
    bootTimer = setTimeout(() => fail('observer_boot_timeout'), 5000);
    bootTimer.unref?.();
  } catch { fail('observer_boot_failed'); }
  return {
    ...engine,
    start() { support.native({ type: 'session.started' }); return engine.start(); },
    receive(event) { const atMs = performance.now();
      if (nativeTypes.has(event.type)) earlyTracker?.receive({ source: 'native', event, atMs });
      support.native(event); copy('native', event, atMs); return engine.receive(event); },
    suspend() { support.suspend(); copy('connection', { type: 'browser_control_detached' }); return engine.suspend(); },
    playback(value) {
      support.playback(value);
      if (value && typeof value.idle === 'boolean' && Number.isSafeInteger(value.version) && value.version >= playback.version) {
        const lateAllowed = lab.lateEnabled === true && support.lateAllowed();
        // A 500ms browser idle transition can precede the stricter 900ms gate.
        // Forward that later readiness change once, not every meter sample.
        if (value.idle !== playback.idle || value.version !== playback.version || lateAllowed !== playback.lateAllowed)
          copy('playback', { ...value, type: 'browser_playback' });
        playback = { idle: value.idle, version: value.version, lateAllowed };
      }
      return engine.playback(value);
    },
    async configure(next, nextScope, eventId) {
      if (lab.earlyEnabled && (studentId(nextScope) !== studentId(currentScope)
        || nextScope.confirmed !== currentScope.confirmed || next.language !== currentLanguage)) earlyConfiguring = true;
      support.configure(nextScope, next.language);
      const nextStudent = studentId(nextScope);
      const scopeChanged = nextStudent !== studentId(currentScope) || nextScope.confirmed !== currentScope.confirmed;
      if (scopeChanged || next.language !== currentLanguage) terminalState.reset();
      const scopeGeneration = scopeChanged ? researchTap.beginScope() : undefined;
      // Production configure() receives only server-validated context from the
      // existing control update registry, never an arbitrary browser profile.
      if (lab.production === true && nextScope.sessionId === lab.seed.callId) allowedStudents.add(nextStudent);
      if (!allowedStudents.has(nextStudent) || nextScope.sessionId !== lab.seed.callId) fail('observer_scope_not_allowlisted');
      else if (scopeChanged) copy('scope', { type: 'scope_transition', scopeGeneration });
      try {
        const result = await engine.configure(next, nextScope, eventId);
        if (scopeChanged) {
          researchTap.finishScope(nextScope);
          copy('scope', { type: 'scope_changed', studentId: nextStudent, language: next.language, confirmed: nextScope.confirmed === true, scopeGeneration });
        }
        else if (next.language !== currentLanguage) copy('scope', { type: 'context_changed', language: next.language });
        currentScope = { ...nextScope }; currentLanguage = next.language;
        earlyConfiguring = false;
        return result;
      } catch (error) { fail('observer_scope_update_failed'); throw error; }
    },
    close() {
      support.close();
      earlyTracker?.close();
      try { return engine.close(); } finally {
        researchTap.close();
        terminalState.close();
        if (!closing) {
          closing = true; clearTimeout(bootTimer); readyResolve(false);
          try { worker?.postMessage({ type: 'close', atMs: performance.now() }); } catch { fail('observer_close_failed'); }
          if (worker) terminateLater(); else closeResolve();
        }
      }
    },
    observation: { ready, closed, status, disable: fail },
  };
}
