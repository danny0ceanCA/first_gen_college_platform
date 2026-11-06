// Shared by the isolated SQLite workbench and PostgreSQL shadow repository.
// Nothing here is imported by the live conversation or its context feeds.
const evidenceTime = item => item.occurredAt || item.recordedAt;

export function latestState(items, kind) {
  const byReporter = new Map();
  for (const item of items.filter(item => item.kind === kind)) {
    const time = evidenceTime(item);
    const previous = byReporter.get(item.reportedBy);
    const order = previous ? time.localeCompare(previous.time) || item.recordedAt.localeCompare(previous.recordedAt) : 1;
    if (order > 0) byReporter.set(item.reportedBy, { time, recordedAt: item.recordedAt, statuses: new Set([item.status]) });
    else if (order === 0) previous.statuses.add(item.status);
  }
  // One simultaneous report can describe several parts of the same concern.
  // A positive part cannot erase a pending or unsuccessful part by key order.
  const combine = statuses => {
    if (statuses.size === 1) return [...statuses][0];
    // Keep unfinished compound questions on the pending worklist. Their result
    // vocabulary is partial/open/unknown, rather than an outcome's mixed state.
    if (kind === 'question') return statuses.has('partial') || statuses.has('resolved') ? 'partial'
      : statuses.has('open') ? 'open' : 'unknown';
    return 'mixed';
  };
  const statuses = [...new Set([...byReporter.values()].map(value => combine(value.statuses)))];
  return statuses.length > 1 ? 'conflicting' : statuses[0] || null;
}

export function episodeProcessingHolds(entries, sources, jobs, processingGaps = []) {
  const first = entries[0];
  if (!first) return [];
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const unfinished = new Map();
  for (const job of jobs) if (['queued', 'running', 'failed'].includes(job.status)) {
    const list = unfinished.get(job.sourceId) || [];
    list.push(job); unfinished.set(job.sourceId, list);
  }
  const affects = source => source.accountId === first.accountId && source.studentId === first.studentId
    // Unknown/family scope is deliberately not widened to all siblings.
    && entries.some(item => (sourceById.get(item.sourceId)?.reporter ?? item.reportedBy) === source.reporter
      && (source.recordedAt >= evidenceTime(item) || source.id === item.sourceId));
  const live = sources.filter(affects)
    .flatMap(source => (unfinished.get(source.id) || []).filter(job => job.sourceVersion === source.version)
      .map(job => ({ sourceId: source.id, sourceVersion: source.version, reporter: source.reporter,
        recordedAt: source.recordedAt, extractorVersion: job.extractorVersion })));
  const erased = processingGaps.filter(affects).map(gap => ({ sourceId: gap.id, sourceVersion: gap.version,
    reporter: gap.reporter, recordedAt: gap.recordedAt, extractorVersion: null, sourceDeleted: true }));
  return [...live, ...erased].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.sourceVersion - b.sourceVersion
    || (a.extractorVersion || '').localeCompare(b.extractorVersion || ''));
}

const correctionScope = item => JSON.stringify([item.accountId, item.studentId, item.sourceId, item.sourceVersion, item.reportedBy, item.kind]);

export function correctionCoverageIndex(items, supersessions) {
  const byId = new Map(items.map(item => [item.id, item]));
  const groups = new Map();
  for (const supersession of supersessions) {
    const target = byId.get(supersession.target_id);
    if (!target || target.kind !== 'outcome') continue;
    const correction = byId.get(supersession.correction_id);
    const group = groups.get(correctionScope(target)) || [];
    group.push({ target, correction, correctionId: supersession.correction_id });
    groups.set(correctionScope(target), group);
  }
  return groups;
}

export function episodeCorrectionCoverageHolds(current, index) {
  const holds = [];
  for (const item of current.filter(item => item.kind === 'outcome' && item.status === 'positive')) {
    for (const entry of index.get(correctionScope(item)) || []) {
      if (entry.target.id === item.id) continue;
      // This is a possible duplicate, not a claim that the two outcomes mean the
      // same thing. An independent newer result can establish this concern anew.
      const boundary = entry.correction && [evidenceTime(item), evidenceTime(entry.correction)].sort().at(-1);
      const replaced = boundary && current.some(candidate => candidate.kind === 'outcome'
        && candidate.reportedBy === item.reportedBy && candidate.sourceId !== item.sourceId
        && candidate.sourceId !== entry.correction.sourceId && candidate.linkState !== 'unresolved'
        && evidenceTime(candidate) > boundary);
      if (!replaced) holds.push({ itemId: item.id, sourceId: item.sourceId, sourceVersion: item.sourceVersion,
        reporter: item.reportedBy, correctedItemId: entry.target.id, correctionId: entry.correctionId,
        correctionSourceId: entry.correction?.sourceId || null });
    }
  }
  return holds.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.correctedItemId.localeCompare(b.correctedItemId));
}

export const processingHoldWarning = 'A newer source in this student and reporter scope has not been successfully processed. Earlier results are provisional and excluded from analysis. Retry a retained source; a deleted source leaves an evidence gap that needs investigation.';
export const mixedStateWarning = 'The same report includes different result states. Each supported part is retained as a mixed result, rather than treating the whole concern as resolved.';
export const correctionCoverageWarning = 'Potential duplicate outcome: another outcome from the same source and reporter was corrected. This positive companion is retained as evidence, but its result is unknown and excluded from analysis until separately corrected or supported by a newer independent result.';
