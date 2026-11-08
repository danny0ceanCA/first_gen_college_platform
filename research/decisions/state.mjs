import { createHash } from 'node:crypto';

// Isolated local observer only. Nothing here sends context, speaks, or
// grants a classifier authority over a Live session or a student record.
export const OBSERVER_STATE_LIMITS = Object.freeze({
  bytes: 24 * 1024,
  transcripts: 16,
  findings: 8,
  researchTasks: 8,
  opportunities: 8,
  acknowledgments: 8,
  playback: 16,
  gaps: 8,
});

const STAMP_FIELDS = ['accountId', 'callId', 'studentId', 'permissionRevision',
  'connectionEpoch', 'scopeEpoch', 'questionRevision', 'inputRevision'];
const boundedArrays = [
  ['recentTranscripts', 'transcripts'], ['researchFindings', 'findings'],
  ['researchTasks', 'researchTasks'],
  ['opportunities', 'opportunities'], ['contextAcknowledgments', 'acknowledgments'],
  ['playbackEvidence', 'playback'],
  ['connectionGaps', 'gaps'],
];
const bytes = (value) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const fail = (reason) => { throw new Error(reason); };

function text(value, name, limit = 128, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || !value.trim() || bytes(value) > limit) fail(`invalid_${name}`);
  return value;
}

function number(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (!Number.isFinite(value) || value < 0) fail(`invalid_${name}`);
  return value;
}

function integer(value, name) {
  number(value, name);
  if (!Number.isSafeInteger(value)) fail(`invalid_${name}`);
  return value;
}

function briefValue(value) {
  if (value === undefined || value === null) return null;
  const inspect = (item, depth = 0) => {
    if (depth > 8) fail('invalid_brief');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      if (item.length > 64) fail('invalid_brief');
      item.forEach((child) => inspect(child, depth + 1));
      return;
    }
    if (typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype) fail('invalid_brief');
    const entries = Object.entries(item);
    if (entries.length > 64) fail('invalid_brief');
    for (const [, child] of entries) inspect(child, depth + 1);
  };
  inspect(value);
  if (bytes(value) > 4096) fail('invalid_brief');
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function snapshotOf(value) {
  return freeze({ ...structuredClone(value), fingerprint: fingerprint(value), relevanceFingerprint: relevanceFingerprint(value) });
}

function relevanceFingerprint({ playbackEvidence: _playback, ...value }) {
  // Playback is diagnostic evidence, not evidence for this transcript classifier.
  return fingerprint(value);
}

function clearStudentContext(value) {
  value.brief = null;
  value.currentQuestion = null;
  for (const [field] of boundedArrays) value[field] = [];
}

function staleReason(event, state) {
  if (event.stamp !== undefined && (!event.stamp || typeof event.stamp !== 'object' || Array.isArray(event.stamp))) {
    return 'invalid_stamp';
  }
  for (const field of STAMP_FIELDS) {
    // A scope event's top-level studentId is its destination, not its origin.
    const supplied = event.stamp && Object.hasOwn(event.stamp, field)
      ? event.stamp[field]
      : (event.type === 'scope' && field === 'studentId' ? undefined : event[field]);
    if (supplied !== undefined && supplied !== state[field]) return `stale_${field}`;
  }
  return null;
}

function appendBounded(state, field, item, limit) {
  state[field].push(item);
  if (state[field].length > limit) state[field].splice(0, state[field].length - limit);
}

function fitBudget(state, protectedRecord) {
  // Evict complete records; never slice a fact away from its year or limitation.
  while (bytes(snapshotOf(state)) > OBSERVER_STATE_LIMITS.bytes) {
    let removed = false;
    for (const [field] of boundedArrays) {
      // Preserve the latest evidence from each category. In particular, many
      // findings must not evict the caller's only recent utterance.
      const index = state[field].findIndex((item, position) => item !== protectedRecord && position < state[field].length - 1);
      if (index >= 0) {
        state[field].splice(index, 1);
        removed = true;
        break;
      }
    }
    if (!removed) fail('state_budget_exceeded');
  }
}

/**
 * Bounded application-owned state for independent Decisions experiments.
 * transcript.text is accumulated text for one span ID, not a delta. Stamps are
 * optional for synchronous fixtures; asynchronous callers should attach the
 * snapshot's scope, connection and question revisions when producing an event.
 */
export function createObserverState(seed) {
  if (!seed || (seed.fictional !== true && !(seed.isolatedLocal === true && seed.dataKind === 'isolated-copy') && !(seed.productionSession === true && seed.dataKind === 'production'))) fail('fictional_data_required');
  let state = {
    schemaVersion: 1,
    fictional: seed.fictional === true,
    productionSession: seed.productionSession === true,
    isolatedLocal: seed.productionSession !== true,
    dataKind: seed.productionSession === true ? 'production' : seed.fictional === true ? 'fictional' : 'isolated-copy',
    accountId: text(seed.accountId, 'accountId'),
    callId: text(seed.callId, 'callId'),
    studentId: text(seed.studentId, 'studentId', 128, true),
    permissionRevision: 0,
    connectionEpoch: 0,
    scopeEpoch: 0,
    questionRevision: 0,
    inputRevision: 0,
    closed: false,
    authorized: seed.authorized !== false,
    language: text(seed.language ?? 'unknown', 'language', 32),
    role: text(seed.role ?? 'unknown', 'role', 32),
    brief: briefValue(seed.brief),
    recentTranscripts: [],
    currentQuestion: null,
    researchFindings: [],
    researchTasks: [],
    opportunities: [],
    contextAcknowledgments: [],
    playbackEvidence: [],
    connectionGaps: [],
  };
  if (!state.authorized) clearStudentContext(state);
  fitBudget(state);

  function apply(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return { accepted: false, reason: 'invalid_event' };
    if (state.closed) return { accepted: false, reason: 'closed' };
    if (!state.authorized && event.type !== 'close') return { accepted: false, reason: 'not_authorized' };
    const stale = staleReason(event, state);
    if (stale) return { accepted: false, reason: stale };
    const next = structuredClone(state);
    let protectedRecord;
    try {
      switch (event.type) {
        case 'invalidate':
          // Native fragments invalidate in-flight decisions before an estimated
          // transcript boundary arrives; they do not authorize classification.
          break;
        case 'context': {
          const language = text(event.language ?? next.language, 'language', 32);
          const role = text(event.role ?? next.role, 'role', 32);
          const brief = Object.hasOwn(event, 'brief') ? briefValue(event.brief) : next.brief;
          if (language === next.language && role === next.role && JSON.stringify(brief) === JSON.stringify(next.brief)) fail('duplicate');
          next.language = language; next.role = role; next.brief = brief;
          break;
        }
        case 'transcript': {
          const id = text(event.id, 'id');
          if (!['user', 'assistant'].includes(event.role)) fail('invalid_role');
          const content = text(event.text, 'text', 2048);
          const startMs = number(event.startMs, 'startMs');
          const endMs = number(event.endMs, 'endMs');
          if (endMs < startMs || typeof event.complete !== 'boolean') fail('invalid_transcript');
          const index = next.recentTranscripts.findIndex((item) => item.id === id && item.connectionEpoch === next.connectionEpoch);
          const previous = next.recentTranscripts[index];
          if (previous?.complete) fail(previous.text === content && event.complete ? 'duplicate' : 'finalized_transcript');
          if (previous && (previous.role !== event.role || previous.startMs !== startMs || endMs < previous.endMs)) fail('stale_transcript');
          protectedRecord = { id, role: event.role, text: content, startMs, endMs, complete: event.complete,
            connectionEpoch: next.connectionEpoch, scopeEpoch: next.scopeEpoch };
          if (previous && JSON.stringify(previous) === JSON.stringify(protectedRecord)) fail('duplicate');
          if (index >= 0) next.recentTranscripts.splice(index, 1);
          appendBounded(next, 'recentTranscripts', protectedRecord, OBSERVER_STATE_LIMITS.transcripts);
          break;
        }
        case 'question': {
          const question = { id: text(event.id, 'id'), text: text(event.text, 'text', 2048) };
          if (next.currentQuestion?.id === question.id && next.currentQuestion.text === question.text) fail('duplicate');
          next.questionRevision += 1;
          next.currentQuestion = { ...question, questionRevision: next.questionRevision };
          break;
        }
        case 'finding': {
          const id = text(event.id, 'id');
          const jobId = text(event.jobId, 'jobId');
          const revision = integer(event.revision, 'revision');
          if (!Array.isArray(event.sourceIds) || event.sourceIds.length > 16) fail('invalid_sourceIds');
          const sourceIds = [...new Set(event.sourceIds.map((source) => text(source, 'sourceId')))];
          protectedRecord = { id, jobId, revision, fact: text(event.fact, 'fact', 2400),
            year: event.year === undefined || event.year === null ? null : text(String(event.year), 'year', 64),
            scenario: text(event.scenario, 'scenario', 512, true),
            limitation: text(event.limitation, 'limitation', 1024, true), sourceIds };
          const index = next.researchFindings.findIndex((item) => item.id === id && item.jobId === jobId);
          const previous = next.researchFindings[index];
          if (previous && revision < previous.revision) fail('stale_finding');
          if (previous && revision === previous.revision) fail(JSON.stringify(previous) === JSON.stringify(protectedRecord) ? 'duplicate' : 'conflicting_finding_revision');
          if (index >= 0) next.researchFindings.splice(index, 1);
          appendBounded(next, 'researchFindings', protectedRecord, OBSERVER_STATE_LIMITS.findings);
          break;
        }
        case 'research_task': {
          const jobId = text(event.jobId, 'jobId');
          const revision = integer(event.revision, 'revision');
          if (!['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown'].includes(event.status)) fail('invalid_research_status');
          if (!['available', 'missing', 'oversized', 'invalid'].includes(event.evidenceAvailability)) fail('invalid_evidence_availability');
          if (!Array.isArray(event.findings) || event.findings.length > 8) fail('invalid_research_findings');
          const findings = event.findings.map(item => {
            if (!['verified', 'partial', 'unverified', 'unknown'].includes(item.status)) fail('invalid_finding_status');
            if (!Array.isArray(item.sourceIds) || item.sourceIds.length > 16) fail('invalid_sourceIds');
            return { fact: text(item.fact, 'fact', 2400), year: text(item.year, 'year', 64, true),
              scenario: text(item.scenario, 'scenario', 512, true), limitation: text(item.limitation, 'limitation', 2048, true),
              status: item.status, subject: text(item.subject, 'subject', 512, true), aspect: text(item.aspect, 'aspect', 128, true),
              sourceIds: [...new Set(item.sourceIds.map(id => text(id, 'sourceId')))] };
          });
          if (event.evidenceAvailability !== 'available' && findings.length) fail('unavailable_research_has_findings');
          if (event.evidenceAvailability === 'available' && !findings.length) fail('available_research_missing_findings');
          if (event.status === 'cancelled' && findings.length) fail('cancelled_research_has_findings');
          protectedRecord = { jobId, revision, question: text(event.question, 'question', 4096, true), status: event.status,
            evidenceVersion: event.evidenceVersion == null ? null : integer(event.evidenceVersion, 'evidenceVersion'),
            evidenceAvailability: event.evidenceAvailability, findings };
          // This is copied backend evidence, not an independent source check or
          // proof of speech/playback. Replacement is atomic, including gaps.
          if (bytes(protectedRecord) > 8000) fail('research_task_budget_exceeded');
          const index = next.researchTasks.findIndex(item => item.jobId === jobId);
          const previous = next.researchTasks[index];
          if (previous && revision < previous.revision) fail('stale_research_task');
          if (previous && revision === previous.revision) fail(JSON.stringify(previous) === JSON.stringify(protectedRecord) ? 'duplicate' : 'conflicting_research_revision');
          if (index >= 0) next.researchTasks.splice(index, 1);
          appendBounded(next, 'researchTasks', protectedRecord, OBSERVER_STATE_LIMITS.researchTasks);
          break;
        }
        case 'opportunity': {
          protectedRecord = { id: text(event.id, 'id'), kind: text(event.kind, 'kind', 64), status: text(event.status, 'status', 64),
            questionRevision: next.questionRevision };
          const index = next.opportunities.findIndex((item) => item.id === protectedRecord.id);
          if (index >= 0 && JSON.stringify(next.opportunities[index]) === JSON.stringify(protectedRecord)) fail('duplicate');
          if (index >= 0) next.opportunities.splice(index, 1);
          appendBounded(next, 'opportunities', protectedRecord, OBSERVER_STATE_LIMITS.opportunities);
          break;
        }
        case 'context_ack': {
          protectedRecord = { id: text(event.id ?? event.clientEventId, 'id'),
            kind: text(event.kind ?? 'context', 'kind', 64), atMs: number(event.atMs, 'atMs', true),
            connectionEpoch: next.connectionEpoch, scopeEpoch: next.scopeEpoch };
          if (next.contextAcknowledgments.some((item) => item.id === protectedRecord.id)) fail('duplicate');
          appendBounded(next, 'contextAcknowledgments', protectedRecord, OBSERVER_STATE_LIMITS.acknowledgments);
          break;
        }
        case 'playback': {
          const playbackState = event.state ?? event.status;
          if (!['started', 'playing', 'ended', 'stopped', 'interrupted', 'paused', 'stalled', 'sample'].includes(playbackState)) fail('invalid_playback_state');
          protectedRecord = { id: text(event.id, 'id'), state: playbackState,
            atMs: number(event.atMs, 'atMs'), playedMs: number(event.playedMs, 'playedMs', true),
            connectionEpoch: next.connectionEpoch, scopeEpoch: next.scopeEpoch };
          if (next.playbackEvidence.some((item) => item.id === protectedRecord.id)) fail('duplicate');
          appendBounded(next, 'playbackEvidence', protectedRecord, OBSERVER_STATE_LIMITS.playback);
          break;
        }
        case 'scope': {
          const studentId = text(event.studentId, 'studentId', 128, true);
          const brief = briefValue(event.brief);
          clearStudentContext(next);
          next.studentId = studentId;
          next.brief = brief;
          next.language = text(event.language ?? next.language, 'language', 32);
          next.role = text(event.role ?? next.role, 'role', 32);
          next.scopeEpoch += 1;
          next.questionRevision += 1;
          break;
        }
        case 'reconnect': {
          protectedRecord = {
            previousConnectionEpoch: next.connectionEpoch,
            connectionEpoch: next.connectionEpoch + 1,
            atMs: number(event.atMs, 'atMs', true),
            reason: text(event.reason ?? 'connection_reestablished', 'reason', 256),
            transcriptContinuity: 'unknown',
          };
          next.connectionEpoch += 1;
          next.contextAcknowledgments = [];
          next.playbackEvidence = [];
          appendBounded(next, 'connectionGaps', protectedRecord, OBSERVER_STATE_LIMITS.gaps);
          break;
        }
        case 'revoke':
          next.permissionRevision += 1;
          next.authorized = false;
          clearStudentContext(next);
          break;
        case 'close':
          next.closed = true;
          break;
        default:
          fail('unsupported_event');
      }
      if (event.type !== 'playback') next.inputRevision += 1;
      fitBudget(next, protectedRecord);
      state = next;
      return { accepted: true, reason: 'applied' };
    } catch (error) {
      return { accepted: false, reason: error.message };
    }
  }

  return Object.freeze({
    apply,
    snapshot: () => snapshotOf(state),
    matches: (snapshot) => {
      if (!state.authorized || state.closed || !snapshot
        || !snapshot.authorized || snapshot.closed) return false;
      try {
        const { fingerprint: supplied, relevanceFingerprint: relevant, ...body } = snapshot;
        return supplied === fingerprint(body) && relevant === relevanceFingerprint(body)
          && relevant === relevanceFingerprint(state);
      } catch {
        return false;
      }
    },
  });
}
