import { silentSidebandAudio } from './audio-activity.mjs';
import { earlyResultDecision } from './early-rubric.mjs';
import { matchEarlyCapture } from './early-need-context.mjs';

// Only this fixed, current-reply note can leave the local experiment. Raw
// transcripts and classifier prose stay in application state. Thinking append
// is quiet context, not a guarantee of silence or of audible delivery.
export const EARLY_SUPPORT_NOTES = Object.freeze({
  en: 'Current reply context: the caller needs this idea explained more simply. One small point in everyday words, with a familiar example if useful, may help. If an earlier explanation did not help, try a different approach. Answer their latest question normally. This applies only to the current reply, not later topics. This note adds no new request: do not interrupt, repeat an answer, add an acknowledgment, or start or extend speech solely for this note.',
  es: 'Contexto de la respuesta actual: la persona necesita una explicación más sencilla de esta idea. Puede ayudar una sola idea con palabras cotidianas y, si sirve, un ejemplo familiar. Si una explicación anterior no ayudó, prueba otro enfoque. Responde normalmente a su última pregunta. Esto aplica solo a la respuesta actual, no a temas posteriores. Esta nota no es otra solicitud: no interrumpas, repitas una respuesta, agregues confirmación ni empieces o prolongues la voz solo por esta nota.',
});

export const EARLY_KIND_NOTES = Object.freeze({
  simpler_explanation: EARLY_SUPPORT_NOTES,
  concrete_example: Object.freeze({
    en: 'Current reply context: the caller asked for a concrete example of the idea being discussed. One brief everyday example may help. Answer their latest question naturally and warmly. This is context for this reply only, not a new request. Do not interrupt, repeat an answer, add an acknowledgment, or start or extend speech solely for this note.',
    es: 'Contexto de la respuesta actual: la persona pidió un ejemplo concreto de la idea que están conversando. Puede ayudar un ejemplo cotidiano y breve. Responde a su última pregunta con naturalidad y calidez. Es contexto solo para esta respuesta, no otra solicitud. No interrumpas, repitas una respuesta, agregues confirmación ni empieces o prolongues la voz solo por esta nota.',
  }),
  starting_point: Object.freeze({
    en: 'Current reply context: the caller asked for help finding where to begin. One manageable starting point grounded in what they shared, or one gentle clarifying question if needed, may help. Answer naturally and warmly. This is context for this reply only, not a new request. Do not interrupt, repeat an answer, add an acknowledgment, or start or extend speech solely for this note.',
    es: 'Contexto de la respuesta actual: la persona pidió ayuda para saber por dónde empezar. Puede ayudar un primer paso pequeño basado en lo que compartió, o una pregunta amable si hace falta aclarar algo. Responde con naturalidad y calidez. Es contexto solo para esta respuesta, no otra solicitud. No interrumpas, repitas una respuesta, agregues confirmación ni empieces o prolongues la voz solo por esta nota.',
  }),
});

// Separate opt-in experiment: this is quiet, optional context after a fresh
// classification of the output since the caller's need. It never asks Live to
// resume speaking, reopen a completed answer, or pivot during an explanation.
export const LATE_KIND_NOTES = Object.freeze({
  simpler_explanation: Object.freeze({
    en: 'Optional context only if this topic continues naturally: the caller may still need a simpler explanation. A small point in everyday words or a different example may help if an earlier approach did not. Follow their latest meaning. This is not a request to speak: do not interrupt, repeat or revive a completed answer, add an acknowledgment, or start or extend speech for this note. It does not apply to later topics.',
    es: 'Contexto opcional solo si este tema continúa con naturalidad: la persona quizá aún necesite una explicación más sencilla. Puede ayudar una idea breve con palabras cotidianas u otro ejemplo si el enfoque anterior no ayudó. Sigue su intención más reciente. No es una solicitud para hablar: no interrumpas, repitas ni retomes una respuesta terminada, agregues confirmación ni empieces o prolongues la voz por esta nota. No aplica a temas posteriores.',
  }),
  concrete_example: Object.freeze({
    en: 'Optional context only if this topic continues naturally: a brief, familiar example may still help with the caller\'s current question. Follow their latest meaning. This is not a request to speak: do not interrupt, repeat or revive a completed answer, add an acknowledgment, or start or extend speech for this note. It does not apply to later topics.',
    es: 'Contexto opcional solo si este tema continúa con naturalidad: un ejemplo breve y familiar quizá aún ayude con la pregunta actual de la persona. Sigue su intención más reciente. No es una solicitud para hablar: no interrumpas, repitas ni retomes una respuesta terminada, agregues confirmación ni empieces o prolongues la voz por esta nota. No aplica a temas posteriores.',
  }),
  starting_point: Object.freeze({
    en: 'Optional context only if this topic continues naturally: one manageable starting point grounded in what the caller shared, or a gentle clarification, may still help. Follow their latest meaning. This is not a request to speak: do not interrupt, repeat or revive a completed answer, add an acknowledgment, or start or extend speech for this note. It does not apply to later topics.',
    es: 'Contexto opcional solo si este tema continúa con naturalidad: quizá aún ayude un primer paso pequeño basado en lo que compartió la persona, o una aclaración amable. Sigue su intención más reciente. No es una solicitud para hablar: no interrumpas, repitas ni retomes una respuesta terminada, agregues confirmación ni empieces o prolongues la voz por esta nota. No aplica a temas posteriores.',
  }),
});

const STAMP_FIELDS = ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch', 'contributionId', 'revision'];
const SCOPE_FIELDS = ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch'];
const validStamp = stamp => stamp && ['callId', 'studentId', 'contributionId'].every(key => typeof stamp[key] === 'string' && stamp[key].length > 0)
  && ['en', 'es'].includes(stamp.language) && ['connectionEpoch', 'scopeEpoch', 'revision'].every(key => Number.isSafeInteger(stamp[key]) && stamp[key] >= 0);
const same = (left, right, keys = STAMP_FIELDS) => left && right && keys.every(key => left[key] === right[key]);
const idsMatch = (left, right) => Array.isArray(left) && left.length > 0 && left.length <= 128
  && Array.isArray(right) && left.length === right.length
  && left.every((id, index) => typeof id === 'string' && id.length > 0 && id === right[index]);
const keyFor = stamp => JSON.stringify(STAMP_FIELDS.map(key => stamp?.[key]));
const contributionFor = stamp => JSON.stringify([...SCOPE_FIELDS, 'contributionId'].map(key => stamp?.[key]));
const cloneStamp = stamp => Object.fromEntries(STAMP_FIELDS.map(key => [key, stamp[key]]));

export function createEarlySupportDelivery({ enabled = false, observeOnly = false, lateEnabled = false, getEvidence = () => null,
  canDeliver = () => 'unavailable', canDeliverLate = () => 'unavailable', send, log = () => {}, now = () => performance.now() } = {}) {
  let closed = false, active = null, pending = null, attempts = 0, lastSentAt = -Infinity;
  let lastScope = null, lastContribution = null, deferredReason = null;
  let supportRevision = 0;
  const answered = new Set(), processed = new Set(), attemptedContributions = new Set();
  const boundedAdd = (set, value) => { set.add(value); if (set.size > 128) set.delete(set.values().next().value); };
  const emit = (stage, details = {}) => {
    try { log({ type: 'support_early_' + stage, callId: lastScope?.callId ?? null,
      studentId: lastScope?.studentId ?? null, language: lastScope?.language ?? null,
      ...details, playbackClaim: false }); } catch {}
  };
  const clearActive = reason => {
    if (active) emit('state_cleared', { reason, contributionId: active.contributionId, contextSent: false });
    if (active) supportRevision++;
    active = null; pending = null;
  };
  function evidence() {
    let value;
    try { value = getEvidence(); } catch { return null; }
    if (!validStamp(value?.stamp)) return null;
    if (lastScope && !same(value.stamp, lastScope, SCOPE_FIELDS)) {
      clearActive('scope_or_connection_changed'); pending = null; deferredReason = null;
    }
    lastScope = cloneStamp(value.stamp);
    const contribution = contributionFor(value.stamp);
    if (lastContribution !== contribution) {
      lastContribution = contribution;
      if (active && active.contributionId !== value.stamp.contributionId) active.laterContributions++;
    }
    if (active && (now() < active.at || now() - active.at > 90000 || active.laterContributions > 3)) clearActive('expired');
    return value;
  }
  const defer = (reason, details = {}) => {
    if (deferredReason !== reason) emit('deferred', { reason, ...details, contextSent: false });
    deferredReason = reason;
    return { sent: false, reason };
  };
  const replied = snapshot => snapshot?.assistantOutputStartedForContribution === true
    || answered.has(contributionFor(snapshot?.stamp));
  function lateIneligible(record, snapshot) {
    if (!lateEnabled) return 'late_experiment_disabled';
    if (record.triggerBasis !== 'settled_late_experiment') return 'late_classification_required';
    const origin = snapshot.contributionOutputOriginRevision;
    const revision = snapshot.assistantOutputRevision;
    if (!Number.isSafeInteger(origin) || origin < 0 || !Number.isSafeInteger(revision) || revision <= origin
      || record.assistantOutputRevision !== revision || record.assistantOutputOriginRevision !== origin) return 'late_output_revision_changed';
    const rows = (snapshot.assistantEvidence ?? []).filter(row => row.revision > origin);
    if (record.assistantEvidenceComplete !== true || !rows.length
      || !rows.every((row, index) => row.revision === origin + index + 1)
      || rows.at(-1).revision !== revision
      || !idsMatch(record.sourceOutputEventIds, rows.map(row => row.sourceEventId))) return 'late_output_evidence_incomplete';
    const classificationAge = now() - record.classifiedAtMs;
    if (!Number.isFinite(record.classifiedAtMs) || !Number.isFinite(classificationAge)
      || classificationAge < 0 || classificationAge > 2000) return 'late_classification_expired';
    const callerAge = now() - snapshot.lastObservedAtMs;
    if (!Number.isFinite(callerAge) || callerAge < 0 || callerAge > 15000) return 'late_caller_evidence_expired';
    if (snapshot.inputOpen !== false) return 'late_input_not_closed';
    return null;
  }
  function tick() {
    if (!enabled || closed || !pending) return { sent: false, reason: 'no_pending_support' };
    const snapshot = evidence();
    if (!snapshot?.usable || !same(pending.stamp, snapshot.stamp)
      || pending.supportRevision !== supportRevision || !idsMatch(pending.sourceEventIds, snapshot.sourceEventIds)) {
      pending = null;
      return defer('stale_evidence');
    }
    const late = pending.deliveryMode === 'late_experiment';
    const details = { operationId: pending.operationId, requestId: pending.requestId,
      contributionId: pending.stamp.contributionId, revision: pending.stamp.revision,
      sourceEventIds: [...pending.sourceEventIds], sourceStartMs: snapshot.startMs, sourceEndMs: snapshot.endMs,
      boundaryBasis: 'native_input_fragment_evidence', sourceComplete: snapshot.complete === true,
      inputOpen: snapshot.inputOpen === true,
      inputBoundaryEvidence: snapshot.inputOpen === false ? 'matched_application_estimate' : 'open_native_transcript',
      callerAudioEnded: 'unknown', deliveryMode: late ? 'late_experiment' : 'preanswer' };
    if (late) {
      const reason = lateIneligible(pending, snapshot);
      if (reason) { pending = null; return defer(reason, details); }
      Object.assign(details, { assistantOutputRevision: pending.assistantOutputRevision,
        assistantOutputOriginRevision: pending.assistantOutputOriginRevision,
        sourceOutputEventIds: [...pending.sourceOutputEventIds], outputEvidenceComplete: true,
        outputEvidenceIsPlayback: false, triggerBasis: pending.triggerBasis,
        classificationAgeMs: now() - pending.classifiedAtMs });
    } else if (replied(snapshot)) {
      pending = null;
      return defer('assistant_already_started', { ...details, evidence: 'observed_output_not_playback' });
    }
    const age = now() - snapshot.lastObservedAtMs;
    if (!late && (!Number.isFinite(age) || age < 0 || age > 2000)) {
      pending = null;
      return defer('preanswer_evidence_expired', details);
    }
    let blocked;
    try { blocked = late ? canDeliverLate() : canDeliver(); } catch { blocked = 'delivery_state_unavailable'; }
    if (blocked) return defer(blocked, details);
    if (!active || active.status !== 'validated' || !same(active.stamp, snapshot.stamp, SCOPE_FIELDS)) {
      pending = null;
      return defer('support_state_unavailable', details);
    }
    if (observeOnly) return defer('shadow_only', details);
    const contribution = contributionFor(snapshot.stamp);
    if (attemptedContributions.has(contribution)) { pending = null; return defer('already_attempted_for_contribution', details); }
    if (attempts >= 4 || now() - lastSentAt < 2500) return defer('rate_limited', details);

    // Take the attempt before writing. A thrown/ambiguous write may already
    // have reached Live, so never retry it on a later idle update.
    boundedAdd(attemptedContributions, contribution);
    attempts++; lastSentAt = now();
    const classificationAt = pending.at;
    pending = null; deferredReason = null;
    active.sent = true;
    const output = { ...details, kind: 'early_support', supportKind: active.kind, supportRevision, attempts,
      classificationToSendMs: now() - classificationAt, inputEvidenceToSendMs: age,
      playbackEvidence: 'external_fresh_idle_fence', contextSent: true, playbackClaim: false };
    try {
      const notes = late ? LATE_KIND_NOTES : EARLY_KIND_NOTES;
      if (typeof send !== 'function' || send('session.thinking.append', notes[active.kind][snapshot.stamp.language], output) === false) throw Error('write_unconfirmed');
      emit('sent', output);
      return { sent: true, reason: null };
    } catch {
      emit('send_unconfirmed', { ...output, contextSent: 'unknown' });
      return { sent: false, reason: 'write_unconfirmed' };
    }
  }
  return Object.freeze({
    tick,
    consider({ record, stamp } = {}) {
      const reject = reason => { emit('skipped', { reason, operationId: record?.operationId ?? null,
        requestId: record?.requestId ?? null, contextSent: false }); return { accepted: false, sent: false, reason }; };
      if (!enabled || closed) return reject('disabled_or_closed');
      const snapshot = evidence();
      if (!snapshot?.usable || !validStamp(stamp)) return reject('stale_evidence');
      if (record?.status !== 'completed' || record.callId !== stamp.callId || record.studentId !== stamp.studentId
        || !Number.isSafeInteger(record.supportRevision) || record.supportRevision !== supportRevision
        || !Number.isSafeInteger(record.assistantOutputRevision) || record.assistantOutputRevision < 0
        || record.assistantOutputRevision > snapshot.assistantOutputRevision) return reject('record_unmatched');
      const captured = matchEarlyCapture(snapshot, stamp, record);
      if (!captured) return reject('stale_evidence');
      const result = record.result, decision = earlyResultDecision(result);
      const late = record.triggerBasis === 'settled_late_experiment';
      if (late) {
        if (!captured.exact) return reject('stale_evidence');
        const reason = lateIneligible(record, snapshot);
        if (reason) return reject(reason);
        if (result?.assistantEvidencePresent !== true || result?.assistantEvidenceUnknown !== false) return reject('late_output_evidence_incomplete');
      }
      const key = keyFor(stamp) + ':' + record.supportRevision + ':' + record.assistantOutputRevision;
      if (processed.has(key)) return reject('duplicate');
      let blocked;
      try { blocked = late ? canDeliverLate() : canDeliver(); } catch { return reject('delivery_state_unavailable'); }
      if (['intro_unready', 'session_or_scope_unready', 'language_unsupported', 'unavailable'].includes(blocked)) return reject(blocked);
      boundedAdd(processed, key);
      pending = null; deferredReason = null;
      if (!captured.exact) {
        // Preserve only an observation of an explicit need. The later suffix
        // may reverse it: a fresh full-evidence classification is mandatory.
        if (!active && decision.eligible && ['simplify', 'example', 'starting_point'].includes(decision.action)) {
          supportRevision++;
          active = { kind: decision.supportKind, status: 'provisional', sourceText: captured.sourceText,
            sourceEventIds: captured.sourceEventIds, contributionId: stamp.contributionId, at: now(),
            stamp: cloneStamp(stamp), supportRevision, originOutputRevision: record.assistantOutputRevision,
            laterContributions: 0, sent: false };
          emit('need_retained', { reason: 'newer_words_require_revalidation', supportRevision,
            contributionId: stamp.contributionId, observedRevision: stamp.revision, currentRevision: snapshot.stamp.revision,
            sourceEventIds: captured.sourceEventIds, operationId: record.operationId, contextSent: false });
          return { accepted: true, sent: false, reason: 'need_retained_requires_revalidation' };
        }
        return reject('stale_evidence');
      }
      if (decision.clearSupport) {
        clearActive(decision.reason);
        emit('resolved', { reason: decision.reason, operationId: record.operationId, supportRevision,
          addressedProbability: result.addressedProbability, evidence: 'classification_of_transcript_not_playback', contextSent: false });
        return { accepted: true, sent: false, reason: decision.reason === 'already_addressed' ? 'already_addressed' : 'support_cleared' };
      }
      if (!decision.eligible) {
        if (decision.reason === 'revised_need_unidentified') {
          // A confirmed replacement withdraws the old subject even when the
          // classifier cannot identify useful support for the new one. Leave
          // the ordinary answer alone; never keep the old need as a fallback.
          clearActive('revised_need_unidentified');
          return { accepted: true, sent: false, reason: 'revised_need_support_withdrawn' };
        }
        if (decision.reason === 'correction_pending' && active
          && (active.status !== 'provisional' || active.blockedReason !== 'correction_pending')) {
          active.status = 'provisional'; active.blockedReason = 'correction_pending';
          active.supportRevision = ++supportRevision;
          emit('need_suspended', { reason: 'correction_pending', supportRevision, contextSent: false });
        }
        return reject(decision.reason);
      }
      if (!Object.hasOwn(EARLY_KIND_NOTES, decision.supportKind)) return reject('unsupported_kind');
      if (decision.action === 'continue_simplifying' && !active) return reject('no_active_support_to_continue');
      const sameNeed = !decision.replaceNeed && active && active.contributionId === stamp.contributionId && active.kind === decision.supportKind;
      if (!sameNeed && decision.action !== 'continue_simplifying') {
        supportRevision++;
        active = { kind: decision.supportKind, status: 'validated', sourceText: captured.sourceText,
          sourceEventIds: captured.sourceEventIds, contributionId: stamp.contributionId, at: now(),
          stamp: cloneStamp(stamp), supportRevision, originOutputRevision: record.assistantOutputRevision,
          laterContributions: 0, sent: false };
      } else if (active.status === 'provisional') {
        active.status = 'validated'; delete active.blockedReason; active.supportRevision = ++supportRevision;
      }
      if (active.sent) return reject('unchanged_support_already_supplied');
      pending = { stamp: cloneStamp(stamp), sourceEventIds: [...record.sourceEventIds], at: now(),
        supportRevision, operationId: record.operationId ?? null, requestId: record.requestId ?? null,
        deliveryMode: late ? 'late_experiment' : 'preanswer', assistantOutputRevision: record.assistantOutputRevision,
        ...(late ? { triggerBasis: record.triggerBasis, classifiedAtMs: record.classifiedAtMs,
          assistantEvidenceComplete: record.assistantEvidenceComplete,
          assistantOutputOriginRevision: record.assistantOutputOriginRevision,
          sourceOutputEventIds: [...record.sourceOutputEventIds] } : {}) };
      emit('validated', { operationId: pending.operationId, requestId: pending.requestId,
        action: decision.action, supportKind: decision.supportKind, supportRevision,
        need: result.need, change: result.change, addressedProbability: result.addressedProbability,
        contributionId: stamp.contributionId, revision: stamp.revision, sourceEventIds: [...record.sourceEventIds],
        inputOpen: snapshot.inputOpen === true, sourceComplete: snapshot.complete === true,
        activeSupport: true, contextSent: false, deliveryMode: pending.deliveryMode });
      return { accepted: true, ...tick() };
    },
    native(event) {
      if (closed || !event) return;
      const snapshot = evidence();
      if (event.type === 'session.closed') { this.close(); return; }
      if ((event.type === 'session.output_transcript.delta' && event.delta)
        || (event.type === 'session.output_audio.delta' && !silentSidebandAudio(event))) {
        if (snapshot?.stamp) boundedAdd(answered, contributionFor(snapshot.stamp));
        if (pending?.deliveryMode === 'late_experiment') {
          pending = null; defer('late_new_output_requires_reclassification');
        }
        if (pending) tick();
      }
      if (event.type === 'session.input_transcript.delta' && pending && (!snapshot || !same(pending.stamp, snapshot.stamp))) {
        pending = null; defer('new_input_requires_reclassification');
      }
    },
    boundary(event) {
      if (closed || !event) return;
      const snapshot = evidence();
      if (event.type === 'response.output_audio_transcript.done' && snapshot?.stamp) {
        boundedAdd(answered, contributionFor(snapshot.stamp));
        if (pending) tick();
      }
      if (event.type === 'session.closed') this.close();
    },
    activeSupport() {
      const snapshot = evidence();
      if (!enabled || closed || !snapshot?.usable || !active) return null;
      return { ...active, stamp: { ...active.stamp }, sourceEventIds: [...active.sourceEventIds] };
    },
    revision() { evidence(); return supportRevision; },
    reset(reason = 'scope_changed') {
      clearActive(reason); supportRevision++; pending = null; lastScope = null; lastContribution = null; deferredReason = null;
      answered.clear(); processed.clear();
      emit('reset', { reason, contextSent: false });
    },
    close() {
      if (closed) return;
      emit('closed', { attempts, pending: Boolean(pending), activeSupport: Boolean(active), contextSent: false });
      closed = true; pending = null; active = null;
    },
    status() { return { enabled, observeOnly, lateEnabled, closed, attempts, pending: Boolean(pending), activeSupport: Boolean(active),
      supportRevision, needStatus: active?.status ?? null, supportKind: active?.kind ?? null }; },
  });
}
