// Local lab only: a parallel projection of native transcript evidence. It does
// not finalize turns, call Live, replace the existing projector, or infer audio
// playback. The parent and worker consume identical packets to share a stamp.
import { createExplanationHistory } from './explanation-history.mjs';

export const EARLY_EVIDENCE_LIMITS = Object.freeze({ textBytes: 8192, classificationBytes: 4096, sourceEvents: 128,
  seenEvents: 256, dialogueItems: 8, dialogueBytes: 8192 });
const fields = ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch', 'contributionId', 'revision'];
const bytes = value => Buffer.byteLength(value, 'utf8');
const validText = (value, max = 256) => typeof value === 'string' && value.trim().length > 0 && bytes(value) <= max;
const normalized = value => value.trim().replace(/\s+/gu, ' ');
// Scheduling hints only: Decisions still judges meaning. Do not spend a scarce
// final check on a newly added connector such as "about" or "and".
const danglingConnector = text => /\b(?:about|between|and|or|the|a|an|of|to|de|del|entre|y|o|el|la|los|las|un|una|que|qué|porque|para)\s*[,;:….-]*\s*$/iu.test(text);

export function sameEarlyEvidenceStamp(left, right) {
  return !!left && !!right && fields.every(field => Object.hasOwn(left, field)
    && Object.hasOwn(right, field) && left[field] === right[field]);
}

export function createEarlyEvidenceTracker(seed, { now = () => performance.now(), log = () => {}, allowedStudentIds = [seed?.studentId] } = {}) {
  if (!seed || (seed.fictional !== true && !(seed.isolatedLocal === true && seed.dataKind === 'isolated-copy') && !(seed.productionSession === true && seed.dataKind === 'production'))
    || !validText(seed.callId) || !validText(seed.studentId) || !['en', 'es'].includes(seed.language)) {
    throw new Error('isolated_early_evidence_seed_required');
  }
  const allowed = new Set([...allowedStudentIds, 'unselected']);
  if (!allowed.has(seed.studentId)) throw new Error('early_evidence_student_not_allowed');
  let studentId = seed.studentId, language = seed.language, connectionEpoch = 0, scopeEpoch = 0;
  let current = null, assistant = null, history = [], assistantEvidence = [], stopped = false, suspended = false;
  let confirmed = studentId !== 'unselected', assistantOutputRevision = 0, assistantBoundaryRevision = -1, reason = null;
  const seen = new Map(), boundaries = new Map();
  const explanations = createExplanationHistory({ log });
  const stamp = () => ({ callId: seed.callId, studentId, language, connectionEpoch, scopeEpoch,
    contributionId: current?.id ?? null, revision: current?.revision ?? 0 });
  function record(type, extra = {}) { log({ type, ...stamp(), ...extra, intervention: false }); }
  function clear() { current = null; assistant = null; assistantBoundaryRevision = -1; history = []; assistantEvidence = []; explanations.clear(); seen.clear(); boundaries.clear(); }
  function reset(resetReason = 'explicit_reset') {
    scopeEpoch++; clear(); reason = resetReason;
    record('early_evidence_reset', { reason: resetReason });
  }
  function fail(failure) {
    if (stopped) return;
    stopped = true; reason = failure; clear();
    record('early_evidence_closed', { reason: failure });
  }
  function remember(map, id, value, limit) {
    map.set(id, value);
    if (map.size > limit) map.delete(map.keys().next().value);
  }
  function appendHistory(row) {
    explanations.append(row);
    if (bytes(row.text) > EARLY_EVIDENCE_LIMITS.dialogueBytes) return;
    history.push(row);
    while (history.length > EARLY_EVIDENCE_LIMITS.dialogueItems
      || bytes(JSON.stringify(history)) > EARLY_EVIDENCE_LIMITS.dialogueBytes) history.shift();
  }
  function snapshot() {
    const recentDialogue = history.map(row => ({ ...row }));
    if (assistant?.text) recentDialogue.push({ role: 'assistant', text: assistant.text,
      complete: false, source: 'native_transcript', startMs: assistant.startMs, endMs: assistant.endMs });
    while (recentDialogue.length > EARLY_EVIDENCE_LIMITS.dialogueItems
      || bytes(JSON.stringify(recentDialogue)) > EARLY_EVIDENCE_LIMITS.dialogueBytes) recentDialogue.shift();
    return { ...stamp(), stamp: stamp(), provisional: true, complete: false,
      usable: !stopped && !suspended && confirmed && studentId !== 'unselected' && current !== null,
      stopped, suspended, confirmed, reason, inputOpen: current?.open === true,
      text: current?.text ?? '', currentText: current?.text ?? '',
      sourceEventIds: [...(current?.sourceEventIds ?? [])],
      sourceTextEnds: [...(current?.sourceTextEnds ?? [])],
      startMs: current?.startMs ?? null, endMs: current?.endMs ?? null,
      firstObservedAtMs: current?.firstObservedAtMs ?? null, lastObservedAtMs: current?.lastObservedAtMs ?? null,
      assistantOutputRevision, assistantBoundaryRevision, outputOpen: assistant !== null,
      assistantOutputStartedForContribution: current?.assistantStarted === true,
      contributionOutputOriginRevision: current?.outputOriginRevision ?? assistantOutputRevision,
      assistantEvidence: assistantEvidence.map(row => ({ ...row })),
      explanationHistory: explanations.snapshot({ currentText: current?.text ?? '', recentDialogue }),
      recentDialogue };
  }
  function receive(packet) {
    if (stopped || !packet || typeof packet.event?.type !== 'string') return { changed: false };
    const { source, event } = packet;
    if (seed.productionSession === true && source === 'scope' && event.type === 'scope_changed' && typeof event.studentId === 'string') allowed.add(event.studentId);
    const atMs = Number.isFinite(packet.atMs) ? packet.atMs : now();
    if (event.type === 'session.closed') { fail('session_closed'); return { changed: true }; }
    if (source === 'connection' && event.type === 'browser_control_detached') {
      connectionEpoch++; clear(); reason = 'connection_gap';
      record('early_evidence_reset', { reason }); return { changed: true };
    }
    if (source === 'scope') {
      if (event.type === 'scope_transition') {
        suspended = true; reset('scope_transition'); return { changed: true };
      }
      if (event.type === 'scope_changed') {
        if (!allowed.has(event.studentId) || !['en', 'es'].includes(event.language)) {
          fail('invalid_scope'); return { changed: true };
        }
        studentId = event.studentId; language = event.language;
        confirmed = event.confirmed !== false && studentId !== 'unselected';
        suspended = false; reset('scope_changed'); return { changed: true };
      }
      if (event.type === 'context_changed') {
        if (!['en', 'es'].includes(event.language)) { fail('invalid_language'); return { changed: true }; }
        if (language !== event.language) { language = event.language; reset('language_changed'); return { changed: true }; }
        return { changed: false };
      }
      fail('unrecognized_scope_change'); return { changed: true };
    }
    if (suspended) return { changed: false };
    if (source === 'native' && ['session.input_transcript.delta', 'session.output_transcript.delta'].includes(event.type)) {
      if (typeof event.delta !== 'string' || !event.delta.length) return { changed: false };
      if (!validText(event.event_id) || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)
        || event.start_ms < 0 || event.end_ms < event.start_ms) {
        fail('invalid_native_evidence'); return { changed: true };
      }
      const signature = JSON.stringify([event.type, event.start_ms, event.end_ms, event.delta]);
      if (seen.has(event.event_id)) {
        if (seen.get(event.event_id) !== signature) { fail('conflicting_native_event'); return { changed: true }; }
        return { changed: false };
      }
      remember(seen, event.event_id, signature, EARLY_EVIDENCE_LIMITS.seenEvents);
      if (event.type === 'session.output_transcript.delta') {
        assistantOutputRevision++;
        assistantEvidence.push({ revision: assistantOutputRevision, sourceEventId: event.event_id,
          text: event.delta, startMs: event.start_ms, endMs: event.end_ms });
        while (assistantEvidence.length > 128 || bytes(JSON.stringify(assistantEvidence)) > EARLY_EVIDENCE_LIMITS.dialogueBytes) assistantEvidence.shift();
        if (current) current.assistantStarted = true;
        const text = (assistant?.text ?? '') + event.delta;
        if (bytes(text) > EARLY_EVIDENCE_LIMITS.textBytes) { fail('assistant_evidence_overflow'); return { changed: true }; }
        assistant = { text, sourceEventIds: [...(assistant?.sourceEventIds ?? []), event.event_id],
          startMs: Math.min(assistant?.startMs ?? event.start_ms, event.start_ms),
          endMs: Math.max(assistant?.endMs ?? event.end_ms, event.end_ms) };
        return { changed: true, callerChanged: false };
      }
      if (!current?.open) {
        current = { id: event.event_id, revision: 0, text: '', sourceEventIds: [], sourceTextEnds: [], startMs: event.start_ms,
          endMs: event.start_ms, firstObservedAtMs: atMs, lastObservedAtMs: atMs, open: true, assistantStarted: false,
          outputOriginRevision: assistantOutputRevision };
      }
      if (event.end_ms < current.endMs || atMs < current.lastObservedAtMs) {
        fail('out_of_order_native_evidence'); return { changed: true };
      }
      const text = current.text + event.delta;
      if (bytes(text) > EARLY_EVIDENCE_LIMITS.textBytes || current.sourceEventIds.length >= EARLY_EVIDENCE_LIMITS.sourceEvents) {
        fail('caller_evidence_overflow'); return { changed: true };
      }
      current.text = text; current.revision++; current.sourceEventIds.push(event.event_id);
      current.sourceTextEnds.push(text.length);
      current.startMs = Math.min(current.startMs, event.start_ms); current.endMs = event.end_ms; current.lastObservedAtMs = atMs;
      reason = null;
      record('early_native_evidence', { sourceEventId: event.event_id, startMs: event.start_ms, endMs: event.end_ms,
        textBytes: bytes(current.text), sourceEventCount: current.sourceEventIds.length, provisional: true, complete: false });
      return { changed: true, callerChanged: true };
    }
    if (source !== 'application') return { changed: false };
    let role, id;
    if (event.type === 'conversation.item.input_audio_transcription.completed') { role = 'user'; id = event.item_id; }
    if (event.type === 'response.output_audio_transcript.done') { role = 'assistant'; id = event.response_id; }
    if (!role) return { changed: false };
    if (!validText(id) || !validText(event.transcript, EARLY_EVIDENCE_LIMITS.textBytes)) {
      fail('invalid_application_boundary'); return { changed: true };
    }
    const key = `${role}:${id}`;
    if (boundaries.has(key)) {
      if (boundaries.get(key) !== event.transcript) { fail('conflicting_application_boundary'); return { changed: true }; }
      return { changed: false };
    }
    remember(boundaries, key, event.transcript, EARLY_EVIDENCE_LIMITS.seenEvents);
    const span = role === 'user' ? current : assistant;
    if (!span || normalized(span.text) !== normalized(event.transcript)) {
      // A delayed adapter boundary can include pre-selection words. It is not
      // proof that the current native span completed; discard its attribution.
      if (role === 'user') { scopeEpoch++; current = null; } else assistant = null;
      reason = 'ambiguous_application_boundary';
      record('early_evidence_boundary_ignored', { role, reason });
      return { changed: true, callerChanged: role === 'user' };
    }
    appendHistory({ role, text: event.transcript, complete: true, source: 'application_estimate',
      sourceEventIds: [...span.sourceEventIds],
      id: key, contributionId: role === 'user' ? current.id : null, startMs: span.startMs, endMs: span.endMs });
    if (role === 'user') current.open = false;
    else { assistant = null; assistantBoundaryRevision = assistantOutputRevision; }
    record('early_evidence_application_boundary', { role, boundary: 'application_estimate', playbackComplete: 'unknown' });
    return { changed: true, callerChanged: false };
  }
  return { receive, snapshot, stamp, reset, close() { fail('closed'); } };
}

export function meaningfulEarlyEvidence(text) {
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
  if (requestMoment(text)) return true;
  if (words.length >= 6) return true;
  if (words.length >= 3 && /[.!?…]\s*$/u.test(text)) return true;
  return words.length >= 2 && /\b(?:i(?:['’]m| am) confused|i (?:do not|don['’]t) understand|still (?:do not|don['’]t) understand|no (?:lo )?entiendo|no me queda claro|estoy confundid[oa])\b/iu.test(text);
}

// Scheduling hints, never classifications or permission to send context. The
// classifier still sees the full accumulated text (including negation/quotes).
export function requestMoment(text) {
  if (typeof text !== 'string') return null;
  if (/\b(?:example|analogy|ejemplo|analogía)\b/iu.test(text)
    && /\b(?:give|show|use|another|different|could|can|please|dame|dar|puedes|podrías|otro|otra|muéstrame)\b/iu.test(text)) return 'example_request';
  if (/\b(?:where (?:do i|should (?:i|we)|to) (?:start|begin)|(?:don['’]t|do not) know where to (?:start|begin)|por d[oó]nde (?:empezar|comenzar|empiezo)|no s[eé] (?:c[oó]mo|por d[oó]nde) empezar)\b/iu.test(text)) return 'starting_point_request';
  if (/\b(?:i(?:['’]m| am) (?:lost|confused)|(?:don['’]t|do not|still don['’]t|still do not) understand|simpler|more simply|no (?:lo )?entiendo|no me queda claro|estoy (?:perdid[oa]|confundid[oa])|m[aá]s (?:sencillo|sencilla|simple))\b/iu.test(text)) return 'explanation_request';
  return null;
}

// One timer and one in-flight observation. The first two accumulation windows
// stay finite; the reserved final attempt waits for a brief quiet gap. Fragments
// replace queued evidence and never create a request per fragment.
export function createEarlyProjector(seed, observe, log = () => {}, options = {}) {
  const { now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout, debounceMs = 160,
    reservedQuietMs = 350, maxPerContribution = 3, maxPerCall = 8, minGrowthBytes = 16, enabled = () => true,
    needsRevalidation = () => false, supportRevision = () => 0,
    distributed = false, meaningfulScheduling = false, lateAllowed = () => false,
    betweenThoughtsAllowed = () => false, hasSupport = () => false, burst = 3, refillMs = 25000 } = options;
  const tracker = createEarlyEvidenceTracker(seed, { ...options, now, log });
  let timer = null, timerDue = Infinity, inFlight = false, closed = false, evaluated = 0, contribution = null, contributionKey = null, attempts = 0, previousBytes = 0;
  let previousSupportRevision = -1;
  let previousOutputRevision = -1, tokens = burst, refillAt = now(), lastSkip = null;
  function available() {
    const elapsed = Math.max(0, now() - refillAt);
    tokens = Math.min(burst, tokens + elapsed / refillMs); refillAt = now();
    return tokens >= 1;
  }
  function skip(reason, snapshot) {
    const key = `${snapshot.contributionId}:${snapshot.revision}:${reason}`;
    if (key !== lastSkip) log({ type: 'early_observation_deferred', ...snapshot.stamp,
      reason, tokensAvailable: Math.floor(tokens), budgetConstraint: 'check_frequency', voiceNeverWaits: true, intervention: false });
    lastSkip = key;
  }
  function clearTimer() { if (timer !== null) cancel(timer); timer = null; timerDue = Infinity; }
  const reservedSlot = () => attempts === maxPerContribution - 1;
  function eligible() {
    const snapshot = tracker.snapshot();
    const key = JSON.stringify([snapshot.connectionEpoch, snapshot.scopeEpoch, snapshot.contributionId]);
    if (key !== contributionKey) {
      contributionKey = key; contribution = snapshot.stamp.contributionId; attempts = 0; previousBytes = 0; previousSupportRevision = -1; previousOutputRevision = -1;
    }
    const postOutput = distributed && snapshot.assistantOutputStartedForContribution;
    const between = postOutput && betweenThoughtsAllowed()
      && (hasSupport() || requestMoment(snapshot.text) !== null);
    const late = postOutput && !between && lateAllowed();
    if (closed || !snapshot.usable || (!distributed && !snapshot.inputOpen) || !enabled(snapshot) || evaluated >= maxPerCall
      || attempts >= maxPerContribution || !meaningfulEarlyEvidence(snapshot.text)
      || distributed && danglingConnector(snapshot.text)
      || bytes(snapshot.text) > EARLY_EVIDENCE_LIMITS.classificationBytes
      || postOutput && (!between && !late || now() - snapshot.lastObservedAtMs > (between ? 45000 : 15000))
      // Keep a bounded post-output check available; never spend all three
      // attempts on the beginning of a long caller contribution.
      || meaningfulScheduling && distributed && maxPerContribution >= 3 && attempts >= maxPerContribution - 1 && !postOutput
      || attempts > 0 && !(needsRevalidation() && supportRevision() !== previousSupportRevision)
        && !(postOutput && snapshot.assistantOutputRevision > previousOutputRevision)
        && bytes(snapshot.text) - previousBytes < (distributed ? minGrowthBytes
          : reservedSlot() || needsRevalidation() ? 1 : minGrowthBytes)) return null;
    if (distributed && !available()) { skip('distributed_budget_reserved_for_later', snapshot); return null; }
    return { ...snapshot, lateExperiment: late, betweenThoughts: between,
      requestMoment: requestMoment(snapshot.text), revalidationRequested: needsRevalidation() };
  }
  function queue({ callerChanged = false } = {}) {
    const snapshot = eligible();
    if (!snapshot || inFlight) return;
    const reserved = reservedSlot();
    const fastRequest = meaningfulScheduling && distributed && attempts === 0 && snapshot.requestMoment
      && !snapshot.assistantOutputStartedForContribution;
    if (timer !== null) {
      // Preserve the first two finite accumulation windows. Only the last slot
      // waits for a short pause, so small but decisive additions remain eligible
      // without spending every request on the beginning of a long utterance.
      // A recognizable request emerging after generic context may bring the
      // first check forward. Subsequent fragments never push that deadline back.
      if (!(fastRequest && now() + debounceMs < timerDue) && (!reserved || !callerChanged)) return;
      clearTimer();
    }
    const quiet = !fastRequest && (distributed || reserved);
    const delay = quiet ? Math.max(0, reservedQuietMs - (now() - snapshot.lastObservedAtMs)) : debounceMs;
    timerDue = now() + delay;
    timer = schedule(() => run(snapshot.betweenThoughts ? 'between_thoughts_revalidation'
      : snapshot.lateExperiment ? 'settled_late_experiment'
      : fastRequest ? 'recognizable_request' : quiet ? 'reserved_quiet_gap' : 'bounded_accumulation'), delay);
    timer?.unref?.();
  }
  function run(triggerBasis) {
    timer = null; timerDue = Infinity;
    const snapshot = eligible();
    if (!snapshot) return;
    if (distributed) triggerBasis = snapshot.betweenThoughts ? 'between_thoughts_revalidation'
      : snapshot.lateExperiment ? 'settled_late_experiment'
      : meaningfulScheduling && attempts === 0 && snapshot.requestMoment ? 'recognizable_request' : 'reserved_quiet_gap';
    const quietAgeMs = Math.max(0, now() - snapshot.lastObservedAtMs);
    if (triggerBasis === 'reserved_quiet_gap' && quietAgeMs < reservedQuietMs) { queue(); return; }
    attempts++; evaluated++; previousBytes = bytes(snapshot.text); previousSupportRevision = supportRevision(); inFlight = true;
    previousOutputRevision = snapshot.assistantOutputRevision;
    if (distributed) tokens -= 1;
    const capture = { ...snapshot, observedAtMs: now(), evaluationOrdinal: evaluated,
      contributionEvaluationOrdinal: attempts, triggerBasis, quietAgeMs,
      revalidationCount: Math.max(0, attempts - 1) };
    log({ type: 'early_observation_started', ...snapshot.stamp, sourceEventIds: snapshot.sourceEventIds,
      textBytes: previousBytes, provisional: true, complete: false, evaluationOrdinal: evaluated,
      contributionEvaluationOrdinal: attempts, triggerBasis, quietAgeMs, requestMoment: snapshot.requestMoment,
      revalidationRequested: snapshot.revalidationRequested, revalidationCount: Math.max(0, attempts - 1),
      evidenceAgeMs: Math.max(0, now() - snapshot.lastObservedAtMs), intervention: false });
    Promise.resolve().then(() => observe(capture)).catch(error => {
      log({ type: 'early_observation_failed', ...snapshot.stamp, reason: error?.name ?? 'Error', intervention: false });
    }).finally(() => { inFlight = false; queue(); });
  }
  return { tracker, receive(packet) {
    const change = tracker.receive(packet);
    if ((!distributed && !tracker.snapshot().inputOpen) || !tracker.snapshot().usable) clearTimer();
    if (change.callerChanged) queue({ callerChanged: true });
    else if (distributed && (packet.source === 'application' || packet.source === 'playback')) queue();
    return change;
  }, refresh() { queue(); }, snapshot: tracker.snapshot, stamp: tracker.stamp,
  status: () => ({ evaluated, inFlight, scheduled: timer !== null, contribution, attempts, closed }),
  close() { closed = true; clearTimer(); tracker.close(); } };
}
