import { randomUUID } from 'node:crypto';
import { createPreferenceDelivery } from './preference-delivery.mjs';
import { silentSidebandAudio } from './audio-activity.mjs';
import { createConversationDelivery } from './conversation-delivery.mjs';
import { createEarlySupportDelivery } from './early-support-delivery.mjs';

// Optional application-authored support. No generated wording, research
// observation, transcript content or student record enters the outbound payload.
export const SUPPORT_NOTES = Object.freeze({
  en: Object.freeze({
    starting_point: 'Conversation support observation: the caller explicitly asked for help finding a starting point. One small starting point grounded in what they already shared, or one gentle question, may help. This is optional context for the next relevant reply, with no separate acknowledgment, greeting or recap needed.',
    simpler_explanation: 'Conversation support observation: the caller explicitly asked for a simpler explanation. A short plain-language explanation of the idea already being discussed, with one familiar example if useful, may help. This is optional context for the next relevant reply, with no separate acknowledgment, greeting or recap needed.',
    concrete_example: 'Conversation support observation: the caller asked for a concrete example. One short familiar example of the current idea may help; use a different example if the last one did not help. This is optional context for the next relevant reply. Do not interrupt, repeat, or start speech for this note.',
    next_step: 'Conversation support observation: the caller explicitly asked what to do next. One manageable next step grounded in the current conversation may help. This is optional context for the next relevant reply, with no separate acknowledgment, greeting or recap needed.',
  }),
  es: Object.freeze({
    starting_point: 'Observación de apoyo: la persona pidió ayuda explícitamente para encontrar por dónde empezar. Puede ayudar un primer paso pequeño basado en lo que ya compartió, o una pregunta amable. Es contexto opcional para la próxima respuesta pertinente; no requiere otro saludo, resumen ni anuncio.',
    simpler_explanation: 'Observación de apoyo: la persona pidió explícitamente una explicación más sencilla. Puede ayudar una explicación breve con palabras cotidianas de la idea que ya se está conversando, y un ejemplo familiar si sirve. Es contexto opcional para la próxima respuesta pertinente; no requiere otro saludo, resumen ni anuncio.',
    concrete_example: 'Observación de apoyo: la persona pidió un ejemplo concreto. Puede ayudar un ejemplo cotidiano y breve de la idea actual; usa otro si el anterior no ayudó. Es contexto opcional para la próxima respuesta pertinente. No interrumpas, repitas ni empieces a hablar por esta nota.',
    next_step: 'Observación de apoyo: la persona preguntó explícitamente qué hacer después. Puede ayudar un solo paso manejable basado en la conversación actual. Es contexto opcional para la próxima respuesta pertinente; no requiere otro saludo, resumen ni anuncio.',
  }),
});

export function createSupportGate({ enabled = false, preferencesEnabled = false, conversationEnabled = false,
  earlyEnabled = false, earlyObserveOnly = false, lateEnabled = false, betweenThoughtsEnabled = false, getEarlyEvidence = () => null, scope = {}, language = 'en',
  send, log = () => {}, now = () => performance.now(), makeId = randomUUID } = {}) {
  let currentScope = { ...scope }, currentLanguage = language;
  let generation = 0, question = null, started = false, closed = false, introReady = false, introBoundary = false;
  let inputOpen = false, outputOpen = false, research = false, delegation = false;
  let audioActivityAt = -Infinity;
  let playback = { idle: false, version: -1, at: -Infinity }, sent = 0, lastSentAt = -Infinity;
  const attempts = new Set(), ownEvents = new Map(), pendingContext = new Set(), backends = new Set(), pendingDelegations = new Set();
  const emit = (type, details = {}) => { try { log({ type: `support_${type}`,
    callId: currentScope.sessionId, studentId: currentScope.studentId, language: currentLanguage, ...details }); } catch {} };
  const invalidate = () => { generation++; question = null; };
  const selected = () => currentScope.confirmed === true && typeof currentScope.studentId === 'string'
    && currentScope.studentId && currentScope.studentId !== 'unselected';
  // A confirmed initial scope is already authorized in session configuration.
  // Subsequent selections must wait for the existing controller's receipt;
  // a short spoken acknowledgment alone is not the end of that selection.
  let selectionPending = false;
  const lateBlocked = () => !lateEnabled || closed || !started || !selected() ? 'session_or_scope_unready'
    : selectionPending || !introReady ? 'intro_unready'
    : inputOpen || outputOpen || now() - audioActivityAt < 900 ? 'speech_in_progress'
    : !playback.idle || now() - playback.at > 1500 ? 'playback_not_fresh_idle'
    : research || delegation || backends.size || pendingDelegations.size || pendingContext.size ? 'background_or_context_pending'
    : !['en', 'es'].includes(currentLanguage) ? 'language_unsupported' : null;
  const betweenBlocked = () => !betweenThoughtsEnabled || closed || !started || !selected() ? 'session_or_scope_unready'
    : selectionPending || !introReady ? 'intro_unready'
    : inputOpen || getEarlyEvidence()?.inputOpen !== false ? 'caller_boundary_unconfirmed'
    : outputOpen || getEarlyEvidence()?.outputOpen !== false
      || getEarlyEvidence()?.assistantBoundaryRevision !== getEarlyEvidence()?.assistantOutputRevision ? 'output_boundary_unconfirmed'
    : now() - audioActivityAt < 900 ? 'speech_in_progress'
    : !playback.idle || now() - playback.at > 1500 ? 'playback_not_fresh_idle'
    // A job running in the background does not itself prevent support. Pending
    // delegations and context still fence the append's acknowledgment effects.
    : delegation || backends.size || pendingDelegations.size || pendingContext.size ? 'background_or_context_pending'
    : !['en', 'es'].includes(currentLanguage) ? 'language_unsupported' : null;
  const deliveryState = () => ({ started, closed, selected: Boolean(selected()), selectionPending, introReady,
    inputOpen, outputOpen, recentAudio: now() - audioActivityAt < 900,
    playbackIdle: playback.idle, playbackAgeMs: Number.isFinite(playback.at) ? Math.max(0, now() - playback.at) : null,
    research, delegation, backendCount: backends.size, delegationCount: pendingDelegations.size,
    pendingContextCount: pendingContext.size });
  const early = createEarlySupportDelivery({ enabled: enabled && earlyEnabled, observeOnly: earlyObserveOnly, lateEnabled, betweenThoughtsEnabled,
    canDeliverLate: lateBlocked, canDeliverBetweenThoughts: betweenBlocked, getEvidence: getEarlyEvidence, now, log, deliveryState,
    canDeliver: () => closed || !started || !selected() ? 'session_or_scope_unready'
      : selectionPending || !introReady ? 'intro_unready'
      // Classification can run while the caller speaks, but optional context
      // must wait for the matching application-estimated input boundary.
      // This never holds native output or claims the caller physically stopped.
      : inputOpen ? 'caller_speech_in_progress'
      : getEarlyEvidence()?.inputOpen !== false ? 'caller_boundary_unconfirmed'
      : outputOpen || now() - audioActivityAt < 900 ? 'assistant_speech_in_progress'
      : !playback.idle || now() - playback.at > 1500 ? 'playback_not_fresh_idle'
      : delegation || backends.size || pendingDelegations.size || pendingContext.size ? 'background_or_context_pending'
      : !['en', 'es'].includes(currentLanguage) ? 'language_unsupported' : null,
    send(type, content, details) {
      const eventId = 'support_early_' + makeId(); details.eventId = eventId;
      pendingContext.add(eventId); ownEvents.set(eventId, { ...details, kind: 'early',
        callId: currentScope.sessionId, studentId: currentScope.studentId, language: currentLanguage, sentAt: now() });
      try { return send({ type, event_id: eventId, delegation_id: null, content }) !== false; }
      catch { return false; }
    },
  });
  const conversation = createConversationDelivery({ enabled: enabled && conversationEnabled, scope, language, now, log,
    canDeliver: () => closed || !started || !selected() ? 'session_or_scope_unready'
      : selectionPending || !introReady ? 'intro_unready'
      : inputOpen || outputOpen || now() - audioActivityAt < 900 ? 'speech_in_progress'
      : !playback.idle || now() - playback.at > 1500 ? 'playback_not_fresh_idle'
      // A running research job alone does not pause ordinary conversation.
      // Unfinished delegations/context still fence acknowledgment side effects.
      : delegation || backends.size || pendingDelegations.size || pendingContext.size ? 'background_or_context_pending'
      : !['en', 'es'].includes(currentLanguage) ? 'language_unsupported' : null,
    send(type, content, details) {
      const eventId = 'support_conversation_' + makeId();
      details = { ...details, callId: currentScope.sessionId, studentId: currentScope.studentId, language: currentLanguage };
      pendingContext.add(eventId); ownEvents.set(eventId, { ...details, sentAt: now() });
      try {
        if (send({ type, event_id: eventId, delegation_id: null, content }) === false) throw Error('not_writable');
        emit('conversation_sent', { ...details, eventType: type, eventId, contextSent: true, playbackClaim: false });
      } catch { emit('conversation_send_unconfirmed', { ...details, eventType: type, eventId, contextSent: 'unknown', playbackClaim: false }); }
    },
  });
  const preferences = createPreferenceDelivery({ enabled: enabled && preferencesEnabled, scope, language, now,
    log,
    deliveryState,
    canDeliver: () => closed || !started || !selected() ? 'session_or_scope_unready'
      : selectionPending || !introReady ? 'intro_unready'
      : inputOpen || outputOpen || now() - audioActivityAt < 900 ? 'speech_in_progress'
      : !playback.idle || now() - playback.at > 1500 ? 'playback_not_fresh_idle'
      : research || delegation || backends.size || pendingDelegations.size || pendingContext.size ? 'background_or_context_pending'
      : !['en', 'es'].includes(currentLanguage) ? 'language_unsupported' : null,
    send(content, details) {
      const eventId = `support_preference_${makeId()}`;
      details = { ...details, callId: currentScope.sessionId, studentId: currentScope.studentId, language: currentLanguage };
      pendingContext.add(eventId); ownEvents.set(eventId, { ...details, sentAt: now() });
      try {
        if (send({ type: 'session.thinking.append', event_id: eventId, delegation_id: null, content }) === false) throw Error('not_writable');
        emit('preference_sent', { ...details, eventId, contextSent: true, playbackClaim: false });
      } catch {
        // A thrown write can be ambiguous. Retain the fence and never retry.
        emit('preference_send_unconfirmed', { ...details, eventId, contextSent: 'unknown', playbackClaim: false });
      }
    },
  });
  function checkAcknowledgments(reason = 'acknowledgment_timeout') {
    for (const [eventId, details] of ownEvents) {
      if (details.uncertaintyLogged || (reason === 'acknowledgment_timeout' && now() - details.sentAt < 10000)) continue;
      details.uncertaintyLogged = true;
      emit('context_unconfirmed', { callId: details.callId, studentId: details.studentId, language: details.language,
        operationId: details.operationId, requestId: details.requestId ?? null, questionId: details.questionId,
        kind: details.kind ?? 'one_time_support', revision: details.revision ?? null,
        supportNeed: details.supportNeed, eventId, reason, durationMs: Math.max(0, now() - details.sentAt),
        contextSent: true, playbackClaim: false });
    }
  }
  function stamp() {
    return question ? { generation, questionId: question.id, questionAt: question.at,
      studentId: currentScope.studentId, sessionId: currentScope.sessionId } : null;
  }
  function blocked(reason, record, source) {
    emit('skipped', { reason, operationId: record?.operationId ?? null, questionId: source?.questionId ?? null,
      contextSent: false, playbackClaim: false });
    return { sent: false, reason };
  }
  return Object.freeze({
    stamp,
    preferenceStamp: preferences.stamp,
    considerPreference: preferences.consider,
    earlySupport: early.activeSupport,
    earlySupportRevision: early.revision,
    earlyAllowed: () => enabled && earlyEnabled && started && !closed && selected() && introReady && !selectionPending,
    lateAllowed: () => enabled && earlyEnabled && lateEnabled && !lateBlocked(),
    betweenThoughtsAllowed: () => enabled && earlyEnabled && betweenThoughtsEnabled && !betweenBlocked(),
    considerEarly: early.consider,
    conversationStamp: conversation.stamp,
    considerConversation(candidate) {
      if (selectionPending || !introReady) {
        emit('conversation_skipped', { reason: 'intro_unready', contextSent: false, playbackClaim: false });
        return { accepted: false, reason: 'intro_unready' };
      }
      if (earlyEnabled && candidate?.record?.result?.conversationSupport) {
        // Early classification owns temporary explanation support. Keep only
        // the existing accepted-offer recovery in this later boundary path.
        candidate = { ...candidate, record: { ...candidate.record, result: { ...candidate.record.result,
          conversationSupport: { ...candidate.record.result.conversationSupport,
            confusion: { action: 'none', confidence: 1, selectedProbability: 1 } } } } };
      }
      return conversation.consider(candidate);
    },
    native(event) {
      checkAcknowledgments();
      if (closed || !event) return;
      preferences.native(event);
      conversation.native(event);
      early.native(event);
      if (event.type === 'session.started') { started = true; introReady = false; introBoundary = false; invalidate(); }
      if (event.type === 'session.closed') { checkAcknowledgments('session_closed'); closed = true; preferences.close(); conversation.close(); early.close(); invalidate(); }
      if (event.type === 'session.input_transcript.delta' && event.delta) { inputOpen = true; invalidate(); }
      if (event.type === 'session.output_transcript.delta' && event.delta) { outputOpen = true; invalidate(); }
      if (event.type === 'session.output_audio.delta' && !silentSidebandAudio(event)) {
        audioActivityAt = now(); invalidate();
      }
      if (event.type === 'session.delegation.created') { pendingDelegations.add(event.delegation?.id ?? 'unknown'); invalidate(); }
      if (event.type === 'response.event' && event.event?.type === 'response.created') {
        pendingDelegations.delete(event.delegation_id);
        backends.add(event.event.response?.id ?? event.event.response_id ?? 'unknown');
        invalidate();
      }
      if (event.type === 'response.event' && ['response.completed', 'response.failed', 'response.cancelled', 'response.incomplete'].includes(event.event?.type))
        pendingDelegations.delete(event.delegation_id);
      if (['session.thinking.appended', 'session.commentary.appended', 'session.instructions.appended', 'error'].includes(event.type)) {
        const id = event.client_event_id ?? event.error?.client_event_id;
        if (id) pendingContext.delete(id);
        if (ownEvents.has(id)) {
          const details = ownEvents.get(id); ownEvents.delete(id);
          emit((['preference', 'conversation', 'early'].includes(details.kind) ? details.kind + '_' : '') + (event.type === 'error' ? 'provider_rejected' : 'context_acknowledged'), {
            callId: details.callId, studentId: details.studentId, language: details.language,
            kind: details.kind ?? 'one_time_support', revision: details.revision ?? null,
            operationId: details.operationId, requestId: details.requestId ?? null,
            questionId: details.questionId, supportNeed: details.supportNeed,
            supportKind: details.supportKind,
            ...(details.kind === 'early' ? { contributionId: details.contributionId, sourceEventIds: details.sourceEventIds,
              sourceRevision: details.revision } : {}),
            eventId: id, contextSent: true, playbackClaim: false, durationMs: Math.max(0, now() - details.sentAt),
            ...(event.type === 'error' ? { reason: 'provider_error',
              providerErrorCode: typeof event.error?.code === 'string' ? event.error.code.slice(0, 100) : null }
              : { startMs: event.start_ms ?? null, endMs: event.end_ms ?? null }),
          });
        }
      }
    },
    boundary(event) {
      checkAcknowledgments();
      if (closed || !event) return;
      preferences.boundary(event);
      conversation.boundary(event);
      early.boundary(event);
      if (event.type === 'origen.selection.context' && event.stage === 'staged') {
        selectionPending = true; introReady = false; introBoundary = false; invalidate();
      }
      if (event.type === 'origen.selection.delivery'
        && ['receipt', 'caller_after_receipt'].includes(event.stage)) {
        // Context acknowledgment is deliberately not a readiness signal. A
        // fresh assistant boundary and browser idle must follow this receipt.
        selectionPending = false; introReady = false; introBoundary = false; invalidate();
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        inputOpen = false; invalidate();
        if (typeof event.item_id === 'string' && typeof event.transcript === 'string' && event.transcript.trim())
          question = { id: `user:${event.item_id}`, at: now() };
      }
      if (event.type === 'response.output_audio_transcript.done') {
        outputOpen = false; invalidate(); introBoundary = true;
      }
      if (event.type === 'origen.backend.started') { backends.add(event.response_id ?? 'unknown'); invalidate(); }
      if (event.type === 'origen.backend.finished') { backends.delete(event.response_id ?? 'unknown'); invalidate(); }
      if (event.type === 'session.closed') { checkAcknowledgments('session_closed'); closed = true; preferences.close(); conversation.close(); early.close(); invalidate(); }
    },
    playback(value) {
      checkAcknowledgments();
      if (closed || !value || typeof value.idle !== 'boolean' || !Number.isSafeInteger(value.version) || value.version < playback.version) return;
      if (!value.idle) invalidate();
      playback = { idle: value.idle, version: value.version, at: now() };
      if (value.idle && !outputOpen && now() - audioActivityAt >= 900 && !selectionPending && introBoundary && selected() && started) introReady = true;
      preferences.playback(value);
      conversation.playback(value);
      early.tick();
    },
    providerCommand(event) {
      if (closed || !event || ownEvents.has(event.event_id)) return;
      if (['session.thinking.append', 'session.commentary.append', 'session.instructions.append', 'session.update', 'response.create', 'response.item.create'].includes(event.type)) {
        invalidate();
        if (event.type.endsWith('.append') && typeof event.event_id === 'string') pendingContext.add(event.event_id);
      }
      if (event.type === 'session.start') { started = false; introReady = false; introBoundary = false; invalidate(); }
      if (event.type === 'session.close') { closed = true; preferences.close(); conversation.close(); early.close(); invalidate(); }
    },
    researchBusy(value) { const next = value === true; if (next !== research) invalidate(); research = next; },
    delegationBusy(value) { const next = value === true; if (next !== delegation) invalidate(); delegation = next; },
    configure(nextScope, nextLanguage) {
      const changed = nextScope.studentId !== currentScope.studentId || nextScope.confirmed !== currentScope.confirmed
        || nextScope.sessionId !== currentScope.sessionId;
      if (changed || nextLanguage !== currentLanguage) invalidate();
      if (changed || nextLanguage !== currentLanguage) preferences.reset(nextScope, nextLanguage, changed ? 'scope_changed' : 'language_changed');
      if (changed || nextLanguage !== currentLanguage) conversation.reset(nextScope, nextLanguage, changed ? 'scope_changed' : 'language_changed');
      if (changed || nextLanguage !== currentLanguage) early.reset(changed ? 'scope_changed' : 'language_changed');
      if (changed) { introReady = false; introBoundary = false; inputOpen = false; outputOpen = false; playback = { idle: false, version: -1, at: -Infinity }; }
      currentScope = { ...nextScope }; currentLanguage = nextLanguage;
      if (changed) selectionPending = Boolean(selected());
    },
    suspend() { checkAcknowledgments('session_suspended'); preferences.reset(currentScope, currentLanguage, 'connection_gap'); conversation.reset(currentScope, currentLanguage, 'connection_gap'); early.reset('connection_gap'); invalidate(); started = false; introReady = false; introBoundary = false; playback.idle = false; },
    close() { checkAcknowledgments('session_closed'); closed = true; preferences.close(); conversation.close(); early.close(); invalidate(); },
    consider({ record, stamp: source } = {}) {
      checkAcknowledgments();
      if (!enabled) return blocked('disabled', record, source);
      if (earlyEnabled && ['simpler_explanation', 'concrete_example', 'starting_point'].includes(record?.result?.supportNeed)) return blocked('early_support_owns_explanation', record, source);
      if (conversationEnabled && conversation.status().pending) return blocked('conversation_update_pending', record, source);
      if (preferencesEnabled && preferences.status().pending) return blocked('preference_update_pending', record, source);
      if (closed || !started || !selected()) return blocked('session_or_scope_unready', record, source);
      if (selectionPending || !introReady) return blocked('intro_unready', record, source);
      if (!source || !question || source.generation !== generation || source.questionId !== question.id
        || source.questionAt !== question.at || source.studentId !== currentScope.studentId
        || source.sessionId !== currentScope.sessionId) return blocked('stale', record, source);
      if (now() - question.at > 4000 || now() < question.at) return blocked('expired', record, source);
      if (inputOpen || outputOpen || now() - audioActivityAt < 900) return blocked('speech_in_progress', record, source);
      if (!playback.idle || now() - playback.at > 1500) return blocked('playback_not_fresh_idle', record, source);
      if (research || delegation || backends.size || pendingDelegations.size || pendingContext.size) return blocked('background_or_context_pending', record, source);
      const result = record?.result;
      if (record?.status !== 'completed' || record.studentId !== currentScope.studentId
        || record.callId !== currentScope.sessionId || !record.sourceTranscriptIds?.includes(question.id)) return blocked('record_unmatched', record, source);
      if (!Object.hasOwn(SUPPORT_NOTES.en, result?.supportNeed)) return blocked('no_support_need', record, source);
      if (!Number.isFinite(result.selectedProbability) || result.selectedProbability < 0.9
        || !Number.isFinite(result.confidence) || result.confidence < 0.85) return blocked('uncertain', record, source);
      if (result.alreadyAddressed !== false || !Number.isFinite(result.addressedProbability)
        || result.addressedProbability > 0.1) return blocked('already_or_possibly_addressed', record, source);
      if (!['en', 'es'].includes(currentLanguage)) return blocked('language_unsupported', record, source);
      if (attempts.has(question.id)) return blocked('duplicate', record, source);
      if (sent >= 2 || now() - lastSentAt < 30000) return blocked('rate_limited', record, source);
      const eventId = `support_${makeId()}`;
      const details = { operationId: record.operationId ?? null, requestId: record.requestId ?? null,
        callId: currentScope.sessionId, studentId: currentScope.studentId, language: currentLanguage,
        questionId: question.id, supportNeed: result.supportNeed };
      const event = { type: 'session.thinking.append', event_id: eventId, delegation_id: null,
        content: SUPPORT_NOTES[currentLanguage][result.supportNeed] };
      attempts.add(question.id); sent++; lastSentAt = now(); pendingContext.add(eventId); ownEvents.set(eventId, { ...details, sentAt: now() });
      // No queue, timer or resend: uncertain send outcomes consume the attempt.
      try {
        if (send(event) === false) throw Error('provider_not_writable');
        emit('sent', { ...details, eventId, contextSent: true, playbackClaim: false });
        return { sent: true, eventId };
      } catch {
        pendingContext.delete(eventId); ownEvents.delete(eventId);
        emit('send_failed', { ...details, eventId, contextSent: 'unknown', playbackClaim: false });
        return { sent: false, reason: 'send_failed' };
      }
    },
    status() { checkAcknowledgments(); return { enabled, started, introReady, selectionPending, sent, generation, closed,
      preferences: preferences.status(), conversation: conversation.status(), early: early.status(), researchObserveOnly: true }; },
  });
}
