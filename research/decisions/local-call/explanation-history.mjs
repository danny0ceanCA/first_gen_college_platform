// Local Decisions evidence only. These are raw transcript observations, not
// learned student facts, a provider Conversation, or context sent to Live.
export const EXPLANATION_HISTORY_VERSION = 'explanation-evidence-1';
export const EXPLANATION_HISTORY_LIMITS = Object.freeze({ rows: 40, bytes: 32768, rowBytes: 8192,
  selectedRows: 10, selectedBytes: 16384, recentRows: 6, sourceEvents: 128 });
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const validId = value => typeof value === 'string' && value.trim().length > 0 && bytes(value) <= 256;
const stopWords = new Set(('about after again already also because before being could does doing every from have just know like more need only said should some than that their them there these they this those want were what when where which will with would your ' +
  'ahora algo antes como donde ella ellos esta este esto fueron hacer hacia hasta mismo para pero porque puede quiero sobre tengo tiene todo usted vamos').split(' '));
const terms = text => new Set((String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(word => !stopWords.has(word)));

function normalizeRow(row, limits) {
  if (!row || !['user', 'assistant'].includes(row.role) || row.complete !== true
    || row.source !== 'application_estimate' || !validId(row.id) || typeof row.text !== 'string'
    || !row.text.trim() || bytes(row.text) > limits.rowBytes
    || !Array.isArray(row.sourceEventIds) || !row.sourceEventIds.length
    || row.sourceEventIds.length > limits.sourceEvents || !row.sourceEventIds.every(validId)
    || new Set(row.sourceEventIds).size !== row.sourceEventIds.length
    || !Number.isFinite(row.startMs) || !Number.isFinite(row.endMs)
    || row.startMs < 0 || row.endMs < row.startMs) return null;
  return { id: row.id, role: row.role, text: row.text, complete: true, source: 'application_estimate',
    sourceEventIds: [...row.sourceEventIds], startMs: row.startMs, endMs: row.endMs };
}

export function createExplanationHistory({ limits: overrides = {}, log = () => {} } = {}) {
  const limits = { ...EXPLANATION_HISTORY_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(EXPLANATION_HISTORY_LIMITS, key) || !Number.isSafeInteger(value)
      || value < 1 || value > EXPLANATION_HISTORY_LIMITS[key])
      throw Error('invalid_explanation_history_limit');
  }
  let rows = [], omittedRows = 0, unavailable = false, sequence = 0;
  const record = (type, extra = {}) => {
    try { log({ type, ...extra, intervention: false, playbackClaim: false, comprehensionClaim: false }); }
    catch { /* Optional evidence logging must not affect the conversation. */ }
  };
  function clear() { rows = []; omittedRows = 0; unavailable = false; sequence = 0; }
  function append(value) {
    if (unavailable) return false;
    const row = normalizeRow(value, limits);
    if (!row) {
      // Missing content may be a decisive correction. It occupies an unknown
      // position even though it cannot be retained, so later accepted rows do
      // not become falsely adjacent across that gap. Exact valid duplicates
      // are handled below and do not create a new position.
      sequence++; omittedRows++;
      record('explanation_history_omitted', { reason: 'invalid_or_oversized_row' }); return false;
    }
    const duplicate = rows.find(item => item.id === row.id);
    const sharedSource = rows.find(item => item.sourceEventIds.some(id => row.sourceEventIds.includes(id)));
    if (duplicate || sharedSource) {
      if (duplicate && JSON.stringify(normalizeRow(duplicate, limits)) === JSON.stringify(row)) return false;
      // A rewritten source is not a trustworthy teaching history. The caller's
      // conversation continues; only this optional evidence buffer closes.
      rows = []; unavailable = true;
      record('explanation_history_unavailable', { reason: 'conflicting_source_evidence' }); return false;
    }
    rows.push({ ...row, evidenceSequence: sequence++ });
    while (rows.length > limits.rows || bytes(rows) > limits.bytes) { rows.shift(); omittedRows++; }
    record('explanation_history_recorded', { role: row.role, retainedRows: rows.length,
      omittedRows, textBytes: bytes(row.text), sourceEventCount: row.sourceEventIds.length });
    return true;
  }
  function snapshot({ currentText = '' } = {}) {
    const selected = new Set(), queryTerms = terms(currentText);
    const recentStart = Math.max(0, rows.length - limits.recentRows);
    let selectedBytes = 2;
    const add = index => {
      if (index < 0 || index >= rows.length || selected.has(index) || selected.size >= limits.selectedRows) return;
      const rowBytes = bytes(rows[index]) + 1;
      if (selectedBytes + rowBytes > limits.selectedBytes) return;
      selected.add(index); selectedBytes += rowBytes;
    };
    const addExchange = index => {
      const group = [index - 1, index, index + 1].filter(item => item >= 0 && item < rows.length);
      const missing = group.filter(item => !selected.has(item));
      // An older explanation without its neighboring question/correction can
      // misrepresent what was tried. Retain that evidence together or omit it.
      if (selected.size + missing.length > limits.selectedRows
        || selectedBytes + missing.reduce((sum, item) => sum + bytes(rows[item]) + 1, 0) > limits.selectedBytes) return;
      group.forEach(add);
    };
    // Reserve the newest context first. Older relevance is an explicit lexical
    // retrieval hint, not a claim that two concepts mean the same thing.
    for (let index = rows.length - 1; index >= recentStart; index--) add(index);
    const older = rows.slice(0, recentStart).map((row, index) => ({ index,
      score: [...terms(row.text)].filter(word => queryTerms.has(word)).length }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.index - a.index);
    for (const { index } of older) {
      addExchange(index);
    }
    const selectedRows = [...selected].sort((a, b) => a - b).map(index => structuredClone(rows[index]));
    return { version: EXPLANATION_HISTORY_VERSION, evidenceType: 'bounded_raw_transcript',
      selection: 'recent_and_lexically_related_earlier_rows', rows: selectedRows,
      retainedRows: rows.length, omittedRows: omittedRows + rows.length - selectedRows.length,
      selectionTruncated: omittedRows > 0 || selectedRows.length < rows.length,
      unavailable, comprehension: 'unknown', playback: 'unknown', fullTranscript: false };
  }
  return { append, snapshot, clear };
}

// Revalidate at the request boundary; metadata or guessed concept summaries
// from arbitrary objects never enter the classifier input.
export function explanationHistoryInput(value) {
  if (!value || value.version !== EXPLANATION_HISTORY_VERSION || value.unavailable === true
    || !Array.isArray(value.rows) || value.rows.length > EXPLANATION_HISTORY_LIMITS.selectedRows
    || bytes(value.rows) > EXPLANATION_HISTORY_LIMITS.selectedBytes) return null;
  const rows = value.rows.map(row => {
    const normalized = normalizeRow(row, EXPLANATION_HISTORY_LIMITS);
    if (!normalized) return null;
    return { ...normalized, ...(Number.isSafeInteger(row.evidenceSequence) && row.evidenceSequence >= 0
      ? { evidenceSequence: row.evidenceSequence } : {}) };
  });
  if (rows.some(row => !row)) return null;
  const ids = rows.map(row => row.id), sources = rows.flatMap(row => row.sourceEventIds);
  if (new Set(ids).size !== ids.length || new Set(sources).size !== sources.length) return null;
  const ordered = rows.every((row, index) => Number.isSafeInteger(row.evidenceSequence)
    && (!index || row.evidenceSequence > rows[index - 1].evidenceSequence));
  // Only proven adjacent rows can establish the shape of an exchange. Selected
  // old and new snippets must never be presented as one uninterrupted exchange.
  const exchanges = ordered ? rows.flatMap((row, index) => {
    if (row.role !== 'assistant') return [];
    const before = rows[index - 1], after = rows[index + 1];
    return [{ assistantRowId: row.id,
      callerBeforeRowId: before?.role === 'user' && before.evidenceSequence + 1 === row.evidenceSequence ? before.id : null,
      callerAfterRowId: after?.role === 'user' && row.evidenceSequence + 1 === after.evidenceSequence ? after.id : null }];
  }) : [];
  return { evidenceType: 'bounded_raw_transcript', rows, exchanges,
    omittedRows: Number.isSafeInteger(value.omittedRows) && value.omittedRows >= 0 ? value.omittedRows : null,
    selectionTruncated: value.selectionTruncated !== false, comprehension: 'unknown', playback: 'unknown',
    interpretation: 'Earlier words show attempts and caller reactions, not confirmed comprehension. An assistant explanation, silence, or a bare okay/sí is not proof of understanding. Exchange references establish adjacency only: inspect the original words to distinguish a definition, example, action step, reassurance, explicit reported clarity or renewed confusion. Do not label all assistant speech as teaching. Latest caller corrections take precedence; a repeated question may need a different explanation, not research. A caller report of clarity is self-report about that idea, not independently measured understanding.' };
}

// Composed rubrics add questions after the base request. Fit only the optional
// history at the final boundary; never truncate a current correction or answer.
export function fitExplanationHistoryBudget(request, maximumBytes = 32768) {
  if (bytes(request) <= maximumBytes) return request;
  const input = JSON.parse(request.input);
  while (bytes(request) > maximumBytes && input.explanationHistory?.rows?.length) {
    const removed = input.explanationHistory.rows.shift();
    input.explanationHistory.omittedRows = (input.explanationHistory.omittedRows ?? 0) + 1;
    input.explanationHistory.selectionTruncated = true;
    input.explanationHistory.exchanges = (input.explanationHistory.exchanges ?? [])
      .filter(exchange => exchange.assistantRowId !== removed.id)
      .map(exchange => ({ ...exchange,
        callerBeforeRowId: exchange.callerBeforeRowId === removed.id ? null : exchange.callerBeforeRowId,
        callerAfterRowId: exchange.callerAfterRowId === removed.id ? null : exchange.callerAfterRowId }));
    request.input = JSON.stringify(input);
  }
  if (bytes(request) > maximumBytes) throw Error('request_too_large');
  return request;
}
