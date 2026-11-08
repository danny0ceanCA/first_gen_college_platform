import { silentSidebandAudio } from './audio-activity.mjs';
import { validConversationSupport } from './conversation-candidates.mjs';
import { affirmativeAcknowledgment } from '../conversation-evidence.mjs';

const complete = text => /[.!?。！？][\s"'”’»)]*$/u.test(text ?? '') && !/(?:\.{2,}|…)[\s"'”’»)]*$/u.test(text ?? '');
const normalize = text => String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
// Deliberately narrow. Anything richer than a known acknowledgment counts as
// a response: a missed recovery is preferable to repeating a finished answer.
export const acknowledgmentOnly = text => /^(?:(?:yes|yeah|yep|okay|ok|sure|of course|great|thanks|thank you|absolutely|all right|si|claro|vale|bien|por supuesto|gracias|de acuerdo|perfecto)[\s,.!¡¿?]*)+$/u.test(normalize(text));
export function conversationalOffer(text) {
  const normalized = normalize(text);
  const match = normalized.match(/(?:would you like|do you want|shall i|i can|want me to|te gustaria|quieres|puedo|te parece).{0,600}$/u);
  if (!match || !complete(text)) return false;
  const offer = match[0];
  if (/\b(?:look up|research|search|check|submit|apply|send|save|book|cancel|delete|busc\w*|busqu\w*|investig\w*|consul\w*|comprob\w*|revis\w*|enviar|envie|envies|guardar|guarde|guardes|solicitar|cancelar|borrar)\b/u.test(offer)) return false;
  return /\b(?:explain|example|walk|compare|comparison|talk|go through|break|explicar|explique|ejemplo|comparar|comparacion|hablar|repasar)\b/u.test(offer);
}
const notes = {
  en: {
    confused: 'Current reply context: the caller found this topic unclear. If helpful, use one familiar example and one small point in everyday words. Answer their latest question normally. This note adds no new request: do not repeat an answer, add acknowledgment, or start or extend speech solely for this note. This is temporary support, not a lasting preference.',
    clear: 'Earlier temporary confusion support ended. For this caller’s current ordinary reply, follow the latest question normally. This note adds no new request: do not repeat an answer, add acknowledgment, or start or extend speech solely for this note.',
    continue: 'The caller accepted your last offer to explain. If not already answered, continue with one concrete point now, without another permission question or reassurance-only reply. Use existing context only; no research or other action is authorized. A new caller turn cancels this direction.',
    example: ' Use a familiar example in everyday words.',
    ended: ' Earlier temporary confusion support has ended.',
  },
  es: {
    confused: 'Contexto para la respuesta actual: este tema no quedó claro. Si ayuda, usa un ejemplo cotidiano y una sola idea con palabras sencillas. Responde normalmente la última pregunta. Esta nota no es otra solicitud: no repitas una respuesta, agregues confirmación ni empieces o prolongues la voz solo por esta nota. Es apoyo temporal, no una preferencia permanente.',
    clear: 'Terminó el apoyo temporal por confusión. Para la respuesta actual, sigue normalmente la última pregunta. Esta nota no es otra solicitud: no repitas una respuesta, agregues confirmación ni empieces o prolongues la voz solo por esta nota.',
    continue: 'La persona aceptó tu última oferta de explicar. Si aún no respondiste, continúa ahora con una idea concreta, sin volver a pedir permiso ni solo confirmar. Usa únicamente el contexto existente; no autoriza investigaciones ni otras acciones. Un nuevo turno de la persona anula esta indicación.',
    example: ' Usa un ejemplo cotidiano con palabras sencillas.',
    ended: ' Terminó el apoyo temporal por confusión.',
  },
};

export function createConversationDelivery({ enabled = false, scope = {}, language = 'en', now = () => performance.now(),
  canDeliver = () => 'unavailable', send, log = () => {} } = {}) {
  let currentScope = { ...scope }, currentLanguage = language, scopeGeneration = 0, inputRevision = 0;
  let source = null, previousAssistant = null, reply = '', thought = null, validation = null;
  let inputSpan = null, acknowledgmentGroup = null, inputInProgress = false, outputDuringInput = false, inputReply = '', inputThought = null;
  let confusion = false, published = false, confusionAt = 0, confusionTurns = 0, pendingContinuation = false;
  let lastActivity = -Infinity, idleSince = null, closed = false, attempts = 0, recoveries = 0, lastSend = -Infinity, lastRecovery = -Infinity;
  let deferred = null;
  const seen = new Set();
  const emit = (stage, details = {}) => { try { log({ type: 'support_conversation_' + stage,
    callId: currentScope.sessionId, studentId: currentScope.studentId, language: currentLanguage,
    questionId: source?.id ?? null, inputRevision, scopeGeneration,
    operationId: validation?.operationId ?? null, requestId: validation?.requestId ?? null,
    ...details, playbackClaim: false }); } catch {} };
  const stamp = () => source ? { scopeGeneration, inputRevision, questionId: source.id,
    studentId: currentScope.studentId, sessionId: currentScope.sessionId } : null;
  const defer = reason => { if (deferred !== reason) emit('deferred', { reason, contextSent: false }); deferred = reason; };
  function tick() {
    if (!enabled || closed || !source) return;
    if (confusion && (now() - confusionAt > 90000 || confusionTurns > 3)) confusion = false;
    if (pendingContinuation && now() - source.at > 12000) { pendingContinuation = false; emit('continuation_expired', { contextSent: false }); }
    if (pendingContinuation && reply && !acknowledgmentOnly(reply)) {
      pendingContinuation = false; emit('continuation_suppressed', { reason: 'assistant_already_responded', evidence: 'transcript_only', contextSent: false });
    }
    if (confusion === published && !pendingContinuation) return;
    // A missed quiet note remains local. Only a fresh classification of the
    // latest caller can revalidate it; no post-answer idle tick publishes it.
    if (!validation) return;
    if (now() - validation.at > 60000) { defer('classification_expired'); return; }
    const blocked = canDeliver(); if (blocked) { defer(blocked); return; }
    if (pendingContinuation) {
      // Recovery directions can interrupt. Require the existing safe gap and
      // never mistake audio without a transcript for an unanswered turn.
      const settled = thought?.complete && thought.revision === inputRevision;
      const noReplyYet = !source.assistantStarted && !reply && previousAssistant?.complete && now() - source.at >= 1800;
      if ((!settled && !noReplyYet) || idleSince === null || now() - idleSince < 400
        || now() - Math.max(lastActivity, source.at, thought?.at ?? -Infinity) < 900) { defer('thought_or_playback_not_settled'); return; }
    } else {
      // Thinking appends can still prompt speech. Apply optional style only
      // before the ordinary reply starts, never after a finished answer. There
      // is no waiting/holding: fast native answers may leave notes unsent.
      if (source.assistantStarted || reply || !previousAssistant?.complete || now() - source.at > 1500) {
        defer('quiet_preanswer_window_missed'); return;
      }
      if (confusion && !validation.confusionNeeds) { defer('confusion_not_revalidated'); return; }
    }
    if (attempts >= 12 || now() - lastSend < 2500) { defer('rate_limited'); return; }
    let kind, content, eventType;
    // A safe conversational continuation can incorporate the simpler style in
    // the same direction, avoiding two competing appends for one caller turn.
    if (pendingContinuation) {
      if (recoveries >= 4 || now() - lastRecovery < 10000) { defer('continuation_rate_limited'); return; }
      kind = 'continuation'; eventType = 'session.instructions.append'; content = notes[currentLanguage].continue;
      if (confusion) content += notes[currentLanguage].example;
      else if (published) content += notes[currentLanguage].ended;
      pendingContinuation = false; recoveries++; lastRecovery = now();
    } else { kind = 'confusion'; eventType = 'session.thinking.append'; content = notes[currentLanguage][confusion ? 'confused' : 'clear']; }
    attempts++; lastSend = now(); published = confusion; deferred = null;
    const details = { kind: 'conversation', supportKind: kind, questionId: source.id,
      operationId: validation?.operationId ?? null, requestId: validation?.requestId ?? null,
      inputRevision, scopeGeneration, activeConfusion: confusion, attempts, recoveries,
      boundaryBasis: kind === 'continuation' ? 'application_estimate' : 'preanswer_application_estimate', playbackEvidence: 'fresh_idle',
      clearingTemporaryContext: kind === 'confusion' && !confusion,
      classificationToSendMs: validation ? now() - validation.at : null, callerToSendMs: now() - source.at };
    try { if (send(eventType, content, details) === false) throw Error('unconfirmed'); }
    catch { emit('send_unconfirmed', { ...details, contextSent: 'unknown' }); }
  }
  return {
    stamp, tick,
    native(event) {
      if (closed) return;
      if (event.type === 'session.input_transcript.delta' && event.delta) {
        if (!inputInProgress) { inputInProgress = true; outputDuringInput = false; inputReply = ''; inputThought = null; }
        source = null; validation = null; inputRevision++; pendingContinuation = false; idleSince = null; lastActivity = now(); thought = null;
        const timed = Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms)
          && event.start_ms >= 0 && event.end_ms >= event.start_ms;
        inputSpan = inputSpan?.invalid || !timed ? { invalid: true } : {
          start: Math.min(inputSpan?.start ?? event.start_ms, event.start_ms),
          end: Math.max(inputSpan?.end ?? event.end_ms, event.end_ms),
        };
      }
      if (event.type === 'session.output_transcript.delta' && event.delta) {
        acknowledgmentGroup = null;
        if (source) source.assistantStarted = true;
        if (inputInProgress) { outputDuringInput = true; inputReply = (inputReply + event.delta).slice(0, 8193); inputThought = null; }
        reply += event.delta; thought = null; idleSince = null; lastActivity = now();
        if (reply.length > 8192) reply = 'response_too_long_to_recover';
      }
      if (event.type === 'session.output_audio.delta' && !silentSidebandAudio(event)) {
        acknowledgmentGroup = null; if (source) source.assistantStarted = true;
        if (inputInProgress) outputDuringInput = true;
        lastActivity = now(); idleSince = null;
      }
    },
    boundary(event) {
      if (closed) return;
      if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.item_id === 'string') {
        const id = 'user:' + event.item_id;
        if (source?.id === id) return;
        const directOffer = !previousAssistant?.consumed && now() - (previousAssistant?.at ?? -Infinity) <= 30000 && conversationalOffer(previousAssistant?.text);
        const affirmative = affirmativeAcknowledgment(event.transcript);
        const timed = inputSpan && !inputSpan.invalid;
        const carry = !directOffer && affirmative && timed && acknowledgmentGroup
          && acknowledgmentGroup.count < 3 && now() - acknowledgmentGroup.at <= 4000
          && inputSpan.start >= acknowledgmentGroup.lastEnd
          && inputSpan.end - acknowledgmentGroup.start <= 4000;
        const offer = Boolean(directOffer || carry);
        acknowledgmentGroup = affirmative && timed && offer ? carry
          ? { ...acknowledgmentGroup, count: acknowledgmentGroup.count + 1, lastEnd: inputSpan.end }
          : { at: now(), count: 1, start: inputSpan.start, lastEnd: inputSpan.end } : null;
        source = { id, at: now(), offer, offerGroupSize: acknowledgmentGroup?.count ?? 0, assistantStarted: outputDuringInput };
        inputSpan = null;
        if (previousAssistant) previousAssistant.consumed = true;
        inputRevision++; confusionTurns++; validation = null; pendingContinuation = false;
        reply = outputDuringInput ? inputReply : '';
        thought = outputDuringInput && inputThought ? { ...inputThought, revision: inputRevision } : null;
        inputInProgress = false; outputDuringInput = false; inputReply = ''; inputThought = null;
      }
      if (event.type === 'response.output_audio_transcript.done') {
        acknowledgmentGroup = null;
        const text = String(event.transcript ?? '');
        if (source) source.assistantStarted = true;
        if (inputInProgress) { outputDuringInput = true; inputReply = text; inputThought = { at: now(), complete: complete(text) }; }
        previousAssistant = { text: text.slice(0, 8192), complete: complete(text), at: now() };
        reply = text; thought = { at: now(), revision: inputRevision, complete: complete(text) };
      }
    },
    playback(value) { if (closed || typeof value?.idle !== 'boolean') return; if (!value.idle) idleSince = null; else idleSince ??= now(); tick(); },
    consider({ record, stamp: candidate } = {}) {
      const reject = reason => { emit('skipped', { reason, candidateOperationId: record?.operationId ?? null, contextSent: false }); return { accepted: false, reason }; };
      if (!enabled || closed || !currentScope.confirmed || !currentScope.studentId || currentScope.studentId === 'unselected') return reject('disabled_or_scope_unready');
      const current = stamp();
      if (!current || !candidate || Object.keys(current).some(key => current[key] !== candidate[key])) return reject('stale_caller_or_scope');
      if (record?.status !== 'completed' || record.callId !== currentScope.sessionId || record.studentId !== currentScope.studentId
        || !Array.isArray(record.sourceTranscriptIds) || record.sourceTranscriptIds.some(id => typeof id !== 'string')
        || !record.sourceTranscriptIds.includes(source.id)
        || !['completed', 'discarded'].includes(record.sourceStatus ?? 'completed')
        || record.sourceStatus === 'discarded' && record.sourceReason !== 'stale_after_request') return reject('record_unmatched');
      const support = record.result?.conversationSupport;
      if (!validConversationSupport(support)) return reject('invalid_result');
      const key = JSON.stringify(current); if (seen.has(key)) return reject('duplicate');
      seen.add(key); if (seen.size > 128) seen.delete(seen.values().next().value);
      const confident = value => value.confidence >= .85 && value.selectedProbability >= .9;
      validation = { at: now(), operationId: record.operationId, requestId: record.requestId,
        confusionNeeds: confident(support.confusion) && support.confusion.action === 'needs_simpler_explanation' };
      if (confident(support.confusion)) {
        if (support.confusion.action === 'needs_simpler_explanation') { confusion = true; confusionAt = now(); confusionTurns = 0; }
        if (['resolved', 'topic_changed'].includes(support.confusion.action)) confusion = false;
      }
      pendingContinuation = confident(support.continuation) && support.continuation.action === 'accepted_conversational_offer' && source.offer;
      emit('validated', { classifications: support, activeConfusion: confusion, continuationEligible: pendingContinuation,
        offerEvidence: source.offer ? source.offerGroupSize > 1 ? 'adjacent_affirmative_group' : 'immediate_completed_assistant_offer' : 'absent_or_ineligible',
        offerGroupSize: source.offerGroupSize, contextSent: false });
      tick(); return { accepted: true, pending: confusion !== published || pendingContinuation };
    },
    reset(nextScope = currentScope, nextLanguage = currentLanguage, reason = 'scope_changed') {
      scopeGeneration++; inputRevision++; currentScope = { ...nextScope }; currentLanguage = nextLanguage;
      source = null; validation = null; previousAssistant = null; reply = ''; thought = null; idleSince = null; inputSpan = null; acknowledgmentGroup = null;
      inputInProgress = false; outputDuringInput = false; inputReply = ''; inputThought = null;
      confusion = false; pendingContinuation = false; emit('reset', { reason, contextSent: false });
    },
    close() { if (closed) return; emit('closed', { pending: confusion !== published || pendingContinuation, attempts, recoveries, contextSent: false }); closed = true; },
    status() { return { enabled, activeConfusion: confusion, pending: confusion !== published || pendingContinuation, attempts, recoveries }; },
  };
}
