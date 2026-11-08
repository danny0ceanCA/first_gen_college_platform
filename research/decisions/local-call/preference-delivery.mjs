import { silentSidebandAudio } from './audio-activity.mjs';

// Application-owned, in-call state only. Never stores preferences in a profile.
const keys = ['plain_language', 'one_step_at_a_time'];
const empty = () => Object.fromEntries(keys.map(key => [key, false]));
const signature = value => JSON.stringify(keys.map(key => value[key]));
const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;

export function preferenceNote(values, language, revision) {
  if (language === 'es') return `Preferencias actuales de comunicación, revisión ${revision}, para esta conversación y el estudiante seleccionado: palabras sencillas ${values.plain_language ? 'solicitadas' : 'sin preferencia activa'}; un solo paso pequeño a la vez ${values.one_step_at_a_time ? 'solicitado' : 'sin preferencia activa'}. Este estado sustituye las notas anteriores de preferencias. Deja de aplicarse al cambiar de estudiante, idioma o llamada. Las peticiones más recientes de la persona tienen prioridad. Es contexto para futuras respuestas pertinentes; no requiere un anuncio, resumen, saludo ni otro turno de voz.`;
  return `Current communication preferences, revision ${revision}, for this call and the currently selected student: plain language ${values.plain_language ? 'requested' : 'no active preference'}; one small step at a time ${values.one_step_at_a_time ? 'requested' : 'no active preference'}. This snapshot supersedes earlier preference notes. It stops applying on a student, language or call change. The caller's latest requests take precedence. Context for future relevant replies only; no announcement, recap, greeting or additional speaking turn is needed.`;
}

export function createPreferenceDelivery({ enabled = false, scope = {}, language = 'en', now = () => performance.now(),
  canDeliver = () => 'unavailable', deliveryState = () => ({}), send, log = () => {} } = {}) {
  let currentScope = { ...scope }, currentLanguage = language, scopeGeneration = 0, inputRevision = 0;
  let source = null, desired = empty(), published = signature(empty()), revision = 0;
  let validation = null, resetPending = false, closed = false, attempts = 0, lastAttempt = -Infinity;
  let lastActivity = -Infinity, idleSince = null, thought = null, deferredReason = null;
  let pendingSince = null;
  const seen = new Set();
  const age = at => at !== null && Number.isFinite(at) ? Math.max(0, now() - at) : null;
  const readiness = () => { try { return deliveryState(); } catch { return { diagnosticUnavailable: true }; } };
  const emit = (type, details = {}) => { try { log({ type: `support_preference_${type}`,
    callId: currentScope.sessionId, studentId: currentScope.studentId, language: currentLanguage,
    scopeGeneration, inputRevision, questionId: source?.id ?? null,
    operationId: validation?.operationId ?? null, requestId: validation?.requestId ?? null,
    ...details, playbackClaim: false }); } catch {} };
  const selected = () => currentScope.confirmed === true && currentScope.studentId && currentScope.studentId !== 'unselected';
  const dirty = () => resetPending || signature(desired) !== published;
  const defer = reason => {
    if (deferredReason !== reason) emit('deferred', { reason, previousReason: deferredReason, revision,
      contextSent: false, pendingMs: age(pendingSince), classificationAgeMs: age(validation?.at),
      boundary: { basis: 'application_estimate', complete: thought?.complete ?? false,
        matchesCallerRevision: thought?.inputRevision === inputRevision, ageMs: age(thought?.at) },
      quietMs: age(lastActivity), idleMs: age(idleSince), readiness: readiness() });
    deferredReason = reason;
  };
  const stamp = () => source && selected() ? { scopeGeneration, inputRevision, questionId: source.id,
    studentId: currentScope.studentId, sessionId: currentScope.sessionId } : null;
  function tick() {
    if (!enabled || closed || !dirty()) return;
    if (!validation || now() - validation.at > 90000) { defer('latest_caller_recheck_required'); return; }
    const blocked = canDeliver();
    if (blocked) { defer(blocked); return; }
    // Neither transcript grouping nor punctuation is authoritative turn completion.
    // Combine them with a sustained idle playback report; never pause audio.
    if (!thought?.complete || thought.inputRevision !== inputRevision || idleSince === null
      || now() - idleSince < 400 || now() - Math.max(lastActivity, thought.at) < 900) {
      defer('thought_or_playback_not_settled'); return;
    }
    if (attempts >= 8 || now() - lastAttempt < 3000) { defer('rate_limited'); return; }
    attempts++; lastAttempt = now(); revision++;
    const content = preferenceNote(desired, currentLanguage, revision);
    // Consume even an uncertain attempt; no automatic resend of the same snapshot.
    published = signature(desired); resetPending = false; deferredReason = null;
    const details = { kind: 'preference', revision, operationId: validation.operationId ?? null,
      requestId: validation.requestId ?? null, questionId: source?.id ?? null,
      preferences: { ...desired }, scopeGeneration, inputRevision,
      boundaryBasis: 'application_estimate', playbackEvidence: 'fresh_idle', quietMs: age(lastActivity),
      idleMs: age(idleSince), thoughtAgeMs: age(thought.at), validationToSendMs: age(validation.at),
      pendingMs: age(pendingSince), readiness: readiness() };
    pendingSince = null;
    try { if (send(content, details) === false) throw Error('unconfirmed_send'); }
    catch { emit('send_unconfirmed', { revision, contextSent: 'unknown' }); }
  }
  return {
    stamp, tick,
    native(event) {
      if (closed) return;
      if (event.type === 'session.input_transcript.delta' && event.delta) {
        inputRevision++; source = null; validation = null; lastActivity = now(); idleSince = null;
        if (dirty()) defer('caller_started');
      }
      if (event.type === 'session.output_transcript.delta' && event.delta) {
        lastActivity = now(); idleSince = null; thought = null;
      }
      if (event.type === 'session.output_audio.delta' && !silentSidebandAudio(event)) {
        // Audio can trail the transcript grouping. Keep the completed text as
        // evidence, but restart the quiet interval and require fresh playback.
        lastActivity = now(); idleSince = null;
      }
    },
    boundary(event) {
      if (closed) return;
      if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.item_id === 'string') {
        const id = `user:${event.item_id}`;
        if (source?.id !== id) { source = { id }; inputRevision++; validation = null; thought = null; }
      }
      if (event.type === 'response.output_audio_transcript.done') {
        thought = { at: now(), inputRevision, complete: /[.!?。！？][\s"'”’»)]*$/u.test(event.transcript ?? '')
          && !/(?:\.{2,}|…)[\s"'”’»)]*$/u.test(event.transcript ?? '') };
      }
    },
    playback(value) {
      if (closed || typeof value?.idle !== 'boolean') return;
      if (!value.idle) idleSince = null;
      else idleSince ??= now();
      tick();
    },
    consider({ record, stamp: candidate } = {}) {
      if (!enabled || closed || !selected()) return { accepted: false, reason: 'disabled_or_scope_unready' };
      const current = stamp();
      const reject = (reason, details = {}) => { emit('skipped', { reason, operationId: record?.operationId ?? null,
        requestId: record?.requestId ?? null, sourceStatus: record?.sourceStatus ?? record?.status ?? null,
        ...details, contextSent: false }); return { accepted: false, reason }; };
      if (!candidate || !current || Object.keys(current).some(key => current[key] !== candidate[key]))
        return reject('stale_caller_or_scope', { stampDifferences: !candidate || !current ? ['missing_stamp']
          : Object.keys(current).filter(key => current[key] !== candidate[key]) });
      if (record?.status !== 'completed' || !['completed', 'discarded'].includes(record.sourceStatus ?? 'completed')
        || record.sourceStatus === 'discarded' && record.sourceReason !== 'stale_after_request'
        || record.studentId !== currentScope.studentId || record.callId !== currentScope.sessionId
        || !record.sourceTranscriptIds?.includes(current.questionId)) return reject('record_unmatched');
      const changes = record.result?.preferenceChanges;
      if (!changes || Object.keys(changes).length !== keys.length || keys.some(key => {
        const value = changes[key];
        return !['unchanged', 'enable', 'disable'].includes(value?.action)
          || !probability(value.confidence) || value.confidence < .85
          || !probability(value.selectedProbability) || value.selectedProbability < .9;
      })) return reject('uncertain_or_invalid', { thresholds: { confidence: .85, selectedProbability: .9 },
        classifications: Object.fromEntries(keys.map(name => [name, {
          action: ['enable', 'disable', 'unchanged'].includes(changes?.[name]?.action) ? changes[name].action : 'invalid',
          confidence: probability(changes?.[name]?.confidence) ? changes[name].confidence : null,
          selectedProbability: probability(changes?.[name]?.selectedProbability) ? changes[name].selectedProbability : null,
        }])) });
      const key = JSON.stringify(current);
      if (seen.has(key)) return reject('duplicate');
      seen.add(key); if (seen.size > 128) seen.delete(seen.values().next().value);
      for (const name of keys) if (changes[name].action !== 'unchanged') desired[name] = changes[name].action === 'enable';
      validation = { at: now(), operationId: record.operationId, requestId: record.requestId };
      if (dirty()) pendingSince ??= now(); else pendingSince = null;
      emit('validated', { operationId: record.operationId, requestId: record.requestId ?? null,
        sourceStatus: record.sourceStatus ?? record.status, sourceReason: record.sourceReason ?? null,
        questionId: current.questionId, preferences: { ...desired }, changes: Object.fromEntries(keys.map(name => [name, {
          action: changes[name].action, confidence: changes[name].confidence, selectedProbability: changes[name].selectedProbability,
        }])),
        changed: dirty(), contextSent: false });
      tick(); return { accepted: true, pending: dirty() };
    },
    reset(nextScope = currentScope, nextLanguage = currentLanguage, reason = 'scope_changed') {
      scopeGeneration++; inputRevision++; source = null; validation = null; thought = null; idleSince = null;
      desired = empty(); resetPending ||= published !== signature(empty());
      if (resetPending) validation = { at: now(), applicationReset: true };
      pendingSince = resetPending ? now() : null;
      currentScope = { ...nextScope }; currentLanguage = nextLanguage;
      emit('reset', { reason, scopeGeneration, contextSent: false });
    },
    close() {
      if (closed) return;
      emit('closed', { revision, pending: dirty(), pendingMs: age(pendingSince), attempts,
        reason: dirty() ? 'session_closed_before_delivery' : 'session_closed', contextSent: false });
      closed = true; validation = null; source = null; desired = empty();
    },
    status() { return { enabled, preferences: { ...desired }, pending: dirty(), attempts, revision, scopeGeneration }; },
  };
}
