// Read-only copy of results that the existing voice controller already fetched.
// No API client, provider writer, polling timer, research starter or await here.
const statuses = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);
const findingStatuses = new Set(['verified', 'partial', 'unverified']);
const terminals = new Set(['completed', 'failed', 'cancelled']);
const size = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
function optional(value, limit) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || size(value) > limit) throw Error('oversized');
  return value.trim() ? value : null;
}
function evidence(job) {
  const raw = job?.result?.voiceBrief?.findings;
  if (job?.status === 'cancelled' || !Array.isArray(raw) || !raw.length) return { evidenceAvailability: 'missing', findings: [] };
  if (raw.length > 8) return { evidenceAvailability: 'oversized', findings: [] };
  try {
    const findings = raw.map(item => {
      const fact = optional(item?.answer ?? item?.fact, 2400);
      if (!fact) throw Error('invalid');
      const local = optional(item.qualification ?? item.limitation, 2048);
      const shared = optional(job.result.voiceBrief.qualification, 2048);
      // Keep the brief-level qualification too: its applicability may not be
      // inferable without the report. Never clip a fact away from its caveat.
      const limitation = optional([...new Set([local, shared].filter(Boolean))].join('\n'), 2048);
      const sources = Array.isArray(job.result.sources) ? job.result.sources : [];
      const cited = [...`${fact}\n${limitation ?? ''}`.matchAll(/\[(\d+)\]/gu)].map(match => Number(match[1]));
      const ids = Array.isArray(item.sourceIds) ? item.sourceIds : cited;
      if (ids.length > 16) throw Error('oversized');
      const sourceIds = [...new Set(ids.filter(id => Number.isSafeInteger(Number(id)) && Number(id) > 0 && Number(id) <= sources.length).map(String))];
      if (sourceIds.length > 16) throw Error('oversized');
      return { fact, year: optional(item.year == null ? null : String(item.year), 64), scenario: optional(item.scenario, 512),
        limitation, status: findingStatuses.has(item.status) ? item.status : 'unknown',
        subject: optional(item.subject, 512), aspect: optional(item.aspect, 128), sourceIds };
    });
    return { evidenceAvailability: 'available', findings };
  } catch (error) { return { evidenceAvailability: error.message === 'oversized' ? 'oversized' : 'invalid', findings: [] }; }
}

export function createResearchObservationTap(request, publish, scope) {
  let generation = 0, transitioning = false, stopped = false, pending = 0;
  let current = { ...scope };
  const jobs = new Map();
  function observe(method, id, bodyQuestion, result, captured) {
    if (stopped || transitioning || captured !== generation || !result || typeof result !== 'object') return;
    if (!['POST', 'GET', 'DELETE'].includes(method)) return;
    const jobId = result.id ?? id;
    if (typeof jobId !== 'string' || !jobId || size(jobId) > 128 || id && result.id && result.id !== id) return;
    if (result.session_id != null && result.session_id !== current.sessionId) return;
    if (Object.hasOwn(result, 'student_id') && (result.student_id ?? 'unselected') !== (current.studentId ?? 'unselected')) return;
    const previous = jobs.get(jobId);
    // A GET for a job we did not see originate in this student scope is not
    // evidence about the newly selected student, even if it resolves late.
    if (method !== 'POST' && !previous) return;
    const status = statuses.has(result.status) ? result.status : 'unknown';
    const evidenceVersion = Number.isSafeInteger(result.result?.evidenceVersion) && result.result.evidenceVersion >= 0 ? result.result.evidenceVersion : null;
    if (previous && evidenceVersion != null && previous.evidenceVersion != null && evidenceVersion < previous.evidenceVersion) return;
    if (previous?.status === 'cancelled' || previous && terminals.has(previous.status) && !terminals.has(status)) return;
    let question, capturedEvidence = evidence(result);
    try { question = optional(result.input?.question ?? previous?.question ?? bodyQuestion, 4096); }
    catch { question = null; capturedEvidence = { evidenceAvailability: 'oversized', findings: [] }; }
    const task = { jobId, question, status, evidenceVersion, ...capturedEvidence };
    if (size(task) > 7800) { task.findings = []; task.evidenceAvailability = 'oversized'; }
    const signature = JSON.stringify(task);
    if (previous?.signature === signature) return;
    const revision = (previous?.revision ?? 0) + 1;
    jobs.set(jobId, { signature, revision, question, status, evidenceVersion });
    if (jobs.size > 64) jobs.delete(jobs.keys().next().value);
    publish({ type: 'research_task', ...task, revision, scopeGeneration: generation });
  }
  return {
    request(...args) {
      const captured = generation, canObserve = !transitioning && !stopped;
      // Preserve the exact return value/rejection and invoke the original once.
      const value = request(...args);
      if (canObserve) {
        const [method, id, body] = args;
        let question = null;
        try { question = optional(body?.question, 4096); } catch { /* Missing scope stays explicit. */ }
        Promise.resolve(value).then(result => {
          if (stopped || captured !== generation) return;
          if (pending >= 64) { stopped = true; publish({ type: 'research_observation_gap', reason: 'research_queue_overflow', scopeGeneration: generation }); return; }
          pending++;
          queueMicrotask(() => {
            try { observe(method, id, question, result, captured); }
            catch { try { publish({ type: 'research_observation_gap', reason: 'research_copy_failed', scopeGeneration: generation }); } catch {} }
            finally { pending--; }
          });
        }, () => {}).catch(() => {});
      }
      return value;
    },
    beginScope() { generation++; transitioning = true; jobs.clear(); return generation; },
    finishScope(next) { current = { ...next }; transitioning = false; return generation; },
    close() { stopped = true; jobs.clear(); },
  };
}
