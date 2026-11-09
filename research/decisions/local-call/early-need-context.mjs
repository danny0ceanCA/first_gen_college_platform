// Application-owned temporary evidence, not a provider Conversation or a turn
// completion signal. Raw revisions remain immutable; a retained prefix alone
// can never authorize a Live write.
const scope = ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch', 'contributionId'];
export function matchEarlyCapture(snapshot, stamp, record) {
  if (!snapshot?.usable || !stamp || !scope.every(key => stamp[key] === snapshot.stamp?.[key])
    || !Number.isSafeInteger(stamp.revision) || stamp.revision < 1 || stamp.revision > snapshot.stamp.revision
    || typeof record?.sourceText !== 'string' || !Array.isArray(record.sourceEventIds)
    || record.sourceEventIds.length !== stamp.revision
    || !record.sourceEventIds.every((id, index) => typeof id === 'string' && id === snapshot.sourceEventIds?.[index])) return null;
  const exact = stamp.revision === snapshot.stamp.revision;
  const end = exact ? snapshot.text.length : snapshot.sourceTextEnds?.[stamp.revision - 1];
  if (!Number.isSafeInteger(end) || end < 1 || snapshot.text.slice(0, end) !== record.sourceText) return null;
  return { exact, sourceText: record.sourceText, sourceEventIds: [...record.sourceEventIds] };
}

export function withEarlyNeedContext(snapshot, activeSupport, supportRevision = 0) {
  // A first need has no active support yet. Anchor it at the start of this
  // caller contribution so output arriving during classification is visible.
  // A new follow-up cannot be considered answered by an earlier explanation.
  const origins = [activeSupport?.originOutputRevision, snapshot.contributionOutputOriginRevision]
    .filter(value => Number.isSafeInteger(value) && value >= 0);
  const origin = snapshot.triggerBasis === 'settled_late_experiment'
    ? (Number.isSafeInteger(snapshot.contributionOutputOriginRevision) ? snapshot.contributionOutputOriginRevision : null)
    : origins.length ? Math.max(...origins) : null;
  const rows = Number.isSafeInteger(origin)
    ? (snapshot.assistantEvidence ?? []).filter(row => row.revision > origin) : [];
  const text = rows.map(row => row.text).join('');
  // A truncated/missing interval is unknown evidence, never proof that a need
  // was addressed. Keep the full bounded transcript with its separate IDs.
  const contiguous = !Number.isSafeInteger(origin) ? snapshot.assistantOutputStartedForContribution !== true
    : (origin <= snapshot.assistantOutputRevision && rows.every((row, index) => row.revision === origin + index + 1)
    && (rows.at(-1)?.revision ?? origin) === snapshot.assistantOutputRevision);
  return { ...snapshot, activeSupport, supportRevision,
    assistantSinceNeed: { text: contiguous ? text : '', sourceEventIds: contiguous ? rows.map(row => row.sourceEventId) : [],
      revision: snapshot.assistantOutputRevision, originOutputRevision: origin, evidenceComplete: contiguous,
      startMs: rows[0]?.startMs ?? null, endMs: rows.at(-1)?.endMs ?? null, playbackClaim: false } };
}
