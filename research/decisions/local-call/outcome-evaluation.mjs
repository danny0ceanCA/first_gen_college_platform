// Offline evidence accounting only. This module has no model, database, socket,
// runtime-controller or Live writer dependency. It does not classify semantics.
export const SUPPORT_OUTCOME_VERSION = 'support-outcome-2';
const SCOPE = ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch'];
const string = value => typeof value === 'string' && value.length > 0;
const time = value => Number.isFinite(value) && value >= 0;
const ids = value => Array.isArray(value) && value.length > 0 && value.length <= 128
  && value.every(string) && new Set(value).size === value.length;
const validScope = value => value && ['callId', 'studentId', 'language'].every(key => string(value[key]))
  && ['connectionEpoch', 'scopeEpoch'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0);
const sameScope = (left, right) => validScope(left) && validScope(right) && SCOPE.every(key => left[key] === right[key]);
const unique = values => [...new Set(values)];
const intervalDuration = rows => {
  let duration = 0, end = -Infinity;
  for (const row of [...rows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    duration += Math.max(0, row.endMs - Math.max(row.startMs, end));
    end = Math.max(end, row.endMs);
  }
  return duration;
};
const bareAcknowledgment = text => /^(?:ok(?:ay)?|yes|yeah|yep|sure|thanks|thank you|uh huh|mhm|mm hmm|si|ya|claro|vale|bien|esta bien|de acuerdo|gracias)[.!?,\s]*$/u
  .test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim());

/**
 * Evaluate one quiet support cue against explicitly supplied observations.
 * All times use the same connection's session timeline, never Date.now().
 * `turns` may be scoped rows or {scope, rows} from the temporary history.
 * Their IDs/boundaries are application groupings, not native completed turns.
 * Completed playback must be normal-rate, untrimmed playback mapped onto this
 * timeline. Accelerated/edited playback needs an explicit mapping elsewhere;
 * a claimed completion alone cannot establish its timing here.
 *
 * Semantic evaluations must be independently human reviewed, scoped, bound to
 * this cue and an exact row/source-event set. No model score, phrase match, ack
 * or audio meter is promoted to understanding. Fixture labels are opt-in and
 * the result remains marked synthetic when they are accepted.
 */
export function measureSupportOutcome({ cue, turns = [], contextAcknowledgments = [], playback = [],
  evaluations = [], allowFixtureLabels = false } = {}) {
  const rejected = [];
  const result = {
    version: SUPPORT_OUTCOME_VERSION, cueId: cue?.id ?? null,
    language: cue?.scope?.language ?? null, valid: false, synthetic: false,
    receipt: { status: 'unconfirmed', sourceEventIds: [], estimatedStartMs: null, estimatedEndMs: null },
    adaptation: { status: 'unknown', evaluationIds: [], sourceEventIds: [] },
    needAddressed: { status: 'unknown', evaluationIds: [], sourceEventIds: [] },
    transcriptFlow: { status: 'unknown', evaluationIds: [], sourceEventIds: [], issues: [] },
    audibleFlow: { status: 'unknown', evaluationIds: [], sourceEventIds: [], issues: [], recordingIds: [] },
    playback: { status: 'unknown', evidenceIds: [], sourceEventIds: [] },
    callerClarity: { status: 'unknown', evaluationIds: [], sourceEventIds: [] },
    window: { basis: 'application_grouped_contributions', maxFollowingUserContributions: 3,
      anchorId: null, followingUserIds: [], rowIds: [], endMs: null },
    rejected,
    inference: 'association_only_not_causal', comprehensionVerified: false,
    limitation: 'Context receipt, transcript adaptation, playback and caller self-report are separate evidence. None proves improved understanding or causation.',
  };
  if (!string(cue?.id) || !validScope(cue.scope) || !ids(cue.sourceEventIds)
    || !time(cue.timelineMs) || typeof cue.sent !== 'boolean' || cue.sent && !string(cue.eventId)) {
    rejected.push({ kind: 'cue', reason: 'invalid_cue' }); return result;
  }
  const wrapper = Array.isArray(turns) ? null : turns;
  const inputRows = Array.isArray(turns) ? turns : Array.isArray(wrapper?.rows) ? wrapper.rows : [];
  const rows = [], seenRows = new Map(), eventOwners = new Map();
  for (const input of inputRows) {
    const row = { ...input, scope: input?.scope ?? wrapper?.scope };
    if (!sameScope(row.scope, cue.scope) || !string(row.id) || !['user', 'assistant'].includes(row.role)
      || typeof row.text !== 'string' || !ids(row.sourceEventIds) || !time(row.startMs)
      || !time(row.endMs) || row.endMs < row.startMs) {
      rejected.push({ kind: 'turn', id: row.id ?? null, reason: 'invalid_or_cross_scope' }); continue;
    }
    const key = JSON.stringify([row.role, row.text, row.startMs, row.endMs, row.sourceEventIds]);
    if (seenRows.has(row.id)) {
      // An exact duplicate is harmless. Conflicting grouping revisions are not
      // silently treated as two observations or as independent user turns.
      if (seenRows.get(row.id) !== key) {
        rejected.push({ kind: 'turn', id: row.id, reason: 'conflicting_row_revision' }); return result;
      }
      continue;
    }
    if (row.sourceEventIds.some(id => eventOwners.has(id))) {
      rejected.push({ kind: 'turn', id: row.id, reason: 'source_event_reused_across_rows' }); return result;
    }
    seenRows.set(row.id, key);
    row.sourceEventIds.forEach(id => eventOwners.set(id, row.id)); rows.push(row);
  }
  rows.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const anchor = rows.find(row => row.role === 'user' && cue.sourceEventIds.every(id => row.sourceEventIds.includes(id)));
  if (!anchor || cue.timelineMs < anchor.startMs) {
    rejected.push({ kind: 'cue', reason: 'missing_or_invalid_anchor' }); return result;
  }
  const following = rows.filter(row => row.role === 'user' && row.id !== anchor.id && row.startMs >= anchor.endMs);
  const boundary = following[3]?.startMs ?? Infinity;
  const windowRows = rows.filter(row => row.id !== anchor.id && row.startMs >= cue.timelineMs
    && row.startMs < boundary && row.endMs <= boundary);
  const byId = new Map(windowRows.map(row => [row.id, row]));
  result.valid = true;
  result.window = { ...result.window, anchorId: anchor.id, followingUserIds: following.slice(0, 3).map(row => row.id),
    rowIds: windowRows.map(row => row.id), endMs: Number.isFinite(boundary) ? boundary : null };
  if (!cue.sent) result.receipt.status = 'not_sent';
  for (const ack of contextAcknowledgments) {
    if (!cue.sent || !sameScope(ack.scope, cue.scope) || ack.type !== 'session.thinking.appended'
      || ack.client_event_id !== cue.eventId || !string(ack.event_id) || !time(ack.start_ms)
      || !time(ack.end_ms) || ack.end_ms < ack.start_ms || ack.start_ms < cue.timelineMs) {
      rejected.push({ kind: 'acknowledgment', id: ack.event_id ?? null, reason: 'unmatched_or_invalid' }); continue;
    }
    result.receipt.status = 'acknowledged';
    result.receipt.sourceEventIds = unique([...result.receipt.sourceEventIds, ack.event_id]);
    result.receipt.estimatedStartMs = Math.min(result.receipt.estimatedStartMs ?? Infinity, ack.start_ms);
    result.receipt.estimatedEndMs = Math.max(result.receipt.estimatedEndMs ?? 0, ack.end_ms);
  }

  const reviewed = [], evaluationIds = new Set();
  for (const review of evaluations) {
    const row = byId.get(review.rowId);
    const methodOK = review.method === 'human_review' || allowFixtureLabels && review.method === 'fixture_label';
    const baseOK = string(review.id) && !evaluationIds.has(review.id) && review.cueId === cue.id && methodOK
      && string(review.reviewerId) && review.reviewed === true && sameScope(review.scope, cue.scope)
      && row && ids(review.sourceEventIds) && review.sourceEventIds.length === row.sourceEventIds.length
      && review.sourceEventIds.every(id => row.sourceEventIds.includes(id)) && string(review.quote)
      && row.text.includes(review.quote);
    const adaptation = review.dimension === 'assistant_adaptation' && row?.role === 'assistant'
      && ['adapted', 'not_adapted', 'unclear'].includes(review.label);
    const clarity = review.dimension === 'caller_clarity' && row?.role === 'user'
      && ['reported_clear', 'reported_unclear', 'acknowledgment_only', 'unclear'].includes(review.label);
    const needAddressed = review.dimension === 'need_addressed' && row?.role === 'assistant'
      && ['addressed', 'not_addressed', 'unclear'].includes(review.label);
    const flow = review.dimension === 'conversational_flow' && row?.role === 'assistant'
      && ['preserved', 'repetition', 'abrupt_pivot', 'unnecessary_speech', 'unclear'].includes(review.label)
      && (review.basis === 'transcript_review' || review.basis === 'audio_review' && string(review.recordingId));
    const clarityBasisOK = !clarity || !['reported_clear', 'reported_unclear'].includes(review.label)
      || ['explicit_self_report', 'substantive_paraphrase'].includes(review.basis) && !bareAcknowledgment(review.quote);
    if (!baseOK || !(adaptation || clarity || needAddressed || flow) || !clarityBasisOK) {
      rejected.push({ kind: 'evaluation', id: review.id ?? null, reason: 'unreviewed_unmatched_or_unsupported' }); continue;
    }
    evaluationIds.add(review.id); reviewed.push({ ...review, row });
    if (review.method === 'fixture_label') result.synthetic = true;
  }
  const adaptation = reviewed.filter(row => row.dimension === 'assistant_adaptation');
  const adapted = adaptation.filter(row => row.label === 'adapted');
  const notAdapted = adaptation.filter(row => row.label === 'not_adapted');
  result.adaptation = { status: adapted.length && notAdapted.length ? 'mixed'
    : adapted.length ? 'observed' : notAdapted.length ? 'not_observed' : 'unknown',
  evaluationIds: adaptation.map(row => row.id), sourceEventIds: unique(adaptation.flatMap(row => row.sourceEventIds)) };
  const addressed = reviewed.filter(row => row.dimension === 'need_addressed');
  const positive = addressed.some(row => row.label === 'addressed');
  const negative = addressed.some(row => row.label === 'not_addressed');
  result.needAddressed = { status: positive && negative ? 'mixed' : positive ? 'observed' : negative ? 'not_observed' : 'unknown',
    evaluationIds: addressed.map(row => row.id), sourceEventIds: unique(addressed.flatMap(row => row.sourceEventIds)) };
  for (const [section, basis] of [['transcriptFlow', 'transcript_review'], ['audibleFlow', 'audio_review']]) {
    const flow = reviewed.filter(row => row.dimension === 'conversational_flow' && row.basis === basis);
    const issues = unique(flow.map(row => row.label).filter(label => !['preserved', 'unclear'].includes(label)));
    result[section] = { status: issues.length ? 'issue_observed' : flow.some(row => row.label === 'preserved') ? 'no_issue_observed' : 'unknown',
      evaluationIds: flow.map(row => row.id), sourceEventIds: unique(flow.flatMap(row => row.sourceEventIds)), issues,
      ...(basis === 'audio_review' ? { recordingIds: unique(flow.map(row => row.recordingId)) } : {}) };
  }
  const clarity = reviewed.filter(row => row.dimension === 'caller_clarity');
  const clear = clarity.some(row => row.label === 'reported_clear');
  const unclear = clarity.some(row => row.label === 'reported_unclear');
  result.callerClarity = { status: clear && unclear ? 'mixed' : clear ? 'reported_clear' : unclear ? 'reported_unclear' : 'unknown',
    evaluationIds: clarity.map(row => row.id), sourceEventIds: unique(clarity.flatMap(row => row.sourceEventIds)) };

  // Playback concerns the reviewed adapted contribution(s), not merely any
  // audio near the cue. The harness's RMS and native audio deltas alone cannot
  // establish the words actually played to a caller.
  const targetIds = new Set(adapted.flatMap(row => row.sourceEventIds));
  const targetRows = new Map(adapted.flatMap(review => review.sourceEventIds.map(id => [id, review.row])));
  const covered = new Set(), partial = new Set(), activity = new Set(), acceptedPlayback = [];
  const seenPlayback = new Set();
  for (const observation of playback) {
    if (!string(observation.id) || seenPlayback.has(observation.id) || !sameScope(observation.scope, cue.scope)
      || !ids(observation.outputSourceEventIds) || !observation.outputSourceEventIds.every(id => targetIds.has(id))
      || !time(observation.startMs) || !time(observation.endMs) || observation.endMs < observation.startMs
      || observation.startMs < cue.timelineMs || observation.startMs >= boundary || observation.endMs > boundary) {
      rejected.push({ kind: 'playback', id: observation.id ?? null, reason: 'unmatched_or_invalid' }); continue;
    }
    const actualPlayback = observation.kind === 'client_playback' && observation.muted === false
      && observation.dropped === false && ['completed', 'interrupted'].includes(observation.status)
      && ['complete', 'partial'].includes(observation.coverage);
    const activityOnly = observation.kind === 'audio_activity';
    if (!actualPlayback && !activityOnly) {
      rejected.push({ kind: 'playback', id: observation.id, reason: 'no_playback_evidence' }); continue;
    }
    const outputRows = [...new Map(observation.outputSourceEventIds.map(id => {
      const row = targetRows.get(id); return [row.id, row];
    })).values()];
    const firstOutputMs = Math.min(...outputRows.map(row => row.startMs));
    const lastOutputMs = Math.max(...outputRows.map(row => row.endMs));
    const claimsComplete = actualPlayback && observation.status === 'completed' && observation.coverage === 'complete';
    if (observation.endMs < firstOutputMs || claimsComplete
      && (observation.startMs < firstOutputMs || observation.endMs < lastOutputMs
        || observation.endMs - observation.startMs < intervalDuration(outputRows))) {
      rejected.push({ kind: 'playback', id: observation.id, reason: 'timing_inconsistent_with_output' }); continue;
    }
    seenPlayback.add(observation.id); acceptedPlayback.push(observation.id);
    const sink = activityOnly ? activity : observation.status === 'completed' && observation.coverage === 'complete' ? covered : partial;
    observation.outputSourceEventIds.forEach(id => sink.add(id));
  }
  result.playback = { status: targetIds.size > 0 && covered.size === targetIds.size ? 'confirmed'
    : covered.size || partial.size ? 'partial' : activity.size ? 'activity_only' : 'unknown',
  evidenceIds: acceptedPlayback, sourceEventIds: unique([...covered, ...partial, ...activity]) };
  return result;
}

// Counts keep their own denominators. There is deliberately no combined
// "naturalness", understanding percentage or causal-lift calculation.
export function summarizeSupportOutcomes(outcomes = []) {
  const valid = outcomes.filter(row => row?.version === SUPPORT_OUTCOME_VERSION && row.valid);
  const count = (rows, section, status) => rows.filter(row => row[section]?.status === status).length;
  const languages = unique(valid.map(row => row.language));
  return { version: SUPPORT_OUTCOME_VERSION, samples: valid.length, invalidSamples: outcomes.length - valid.length,
    inference: 'association_only_not_causal', byLanguage: Object.fromEntries(languages.map(language => {
      const rows = valid.filter(row => row.language === language);
      return [language, { samples: rows.length, syntheticSamples: rows.filter(row => row.synthetic).length,
        sent: rows.length - count(rows, 'receipt', 'not_sent'), acknowledged: count(rows, 'receipt', 'acknowledged'),
        reviewedAdaptation: rows.filter(row => row.adaptation.status !== 'unknown').length,
        adaptationObserved: count(rows, 'adaptation', 'observed'), adaptationMixed: count(rows, 'adaptation', 'mixed'),
        reviewedNeedAddressed: rows.filter(row => row.needAddressed.status !== 'unknown').length,
        needAddressed: count(rows, 'needAddressed', 'observed'), needNotAddressed: count(rows, 'needAddressed', 'not_observed'),
        needAddressedMixed: count(rows, 'needAddressed', 'mixed'),
        reviewedTranscriptFlow: rows.filter(row => row.transcriptFlow.status !== 'unknown').length,
        transcriptFlowIssues: count(rows, 'transcriptFlow', 'issue_observed'),
        reviewedAudibleFlow: rows.filter(row => row.audibleFlow.status !== 'unknown').length,
        audibleFlowIssues: count(rows, 'audibleFlow', 'issue_observed'),
        playbackConfirmed: count(rows, 'playback', 'confirmed'), playbackPartial: count(rows, 'playback', 'partial'),
        audioActivityOnly: count(rows, 'playback', 'activity_only'),
        callerReportedClear: count(rows, 'callerClarity', 'reported_clear'),
        callerReportedUnclear: count(rows, 'callerClarity', 'reported_unclear'),
        callerClarityMixed: count(rows, 'callerClarity', 'mixed'), callerClarityUnknown: count(rows, 'callerClarity', 'unknown') }];
    })) };
}
